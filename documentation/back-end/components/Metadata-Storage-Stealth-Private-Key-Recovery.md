# Component 9: Metadata Storage for Stealth Private Key Recovery

## Deep Research — Production Implementations for ERC-5564 SchemeId = 1 (SECP256k1)

---

## 1. Executive Summary

This document focuses on the **metadata storage infrastructure** required to support stealth private key recovery in ERC-5564 systems. While the cryptographic derivation formulas and wallet injection mechanisms are covered in [Stealth Private Key Recovery & Wallet Injection](./Stealth-Private-Key-Recovery-Wallet-Injection.md), this document addresses the complementary problem: **how and where recovery-critical metadata is stored**, cached, and made available under all failure scenarios.

The stealth address protocol introduces a fundamental asymmetry: a sender can create a stealth address using only the recipient's public meta-address, but the recipient cannot spend funds without reconstructing the stealth private key — which requires the sender's ephemeral public key (`P_ephemeral`). This metadata exists in on-chain `Announcement` events, but efficiently accessing it requires storage infrastructure: local caches, restore height bookmarks, encrypted local databases, server-side schemas, and social recovery mechanisms.

This document examines: the core recovery problem and failure scenarios (Section 2), how Fluidkey and Umbra approach metadata storage differently (Sections 3–4), restore height optimization (Section 5), encrypted local storage patterns (Section 6), server-side database schemas (Section 7), social recovery compatibility (Section 8), minimum backup requirements (Section 10), and privacy considerations for metadata storage (Section 11).

---

## 2. The Core Recovery Problem

### 2.1. Why Metadata Is Required

To spend funds at a stealth address, the recipient must derive the stealth private key using ECDH with the sender's ephemeral public key.

> **See:** [Stealth Private Key Recovery & Wallet Injection](./Stealth-Private-Key-Recovery-Wallet-Injection.md), Section 2.1 — for the canonical derivation formula (`p_stealth = p_spend + hash(s) mod n`).

The recipient always possesses `p_spend` and `p_view` (their root keys, backed up as a seed phrase or derived from a wallet signature). The missing piece is **`P_ephemeral`** — the sender's one-time ephemeral public key that was used to generate the stealth address. Without it, the shared secret `s` cannot be computed, and the stealth private key cannot be derived.

### 2.2. Where P_ephemeral Lives

In the ERC-5564 protocol, the sender publishes `P_ephemeral` via an on-chain `Announcement` event:

```solidity
event Announcement(
    uint256 indexed schemeId,       // 1 for SECP256k1
    address indexed stealthAddress, // The generated stealth address
    address indexed caller,         // The contract/EOA that called announce()
    bytes ephemeralPubKey,          // P_ephemeral — CRITICAL for recovery
    bytes metadata                  // [viewTag (1 byte)][token info][amount]
);
```

This event is emitted by the singleton `ERC5564Announcer` contract deployed at `0x55649E01B5Df198D18D95b5cc5051630cfD45564` across all EVM chains. The `ephemeralPubKey` field in this event is the **sole canonical source** of recovery metadata in the standard ERC-5564 flow.

### 2.3. The Failure Scenarios

Recovery metadata must survive the following scenarios:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                        Recovery Failure Scenarios                        │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Device Loss                                                          │
│     User loses phone/laptop with local wallet cache                      │
│     → Must reconstruct all stealth addresses from scratch                │
│                                                                          │
│  2. Service Provider Shutdown                                            │
│     Fluidkey, Umbra, or custom backend goes offline permanently          │
│     → Must recover without any server-side assistance                    │
│                                                                          │
│  3. Local Cache Corruption                                               │
│     IndexedDB, localStorage, or SQLite database corrupted                │
│     → Must re-derive all data from on-chain + root keys                  │
│                                                                          │
│  4. Multi-Chain Migration                                                │
│     User switches chains or adds new L2 support                          │
│     → Must discover stealth addresses across all chains                  │
│                                                                          │
│  5. Key Rotation                                                         │
│     Social recovery changes the spending key                             │
│     → All N stealth wallets need re-keying (N transactions)              │
│                                                                          │
│  6. Time Gap                                                             │
│     User doesn't open wallet for months/years                            │
│     → Must scan all announcements since last checkpoint                  │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Production Approach #1: BIP-32 Deterministic Derivation (Fluidkey)

