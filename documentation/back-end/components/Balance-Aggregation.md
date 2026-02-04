# Component 7: Balance Aggregation (Multi-Chain)

---

## 1. Summary

Balance aggregation across multiple chains is the critical infrastructure layer that enables stealth address wallets to present a unified portfolio view despite funds being scattered across potentially hundreds of one-time addresses on multiple EVM chains. Unlike standard wallets that track a single address per chain, stealth address systems must query balances for N stealth addresses × M tokens × C chains — creating an exponential query problem that demands specialized batching, caching, and privacy-preserving strategies.

This document covers production implementations from Fluidkey, Umbra, and general-purpose indexer APIs (Alchemy, Moralis, Covalent/GoldRush), alongside the on-chain batching primitive Multicall3 and its integration with Viem. It analyzes the privacy implications of each approach, provides production-ready TypeScript code, and recommends an architecture optimized for Account Abstraction (ERC-4337) stealth wallets at Openfort.

---

## 2. The Multi-Chain Balance Problem for Stealth Addresses

### 2.1 Problem Statement

A standard wallet queries balances for **1 address × M tokens × C chains**. A stealth address wallet must query **N addresses × M tokens × C chains**, where N can grow to hundreds or thousands over time.

```
Standard Wallet Query Load:
  1 address × 10 tokens × 6 chains = 60 balance queries

Stealth Address Wallet (100 addresses):
  100 addresses × 10 tokens × 6 chains = 6,000 balance queries

Stealth Address Wallet (500 addresses):
  500 addresses × 10 tokens × 6 chains = 30,000 balance queries
```

Without batching, this creates catastrophic RPC costs and latency. The fundamental challenge is reducing these thousands of queries to a manageable number while preserving privacy (not leaking the relationship between stealth addresses).

### 2.2 Dimensions of the Problem

```
┌─────────────────────────────────────────────────────────────────────┐
│                 MULTI-CHAIN BALANCE AGGREGATION                     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   Dimension 1: ADDRESS CARDINALITY                                  │
│   ├── Hundreds of stealth addresses per user                        │
│   ├── New address per incoming payment                              │
│   └── Addresses span multiple chains                                │
│                                                                     │
│   Dimension 2: TOKEN DIVERSITY                                      │
│   ├── Known tokens (from announcement metadata)                     │
│   ├── Unknown tokens (airdrops, unexpected transfers)               │
│   └── Native ETH (requires separate query method)                   │
│                                                                     │
│   Dimension 3: CHAIN COVERAGE                                       │
│   ├── Ethereum mainnet                                              │
│   ├── L2s: Base, Optimism, Arbitrum, Polygon, Gnosis                │
│   └── Each chain has independent state                              │
│                                                                     │
│   Dimension 4: PRIVACY                                              │
│   ├── Batch queries reveal address linkage to RPC provider          │
│   ├── Timing correlation between queries                            │
│   └── API providers see all addresses (metadata leak)               │
│                                                                     │
│   Dimension 5: FRESHNESS                                            │
│   ├── Real-time vs. cached balances                                 │
│   ├── Block-level consistency guarantees                            │
│   └── Stale balance risk for spending decisions                     │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. On-Chain Batching: Multicall3

### 3.1 Overview

Multicall3 is the foundational on-chain primitive for batching balance queries. It aggregates multiple contract read calls into a single `eth_call` JSON-RPC request, returning all results atomically from the same block.

**Contract Address (deterministic across all chains):**
```
0xcA11bde05977b3631167028862bE2a173976CA11
```

**Deployment:** Over 250+ EVM chains via CREATE2 deterministic deployer at `0x4e59b44847b379578588920ca78fbf26c0b4956c`.

### 3.2 Key Functions for Balance Aggregation

```solidity
// Primary batching function
function aggregate3(
    Call3[] calldata calls
) public payable returns (Result[] memory returnData);

struct Call3 {
    address target;      // Token contract address
    bool allowFailure;   // true = don't revert if call fails
    bytes callData;      // Encoded function call (e.g., balanceOf)
}

struct Result {
    bool success;
    bytes returnData;
}

// Native ETH balance helper
function getEthBalance(
    address addr
) public view returns (uint256 balance);
```

### 3.3 Viem Native Integration

Viem provides first-class Multicall3 support via `client.multicall()`. This is the recommended interface for TypeScript stealth address implementations.

```typescript
import {
  createPublicClient,
  http,
  parseAbi,
  formatUnits,
  type Address,
  type Chain,
} from 'viem';
import { base, optimism, arbitrum, mainnet, polygon, gnosis } from 'viem/chains';

const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);

// Token registry per chain
interface TokenConfig {
  address: Address;
  symbol: string;
  decimals: number;
}

