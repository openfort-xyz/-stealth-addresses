# Must-Have Backend Components for EOA-Based Stealth Address Systems

Production stealth address implementations require **10 essential backend services** to operate at scale. Umbra Cash and Fluidkey have demonstrated that while the core cryptography executes client-side, robust backend infrastructure determines whether a stealth address system can practically serve users across multiple chains with acceptable UX. This report analyzes each component through the lens of ERC-5564/ERC-6538 compliance, production implementations, and the privacy-UX tradeoff spectrum.

The fundamental architecture choice—whether to follow Umbra's decentralized, event-driven model or Fluidkey's server-assisted, ENS-based approach—cascades through every backend component. Umbra processes **$250M+ in transactions** across 85,000+ transfers with minimal backend trust, while Fluidkey achieves superior UX by accepting viewing key delegation. Both approaches successfully solve the core challenges: announcement indexing, view tag filtering, gas funding for empty stealth addresses, and multi-chain coordination.

---

## Announcement indexing forms the backbone of any stealth address backend

Every stealth address payment emits an `Announcement` event from the singleton ERC5564Announcer contract at `0x55649E01B5Df198D18D95b5cc5051630cfD45564`. The indexer must capture these events across all supported chains and make them queryable for recipient scanning.

**Event structure to index:**
```solidity
event Announcement(
  uint256 indexed schemeId,      // 1 = SECP256k1
  address indexed stealthAddress,
  address indexed caller,        // For spam filtering
  bytes ephemeralPubKey,         // 33-byte compressed key
  bytes metadata                 // View tag + token info
);
```

**Production implementations diverge sharply** on indexing strategy. Umbra deploys **The Graph subgraphs** per chain, with each deployment indexing Announcement events from the Umbra contract. This approach benefits from The Graph's automatic reorg handling and decentralized query infrastructure. The umbra-js SDK supplements this with direct `eth_getLogs` RPC queries for real-time data not yet indexed.

Fluidkey takes a radically different approach: **no announcement indexing needed**. Because Fluidkey's server holds the user's viewing key node (`m/5564'/N'`), it deterministically derives all possible stealth addresses and monitors them directly via blockchain scanning. This eliminates the announcement parsing bottleneck entirely but requires users to trust Fluidkey with transaction visibility.

For multi-chain indexing, the key insight is that ERC-5564 contracts deploy at **identical addresses across all EVM chains** via CREATE2 with deterministic salt `0xd0103a290d760f027c9ca72675f5121d725397fb2f618f05b6c44958b25b4447`. This enables a unified indexing strategy—same contract address, different RPC endpoints per chain. Production systems typically deploy **separate subgraph instances per chain** rather than attempting cross-chain subgraph queries.

**Chain reorg handling** relies on The Graph's built-in finality tracking for subgraph data. For direct RPC queries, implementations use chain-appropriate confirmation counts (1-2 blocks on L2s, 12+ on mainnet) and re-scan recent blocks on each query. The ScopeLift SDK accepts a `fromBlock` parameter that should track each user's last scan position.

**Recommended architecture:** Hybrid subgraph + RPC polling. Deploy subgraphs for historical data and bulk queries; use direct RPC for real-time announcement detection. Store `fromBlock` per user to avoid full-chain rescans.

---

## View tag filtering enables 6x faster scanning with 1-byte optimization

The parsing service is the computational heart of stealth address backends—it determines which announcements belong to each user. The **view tag optimization** specified in ERC-5564 reduces scanning cost by **255/256 (99.6%)** by allowing early-exit on non-matching announcements.

**How view tag filtering works:**
1. Extract first byte of announcement metadata (the view tag)
2. Compute shared secret: `S = viewingPrivateKey × ephemeralPubKey` (one ecMUL)
3. Hash the secret: `s_h = keccak256(S)`
4. Compare: if `s_h[0] ≠ viewTag`, skip this announcement (99.6% probability)
5. Only if view tags match: perform full stealth address derivation and verification

**Per-announcement computational cost:**
- Non-matching (255/256 cases): 1× ecMUL + 1× hash
- View tag match (1/256 cases): 2× ecMUL + 2× hash + 1× ecADD + address derivation

Umbra's current production system performs **client-side scanning**—the umbra-js SDK fetches announcements and runs SECP256k1 operations in the browser. This preserves privacy (viewing key never leaves client) but creates UX friction. Umbra reported that "regular users returning after ~1 week see scan times of only **5-10 seconds**" after implementing advanced caching, down from ~1 minute previously. A Gitcoin bounty exists to parallelize this work via Web Workers.