Fluidkey eliminates the need to store per-transaction ephemeral keys by using BIP-32 hierarchical deterministic derivation. All stealth addresses can be replayed from the user's wallet private key and PIN, with no external metadata required. The Fluidkey server holds a derived subtree of the viewing key (at `m/5564'/N'`), which it uses to generate new stealth addresses on behalf of the user. The spending key never leaves the client.

> **See:** [Stealth Private Key Recovery & Wallet Injection](./Stealth-Private-Key-Recovery-Wallet-Injection.md), Section 5 — for the Fluidkey BIP-32 recovery architecture, wallet injection flow, smart account integration, counterfactual Safe address prediction, and SARA recovery tool.
>
> **See:** [Creation of Key Pairs](./Creation-Key-Pairs.md), Section 4.2 — for the BIP-32 derivation path structure (`m/5564'/N'/c0'/c1'/0'/p'/n'`), ENSIP-11 coinType encoding, and multi-chain derivation.
>
> **See:** [Storing Key Pairs](./Storing-Key-Pairs.md), Section 4.1 — for the canonical `extractViewingPrivateKeyNode()` implementation and server-side viewing node delegation.

**Key metadata-storage implication:** Because Fluidkey's derivation is deterministic, there is **no per-transaction metadata to store**. Recovery requires only the wallet key + PIN. This eliminates the announcement scanning problem entirely for the Fluidkey model.

---

## 4. Production Approach #2: On-Chain Announcement Scanning (Umbra / ERC-5564 Standard)

Umbra follows the ERC-5564 specification directly: all recovery metadata lives on-chain in `Announcement` events. The recipient scans these events, performs ECDH with their viewing key against each ephemeral public key, and identifies which announcements are addressed to them. This approach has maximum decentralization — no server is involved in the recovery process.

> **See:** [Event Listener](./Event-Listener.md), Sections 3–4 — for the ViewTag scanning algorithm (99.6% filter efficiency), Umbra subgraph architecture, and client-side scanning flow.
>
> **See:** [Stealth Private Key Recovery & Wallet Injection](./Stealth-Private-Key-Recovery-Wallet-Injection.md), Section 4 — for the Umbra key derivation implementation, wallet injection, and gas funding architecture.
>
> **See:** [Event Listener](./Event-Listener.md), Section 7 — for the ScopeLift SDK `createStealthClient`, `getAnnouncements`, `getAnnouncementsForUser`, and `computeStealthKey` code examples.

### 4.1. Umbra Caching Strategy

Umbra's client-side caching reduces re-scanning time for returning users. The Umbra app reports approximately 10–15 seconds for a weekly scan window, thanks to incremental checkpoint-based caching.

```
Client-Side Cache (Browser):
├── Matched announcements        → Verified stealth addresses
├── Last scanned block number    → Resume point for incremental scan
├── Derived stealth private keys → For immediate spending
└── View tag match candidates    → Reduces re-computation on refresh

On each login:
1. Load cached checkpoint (last scanned block)
2. Query new Announcement events from checkpoint → current block
3. Apply view tag filter → full ECDH on matches
4. Update cache with new matches and checkpoint
```

---

## 5. Restore Height: Optimizing Full Recovery Scans

### 5.1. The Full-Scan Problem

When a user performs a complete recovery (device loss, new wallet), they face a cold-start problem: which block should the scan begin from? Starting from block 0 (or the contract deployment block) requires processing every announcement ever emitted — potentially millions of events across years of chain history.

### 5.2. Monero's Restore Height Pattern