const CHAIN_TOKENS: Record<number, TokenConfig[]> = {
  8453: [ // Base
    { address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', symbol: 'USDC', decimals: 6 },
    { address: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb', symbol: 'DAI', decimals: 18 },
  ],
  10: [ // Optimism
    { address: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85', symbol: 'USDC', decimals: 6 },
    { address: '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58', symbol: 'USDT', decimals: 6 },
  ],
  // ... additional chains
};

/**
 * Batch query ERC-20 balances for multiple stealth addresses on a single chain
 * using Viem's native multicall (routes through Multicall3 on-chain)
 */
async function batchBalanceQuery(
  chain: Chain,
  rpcUrl: string,
  stealthAddresses: Address[],
  tokens: TokenConfig[],
): Promise<Map<Address, Map<string, bigint>>> {
  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
    batch: { multicall: true },
  });

  // Build contract call array: N addresses × M tokens
  const contracts = stealthAddresses.flatMap((stealthAddr) =>
    tokens.map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: 'balanceOf' as const,
      args: [stealthAddr] as const,
    }))
  );

  // Single eth_call via Multicall3
  const results = await client.multicall({
    contracts,
    allowFailure: true,
    batchSize: 4096, // 4kB per batch chunk
  });

  // Parse results into structured map
  const balanceMap = new Map<Address, Map<string, bigint>>();

  let idx = 0;
  for (const stealthAddr of stealthAddresses) {
    const tokenBalances = new Map<string, bigint>();
    for (const token of tokens) {
      const result = results[idx];
      if (result.status === 'success') {
        tokenBalances.set(token.symbol, result.result as bigint);
      } else {
        tokenBalances.set(token.symbol, 0n);
      }
      idx++;
    }
    balanceMap.set(stealthAddr, tokenBalances);
  }

  return balanceMap;
}
```

### 3.4 Native ETH Balance Batching

Native ETH balances cannot be queried via `balanceOf()`. Multicall3 provides a dedicated `getEthBalance()` helper, or Viem's multicall can target the Multicall3 contract itself:

```typescript
import { multicall3Abi } from 'viem';

const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11';

async function batchNativeBalances(
  client: PublicClient,
  stealthAddresses: Address[],
): Promise<Map<Address, bigint>> {
  const contracts = stealthAddresses.map((addr) => ({
    address: MULTICALL3_ADDRESS,
    abi: parseAbi([
      'function getEthBalance(address addr) view returns (uint256 balance)',
    ]),
    functionName: 'getEthBalance' as const,
    args: [addr] as const,
  }));

  const results = await client.multicall({
    contracts,
    allowFailure: true,
  });

  const balances = new Map<Address, bigint>();
  stealthAddresses.forEach((addr, i) => {
    const result = results[i];
    balances.set(addr, result.status === 'success' ? (result.result as bigint) : 0n);
  });

  return balances;
}
```

### 3.5 Batch Size Limits and Chunking

RPC providers impose limits on calldata size per `eth_call`. Production guidelines:

| Provider        | Recommended Batch Size | Max Calls/Request |
|-----------------|------------------------|-------------------|
| QuickNode       | 50-100 calls           | ~200              |
| Alchemy         | 50-100 calls           | ~150              |
| Infura          | 30-50 calls            | ~100              |
| Self-hosted     | 100-200 calls          | Depends on config |
| Viem default    | 4096 bytes (~100 calls)| Auto-chunked      |

Viem auto-chunks based on the `batchSize` parameter (measured in bytes of encoded calldata). For stealth address use cases with 100+ addresses × 10 tokens, expect 5-10 chunked multicalls per chain.

```typescript
// Explicit chunking for large address sets
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

async function queryAllBalances(
  client: PublicClient,
  stealthAddresses: Address[],
  tokens: TokenConfig[],
): Promise<Map<Address, Map<string, bigint>>> {
  const CHUNK_SIZE = 50; // addresses per multicall
  const chunks = chunkArray(stealthAddresses, CHUNK_SIZE);
  const allBalances = new Map<Address, Map<string, bigint>>();

  for (const chunk of chunks) {
    const contracts = chunk.flatMap((addr) =>
      tokens.map((token) => ({
        address: token.address,
        abi: erc20Abi,
        functionName: 'balanceOf' as const,
        args: [addr] as const,
      }))
    );

    const results = await client.multicall({ contracts, allowFailure: true });

    let idx = 0;
    for (const addr of chunk) {
      const tokenBalances = new Map<string, bigint>();
      for (const token of tokens) {
        const r = results[idx++];
        tokenBalances.set(token.symbol, r.status === 'success' ? (r.result as bigint) : 0n);
      }
      allBalances.set(addr, tokenBalances);
    }
  }

  return allBalances;
}
```

### 3.6 Consistency Guarantees

Multicall3 provides **block-level atomicity**: all calls within a single `aggregate3` execute against the same block state. This is critical for stealth address wallets because it ensures the portfolio view reflects a consistent snapshot. However, cross-chain consistency is not guaranteed — each chain's multicall returns data from its own latest block.

---

## 4. Indexer API Approaches

### 4.1 Alchemy Portfolio API

Alchemy's Portfolio API is the most mature multi-chain balance aggregation service, supporting 30+ EVM chains with a single endpoint.

**Endpoint:** `POST /data/v1/:apiKey/assets/tokens/balances/by-address`

**Key Capabilities:**
- Multi-address + multi-network in a single request
- Limit: 3 address/network pairs per request, max 20 networks per pair
- Returns native tokens, ERC-20 tokens, with optional metadata and prices
- Supported on Ethereum, Base, Optimism, Arbitrum, Polygon, and 25+ more chains

**Stealth Address Usage Pattern:**

```typescript
import { Alchemy, Network } from 'alchemy-sdk';