**Viewing key delegation** enables server-side parsing without compromising fund security. The viewing private key can be shared with a parsing provider while the spending key remains in cold storage. This is the model Fluidkey uses—users share the BIP-32 derived node `m/5564'/N'` with Fluidkey's backend, which performs all scanning server-side. The privacy tradeoff: the parsing provider learns all incoming transactions but cannot spend funds.

**Security consideration:** View tags reduce the security margin from 128 bits to 124 bits (privacy only—stealth address generation security is unaffected). This remains cryptographically secure but represents a conscious tradeoff for performance.

**Recommended architecture:** Offer both client-side scanning (maximum privacy) and opt-in server-side parsing (better UX). Track per-user `lastScannedBlock` to enable incremental scans. Implement Web Worker parallelization for browser-based scanning.

---

## The ERC-6538 Registry provides stealth meta-address resolution

The registry service wraps interaction with the ERC-6538 Stealth Meta-Address Registry at `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`. It stores the mapping from Ethereum addresses to stealth meta-addresses.

**Core registry operations:**
```solidity
// Read stealth meta-address for recipient
function stealthMetaAddressOf(address registrant, uint256 schemeId)
  external view returns (bytes memory);

// Register your own stealth meta-address
function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress)
  external;

// Register on behalf (EIP-712 signature)
function registerKeysOnBehalf(
  address registrant, uint256 schemeId,
  bytes memory signature, bytes calldata stealthMetaAddress
) external;
```

**Stealth meta-address format:** `st:<chain>:0x<spendingPubKey><viewingPubKey>` where each public key is 33 bytes (compressed SECP256k1), totaling 66 bytes.

Umbra originally used **ENS text records** for stealth key storage, but this required L1 interaction from L2s. The StealthKeyRegistry contract (`0x31fe56609C65Cd0C510E7125f051d440424D38f3`) solved this by deploying on each chain—no cross-chain calls required. The registry service indexes `StealthMetaAddressSet` events to maintain a local cache, enabling fast lookups without RPC calls.

Fluidkey bypasses the on-chain registry entirely via **ENS offchain resolution** (ERC-3668 CCIP Read). Users receive `username.fkey.eth` subdomains that resolve to **fresh stealth addresses on every query**—the offchain resolver generates new ephemeral keys server-side. This eliminates on-chain registration fees but centralizes address generation at Fluidkey's server.

**Key rotation** requires updating the registry and re-announcing the new meta-address. ERC-6538 includes nonce tracking for signature replay protection. Backends should monitor `NonceIncremented` events to invalidate cached signatures.

**ENS integration** is straightforward: store stealth meta-address in ENS text record `stealthMetaAddress` for direct resolution. However, this creates a permanent public link between ENS name and meta-address—a privacy consideration for users with doxxed ENS names.

**Recommended architecture:** Index registry events locally for fast lookups. Support both on-chain registry and ENS resolution. Implement caching with TTL matched to expected key rotation frequency.

---

## Balance aggregation transforms fragmented addresses into unified portfolios

Users receiving many stealth payments accumulate balances across potentially **hundreds of isolated addresses**. The balance aggregation service queries all known stealth addresses and presents a unified portfolio view.

**Fluidkey's implementation** demonstrates the production approach:
1. Server knows all stealth addresses via viewing key node
2. Batch-query balances across all addresses on all chains
3. Aggregate into single portfolio view with chain breakdown
4. Display as if user has one wallet

**Token discovery** remains challenging. Default implementations support ETH and major stablecoins (USDC, DAI, USDT). For other ERC-20s, users typically "import" tokens by address, triggering balance checks across all stealth addresses. ERC-721/1155 discovery requires indexing Transfer events to each stealth address—computationally expensive but necessary for NFT support.