The stealth address ecosystem borrows the concept of **restore height** from Monero, which has faced the same scanning problem for over a decade:

```
Restore Height: The block number at or before the first incoming
transaction to the wallet. Scanning begins from this block forward.

Storage locations:
  - Written alongside the seed phrase during wallet creation
  - Stored in wallet file metadata
  - Optionally provided by the user during manual recovery

Impact:
  - Correct restore height: Scan only relevant blocks (fast)
  - Too low: Scans extra blocks but finds all transactions (safe but slow)
  - Too high: Misses early transactions (DANGEROUS — incorrect balance)
  - Unknown: Full scan from genesis (very slow but complete)
```

### 5.3. Ethereum Stealth Address Restore Height

For ERC-5564 implementations, the restore height maps to the block number of the user's first interaction with the stealth address system:

```typescript
// Optimal restore height sources (in priority order):
const restoreHeight =
  userRegistrationBlock      // Block when user registered stealth meta-address
  ?? firstAnnouncementBlock  // Block of first received stealth payment
  ?? contractDeployBlock     // ERC5564Announcer deployment block (fallback)
  ?? 0n;                     // Genesis (worst case — full chain scan)

// ScopeLift SDK uses fromBlock parameter:
const announcements = await stealthClient.getAnnouncements({
  ERC5564Address,
  args: { schemeId },
  fromBlock: restoreHeight,  // Defaults to 0 if not provided
});
```

### 5.4. Multi-Chain Restore Height Tracking

In a multi-chain environment, each chain requires its own restore height:

```typescript
interface ChainRestoreHeight {
  chainId: number;
  restoreBlock: bigint;          // First relevant block on this chain
  contractDeployBlock: bigint;    // ERC5564Announcer deploy block
  lastScannedBlock: bigint;       // Most recent fully scanned block
  lastScanTimestamp: Date;        // When the last scan completed
}

// Example restore heights for production chains:
const restoreHeights: ChainRestoreHeight[] = [
  { chainId: 1,     restoreBlock: 18_000_000n, ... }, // Ethereum mainnet
  { chainId: 10,    restoreBlock: 112_000_000n, ...},  // Optimism
  { chainId: 42161, restoreBlock: 150_000_000n, ...},  // Arbitrum
  { chainId: 8453,  restoreBlock: 7_000_000n, ... },   // Base
  { chainId: 137,   restoreBlock: 50_000_000n, ... },  // Polygon
];
```

---

## 6. Encrypted Local Storage (Client-Side Caching)

### 6.1. Purpose and Scope

Local caching is a **performance optimization**, not a primary recovery mechanism. The canonical metadata source is always either on-chain events (Umbra model) or deterministic derivation (Fluidkey model). Local caches reduce re-computation on subsequent logins.

### 6.2. Storage Mechanisms by Platform

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Client-Side Storage Options                         │
├────────────────┬────────────┬──────────────────┬────────────────────────┤
│ Platform       │ Mechanism  │ Capacity         │ Security Level         │
├────────────────┼────────────┼──────────────────┼────────────────────────┤
│ Browser        │ IndexedDB  │ ~unlimited       │ Origin-isolated        │
│ Browser        │ localStorage│ ~5-10 MB        │ Origin-isolated        │
│ iOS            │ Keychain   │ ~unlimited       │ Secure Enclave         │
│ Android        │ Keystore   │ ~unlimited       │ Hardware-backed        │
│ Desktop        │ OS Keychain│ ~unlimited       │ OS-level encryption    │
│ Desktop        │ SQLite     │ ~unlimited       │ Application-level      │
└────────────────┴────────────┴──────────────────┴────────────────────────┘
```

### 6.3. Cached Data Schema

```typescript
interface CachedStealthData {
  // Scan checkpoint (always stored)
  scanCheckpoints: {
    chainId: number;
    lastScannedBlock: bigint;
    lastScanTimestamp: Date;
  }[];