interface AlchemyBalanceResult {
  network: string;
  address: string;
  tokenAddress: string | null; // null = native token
  tokenBalance: string;
}

/**
 * Query balances for stealth addresses via Alchemy Portfolio API
 *
 * PRIVACY WARNING: Alchemy sees all queried addresses.
 * This reveals the link between stealth addresses to Alchemy.
 */
async function queryAlchemyPortfolio(
  apiKey: string,
  stealthAddresses: Address[],
  networks: string[],
): Promise<AlchemyBalanceResult[]> {
  const BATCH_SIZE = 3; // Alchemy limit: 3 address/network pairs
  const allResults: AlchemyBalanceResult[] = [];

  // Chunk addresses into batches of 3
  const chunks = chunkArray(stealthAddresses, BATCH_SIZE);

  for (const chunk of chunks) {
    const payload = {
      addresses: chunk.map((addr) => ({
        address: addr,
        networks,
      })),
      includeNativeTokens: true,
      includeErc20Tokens: true,
    };

    const response = await fetch(
      `https://api.g.alchemy.com/data/v1/${apiKey}/assets/tokens/balances/by-address`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    );

    const data = await response.json();
    allResults.push(...data.data.tokens);
  }

  return allResults;
}
```

**Single-Chain Token Balance API (Legacy):**

```typescript
// alchemy_getTokenBalances — single address, single chain
// Useful for "unknown token discovery" (finds ALL ERC-20 tokens an address holds)
const response = await fetch(`https://eth-mainnet.g.alchemy.com/v2/${apiKey}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'alchemy_getTokenBalances',
    params: [stealthAddress, 'erc20'], // 'erc20' discovers ALL tokens
    id: 1,
  }),
});
```

### 4.2 Moralis Wallet API

Moralis provides cross-chain wallet balance queries with enriched metadata (prices, logos, labels).

**Key Endpoints:**
- `getWalletTokenBalances` — ERC-20 balances per address per chain
- `getNativeBalance` — Native token balance
- `getWalletNetWorth` — USD net worth aggregation

**Stealth Address Considerations:**
- Works with Account Abstraction: fetches balances for smart contract accounts
- Cross-chain: supports Ethereum, Polygon, BNB Chain, Optimism, Arbitrum, Avalanche, Base, and more
- Rate limits: plan-dependent (free tier: 25 requests/second)

```typescript
import Moralis from 'moralis';

async function queryMoralisBalances(
  stealthAddresses: Address[],
  chainId: string, // '0x1', '0x2105' (Base), etc.
): Promise<Map<Address, any[]>> {
  await Moralis.start({ apiKey: process.env.MORALIS_API_KEY });

  const results = new Map<Address, any[]>();

  for (const addr of stealthAddresses) {
    const response = await Moralis.EvmApi.token.getWalletTokenBalances({
      address: addr,
      chain: chainId,
    });
    results.set(addr, response.toJSON());
  }

  return results;
}
```

### 4.3 Covalent GoldRush API

Covalent (now GoldRush) provides a unified API across 210+ chains with a consistent response schema. Switching chains is simply changing the `chainName` path parameter.

**Key Endpoint:**
```
GET /v1/{chainName}/address/{walletAddress}/balances_v2/
```

Returns native, ERC-20, and NFT (ERC-721/1155) tokens held by an address, including spot prices and metadata.

**Stealth Address Pattern:**
```typescript
import { CovalentClient } from '@covalenthq/client-sdk';

async function queryCovalentBalances(
  stealthAddresses: Address[],
  chainName: string, // 'eth-mainnet', 'base-mainnet', etc.
): Promise<Map<Address, any>> {
  const client = new CovalentClient(process.env.COVALENT_API_KEY!);
  const results = new Map<Address, any>();

  for (const addr of stealthAddresses) {
    const resp = await client.BalanceService.getTokenBalancesForWalletAddress(
      chainName,
      addr,
    );
    results.set(addr, resp.data);
  }

  return results;
}
```

### 4.4 Comparison Matrix

| Feature                     | Multicall3 (Direct) | Alchemy Portfolio | Moralis Wallet | Covalent GoldRush |
|-----------------------------|---------------------|-------------------|----------------|-------------------|
| **Multi-chain single call** | No (1 chain/call)   | Yes (20 networks) | No (1 chain)   | No (1 chain)      |
| **Multi-address single call** | Yes (via batch)   | Yes (3 addresses) | No (1 address) | No (1 address)    |
| **Unknown token discovery** | No                  | Yes               | Yes            | Yes               |
| **Native ETH balance**      | Yes (getEthBalance) | Yes               | Yes            | Yes               |
| **USD prices**              | No                  | Optional          | Yes            | Yes               |
| **Token metadata**          | No                  | Optional          | Yes            | Yes               |
| **Block-level atomicity**   | Yes                 | No                | No             | No                |
| **Privacy (no 3rd party)**  | Yes (self-hosted)   | No (Alchemy sees) | No             | No                |
| **Free tier**               | Yes (just RPC)      | 100M CU/month     | 25 req/sec     | 100K credits      |
| **Smart account support**   | Yes                 | Yes               | Yes            | Yes               |
| **Chains supported**        | 250+                | 30+               | 15+            | 210+              |

---

## 5. Production Implementations

### 5.1 Fluidkey: Server-Side Aggregation Model

Fluidkey is the most advanced production implementation of multi-chain stealth address balance aggregation.

**Architecture:**

```
┌──────────────┐     ┌───────────────────┐     ┌───────────────────┐
│   User's     │     │   Fluidkey        │     │  Multi-Chain      │
│   Browser    │────▶│   Backend         │────▶│  RPC Nodes        │
│              │     │                   │     │  (Base, OP, ARB)  │
│  Unified     │◀────│  Balance Cache    │◀────│                   │
│  Dashboard   │     │  + Aggregator     │     │  Multicall3       │
└──────────────┘     └───────────────────┘     └───────────────────┘
```

**Key Design Decisions:**

1. **Server knows all addresses:** Fluidkey's backend holds the BIP-32 viewing key node and can deterministically derive all stealth addresses. This means the server can pre-generate addresses and proactively query balances without waiting for user requests.

2. **CREATE2 predicted addresses:** Fluidkey stealth addresses are Safe smart accounts predicted via CREATE2. The address is known before deployment, and the same predicted address is valid on all EVM chains (because CREATE2 is chain-agnostic with identical factory + salt).

3. **Unified dashboard:** The user sees a single portfolio view. Individual stealth addresses are never shown by default. The aggregated balance is `SUM(balance[addr][token])` across all stealth addresses and chains.

4. **Gas deducted from tokens:** When spending, Fluidkey computes gas costs and deducts them from the token being sent (not native ETH), eliminating the "stealth address has no ETH for gas" problem.

5. **Automatic address selection:** When a user initiates a spend, the backend finds the optimal combination of stealth addresses to cover the target amount, then batch-executes Safe transactions.

**Multi-Chain Balance Flow:**

```
1. User opens dashboard
2. Backend already knows all stealth addresses (BIP-32 derivation)
3. Backend queries Multicall3 on each supported chain:
   - Base:     aggregate3([balanceOf(addr1), balanceOf(addr2), ...])
   - Optimism: aggregate3([balanceOf(addr1), balanceOf(addr2), ...])
   - Arbitrum: aggregate3([balanceOf(addr1), balanceOf(addr2), ...])
4. Backend aggregates results into unified portfolio:
   USDC: $2,500 (across 8 addresses on Base, 3 on Optimism)
   ETH:  0.5 ETH (across 2 addresses on Arbitrum)
5. User sees single balance view
6. Cache updated with TTL-based invalidation
```

**Supported Chains (Production):**

| Chain     | Chain ID | Status     |
|-----------|----------|------------|
| Ethereum  | 1        | Supported  |
| Base      | 8453     | Primary    |
| Optimism  | 10       | Supported  |
| Arbitrum  | 42161    | Supported  |
| Polygon   | 137      | Supported  |
| Gnosis    | 100      | Supported  |

**Additional Chain Support (via Near Intents):**
Fluidkey can receive BTC, USDC, and USDT from 10 additional chains (Bitcoin, Tron, Solana, Binance, Near, Avalanche, Ton, Sui, Stellar, Monad), which are deposited as USDC on Base.

### 5.2 Umbra: Client-Side Scanning Model

> **See also:** [Event Listener](./Event-Listener.md), Sections 4 and 7 for the detailed Umbra scanning architecture (subgraph queries, ViewTag filtering, caching strategy) and ScopeLift SDK integration used in the client-side scanning model.

Umbra takes a fundamentally different approach — fully client-side with no server-side balance aggregation.

**Architecture:**

```
┌──────────────┐     ┌───────────────────┐     ┌───────────────────┐
│   User's     │     │   Umbra App       │     │  Multi-Chain      │
│   Browser    │────▶│   (Client-Side)   │────▶│  RPC Nodes        │
│              │     │                   │     │                   │
│  Payment     │◀────│  Scan + Query     │◀────│  Events + Calls   │
│  List View   │     │  per-address      │     │                   │
└──────────────┘     └───────────────────┘     └───────────────────┘
```

**Key Differences:**

1. **No server knows addresses:** The user's browser scans Announcement events and derives stealth addresses locally. No third party learns which addresses belong to the user.

2. **Per-payment view:** Umbra shows individual payments rather than an aggregated portfolio. Each entry has a "Withdraw" button.

3. **Balance check per address:** After discovering a stealth address, Umbra checks its balance individually. For ETH, the balance was sent directly to the stealth address. For ERC-20 tokens, balances are held in the Umbra contract (not in the stealth address directly).

4. **Withdrawal UX:** The user manually withdraws from each stealth address. There is no automatic consolidation or batched spending.

**Privacy Advantage:** Maximum privacy — no third party (not even the Umbra team) can see which addresses belong to which user.

**Privacy Disadvantage:** The user's browser must query RPC nodes for each stealth address, creating a timing correlation fingerprint at the RPC provider level.

### 5.3 Privacy Comparison

| Aspect                        | Fluidkey (Server)       | Umbra (Client)         |
|-------------------------------|-------------------------|------------------------|
| **Who knows addresses?**      | Fluidkey backend        | Only user's browser    |
| **Address linkage exposed?**  | Yes, to Fluidkey        | Only to RPC provider   |
| **Balance freshness**         | Real-time (server push) | On-demand (user scans) |
| **Aggregation quality**       | Full portfolio          | Per-payment list       |
| **RPC fingerprint**           | Server's IP only        | User's IP per address  |
| **Recovery complexity**       | Low (server has state)  | High (full rescan)     |

---

## 6. Multi-Chain Orchestration Architecture

### 6.1 Parallel Chain Querying

For a production stealth address wallet supporting 6 chains, balance queries should run in parallel across chains but sequentially within each chain (to respect Multicall3 chunk limits).

```typescript
import { createPublicClient, http, type PublicClient, type Chain, type Address } from 'viem';
import { mainnet, optimism, base, arbitrum, polygon, gnosis } from 'viem/chains';

interface ChainConfig {
  chain: Chain;
  rpcUrl: string;
  tokens: TokenConfig[];
  announcerDeployBlock: bigint;
}

const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    chain: mainnet,
    rpcUrl: process.env.ETH_RPC_URL!,
    tokens: [/* ETH mainnet tokens */],
    announcerDeployBlock: 18543663n,
  },
  {
    chain: base,
    rpcUrl: process.env.BASE_RPC_URL!,
    tokens: [/* Base tokens */],
    announcerDeployBlock: 7813958n,
  },
  {
    chain: optimism,
    rpcUrl: process.env.OP_RPC_URL!,
    tokens: [/* Optimism tokens */],
    announcerDeployBlock: 111585236n,
  },
  {
    chain: arbitrum,
    rpcUrl: process.env.ARB_RPC_URL!,
    tokens: [/* Arbitrum tokens */],
    announcerDeployBlock: 151358134n,
  },
  {
    chain: polygon,
    rpcUrl: process.env.POLYGON_RPC_URL!,
    tokens: [/* Polygon tokens */],
    announcerDeployBlock: 50525025n,
  },
  {
    chain: gnosis,
    rpcUrl: process.env.GNOSIS_RPC_URL!,
    tokens: [/* Gnosis tokens */],
    announcerDeployBlock: 31219550n,
  },
];

interface ChainBalance {
  chainId: number;
  chainName: string;
  address: Address;
  tokenSymbol: string;
  tokenAddress: Address;
  balance: bigint;
  decimals: number;
}

interface AggregatedPortfolio {
  totalUsdValue: number;
  chainBreakdown: Map<number, ChainBalance[]>;
  tokenTotals: Map<string, { balance: bigint; decimals: number; addressCount: number }>;
  lastUpdated: Date;
}

/**
 * Query all stealth address balances across all supported chains in parallel
 */
async function aggregateMultiChainBalances(
  stealthAddresses: Address[],
): Promise<AggregatedPortfolio> {
  // Parallel query across all chains
  const chainResults = await Promise.allSettled(
    SUPPORTED_CHAINS.map(async (chainConfig) => {
      const client = createPublicClient({
        chain: chainConfig.chain,
        transport: http(chainConfig.rpcUrl),
      });

      // Query ERC-20 balances via Multicall3
      const tokenBalances = await queryAllBalances(
        client,
        stealthAddresses,
        chainConfig.tokens,
      );

      // Query native ETH balances via Multicall3
      const nativeBalances = await batchNativeBalances(client, stealthAddresses);

      return {
        chainId: chainConfig.chain.id,
        chainName: chainConfig.chain.name,
        tokenBalances,
        nativeBalances,
      };
    })
  );

  // Aggregate results
  const portfolio: AggregatedPortfolio = {
    totalUsdValue: 0,
    chainBreakdown: new Map(),
    tokenTotals: new Map(),
    lastUpdated: new Date(),
  };

  for (const result of chainResults) {
    if (result.status === 'rejected') {
      console.error(`Chain query failed: ${result.reason}`);
      continue;
    }

    const { chainId, chainName, tokenBalances, nativeBalances } = result.value;
    const chainBalances: ChainBalance[] = [];

    // Process ERC-20 balances
    for (const [addr, tokens] of tokenBalances) {
      for (const [symbol, balance] of tokens) {
        if (balance > 0n) {
          chainBalances.push({
            chainId, chainName, address: addr,
            tokenSymbol: symbol,
            tokenAddress: '0x' as Address, // lookup from config
            balance, decimals: 18, // lookup from config
          });

          // Aggregate token totals
          const existing = portfolio.tokenTotals.get(symbol) || {
            balance: 0n, decimals: 18, addressCount: 0,
          };
          portfolio.tokenTotals.set(symbol, {
            balance: existing.balance + balance,
            decimals: existing.decimals,
            addressCount: existing.addressCount + 1,
          });
        }
      }
    }

    // Process native balances
    for (const [addr, balance] of nativeBalances) {
      if (balance > 0n) {
        chainBalances.push({
          chainId, chainName, address: addr,
          tokenSymbol: 'ETH',
          tokenAddress: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address,
          balance, decimals: 18,
        });
      }
    }

    portfolio.chainBreakdown.set(chainId, chainBalances);
  }

  return portfolio;
}
```

### 6.2 Cross-Chain Address Validity

Stealth addresses have special cross-chain properties depending on the implementation:

**EOA Stealth Addresses (Umbra model):**
The derived stealth address (an EOA) is valid on ALL EVM chains by definition. However, funds only exist on the chain where the sender sent them.

**Smart Account Stealth Addresses (Fluidkey model):**
CREATE2-predicted Safe addresses are deterministic across all chains IF the same factory, singleton, and initialization data are used. Fluidkey uses `chainId: 0` in the derivation path specifically to make addresses chain-agnostic.

```typescript
// Fluidkey derivation path for cross-chain stealth addresses
// m/5564'/0'/8'/0'/0'/p'/n'
//                ^
//                chainId = 0 → valid on ALL chains

// The predicted Safe address is the same on every chain
// because CREATE2 depends only on:
//   - deployer address (SafeProxyFactory — same everywhere)
//   - salt (derived from initialization data — same everywhere)
//   - creation code (SafeProxy bytecode — same everywhere)
```

### 6.3 Caching Strategy

```typescript
interface BalanceCache {
  balances: Map<Address, Map<string, bigint>>;
  lastBlock: bigint;
  lastUpdated: Date;
  chainId: number;
}

class MultiChainBalanceCache {
  private caches: Map<number, BalanceCache> = new Map();

  // Cache TTL per chain (L2s update faster)
  private readonly TTL_MS: Record<number, number> = {
    1: 15_000,     // Ethereum: 15 seconds (1 block)
    8453: 2_000,   // Base: 2 seconds
    10: 2_000,     // Optimism: 2 seconds
    42161: 250,    // Arbitrum: 250ms
    137: 2_000,    // Polygon: 2 seconds
    100: 5_000,    // Gnosis: 5 seconds
  };

  isStale(chainId: number): boolean {
    const cache = this.caches.get(chainId);
    if (!cache) return true;
    const ttl = this.TTL_MS[chainId] || 15_000;
    return Date.now() - cache.lastUpdated.getTime() > ttl;
  }

  get(chainId: number): BalanceCache | undefined {
    if (this.isStale(chainId)) return undefined;
    return this.caches.get(chainId);
  }

  set(chainId: number, balances: Map<Address, Map<string, bigint>>, block: bigint): void {
    this.caches.set(chainId, {
      balances,
      lastBlock: block,
      lastUpdated: new Date(),
      chainId,
    });
  }
}
```

---

## 7. Unknown Token Discovery

### 7.1 The Problem

Multicall3 only queries known token contracts. Stealth addresses may receive unexpected tokens (airdrops, spam tokens, legitimate transfers of uncommon tokens). These require an indexer API to discover.

### 7.2 Hybrid Strategy (Recommended)

```
┌──────────────────────────────────────────────────────────────────┐
│                   HYBRID BALANCE STRATEGY                        │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TIER 1: Known Tokens (Real-Time)                                │
│  ├── Method: Multicall3 via Viem                                 │
│  ├── Frequency: Every dashboard load (with cache)                │
│  ├── Privacy: Self-hosted RPC → no 3rd party leak                │
│  └── Tokens: USDC, USDT, DAI, WETH, + chain-specific tokens      │
│                                                                  │
│  TIER 2: Token Discovery (Periodic)                              │
│  ├── Method: Alchemy getTokenBalances("erc20")                   │
│  ├── Frequency: Every 1-4 hours (background job)                 │
│  ├── Privacy: Alchemy sees stealth addresses                     │
│  └── Purpose: Find unexpected tokens, airdrops                   │
│                                                                  │
│  TIER 3: Native ETH (Real-Time)                                  │
│  ├── Method: Multicall3 getEthBalance                            │
│  ├── Frequency: Every dashboard load (with cache)                │
│  └── Privacy: Same as Tier 1                                     │
│                                                                  │
│  TIER 4: Price Enrichment (Cached)                               │
│  ├── Method: CoinGecko / Alchemy Prices API                      │
│  ├── Frequency: Every 5 minutes                                  │
│  └── Privacy: Token addresses only (no wallet leak)              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 8. Privacy-Preserving Balance Queries

### 8.1 Threat Model

When querying balances for stealth addresses, the following information can leak:

| Leakage Vector                   | Leaked To           | Impact                          |
|----------------------------------|---------------------|---------------------------------|
| All stealth addresses in 1 batch | RPC provider        | Links all addresses to 1 user   |
| Query timing correlation         | RPC provider        | Activity fingerprint            |
| IP address + address set         | RPC provider        | Geographic + identity linkage   |
| API key + address set            | Indexer API         | Account-level linkage           |
| Query frequency pattern          | Network observer    | Usage pattern analysis          |

### 8.2 Mitigation Strategies

**Strategy 1: Self-Hosted RPC Nodes**

The highest privacy option: run your own nodes on each supported chain. The RPC provider cannot link addresses because you ARE the RPC provider.

Trade-off: Extremely high operational cost ($1,000-5,000/month per chain for full/archive nodes).

**Strategy 2: Distributed RPC Queries**

Split stealth address batches across multiple RPC providers so no single provider sees all addresses.

```typescript
async function distributedQuery(
  stealthAddresses: Address[],
  rpcProviders: string[], // Multiple RPC URLs
): Promise<Map<Address, Map<string, bigint>>> {
  // Shuffle addresses and distribute across providers
  const shuffled = [...stealthAddresses].sort(() => Math.random() - 0.5);
  const perProvider = Math.ceil(shuffled.length / rpcProviders.length);

  const results = await Promise.all(
    rpcProviders.map((rpc, i) => {
      const chunk = shuffled.slice(i * perProvider, (i + 1) * perProvider);
      const client = createPublicClient({
        chain: base,
        transport: http(rpc),
      });
      return queryAllBalances(client, chunk, CHAIN_TOKENS[8453]);
    })
  );

  // Merge results
  const merged = new Map<Address, Map<string, bigint>>();
  for (const result of results) {
    for (const [addr, balances] of result) {
      merged.set(addr, balances);
    }
  }
  return merged;
}
```

**Strategy 3: Randomized Query Timing**

Add jitter to balance query intervals so the timing pattern doesn't fingerprint the user.

```typescript
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = minMs + Math.random() * (maxMs - minMs);
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function privacyAwareQuery(
  stealthAddresses: Address[],
  client: PublicClient,
  tokens: TokenConfig[],
): Promise<Map<Address, Map<string, bigint>>> {
  const CHUNK_SIZE = 20; // Smaller chunks = less linkage per batch
  const chunks = chunkArray(stealthAddresses, CHUNK_SIZE);
  const allBalances = new Map<Address, Map<string, bigint>>();

  for (const chunk of chunks) {
    // Random delay between chunks (1-5 seconds)
    await randomDelay(1000, 5000);

    const result = await queryAllBalances(client, chunk, tokens);
    for (const [addr, balances] of result) {
      allBalances.set(addr, balances);
    }
  }

  return allBalances;
}
```

**Strategy 4: Privacy-Preserving RPCs**

Use privacy-focused RPC services that don't log requests or correlate addresses:

| Service       | Approach                           | URL                           |
|---------------|------------------------------------|-------------------------------|
| **RPCh**      | HOPR mixnet-based RPC proxy        | rpch.net                      |
| **DERP**      | Visualize RPC data leaks           | github.com/ScopeLift/derp     |
| **Tor Proxy** | Route RPC via Tor hidden services  | Self-configured               |
| **MEV Blocker** | Private transaction submission   | mevblocker.io (read-only OK)  |

**Strategy 5: Decoy Queries (Cover Traffic)**

Mix real stealth address queries with queries for random addresses to mask which addresses actually belong to the user.

```typescript
async function queriesWithDecoys(
  realAddresses: Address[],
  client: PublicClient,
  tokens: TokenConfig[],
  decoyRatio: number = 0.3, // 30% decoy addresses
): Promise<Map<Address, Map<string, bigint>>> {
  const decoyCount = Math.ceil(realAddresses.length * decoyRatio);
  const decoyAddresses = generateRandomAddresses(decoyCount);
  const allAddresses = [...realAddresses, ...decoyAddresses]
    .sort(() => Math.random() - 0.5); // Shuffle

  const results = await queryAllBalances(client, allAddresses, tokens);

  // Filter out decoys from results
  const realResults = new Map<Address, Map<string, bigint>>();
  for (const addr of realAddresses) {
    const balance = results.get(addr);
    if (balance) realResults.set(addr, balance);
  }

  return realResults;
}

function generateRandomAddresses(count: number): Address[] {
  const addresses: Address[] = [];
  for (let i = 0; i < count; i++) {
    // Generate random 20-byte addresses
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    addresses.push(`0x${hex}` as Address);
  }
  return addresses;
}
```

### 8.3 ACM Anonymity Research Context

The ACM Web Conference 2024 analysis of Umbra found that 48.5% of Ethereum stealth transactions had the recipient identified (65.7% on Arbitrum). The primary heuristics used were:

1. **Withdrawal to registrant address** — withdrawing to the original wallet that registered the stealth meta-address
2. **Timing correlation** — querying/withdrawing shortly after receiving
3. **Amount matching** — round-number amounts that are easy to correlate
4. **RPC provider correlation** — sequential balance checks for multiple addresses from the same IP

This research confirms that good cryptography alone is insufficient — the wallet UX and balance query infrastructure must actively guide privacy-preserving behavior.

---

## 9. Database Schema for Multi-Chain Balances

### 9.1 Production Schema

```sql
-- Per-chain balance cache (updated by balance aggregator)
CREATE TABLE stealth_balances (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    stealth_address     VARCHAR(42) NOT NULL,
    chain_id            INTEGER NOT NULL,
    token_address       VARCHAR(42) NOT NULL, -- 0xEeee...eEEeE for native ETH
    token_symbol        VARCHAR(20),
    token_decimals      SMALLINT DEFAULT 18,
    balance_raw         NUMERIC(78, 0) NOT NULL DEFAULT 0, -- uint256
    balance_usd         NUMERIC(20, 6) DEFAULT 0,
    last_block_checked  BIGINT NOT NULL,
    last_updated        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE(stealth_address, chain_id, token_address)
);

-- Multi-chain scan tracking
CREATE TABLE chain_scan_status (
    user_id             UUID NOT NULL REFERENCES users(id),
    chain_id            INTEGER NOT NULL,
    last_scanned_block  BIGINT NOT NULL,
    total_addresses     INTEGER DEFAULT 0,
    funded_addresses    INTEGER DEFAULT 0,
    last_scan_duration  INTERVAL,
    last_updated        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    PRIMARY KEY (user_id, chain_id)
);

-- Materialized view: aggregated portfolio per user per token
CREATE MATERIALIZED VIEW user_portfolio AS
SELECT
    b.user_id,
    b.token_symbol,
    b.token_address,
    b.token_decimals,
    SUM(b.balance_raw) AS total_balance_raw,
    SUM(b.balance_usd) AS total_balance_usd,
    COUNT(*) FILTER (WHERE b.balance_raw > 0) AS funded_address_count,
    COUNT(DISTINCT b.chain_id) AS chain_count,
    MAX(b.last_updated) AS last_updated
FROM stealth_balances b
GROUP BY b.user_id, b.token_symbol, b.token_address, b.token_decimals;

-- Index for fast portfolio lookups
CREATE INDEX idx_balances_user_chain ON stealth_balances(user_id, chain_id);
CREATE INDEX idx_balances_funded ON stealth_balances(user_id)
    WHERE balance_raw > 0;
CREATE UNIQUE INDEX idx_portfolio_user_token ON user_portfolio(user_id, token_symbol);

-- Refresh strategy: trigger on balance update
-- In practice: REFRESH MATERIALIZED VIEW CONCURRENTLY user_portfolio;
```

### 9.2 Query Patterns

```sql
-- Get user's total portfolio across all chains
SELECT token_symbol, total_balance_raw, total_balance_usd,
       funded_address_count, chain_count
FROM user_portfolio
WHERE user_id = $1
ORDER BY total_balance_usd DESC;

-- Get chain breakdown for a specific token
SELECT chain_id, stealth_address, balance_raw, balance_usd, last_updated
FROM stealth_balances
WHERE user_id = $1 AND token_symbol = $2 AND balance_raw > 0
ORDER BY balance_raw DESC;

-- Find optimal addresses for spending $X of USDC
SELECT stealth_address, chain_id, balance_raw
FROM stealth_balances
WHERE user_id = $1
  AND token_symbol = 'USDC'
  AND balance_raw > 0
ORDER BY balance_raw DESC; -- Greedy: largest first
```


---

## 10. Sources

### Primary Sources

| Resource | URL | Used For |
|----------|-----|----------|
| Multicall3 Repository | https://github.com/mds1/multicall3 | On-chain batching contract |
| Viem Multicall Docs | https://viem.sh/docs/contract/multicall.html | Viem integration |
| Alchemy Portfolio API | https://docs.alchemy.com/reference/portfolio-apis | Multi-chain balance API |
| Alchemy Token API | https://docs.alchemy.com/reference/alchemy-gettokenbalances | Single-chain token balances |
| Moralis Wallet API | https://moralis.com/api/wallet/ | Cross-chain wallet data |
| Covalent GoldRush API | https://goldrush.dev/docs/api/ | Unified multi-chain API |
| Fluidkey Docs | https://docs.fluidkey.com | Production stealth wallet |
| Fluidkey Stealth Account Kit | https://github.com/fluidkey/fluidkey-stealth-account-kit | Open-source SDK |

### Stealth Address Standards

| Resource | URL | Used For |
|----------|-----|----------|
| ERC-5564 | https://eips.ethereum.org/EIPS/eip-5564 | Core stealth address standard |
| ERC-6538 | https://eips.ethereum.org/EIPS/eip-6538 | Stealth meta-address registry |
| ScopeLift SDK | https://github.com/ScopeLift/stealth-address-sdk | Reference TypeScript SDK |

### Privacy & Security Analysis

| Resource | URL | Used For |
|----------|-----|----------|
| ACM 2024 Anonymity Analysis | WWW '24 proceedings | Deanonymization heuristics |
| Privacy in Ethereum (simbro) | https://simbro.medium.com/privacy-in-ethereum-stealth-addresses-f05016109010 | Production comparison |
| Vitalik Stealth Guide | https://vitalik.eth.limo/general/2023/01/20/stealth.html | Conceptual foundation |
| Web3Privacy Now | https://github.com/web3privacy/web3privacy | Privacy RPC catalog |
| Bankless Fluidkey Guide | https://www.bankless.com/read/fluidkey-bank-base | UX patterns |

### Tutorials & Integration Guides

| Resource | URL | Used For |
|----------|-----|----------|
| QuickNode Multicall Guide | https://www.quicknode.com/guides/ethereum-development/transactions/how-to-optimize-ethereum-rpc-usage-with-multicall | Multicall3 + Viem tutorial |
| Chainstack Stealth Guide | https://chainstack.com/stealth-addresses-blockchain-transaction-privacy/ | Balance query patterns |
| ENS + Fluidkey | https://ens.domains/blog/post/private-transactions-with-fluidkey | ENS stealth integration |
| Fluidkey Medium Deep Dive | https://medium.com/@0xswayam/introduction-stealth-addresses-how-fluid-key-enhances-user-privacy-19316ff06e0d | Architecture analysis |
