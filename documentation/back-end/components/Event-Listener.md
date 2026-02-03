# Component 5: Event Listener / Announcement Indexer

## Deep Research — Production Solutions & Implementation Patterns

**Scope:** Infrastructure to monitor, capture, and index `Announcement` events emitted by the ERC-5564 singleton contract, enabling recipients to discover incoming stealth payments across multiple EVM chains.

**Research Date:** February 2026

---

## 1. Executive Summary

The Event Listener / Announcement Indexer is the most infrastructure-heavy component in any stealth address backend. Every stealth payment triggers an `Announcement` event on-chain, and recipients must scan *all* announcements across *all* supported chains to find payments addressed to them. This creates a significant scaling challenge: as the anonymity set grows (more total announcements), scanning cost increases linearly unless optimized.

Production implementations have diverged into three fundamentally different architectures:

**Umbra Cash** (decentralized, client-side scanning) — Uses The Graph subgraphs for historical indexing combined with direct RPC queries for real-time data. All cryptographic scanning happens in the user's browser, preserving maximum privacy. Advanced caching eliminated redundant rescanning, reducing returning-user wait times from ~60 seconds to ~5-10 seconds on Arbitrum.

**Fluidkey** (server-side scanning, no announcement parsing) — Bypasses the announcement indexer entirely. Because users delegate their BIP-32 viewing key node to Fluidkey's server, the server deterministically derives all possible stealth addresses and monitors them directly via QuickNode's real-time block notification infrastructure. This eliminates the announcement parsing bottleneck but trades privacy for UX.

**Reth ExEx** (node-level scanning, experimental) — A Reth Execution Extension implementing ERC-5564 stealth address scanning at the node level. This approach enables scanning at native execution speed without RPC overhead, representing the most performant and trustless architecture but requiring users to run their own node.

**ScopeLift SDK** (reference implementation) — The `@scopelift/stealth-address-sdk` provides `getAnnouncements`, `getAnnouncementsForUser`, and `watchAnnouncementsForUser` as the canonical SDK actions for announcement retrieval and parsing, built on top of Viem's `getLogs` abstraction.

The viewTag optimization (first byte of announcement metadata) remains the single most impactful performance feature, enabling recipients to skip 99.6% of announcements with a single byte comparison before performing expensive elliptic curve operations.

---

## 2. The ERC-5564 Announcement Event Specification

### 2.1 Contract and Event Structure

The ERC5564Announcer is a singleton contract deployed at a deterministic address on all EVM chains via CREATE2:

```
ERC5564Announcer: 0x55649E01B5Df198D18D95b5cc5051630cfD45564
CREATE2 Salt:     0xd0103a290d760f027c9ca72675f5121d725397fb2f618f05b6c44958b25b4447
```

The contract exposes a single function and event:

```solidity
// SPDX-License-Identifier: MIT
// ERC-5564 Canonical Implementation

interface IERC5564Announcer {
    /// @dev Emitted when something is sent to a stealth address.
    event Announcement(
        uint256 indexed schemeId,       // Cryptographic scheme (1 = SECP256k1)
        address indexed stealthAddress, // The generated one-time address
        address indexed caller,         // msg.sender (typically the sending contract or EOA)
        bytes ephemeralPubKey,          // 33-byte compressed SECP256k1 public key
        bytes metadata                  // View tag (byte 0) + optional token/amount info
    );

    /// @dev Called by integrators to emit an Announcement event.
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes memory metadata
    ) external;
}
```

### 2.2 Indexed vs Non-Indexed Parameters

The event uses three indexed parameters (`schemeId`, `stealthAddress`, `caller`) which appear as `topics[1]`, `topics[2]`, `topics[3]` in the log. This design enables:

- **Filtering by schemeId:** Only retrieve announcements for SECP256k1 (schemeId = 1)
- **Filtering by stealthAddress:** Check if a specific address received funds (rare use case)
- **Filtering by caller:** Implement allowlist/denylist for spam filtering

The non-indexed data (`ephemeralPubKey`, `metadata`) is ABI-encoded in the log's `data` field and must be decoded after retrieval.

### 2.3 Event Topic Hash

```
keccak256("Announcement(uint256,address,address,bytes,bytes)")
= 0x5f0eab8c...  // The topic[0] signature hash
```

This topic hash is identical across all chains, enabling unified log filtering.

### 2.4 Metadata Structure (ERC-5564 Standard)

```
Byte 0:       viewTag (REQUIRED — first byte of keccak256(sharedSecret))
Bytes 1-4:    Function selector (0xeeeeeeee = native ETH, 0x23b872dd = ERC-20 transfer)
Bytes 5-24:   Token contract address (0xEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEeEe for native ETH)
Bytes 25-56:  Transfer amount (uint256)
```