  // Verified stealth addresses (announcements confirmed as belonging to user)
  verifiedAddresses: {
    stealthAddress: `0x${string}`;
    ephemeralPubKey: `0x${string}`;
    viewTag: `0x${string}`;
    blockNumber: bigint;
    transactionHash: `0x${string}`;
    chainId: number;
    derivationIndex?: number;        // If using deterministic derivation
  }[];

  // Derived keys (SENSITIVE — only stored in encrypted form)
  derivedKeys?: {
    stealthAddress: `0x${string}`;
    stealthPrivateKey: `0x${string}`; // Encrypted with user password
  }[];
}
```

### 6.4. Encryption Requirements

If stealth private keys are cached locally (to avoid re-derivation on each session), they must be encrypted at rest:

```
Key Derivation Function: Argon2id (preferred) or PBKDF2
  - Memory: 64 MB (Argon2id)
  - Iterations: 3 (Argon2id) / 600,000 (PBKDF2)
  - Salt: Random 16 bytes per user

Symmetric Encryption: AES-256-GCM
  - Key: Derived from user password via KDF
  - IV: Random 12 bytes per encryption
  - Auth tag: 16 bytes (included in ciphertext)

Critical rule: NEVER store spending private keys unencrypted.
  - Viewing keys may be stored unencrypted (they cannot spend funds).
  - Stealth private keys MUST be encrypted or not stored at all.
  - Fluidkey approach: never store any keys (re-derive each session).
```

### 6.5. Cache Invalidation Strategies

```
1. Reorg Detection:
   - On each scan, verify block hashes for cached blocks
   - If hash mismatch detected, invalidate from reorged block forward
   - Re-scan affected range

2. Incremental Refresh:
   - Store lastScannedBlock per chain
   - On login: scan from lastScannedBlock → latestBlock
   - Merge new results into existing cache

3. Periodic Full Verification:
   - Every N sessions, re-scan from restoreHeight
   - Compare results against cache for consistency
   - Alert user if discrepancies found

4. Manual Reset:
   - User-triggered full cache clear + re-scan
   - Useful when cache corruption suspected
```

---

## 7. Server-Side Database Schemas (Production Implementations)

### 7.1. Fluidkey Server Database (Deterministic Model)

Fluidkey's server stores the viewing key node and derivation state, enabling it to generate new stealth addresses and detect incoming payments without the spending key:

```sql
-- Core accounts table: maps users to their stealth addresses
CREATE TABLE stealth_accounts (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id),
    stealth_address     VARCHAR(42) NOT NULL,
    derivation_index    INTEGER NOT NULL,          -- p'/n' from BIP-32 path
    chain_id            INTEGER NOT NULL,
    safe_deployed       BOOLEAN DEFAULT FALSE,      -- Whether Safe is deployed
    balance_wei         NUMERIC(78, 0) DEFAULT 0,   -- Last known balance
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, derivation_index, chain_id)
);

-- Scan progress: tracks how far the server has indexed
CREATE TABLE scan_checkpoints (
    user_id             UUID NOT NULL REFERENCES users(id),
    chain_id            INTEGER NOT NULL,
    last_scanned_block  BIGINT NOT NULL,
    last_scan_timestamp TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, chain_id)
);