**Multi-chain balance queries** benefit from the **unified stealth meta-address** approach (Fluidkey's `chainId 0` derivation). A single meta-address generates valid stealth addresses on all EVM chains, meaning the aggregation service queries the same derived addresses across Ethereum, Arbitrum, Base, Optimism, Polygon, and Gnosis.

**Performance optimization:** Cache balance snapshots with block-height timestamps. Use websocket subscriptions for real-time balance updates on active addresses. Implement parallel RPC queries across chains (most L2 RPC providers support high request rates).

**Recommended architecture:** Server-side aggregation with viewing key delegation for production UX. Client-side aggregation available for privacy-maximizing users. Support token imports and consider background token discovery jobs.

---

## Transaction relay solves the critical "empty stealth address" problem

Fresh stealth addresses contain **zero ETH**—they cannot pay gas to spend their contents. This is the most significant UX challenge in stealth address systems, and production implementations have developed sophisticated solutions.

**Umbra's meta-transaction relay** for ERC-20 tokens:
1. Tokens are sent to Umbra contract (not directly to stealth address)
2. User signs withdrawal authorization from stealth address private key
3. Relayer submits transaction, paying ETH gas
4. Contract swaps portion of tokens via Uniswap to compensate relayer
5. Remaining tokens reach user's destination address

For native ETH payments, recipients can use received ETH directly for gas. The relay is only necessary for token withdrawals.

**Fluidkey's Safe-based gas sponsorship:**
1. Stealth addresses are **counterfactual Safe smart accounts** (not deployed until first spend)
2. When withdrawing, Fluidkey calculates gas cost
3. Relayer deploys Safe + executes transfer atomically
4. Gas deducted from user's token balance (works with any supported token)
5. L2 deployment cost: typically **under 1 cent**

**Railgun's broadcaster network** uses the Waku P2P messaging protocol:
1. User packages encrypted transaction with gas allocation
2. Broadcasts to network of broadcasters via Waku
3. Broadcaster pays ETH gas, receives token compensation
4. Transaction appears to originate from broadcaster address
5. Broadcaster cannot decrypt transaction details

**Privacy implications:** Relayers see stealth addresses but not the link to recipient identity. Umbra's approach preserves anonymity because the relayer only knows "this stealth address is withdrawing"—not who controls it. Fluidkey's approach requires trusting their backend, which already has viewing key access.

**EIP-4337 paymasters** offer an emerging alternative: users can pay gas in ERC-20s via paymaster contracts. Labyrinth integrates this for gasless operations. However, this requires smart account stealth addresses rather than EOAs.

**Recommended architecture:** For EOA-based systems, implement Umbra-style meta-transaction relays with token-to-ETH swaps. Support multiple fee tokens (ETH, USDC, DAI minimum). Consider Safe-based smart accounts for L2-focused deployments where deployment costs are negligible.

---

## UTXO-like management handles fund fragmentation gracefully

Stealth addresses create **UTXO-like fragmentation**: each payment generates a new isolated address. Users accumulating 50-100 payments face complex fund management without proper tooling.

**Fluidkey's automatic selection algorithm:**
1. Identify all stealth addresses with balances
2. For transfers: find single address with sufficient balance (optimal privacy)
3. If none sufficient: compute optimal combination of addresses
4. Execute multi-address transfer atomically
5. User never sees underlying complexity

**Privacy-preserving selection heuristics:**
- Prefer single-address spends (no address linking)
- When combining, prefer addresses from same sender/category
- Avoid mixing unrelated payment sources
- Apply labels ("personal", "freelance") to control selection pools

**Consolidation creates linkability**—moving funds from multiple stealth addresses to one destination reveals common ownership. Production systems mitigate this through:
- Time-randomized transfers (Vitalik recommends 2-week random intervals)
- Direct spending to exchanges (no intermediate consolidation)
- Label-based separation (never combine work and personal funds)

**ZK-proof systems** (Railgun, Labyrinth) solve consolidation elegantly: users prove ownership of multiple notes and create new aggregated notes without revealing which inputs were combined. The nullifier mechanism prevents double-spending while preserving privacy. However, this requires shielded pool architecture rather than plain stealth addresses.

**Recommended architecture:** Implement automatic UTXO selection with privacy-preserving heuristics. Provide labeling/categorization for user control. Display privacy warnings when combinations would link addresses. Consider ZK-based aggregation for future roadmap.

---

## Multi-chain coordination unifies the cross-chain experience

Stealth addresses must work seamlessly across Ethereum mainnet and L2s. The ERC-5564/6538 contracts deploy at **identical addresses on all EVM chains** via CREATE2, simplifying multi-chain coordination.

**Contract addresses (all chains):**
- ERC5564Announcer: `0x55649E01B5Df198D18D95b5cc5051630cfD45564`
- ERC6538Registry: `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538`

**Unified vs. chain-specific elements:**

| Component | Unified | Chain-Specific |
|-----------|---------|----------------|
| Contract addresses | ✅ Same everywhere | |
| Stealth meta-address | ✅ Single meta-address | |
| Subgraph deployments | | ✅ Separate per chain |
| Relay infrastructure | | ✅ Different per chain |
| Token support | | ✅ Varies by chain |

**Fluidkey's approach** uses `chainId 0` derivation to generate stealth addresses valid on all EVM chains from a single meta-address. The derivation path `m/5564'/0'/8'/0'/0'/p'/n'` produces addresses usable on any supported network.

**Cross-chain deposits** (Fluidkey via Near Intents) convert assets from 10+ chains (including Bitcoin, Solana, Tron) to USDC deposited on Base. This expands the payment source surface without requiring stealth address infrastructure on non-EVM chains.

**Unified API design:**
```typescript
const stealthClient = createStealthClient({
  chainId: 42161,  // Arbitrum
  rpcUrl: "..."
});
// Same SDK interface, different chainId
```

**Recommended architecture:** Deploy subgraphs/indexers per chain with unified query layer. Single API with chainId parameter. Support chain-specific token registries. Consider bridge integration for cross-L2 fund movement.

---

## Metadata encoding carries payment context beyond addresses

The `metadata` field in Announcement events encodes critical context: view tag, token type, and amount. The metadata service handles encoding/decoding per ERC-5564 specification.

**Standard metadata structure:**
- **Byte 1:** View tag (required)
- **Bytes 2-5:** Function selector (`0xeeeeeeee` for native ETH, `0x23b872dd` for ERC-20 transfer)
- **Bytes 6-25:** Token address (`0xEeee...EEeE` for native ETH)
- **Bytes 26-57:** Amount (uint256)

**Extended metadata (Stealthereum)** supports batch transfers:
```
View tag + [token1 info] + [token2 info] + ...
```
Each token info block: selector (4 bytes) + address (20 bytes) + amount (32 bytes)

**Token registry integration:** The metadata service maps token addresses to human-readable names and decimals. Production systems maintain chain-specific token registries with at minimum: ETH, WETH, USDC, USDC.e, DAI, USDT.

**ERC-721/1155 handling:** The amount field becomes tokenId for non-fungibles. The metadata service must distinguish fungible vs. non-fungible transfers via token address lookup.

**Recommended architecture:** Implement encoder/decoder per ERC-5564 spec. Maintain token registries per chain. Support extended metadata for batch transfers. Validate metadata integrity on decode.

---

## Caching and persistence optimize scanning performance

The database layer determines whether users wait 5 seconds or 5 minutes for wallet restore. Strategic caching dramatically improves UX.

**Data that must be persisted:**
- User's `lastScannedBlock` per chain
- Parsed announcement results (matched stealth addresses)
- Stealth address → balance snapshots
- Token registry (addresses, decimals, symbols)
- Registry cache (address → stealth meta-address)

**Data computed on-the-fly:**
- View tag matching (cryptographic operation)
- Current balances (RPC query with caching)
- Stealth address derivation from meta-address

**Wallet restore performance** depends critically on `lastScannedBlock` tracking. Without it, systems must scan from contract deployment—potentially millions of blocks. Umbra's "5-10 second" returning-user scan times result from caching the last scan position and only processing new blocks.

**Announcement caching strategies:**
- Cache raw announcements indexed by block range and schemeId
- Store parsed results per user (requires viewing key or delegated parsing)
- Implement TTL matching expected transaction frequency

**Recommended architecture:** PostgreSQL or similar for relational data (users, stealth addresses, tokens). Redis for hot caches (recent announcements, balance snapshots). Index announcements by (chain, fromBlock, toBlock, schemeId) for efficient range queries.

---

## API design enables wallet and dApp integration

The API layer exposes backend functionality to wallets, dApps, and SDKs. Production systems typically offer REST endpoints with WebSocket subscriptions for real-time updates.

**Core API endpoints:**

| Endpoint | Purpose |
|----------|---------|
| `GET /announcements` | Fetch announcements by block range, chain, schemeId |
| `GET /user/{address}/stealth-addresses` | List known stealth addresses (requires auth) |
| `GET /user/{address}/balances` | Aggregated balance across stealth addresses |
| `POST /parse` | Parse announcements with provided viewing key |
| `POST /relay/withdraw` | Submit meta-transaction for relay |
| `WS /subscribe/announcements` | Real-time announcement stream |

**ScopeLift SDK actions** map to API requirements:
- `getAnnouncements` → announcement query endpoint
- `getAnnouncementsForUser` → parsing endpoint (or client-side)
- `watchAnnouncementsForUser` → WebSocket subscription
- `prepareAnnounce`, `prepareRegisterKeys` → can be client-side only

**Authentication considerations:** Balance queries and stealth address lists require user authentication (the aggregation service needs to know which addresses belong to whom). Announcement queries can be public (events are on-chain anyway). Parsing endpoints accepting viewing keys must use TLS and implement rate limiting.

**Rate limiting:** Announcement queries can be expensive. Implement per-IP and per-user rate limits. Consider tiered access for high-volume integrators.

**Recommended architecture:** REST API for CRUD operations. WebSocket for real-time subscriptions. GraphQL optional for flexible querying. SDK wrapping API for type-safe integration.

---

## Privacy implications vary dramatically by architecture choice

Every backend component represents a potential privacy leak. The choice between Umbra's decentralized model and Fluidkey's server-assisted model exemplifies the privacy-UX tradeoff.

**Umbra model (maximum decentralization):**
- Client-side scanning → viewing key never leaves device
- Public subgraphs → anyone can run their own indexer
- Meta-transaction relay → relayer sees stealth address, not owner identity
- Trade-off: Slower scanning, more complex UX

**Fluidkey model (optimized UX):**
- Server-side scanning → Fluidkey sees all transactions
- Proprietary indexing → dependency on Fluidkey infrastructure
- ENS resolution → Fluidkey generates stealth addresses
- Trade-off: Trust Fluidkey with transaction visibility (not custody)

**Privacy threat matrix:**

| Component | Self-Hosted | Third-Party | Threat |
|-----------|------------|-------------|--------|
| Indexer | ✅ Safe | ⚠️ Sees all announcements | Correlation analysis |
| Parsing | ✅ Safe | ⚠️ Sees your transactions | Full transaction visibility |
| RPC provider | ⚠️ IP correlation | ⚠️ IP + wallet correlation | Deanonymization |
| Relay | ✅ Minimal exposure | ⚠️ Sees stealth addresses | Timing correlation |

**Critical recommendations:**
1. **Never share spending keys** with any service
2. **Viewing key delegation** is acceptable for trusted providers
3. **Use private RPC** (self-hosted node or privacy-focused provider) to avoid IP correlation
4. **Time-randomize withdrawals** to defeat timing analysis
5. **Avoid consolidation** to unlinked addresses—send directly to exchanges or fresh wallets

**Academic finding:** Research found **48.5%-65.7% of Umbra transactions can be deanonymized** through user behavior heuristics, despite the protocol's cryptographic privacy. Backend design matters, but user behavior matters more.

---

## Recommended production architecture

Based on analysis of Umbra, Fluidkey, and the ERC-5564/6538 specifications, a production stealth address backend should include:

**Tier 1 (Essential):**
1. **Announcement Indexer** — Subgraph per chain + direct RPC fallback
2. **Parsing Service** — Client-side SDK with optional server-side delegation
3. **Registry Service** — Cached ERC-6538 lookups with ENS integration
4. **Metadata Codec** — ERC-5564 compliant encoder/decoder
5. **Transaction Relay** — Meta-transaction system with token-to-ETH swaps

**Tier 2 (Required for production UX):**
6. **Balance Aggregation** — Multi-chain portfolio view
7. **UTXO Selection** — Privacy-aware fund combination logic
8. **Multi-chain Coordinator** — Unified API across chains
9. **Database Layer** — Persistent caching for scan optimization

**Tier 3 (Differentiation):**
10. **Real-time API** — WebSocket subscriptions for instant notifications
11. **Privacy Dashboard** — Address linkability warnings
12. **Compliance Tools** — Viewing key sharing for auditors

**Technology stack recommendation:**
- **Indexing:** The Graph (hosted or self-hosted) + Alchemy/QuickNode RPC
- **Backend:** Node.js/TypeScript with ScopeLift SDK as foundation
- **Database:** PostgreSQL (relational) + Redis (caching)
- **Relay:** Custom meta-transaction service with Uniswap integration
- **API:** REST + WebSocket, optionally GraphQL

The stealth address ecosystem is maturing rapidly. ERC-5564 and ERC-6538 provide the standardized foundation, while Umbra and Fluidkey demonstrate viable—though philosophically different—production architectures. The backend components outlined here represent the minimum viable infrastructure for operating a stealth address system that users will actually adopt.