Extended metadata formats (e.g., Stealthereum's batch transfer support) append additional token info blocks after the standard structure.

---

## 3. The ViewTag Optimization — 99.6% Filter Efficiency

### 3.1 How ViewTags Work

The viewTag is the most critical optimization in the entire scanning pipeline. Without it, recipients must perform a full ECDH shared secret derivation for every announcement. With it, 255 out of 256 announcements (99.6%) can be immediately skipped.

**Generation (sender side):**
```
1. Generate ephemeral key pair: (r, R = r·G)
2. Compute shared secret:       S = r · ViewingPubKey_recipient
3. Hash the secret:             s_h = keccak256(S)
4. Extract viewTag:             viewTag = s_h[0]   (first byte)
5. Include viewTag as first byte of metadata field
```

**Scanning (recipient side):**
```
For each announcement:
  1. Extract viewTag from metadata[0]
  2. Compute shared secret:     S = viewingPrivateKey · ephemeralPubKey  (1× ecMUL)
  3. Hash the secret:           s_h = keccak256(S)                       (1× hash)
  4. Compare:                   if s_h[0] ≠ viewTag → SKIP (99.6% of cases)
  5. Full derivation:           stealthAddr = spendingPubKey + s_h · G   (1× ecMUL + 1× ecADD)
  6. Address check:             if derived == announcement.stealthAddress → MATCH
```

### 3.2 Computational Cost Analysis

| Scenario | EC Operations | Hashes | Probability |
|----------|--------------|--------|-------------|
| ViewTag mismatch (skip) | 1× ecMUL | 1× keccak256 | 255/256 (99.6%) |
| ViewTag match, not ours | 2× ecMUL + 1× ecADD | 2× keccak256 + address derivation | ~1/256 |
| ViewTag match, IS ours | 2× ecMUL + 1× ecADD | 2× keccak256 + address derivation | Very rare |

**Without viewTag:** Every announcement requires 2× ecMUL + 1× ecADD + 2× hashes
**With viewTag:** Average cost ≈ 1× ecMUL + 1× hash (since 99.6% exit early)

**Net savings:** ~6× reduction in elliptic curve computation per announcement.

### 3.3 Privacy Implications of ViewTags

ViewTags reduce the recipient's privacy margin from 128 bits to 124 bits (a 4-bit reduction because 1 byte of the hash is publicly revealed). This remains cryptographically secure and is considered an acceptable tradeoff for the ~6× performance gain.

However, viewTags create a subtle privacy consideration for indexer operators: an indexer that observes a client repeatedly querying announcements with a specific viewTag filter could correlate those queries to a single recipient. Production implementations mitigate this by always fetching *all* announcements and performing viewTag filtering client-side.

---

## 4. Production Implementation: Umbra Cash

### 4.1 Architecture Overview

Umbra is the most mature stealth address implementation, processing over $250M in transactions across 85,000+ transfers since launch in June 2021. Umbra's announcement indexing architecture has evolved through several iterations:

**Phase 1 (2021-2022): Direct RPC Scanning**
- `eth_getLogs` calls against Umbra contract
- Full-chain scanning from deployment block
- Slow: Minutes to scan weeks of history
- Expensive: Heavy RPC consumption

**Phase 2 (2022-2023): The Graph Subgraphs**
- Deployed separate subgraph per chain
- Subgraphs index Announcement events into queryable GraphQL API
- Supplement with direct RPC for real-time (not-yet-indexed) blocks
- Faster historical queries, but still rescanning on every visit

**Phase 3 (2024-present): Advanced Caching**
- Persistent `lastScannedBlock` tracking per user per chain
- Eliminate redundant rescanning of already-checked blocks
- Before: ~60 seconds for 1 week of Arbitrum scanning
- After: ~5-10 seconds for same period
- 6-12× improvement for returning users

### 4.2 Subgraph Architecture

Umbra deploys The Graph subgraphs on each supported chain. The subgraph watches the Umbra contract (not the ERC-5564 singleton, since Umbra v1 predates the finalized standard) for its `Announcement` event.

**Conceptual subgraph.yaml:**
```yaml
specVersion: 0.0.5
schema:
  file: ./schema.graphql
dataSources:
  - kind: ethereum/contract
    name: UmbraContract
    network: arbitrum-one
    source:
      address: "0xFb2dc580Eed955B528407b4d36FfaFe3da685401"
      abi: Umbra
      startBlock: 3382958  # Umbra deployment block on Arbitrum
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.7
      language: wasm/assemblyscript
      entities:
        - Announcement
      abis:
        - name: Umbra
          file: ./abis/Umbra.json
      eventHandlers:
        - event: Announcement(indexed uint256,indexed address,indexed address,bytes,bytes)
          handler: handleAnnouncement
      file: ./src/mapping.ts
```

**Conceptual schema.graphql:**
```graphql
type StealthAnnouncement @entity(immutable: true) {
  id: ID!                          # txHash-logIndex
  schemeId: BigInt!                 # 1 for SECP256k1
  stealthAddress: Bytes!            # The one-time recipient address
  caller: Bytes!                    # msg.sender for spam filtering
  ephemeralPubKey: Bytes!           # 33-byte compressed key
  metadata: Bytes!                  # viewTag + token info
  blockNumber: BigInt!
  blockTimestamp: BigInt!
  transactionHash: Bytes!
  logIndex: BigInt!
}
```

**Key design decisions:**
- Entity marked `immutable: true` — Announcements are append-only events, never updated
- No derived fields or relationships — Keeps indexing fast
- Block number and timestamp indexed — Enables efficient range queries

### 4.3 Multi-Chain Deployment

Umbra deploys subgraphs on:
- Ethereum mainnet
- Arbitrum One
- Optimism
- Polygon
- Gnosis Chain

Each chain has its own subgraph deployment with chain-specific:
- Contract address (Umbra v1 uses different addresses per chain)
- Start block (deployment block)
- Network identifier

The frontend queries each subgraph independently and aggregates results client-side.

### 4.4 Scanning Flow (Client-Side)

```
1. User connects wallet → derive viewingPrivateKey from signature
2. For each supported chain:
   a. Load lastScannedBlock from local storage (or use deployment block)
   b. Query subgraph for announcements WHERE blockNumber > lastScannedBlock
   c. Query RPC directly for very recent blocks not yet indexed by subgraph
   d. For each announcement:
      - Extract viewTag from metadata[0]
      - Compute sharedSecret = viewingPrivateKey × ephemeralPubKey
      - Compare keccak256(sharedSecret)[0] with viewTag
      - If match: perform full stealth address derivation
      - If derived address == announcement.stealthAddress → payment found!
   e. Update lastScannedBlock in local storage
3. Display found payments in UI
```

### 4.5 Performance Characteristics

| Metric | Before Caching (2023) | After Caching (2024) |
|--------|----------------------|---------------------|
| Returning user, 1 week (Arbitrum) | ~60 seconds | ~5-10 seconds |
| First-time scan (full history) | Minutes to hours | Minutes to hours |
| Subgraph query latency | <1 second | <1 second |
| ViewTag filtering | 99.6% skip rate | 99.6% skip rate |

### 4.6 Reorg Handling

The Graph handles chain reorganizations automatically:
- Subgraph maintains internal block pointer
- On reorg detection, subgraph rolls back to last confirmed block and re-indexes
- For direct RPC queries (latest blocks), Umbra uses chain-appropriate confirmation depths:
  - Ethereum: 12 blocks (~2.4 minutes)
  - Arbitrum: 64 blocks (~16 seconds)
  - Optimism/Base: 120 blocks (~4 minutes)
  - Polygon: 64 blocks (~2.1 minutes)

The `removed` field in `eth_getLogs` results indicates reorged logs:
```typescript
const logs = await provider.getLogs(filter);
const validLogs = logs.filter(log => !log.removed);
```

---

## 5. Production Implementation: Fluidkey

### 5.1 Architecture: No Announcement Parsing Required

Fluidkey takes a fundamentally different approach that eliminates the announcement indexing challenge entirely. Instead of scanning `Announcement` events, Fluidkey's server deterministically derives all stealth addresses and monitors them directly.

**How it works:**

1. **Key Delegation:** During onboarding, users share their BIP-32 viewing key node (`m/5564'/N'`) with Fluidkey's server. This is *not* the raw viewing private key — it's a hierarchical deterministic node from which child keys can be derived.

2. **Deterministic Address Generation:** For each new stealth address request, Fluidkey increments a counter in the derivation path: `m/5564'/0'/8'/0'/0'/p'/n'`. Because Fluidkey holds the viewing key node, it can independently derive every stealth address that will ever be generated for this user.

3. **Direct Blockchain Monitoring:** Instead of scanning announcement events, Fluidkey watches for *any transfer* (native or ERC-20) landing on any of the user's derived stealth addresses.

4. **Push Notifications:** When a transfer matches a known stealth address, Fluidkey immediately notifies the user.

### 5.2 QuickNode Infrastructure

Fluidkey disclosed key details about their infrastructure in a QuickNode Feature Friday interview:

**Challenge:** Fluidkey generates thousands of addresses per user. Traditional RPC providers allow whitelisting a limited number of addresses for monitoring, but Fluidkey's needs would quickly escalate to millions of addresses, making standard address-watching approaches infeasible.

**Solution:** Fluidkey developed custom tracking methods, supported by QuickNode's real-time block notification infrastructure. These notifications contain native and ERC-20 transfer data and are immediately compared within Fluidkey's infrastructure to identify matching user addresses.

**Architecture Pattern:**
```
QuickNode Streams → Real-time block data with transfer events
                  ↓
Fluidkey Backend  → Compare transfers against derived address set
                  ↓
Match Found       → Push notification to user + update dashboard
```

### 5.3 Privacy Tradeoff

| Property | Umbra (Client-Side) | Fluidkey (Server-Side) |
|----------|-------------------|----------------------|
| Viewing key exposure | Never leaves device | Shared with Fluidkey server |
| Transaction visibility | Only user sees matches | Fluidkey sees all incoming |
| Spending key control | User only | User only (Fluidkey never has it) |
| Scanning latency | 5-60 seconds | Near-instant (push) |
| Infrastructure dependency | Subgraphs (decentralized) | Fluidkey backend (centralized) |
| Offline access | Yes (client-side scanning) | No (requires server) |

**Key distinction:** Fluidkey's approach means their server knows which stealth addresses belong to each user and when payments arrive. However, they explicitly cannot spend funds because they never possess the spending private key. The privacy model is analogous to an email provider: they can see your inbox metadata, but they cannot forge your digital signature.

### 5.4 ENS-Based Address Resolution (No Registry Needed)

Fluidkey bypasses the ERC-6538 on-chain registry entirely. Each user receives an ENS subdomain (`username.fkey.eth`) that resolves to a fresh stealth address on every query via an ERC-3668 offchain resolver.

This means there are no on-chain `Announcement` events for ENS-resolved payments. The "indexing" happens entirely within Fluidkey's infrastructure, where the server:
1. Received the stealth address resolution request
2. Generated the ephemeral key and derived the stealth address
3. Already knows which user the address belongs to
4. Simply monitors for funds arriving at that address

### 5.5 Multi-Chain Support

Fluidkey supports 5+ chains (Base, Optimism, Arbitrum, Polygon, Gnosis, Ethereum) using a `chainId 0` derivation strategy. The path `m/5564'/0'/8'/0'/0'/p'/n'` produces stealth addresses valid on all EVM chains, meaning a single derivation works across networks.

For each chain, Fluidkey runs parallel QuickNode stream consumers monitoring for transfers to the globally-valid address set.

---

## 6. Experimental Implementation: Reth Execution Extension

### 6.1 Node-Level Stealth Address Scanning

ScopeLift's blog post about Umbra v2 revealed an experimental Reth Execution Extension (ExEx) implementing ERC-5564 stealth address scanning at the node level. This was built independently by the Paradigm Reth team as a demonstration of ExEx capabilities.

**What is a Reth ExEx?**
Execution Extensions are post-execution hooks for building real-time, high-performance off-chain infrastructure on top of Reth. They receive committed chain state changes (including all events/logs) directly from the node's execution pipeline, without any RPC overhead.

### 6.2 Advantages Over RPC-Based Indexing

| Property | RPC Indexing | Subgraph | Reth ExEx |
|----------|-------------|----------|-----------|
| Latency | Polling interval (seconds) | Indexing delay (seconds-minutes) | Zero (inline execution) |
| RPC overhead | High (eth_getLogs) | None (reads from store) | None (inline) |
| Reorg handling | Manual | Automatic | Automatic (ExEx framework) |
| Trust model | Trust RPC provider | Trust subgraph indexer | Trustless (own node) |
| Setup complexity | Low | Medium | High (run full node) |
| Performance | Limited by RPC rate limits | Limited by Graph node | Native execution speed |

### 6.3 Architecture Pattern

```
Block Execution (Reth)
    ↓
ExEx Hook receives committed notifications
    ↓
Filter for Announcement events from 0x55649E01...
    ↓
ViewTag pre-filter against user's viewing key
    ↓
Full derivation for matches
    ↓
Notify application / write to local DB
```

### 6.4 Significance for the Ecosystem

ScopeLift highlighted this as evidence that ERC standardization yields composable, permissionless innovation. The Reth extension was built by a different team, on different infrastructure, but works with any ERC-5564 compliant stealth address system — including Umbra, Fluidkey, or any future implementation.

For infrastructure providers, running a Reth node with the stealth address ExEx could enable offering "stealth address as a service" scanning with native performance and full trustlessness.

---

## 7. Reference Implementation: ScopeLift Stealth Address SDK

### 7.1 SDK Announcement Actions

The `@scopelift/stealth-address-sdk` provides three core actions for announcement handling:

**`getAnnouncements`** — Retrieves raw announcement logs from the ERC5564Announcer contract.

```typescript
import {
  ERC5564_CONTRACT_ADDRESS,
  VALID_SCHEME_ID,
  createStealthClient,
} from "@scopelift/stealth-address-sdk";

const stealthClient = createStealthClient({
  chainId: 11155111,  // Sepolia
  rpcUrl: process.env.RPC_URL!,
});

const announcements = await stealthClient.getAnnouncements({
  ERC5564Address: ERC5564_CONTRACT_ADDRESS,
  args: {
    schemeId: BigInt(VALID_SCHEME_ID.SCHEME_ID_1),
    caller: "0xYourCallingContractAddress",  // Optional filter
  },
  fromBlock: BigInt(12345678),  // Deployment block or last scanned
});
```

**`getAnnouncementsForUser`** — Filters announcements to find those belonging to a specific user by performing viewTag matching and full stealth address derivation.

```typescript
const userAnnouncements = await stealthClient.getAnnouncementsForUser({
  announcements,                              // From getAnnouncements
  spendingPublicKey: "0x...",                  // User's spending public key
  viewingPrivateKey: "0x...",                  // User's viewing private key
  excludeList: [],                             // Optional: addresses to skip (spam filter)
  includeList: [],                             // Optional: only include these callers
});
```

**`watchAnnouncementsForUser`** — Real-time monitoring that combines announcement fetching with user-specific filtering.

```typescript
const unwatch = await stealthClient.watchAnnouncementsForUser({
  ERC5564Address: ERC5564_CONTRACT_ADDRESS,
  args: { schemeId: BigInt(VALID_SCHEME_ID.SCHEME_ID_1) },
  spendingPublicKey: "0x...",
  viewingPrivateKey: "0x...",
  onAnnouncement: (announcement) => {
    console.log("Payment found!", announcement.stealthAddress);
  },
  pollInterval: 12_000,  // Poll every 12 seconds (Ethereum block time)
});
```

### 7.2 Under the Hood: Viem getLogs

The SDK uses Viem's `getLogs` abstraction internally, which maps to `eth_getLogs` JSON-RPC calls. Viem handles:
- ABI decoding of event parameters
- Block range pagination (splitting large ranges into chain-appropriate chunks)
- Type-safe return values

### 7.3 The `fromBlock` Parameter

The `fromBlock` parameter in `getAnnouncements` is critical for performance:

- **First-time scan:** Set to the ERC5564Announcer deployment block for the target chain
- **Returning user:** Set to `lastScannedBlock + 1` to avoid re-scanning history
- **Default (0):** Will attempt to scan from genesis — extremely slow on mature chains

Production applications MUST track `lastScannedBlock` per user per chain.

---

## 8. Custom RPC Indexer Implementation

### 8.1 Direct eth_getLogs Approach

For teams building custom indexers without The Graph:

```typescript
import { createPublicClient, http, parseAbiItem } from "viem";
import { arbitrum } from "viem/chains";

const ERC5564_ANNOUNCER = "0x55649E01B5Df198D18D95b5cc5051630cfD45564";

const client = createPublicClient({
  chain: arbitrum,
  transport: http(process.env.ARBITRUM_RPC_URL),
});

const announcementEvent = parseAbiItem(
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)"
);

async function indexBlockRange(fromBlock: bigint, toBlock: bigint) {
  const logs = await client.getLogs({
    address: ERC5564_ANNOUNCER,
    event: announcementEvent,
    args: {
      schemeId: 1n,  // SECP256k1 only
    },
    fromBlock,
    toBlock,
  });

  return logs.map((log) => ({
    schemeId: log.args.schemeId!,
    stealthAddress: log.args.stealthAddress!,
    caller: log.args.caller!,
    ephemeralPubKey: log.args.ephemeralPubKey!,
    viewTag: parseInt(log.args.metadata!.slice(2, 4), 16),
    metadata: log.args.metadata!,
    blockNumber: log.blockNumber!,
    transactionHash: log.transactionHash!,
    logIndex: log.logIndex!,
    removed: log.removed,
  }));
}
```

### 8.2 Block Range Limits Per Chain

Each chain enforces maximum block range limits for `eth_getLogs`:

| Chain | Max Block Range | Avg Block Time | Max Time Span per Query |
|-------|----------------|----------------|------------------------|
| Ethereum | 2,000-10,000 | 12 seconds | 6.6 hours - 33 hours |
| Arbitrum | 10,000 | 250 ms | ~42 minutes |
| Optimism | 10,000 | 2 seconds | ~5.5 hours |
| Base | 10,000 | 2 seconds | ~5.5 hours |
| Polygon | 2,000-3,500 | 2 seconds | ~1.1 - 1.9 hours |
| Gnosis | 10,000 | 5 seconds | ~13.9 hours |
| BNB Smart Chain | 5,000 | 3 seconds | ~4.2 hours |

**Pagination required:** For full historical scans, split the total range into chunks within these limits:

```typescript
async function fullHistoricalScan(
  deploymentBlock: bigint,
  currentBlock: bigint,
  maxRange: bigint = 10_000n
) {
  const allAnnouncements = [];

  for (let from = deploymentBlock; from <= currentBlock; from += maxRange) {
    const to = from + maxRange - 1n > currentBlock
      ? currentBlock
      : from + maxRange - 1n;

    const batch = await indexBlockRange(from, to);
    allAnnouncements.push(...batch);

    // Rate limiting: respect RPC provider limits
    await sleep(100);
  }

  return allAnnouncements;
}
```

### 8.3 Result Count Limits

Some RPC providers also enforce maximum result counts (e.g., MetaMask Infura: 10,000 results per query). If the Announcement event is widely used, a single block range query could exceed this limit. Handle with adaptive range splitting:

```typescript
async function adaptiveIndexRange(from: bigint, to: bigint): Promise<AnnouncementLog[]> {
  try {
    return await indexBlockRange(from, to);
  } catch (error: any) {
    if (error.message?.includes("query returned more than")) {
      // Split range in half and retry
      const mid = (from + to) / 2n;
      const firstHalf = await adaptiveIndexRange(from, mid);
      const secondHalf = await adaptiveIndexRange(mid + 1n, to);
      return [...firstHalf, ...secondHalf];
    }
    throw error;
  }
}
```

---

## 9. WebSocket Real-Time Subscriptions

### 9.1 eth_subscribe for New Announcements

For real-time detection, WebSocket subscriptions avoid polling overhead:

```typescript
import { createPublicClient, webSocket, parseAbiItem } from "viem";
import { mainnet } from "viem/chains";

const wsClient = createPublicClient({
  chain: mainnet,
  transport: webSocket("wss://eth-mainnet.g.alchemy.com/v2/YOUR_KEY"),
});

const unwatch = wsClient.watchEvent({
  address: "0x55649E01B5Df198D18D95b5cc5051630cfD45564",
  event: parseAbiItem(
    "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)"
  ),
  args: {
    schemeId: 1n,
  },
  onLogs: (logs) => {
    for (const log of logs) {
      const viewTag = parseInt(log.args.metadata!.slice(2, 4), 16);

      // ViewTag pre-filter
      if (viewTag === expectedViewTag) {
        // Perform full stealth address derivation
        processAnnouncementMatch(log);
      }
    }
  },
});
```

### 9.2 Polling vs WebSocket Tradeoffs

| Property | Polling (eth_getLogs) | WebSocket (eth_subscribe) |
|----------|---------------------|--------------------------|
| Latency | Poll interval (e.g., 12s) | Near-instant (<1 second) |
| Connection | Stateless HTTP | Persistent WS connection |
| Reliability | Highly reliable | Connection drops possible |
| Cost | Higher RPC usage | Lower (single subscription) |
| Reorg handling | Check `removed` field | Receives removal notifications |
| Historical data | Native support (fromBlock/toBlock) | Current events only |

**Production recommendation:** Use WebSocket for real-time detection + periodic eth_getLogs polling as a safety net for missed events and historical backfill.

---

## 10. Chain Reorganization Handling

### 10.1 Why Reorgs Matter for Stealth Addresses

A chain reorganization can invalidate an `Announcement` event. If a user processes an announcement from a reorged block, they may:
- See a payment that never actually occurred
- Miss a payment that ended up in a different block
- Derive incorrect stealth address private keys

### 10.2 Detection Mechanisms

**Via `eth_getLogs`:**
The `removed` field in log objects indicates reorged logs:
```typescript
interface Log {
  removed: boolean;  // true = reorged out, false = canonical
  blockHash: string;
  blockNumber: bigint;
  // ...
}
```

**Via WebSocket subscriptions:**
When a reorg occurs, the node sends the original log with `removed: true`, followed by the new canonical log.

**Via The Graph:**
Subgraphs handle reorgs automatically — they maintain a "reorg depth" parameter and only serve data from blocks deep enough to be considered final.

### 10.3 Confirmation Depth Strategy

```typescript
const CONFIRMATION_DEPTHS: Record<number, number> = {
  1: 12,       // Ethereum: 12 blocks (~2.4 minutes)
  42161: 64,   // Arbitrum: 64 blocks (~16 seconds)
  10: 120,     // Optimism: 120 blocks (~4 minutes)
  8453: 120,   // Base: 120 blocks (~4 minutes)
  137: 64,     // Polygon: 64 blocks (~2.1 minutes)
  100: 12,     // Gnosis: 12 blocks (~1 minute)
};

async function getConfirmedAnnouncements(chainId: number) {
  const currentBlock = await client.getBlockNumber();
  const confirmationDepth = CONFIRMATION_DEPTHS[chainId] ?? 12;
  const safeBlock = currentBlock - BigInt(confirmationDepth);

  // Query only confirmed blocks
  return indexBlockRange(lastScannedBlock, safeBlock);
}
```

### 10.4 Handling Reorgs in the Database

For custom indexers that persist announcements:

```typescript
async function handleReorg(reorgedBlockNumber: bigint, chainId: number) {
  // 1. Mark all announcements at or after reorged block as invalid
  await db.query(`
    UPDATE announcements
    SET removed = true
    WHERE chain_id = $1 AND block_number >= $2
  `, [chainId, reorgedBlockNumber]);

  // 2. Re-index from the reorged block
  const currentBlock = await client.getBlockNumber();
  const newAnnouncements = await indexBlockRange(reorgedBlockNumber, currentBlock);

  // 3. Insert new canonical announcements
  for (const ann of newAnnouncements) {
    await upsertAnnouncement(ann);
  }

  // 4. Update scan cursor
  await updateLastScannedBlock(chainId, currentBlock);
}
```

### 10.5 Polygon Reorg Considerations

Polygon PoS experiences deeper reorgs than other networks. One notable instance involved a reorg 157 blocks deep. For stealth address systems on Polygon:
- Use higher confirmation depth (128+ blocks)
- Implement aggressive reorg monitoring
- Consider The Graph's built-in handling over custom indexing

---

## 11. Storage Schema for Custom Indexers

### 11.1 PostgreSQL Schema

```sql
-- Core announcements table
CREATE TABLE announcements (
    id                SERIAL PRIMARY KEY,
    chain_id          INTEGER NOT NULL,
    scheme_id         INTEGER NOT NULL DEFAULT 1,
    stealth_address   BYTEA NOT NULL,          -- 20 bytes
    caller            BYTEA NOT NULL,          -- 20 bytes
    ephemeral_pubkey  BYTEA NOT NULL,          -- 33 bytes (compressed)
    view_tag          SMALLINT NOT NULL,        -- 0-255
    metadata          BYTEA,                    -- Full metadata including viewTag
    block_number      BIGINT NOT NULL,
    block_hash        BYTEA NOT NULL,           -- 32 bytes, for reorg detection
    tx_hash           BYTEA NOT NULL,           -- 32 bytes
    log_index         INTEGER NOT NULL,
    removed           BOOLEAN DEFAULT FALSE,
    indexed_at        TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (chain_id, tx_hash, log_index)
);

-- Indexes for common query patterns
CREATE INDEX idx_announcements_chain_block
    ON announcements (chain_id, block_number DESC);

CREATE INDEX idx_announcements_view_tag
    ON announcements (chain_id, view_tag)
    WHERE removed = FALSE;

CREATE INDEX idx_announcements_stealth_addr
    ON announcements (stealth_address)
    WHERE removed = FALSE;

CREATE INDEX idx_announcements_caller
    ON announcements (chain_id, caller)
    WHERE removed = FALSE;

-- Scan cursor tracking per user per chain
CREATE TABLE scan_cursors (
    user_id           TEXT NOT NULL,
    chain_id          INTEGER NOT NULL,
    last_scanned_block BIGINT NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),

    PRIMARY KEY (user_id, chain_id)
);

-- User-specific matched announcements (after viewTag + full derivation)
CREATE TABLE matched_announcements (
    id                SERIAL PRIMARY KEY,
    user_id           TEXT NOT NULL,
    announcement_id   INTEGER REFERENCES announcements(id),
    stealth_private_key_hash BYTEA,            -- NOT the actual key! Just a reference hash
    matched_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_matched_user
    ON matched_announcements (user_id);
```

### 11.2 Index Design Rationale

- **`idx_announcements_view_tag`**: The most critical index. When a user scans, they compute their expected viewTag and query by it. This index enables 99.6% of rows to be eliminated at the database level before any application-level processing.
- **`WHERE removed = FALSE`**: Partial indexes exclude reorged announcements, keeping the index compact.
- **`chain_id, block_number DESC`**: Supports efficient incremental scanning ("give me everything after block X on chain Y").
- **`stealth_address`**: Rarely used for scanning, but useful for balance lookups and debugging.

---

## 12. Caching Strategy

### 12.1 Three-Layer Cache Architecture

**Layer 1: In-Memory (Redis/LRU)**
```
Key:    announcements:{chainId}:{blockRange}
Value:  Serialized announcement array
TTL:    5 minutes (recent blocks that might reorg)
Use:    Hot path for real-time scanning
```

**Layer 2: Persistent Database (PostgreSQL)**
```
Table:  announcements
TTL:    Permanent (immutable once confirmed)
Use:    Full historical record
Note:   Announcements from confirmed blocks never change
```

**Layer 3: User-Specific Scan Cache**
```
Key:    scan_cursor:{userId}:{chainId}
Value:  lastScannedBlock number
TTL:    Permanent (updated on each scan)
Use:    Prevents redundant re-scanning
```

### 12.2 Cache Invalidation

- **Layer 1:** TTL-based expiry. Reorged blocks automatically expire within 5 minutes.
- **Layer 2:** Only invalidated on reorg detection (set `removed = true`).
- **Layer 3:** Only updated forward (never rolled back unless user explicitly requests full rescan).

### 12.3 Umbra's Caching Innovation

Umbra's advanced caching (2024) specifically addressed the problem of returning users:

**Before:** Every time a user opened the app, the scanner would re-fetch and re-process all announcements from the subgraph, even if they'd already been checked.

**After:** The app stores the last scanned block number in the browser's local storage. On return, it only fetches announcements from `lastScannedBlock + 1` to `currentBlock`, then performs viewTag filtering only on the new batch.

This single optimization yielded the 6-12× improvement (60 seconds → 5-10 seconds) for returning users.

---

## 13. Multi-Chain Indexing Strategies

### 13.1 Strategy Comparison

**Option A: Separate Indexer Per Chain (Umbra's Approach)**
```
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│ ETH Subgraph│  │ ARB Subgraph│  │ OP Subgraph │
│ (indexer)   │  │ (indexer)   │  │ (indexer)   │
└──────┬──────┘  └──────┬──────┘  └──────┬──────┘
       │                │                │
       └────────┬───────┘────────────────┘
                │
         ┌──────┴──────┐
         │ Unified API │
         │  (client)   │
         └─────────────┘
```

Pros: Independent scaling, chain-specific optimizations, isolated failures
Cons: Higher infrastructure cost, more deployments to manage
Used by: Umbra (separate Graph deployments per chain)

**Option B: Unified Indexer (Fluidkey's Approach)**
```
┌─────────────────────────────┐
│     QuickNode Streams       │
│  (all chains, unified)      │
└──────────────┬──────────────┘
               │
       ┌───────┴───────┐
       │ Fluidkey Core │
       │  (single BE)  │
       └───────────────┘
```

Pros: Centralized management, shared caching, simpler deployment
Cons: Single point of failure, harder to scale individual chains
Used by: Fluidkey (unified backend with QuickNode)

**Option C: Hybrid (Recommended)**
```
Primary:   The Graph subgraphs per chain (decentralized, historical)
Secondary: Custom RPC polling per chain (real-time, gap filling)
Fallback:  Direct node access (if subgraph goes down)
```

Pros: Decentralized primary, fast fallback, resilient
Cons: Most complex to implement
Recommended for: New production deployments

### 13.2 Unified Contract Address Advantage

Because ERC-5564 deploys the ERC5564Announcer at the same address (`0x55649E01B5Df198D18D95b5cc5051630cfD45564`) on all EVM chains, the indexing logic is identical across networks. Only three parameters change per chain:
1. RPC URL
2. Start block (deployment block)
3. Block range limit

This enables a clean abstraction:

```typescript
interface ChainConfig {
  chainId: number;
  rpcUrl: string;
  startBlock: bigint;
  maxBlockRange: bigint;
  confirmationDepth: number;
}

const CHAIN_CONFIGS: ChainConfig[] = [
  { chainId: 1,     rpcUrl: "...", startBlock: 17461778n, maxBlockRange: 5000n, confirmationDepth: 12 },
  { chainId: 42161, rpcUrl: "...", startBlock: 136000000n, maxBlockRange: 10000n, confirmationDepth: 64 },
  { chainId: 10,    rpcUrl: "...", startBlock: 116000000n, maxBlockRange: 10000n, confirmationDepth: 120 },
  { chainId: 8453,  rpcUrl: "...", startBlock: 8000000n,  maxBlockRange: 10000n, confirmationDepth: 120 },
  { chainId: 137,   rpcUrl: "...", startBlock: 50000000n, maxBlockRange: 3500n,  confirmationDepth: 128 },
  { chainId: 100,   rpcUrl: "...", startBlock: 30000000n, maxBlockRange: 10000n, confirmationDepth: 12 },
];
```

---

## 14. Spam Mitigation

### 14.1 The Spam Problem

Anyone can call `announce()` on the ERC5564Announcer with arbitrary data. A malicious actor could flood the contract with fake announcements, forcing all recipients to process useless data during scanning.

### 14.2 Mitigation Strategies

**ViewTag Pre-Filter (built-in):**
Already eliminates 99.6% of announcements. Spam announcements with random metadata will only match a recipient's viewTag 1/256 of the time.

**Caller-Based Filtering (excludeList/includeList):**
The ScopeLift SDK supports excluding announcements from known spam callers or only including announcements from known legitimate callers:
```typescript
const filtered = await stealthClient.getAnnouncementsForUser({
  announcements,
  excludeList: ["0xSpammerAddress1", "0xSpammerAddress2"],
  includeList: [],
  // ...
});
```

**Staking Mechanisms (ERC-5564 Specification):**
The specification suggests parsing providers could require senders to stake an unslashable amount of ETH (similar to ERC-4337 bundler staking) before their announcements are indexed.

**Toll System:**
A small fee per announcement (e.g., 0.001 ETH) makes spamming economically unattractive while remaining negligible for legitimate users.

**Rate Limiting per Sender:**
Indexers can enforce limits on announcements per `caller` per block period.

### 14.3 Practical Impact

In practice, spam has not been a significant issue for Umbra or the ERC-5564 ecosystem because:
- Gas costs already create a natural economic barrier
- The anonymity set is still relatively small (~77K registered users)
- ViewTag filtering already handles random noise efficiently

---

## 15. Sources

| Source | URL | Used For |
|--------|-----|----------|
| ERC-5564 Specification | https://eips.ethereum.org/EIPS/eip-5564 | Announcement event spec, viewTag mechanics, schemeId |
| ERC-6538 Specification | https://eips.ethereum.org/EIPS/eip-6538 | Registry context |
| ScopeLift Stealth Address SDK | https://github.com/ScopeLift/stealth-address-sdk | SDK actions: getAnnouncements, getAnnouncementsForUser, watchAnnouncementsForUser |
| ScopeLift ERC Contracts | https://github.com/ScopeLift/stealth-address-erc-contracts | Canonical contract addresses, CREATE2 deployment |
| stealthaddress.dev | https://stealthaddress.dev/SDK/overview | SDK documentation, stealth client actions |
| ScopeLift Blog: Umbra v2 Prototypes | https://scopelift.co/blog/umbra-v2-prototypes-and-designs | Caching improvements, Reth ExEx reference, performance benchmarks |
| ScopeLift Blog: EF Grant Announcement | https://scopelift.co/blog/ef-funds-scopelift-stealth-address-standardization | Umbra history, ERC standardization |
| ScopeLift Blog: Progress Update | https://scopelift.co/blog/progress-update-stealth-address-ercs | SDK development, Umbra v1 enhancements |
| Fluidkey Technical Walkthrough | https://docs.fluidkey.com/technical-documentation/technical-walkthrough | BIP-32 viewing key delegation, derivation path, Safe accounts |
| Fluidkey FAQ | https://docs.fluidkey.com/readme/frequently-asked-questions | Viewing key vs spending key delegation |
| QuickNode Feature Friday: Fluidkey | https://blog.quicknode.com/feature-fridays-fluidkey/ | Infrastructure details, real-time block notifications, address tracking |
| Fluidkey Stealth Account Kit | https://github.com/fluidkey/fluidkey-stealth-account-kit | Open source cryptographic kit |
| Paradigm: Reth Execution Extensions | https://www.paradigm.xyz/2024/05/reth-exex | ExEx architecture, node-level indexing |
| Seres et al.: Umbra Anonymity Analysis | https://arxiv.org/abs/2308.01703 | Deanonymization heuristics, 48.5%-65.7% rates |
| Nerolation Stealth Utils | https://nerolation.github.io/stealth-utils/ | Interactive viewTag walkthrough |
| Chainstack: eth_getLogs Limitations | https://docs.chainstack.com/docs/understanding-eth-getlogs-limitations | Block range limits per chain |
| MetaMask: eth_getLogs Docs | https://docs.metamask.io/services/reference/ethereum/json-rpc-methods/eth_getlogs/ | Result count limits, `removed` field |
| Envio: Indexing & Reorgs | https://medium.com/@envio_indexer/indexing-reorgs-326f7b6b13ba | Stateful vs stateless reorg handling, Polygon depth |
| Simon Brown: Privacy in Ethereum | https://simbro.medium.com/privacy-in-ethereum-stealth-addresses-f05016109010 | Ecosystem overview, Umbra registration stats |
| RocknBlock: Stealth Address Deep Dive | https://rocknblock.io/blog/how-ethereum-stealth-addresses-work-technical-deep-dive | Fluidkey vs Umbra comparison |
| The Graph: Subgraph Development | https://thegraph.com/docs/en/subgraphs/developing/subgraphs/ | Subgraph architecture reference |

---

*Component 5 of 10 — EOA-Based Stealth Address Backend Architecture*
*Previous: Component 4 (Registration / On-Chain Meta-Address Publishing)*
*Next: Component 6 (Stealth Wallet Management / Balance Aggregation)*