-- Viewing key node: the BIP-32 subtree shared by the user
CREATE TABLE viewing_key_nodes (
    user_id             UUID PRIMARY KEY REFERENCES users(id),
    encrypted_node      BYTEA NOT NULL,             -- Encrypted BIP-32 node
    node_path           VARCHAR(50) NOT NULL,       -- e.g., "m/5564'/0'"
    next_derivation_idx INTEGER DEFAULT 0,          -- Next unused index
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookup by stealth address
CREATE INDEX idx_stealth_accounts_address ON stealth_accounts(stealth_address);
CREATE INDEX idx_stealth_accounts_user_chain ON stealth_accounts(user_id, chain_id);
```

### 7.2. Umbra / ERC-5564 Standard Database (Scan-Based Model)

For implementations that cache on-chain announcements server-side (e.g., indexer services or The Graph subgraphs):

```sql
-- All announcement events indexed from on-chain
CREATE TABLE announcement_cache (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scheme_id           INTEGER NOT NULL DEFAULT 1,
    stealth_address     VARCHAR(42) NOT NULL,
    caller              VARCHAR(42) NOT NULL,
    ephemeral_pubkey    VARCHAR(132) NOT NULL,       -- 66 bytes hex-encoded
    view_tag            VARCHAR(4) NOT NULL,          -- 1 byte hex
    metadata            TEXT,                         -- Full metadata field
    block_number        BIGINT NOT NULL,
    transaction_hash    VARCHAR(66) NOT NULL,
    log_index           INTEGER NOT NULL,
    chain_id            INTEGER NOT NULL,
    indexed_at          TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(transaction_hash, log_index, chain_id)
);

-- User-specific recovery checkpoints
CREATE TABLE user_recovery_state (
    registrant_address  VARCHAR(42) NOT NULL,
    chain_id            INTEGER NOT NULL,
    registration_block  BIGINT NOT NULL,              -- Restore height
    last_scanned_block  BIGINT NOT NULL,
    matched_count       INTEGER DEFAULT 0,            -- Stealth addresses found
    last_scan_timestamp TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (registrant_address, chain_id)
);

-- Indices for efficient scanning
CREATE INDEX idx_announcements_block ON announcement_cache(chain_id, block_number);
CREATE INDEX idx_announcements_view_tag ON announcement_cache(view_tag);
CREATE INDEX idx_announcements_stealth ON announcement_cache(stealth_address);
```

---

## 8. Social Recovery and Stealth Addresses

### 8.1. The Fundamental Incompatibility

Vitalik Buterin identified the core tension between stealth addresses and social recovery wallets in his January 2023 guide:

Social recovery wallets allow guardians to change the controlling key when a user loses access. But with stealth addresses, the user may control **N** stealth wallets — each requires a separate key-change transaction. This creates three problems:

1. **Gas cost**: N transactions across potentially many chains
2. **Privacy loss**: Executing N recovery transactions simultaneously links all stealth addresses to the same owner
3. **Counterfactual addresses**: Some stealth addresses may not even be deployed yet (funds received at CREATE2-predicted addresses)

### 8.2. Production Mitigation Strategies

```
Strategy 1: Deterministic Derivation (Fluidkey approach)
  - Only the root wallet key needs recovery
  - All stealth addresses are re-derivable from the root
  - Social recovery at the wallet level automatically recovers all stealth addresses
  - No per-address recovery transactions needed

Strategy 2: Accept Privacy Loss on Recovery (Vitalik's suggestion)
  - Perform recovery transactions slowly over 2+ weeks
  - Spread across different times and gas conditions
  - Use a third-party service to manage the slow rollout
  - Partial privacy preservation at the cost of recovery speed

Strategy 3: Secret-Share Root Key (Not smart contract recovery)
  - Split the root spending key using Shamir's Secret Sharing
  - Distribute shares to guardians
  - Reconstruct root key from threshold of shares
  - No on-chain recovery transactions needed
  - Tradeoff: guardians can collude to steal funds

Strategy 4: Keystore Contracts (Vitalik's "Three Transitions" vision)
  - Store stealth meta-addresses + recovery logic in a keystore contract
  - Use the keystore address as the user's canonical identity
  - Key changes propagate through the keystore
  - Still requires cross-chain messaging for L2 stealth addresses
```

---

## 9. Comparison Matrix: Fluidkey vs. Umbra Recovery

> **See:** [Stealth Private Key Recovery & Wallet Injection](./Stealth-Private-Key-Recovery-Wallet-Injection.md), Addendum — for the comprehensive comparison matrix covering recovery inputs, scanning costs, smart account integration, multi-chain recovery, and all production implementation differences.

---

## 10. Minimum Backup Requirements

### 10.1. What Users Must Back Up

```
┌──────────────────────────────────────────────────────────────────────────┐
│                    Minimum Backup Per Implementation                     │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Fluidkey:                                                               │
│  ┌─────────────────────────────────────────────────┐                     │
│  │ 1. Wallet private key (or seed phrase)  [REQUIRED]│                   │
│  │ 2. PIN code (user-chosen)               [REQUIRED]│                   │
│  │ 3. Derivation index checkpoint          [OPTIONAL]│                   │
│  └─────────────────────────────────────────────────┘                     │
│  Recovery guarantee: 100% with items 1 + 2                               │
│  Without PIN: Cannot derive keys (PIN is part of signed message hash)    │
│                                                                          │
│  Umbra / ERC-5564:                                                       │
│  ┌─────────────────────────────────────────────────┐                     │
│  │ 1. Wallet private key (or seed phrase)  [REQUIRED]│                   │
│  │ 2. Restore height (block number or date)[RECOMMENDED]│                │
│  │ 3. Cached announcement data             [OPTIONAL]│                   │
│  └─────────────────────────────────────────────────┘                     │
│  Recovery guarantee: 100% with item 1 (scan from genesis)                │
│  Without restore height: Works but very slow (full chain scan)           │
│                                                                          │
│  Combined / Hybrid:                                                      │
│  ┌─────────────────────────────────────────────────┐                     │
│  │ 1. Wallet private key                 [REQUIRED]│                     │
│  │ 2. PIN or passphrase                  [REQUIRED]│                     │
│  │ 3. Restore height per chain        [RECOMMENDED]│                     │
│  │ 4. Derivation path specificati    [NON-STANDARD]│                     │
│  └─────────────────────────────────────────────────┘                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 10.2. Physical Backup Methods

```
Steel / Metal Backup:
  - Seed phrase engraved on metal plate (Trezor Keep Metal, Cryptosteel)
  - PIN written on separate metal plate (stored in different location)
  - Restore height engraved alongside seed (optional but recommended)

Paper Backup:
  - Seed phrase written on acid-free paper
  - Stored in fireproof safe or bank safety deposit box
  - PIN stored separately from seed

Digital Encrypted Backup:
  - AES-256-GCM encrypted file containing:
    { seedPhrase, pin, restoreHeights: { chainId: blockNumber } }
  - Encrypted with a strong passphrase (NOT the wallet password)
  - Stored on multiple USB drives in geographically separated locations
```

---

## 11. Privacy Considerations in Metadata Storage

### 11.1. Metadata Leakage Vectors

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       Privacy Leakage Vectors                            │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  1. Local Cache Compromise                                               │
│     Attacker gains access to device → sees all verified stealth addrs    │
│     Mitigation: Encrypt cache, don't store stealth private keys          │
│                                                                          │
│  2. Server-Side Metadata (Fluidkey model)                                │
│     Fluidkey server holds viewing key node → can see all stealth addrs   │
│     Mitigation: Server cannot spend funds (no spending key)              │
│     Note: This is an explicit privacy tradeoff for UX                    │
│                                                                          │
│  3. RPC Provider Observation                                             │
│     Provider sees eth_getLogs queries for Announcement events            │
│     Can correlate query timing with user identity                        │
│     Mitigation: Use privacy-preserving RPCs (Tor, RPCh, MEV blocker)     │
│     Mitigation: Distribute queries across multiple providers             │
│                                                                          │
│  4. Subgraph / Indexer Observation                                       │
│     Graph node operator sees which stealth addresses are queried         │
│     Mitigation: Self-host subgraph node                                  │
│     Mitigation: Query all announcements, not just user's                 │
│                                                                          │
│  5. Blockchain Analysis During Recovery                                  │
│     Recovery transaction pattern (many balance checks in sequence)       │
│     Can reveal that specific addresses belong to same user               │
│     Mitigation: Add random delays between balance queries                │
│     Mitigation: Use Multicall3 to batch queries (hides individual addrs) │
│                                                                          │
│  6. ENS Resolution Timing (Fluidkey model)                               │
│     Each ENS query returns a new stealth address                         │
│     Multiple queries in short succession → same recipient assumed        │
│     Mitigation: Inherent to the design, accepted tradeoff                │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

### 11.2. Privacy Tier Classification

```
Tier 1 — Maximum Privacy (Umbra, client-side only):
  - No server involvement
  - User scans all announcements locally
  - No viewing key delegation
  - Tradeoff: Slowest recovery, highest computation

Tier 2 — Balanced Privacy (Fluidkey model):
  - Server holds viewing key node (can detect payments)
  - Server cannot spend funds
  - Faster UX (server generates addresses, notifies of payments)
  - Tradeoff: Server knows all stealth addresses and balances

Tier 3 — Trusted Parser (Delegated scanning):
  - User shares viewing key with third-party parser
  - Parser scans on user's behalf and reports matches
  - Fastest performance (no client-side computation)
  - Tradeoff: Parser sees all payment activity
```

---

## 12. Sources

### Primary Sources

| Source | URL | Relevance |
|--------|-----|-----------|
| Fluidkey Technical Walkthrough | https://docs.fluidkey.com/technical-documentation/technical-walkthrough | BIP-32 derivation, key architecture |
| Fluidkey Stealth Account Kit | https://github.com/fluidkey/fluidkey-stealth-account-kit | Recovery functions, code reference |
| SARA Recovery Interface | https://recovery.fluidkey.com | Production recovery tool |
| Fluidkey Initdata Docs | https://docs.fluidkey.com/technical-documentation/stealth-account-initdata | Initdata versioning for recovery |
| Fluidkey FAQ | https://docs.fluidkey.com/readme/frequently-asked-questions | Self-custody, recovery guarantees |
| ScopeLift Stealth SDK | https://github.com/ScopeLift/stealth-address-sdk | Announcement scanning, key computation |
| Umbra Protocol | https://github.com/ScopeLift/umbra-protocol | On-chain recovery architecture |
| ERC-5564 Specification | https://eips.ethereum.org/EIPS/eip-5564 | Announcement event structure, view tags |
| Dedaub Fluidkey Audit | https://dedaub.com/audits/fluidkey/fluidkey-stealth-account-kit-may-24-2024/ | Recovery audit findings |

### Secondary Sources

| Source | URL | Relevance |
|--------|-----|-----------|
| Vitalik Stealth Guide | https://vitalik.eth.limo/general/2023/01/20/stealth.html | Social recovery challenges |
| Vitalik Three Transitions | https://vitalik.eth.limo/general/2023/06/09/three_transitions.html | Multi-address recovery architecture |
| Privacy in Ethereum (Simon Brown) | https://simbro.medium.com/privacy-in-ethereum-stealth-addresses-f05016109010 | Fluidkey vs Umbra comparison |
| ENS + Fluidkey Blog | https://ens.domains/blog/post/private-transactions-with-fluidkey | ENS integration, recovery.fluidkey.com |
| Anonymity Analysis (ACM 2023) | https://arxiv.org/pdf/2308.01703 | Umbra deanonymization heuristics |
| ScopeLift EF Grant Update | https://scopelift.co/blog/progress-update-stealth-address-ercs | SDK development, Umbra v2 plans |
| Stealth Address Dev Docs | https://stealthaddress.dev/SDK/glossary/terms | SDK terminology reference |
| BIP-32 Specification | https://github.com/bitcoin/bips/blob/master/bip-0032.mediawiki | HD wallet derivation standard |
| QuickNode Fluidkey Feature | https://blog.quicknode.com/feature-fridays-fluidkey/ | Fluidkey architecture overview |
