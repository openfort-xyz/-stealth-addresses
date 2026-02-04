# Backend Components for EOA-Based Stealth Address Systems (SchemeId = 1, SECP256k1)

Implementing stealth addresses requires **10 interconnected backend components** spanning cryptographic key management, on-chain registries, event indexing, and wallet infrastructure. Each component has a dedicated deep-research document in the [`components/`](./components/) directory. This page provides the architectural overview, component diagram, and navigation links.

**Standards:** ERC-5564 (Stealth Addresses) / ERC-6538 (Stealth Meta-Address Registry)
**Production references:** Umbra Protocol, Fluidkey, ScopeLift Stealth Address SDK

---

## System Architecture

```
                        ┌─────────────────────────────────────────────────────────────────┐
                        │                     RECIPIENT SETUP                             │
                        │                                                                 │
                        │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
                        │   │   C1: Create │────▶│  C2: Store   │────▶│  C3: Store   │    │
                        │   │   Key Pairs  │     │  Key Pairs   │     │  Meta-Address│    │
                        │   └──────────────┘     └──────────────┘     └──────┬───────┘    │
                        │                                                    │            │
                        │                                             ┌──────▼───────┐    │
                        │                                             │  C4: Attach  │    │
                        │                                             │  to Account  │    │
                        │                                             │  (Registry)  │    │
                        │                                             └──────────────┘    │
                        └─────────────────────────────────────────────────────────────────┘
                                                       │
                                                       │ On-chain: ERC-6538 Registry
                                                       │           + ERC-5564 Announcer
                                                       ▼
                        ┌─────────────────────────────────────────────────────────────────┐
                        │                     PAYMENT DETECTION                           │
                        │                                                                 │
                        │   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐    │
                        │   │  C5: Event   │────▶│  C6: Manage  │────▶│ C7: Balance  │    │
                        │   │  Listener    │     │  Stealth     │     │ Aggregation  │    │
                        │   │  (Indexer)   │     │  Accounts    │     │ (Multi-Chain)│    │
                        │   └──────────────┘     └──────────────┘     └──────────────┘    │
                        │         │                                                       │
                        │         │ ViewTag filter (99.6% skip rate)                      │
                        │         ▼                                                       │
                        │   ┌──────────────┐                                              │
                        │   │ C9: Metadata │                                              │
                        │   │ Storage for  │                                              │
                        │   │ Recovery     │                                              │
                        │   └──────────────┘                                              │
                        └─────────────────────────────────────────────────────────────────┘
                                                       │
                                                       │ Stealth private key derivation
                                                       │ + gas funding
                                                       ▼
                        ┌─────────────────────────────────────────────────────────────────┐
                        │                     WITHDRAWAL                                  │
                        │                                                                 │
                        │   ┌──────────────┐     ┌──────────────┐                         │
                        │   │ C10: Key     │────▶│ C8: Spending │                         │
                        │   │ Recovery &   │     │ Actions      │                         │
                        │   │ Wallet       │     │ (Gas Funding │                         │
                        │   │ Injection    │     │  + Withdraw) │                         │
                        │   └──────────────┘     └──────────────┘                         │
                        └─────────────────────────────────────────────────────────────────┘
```

### Data Flow Summary

```
Sender                                                    Recipient
  │                                                           │
  │  1. Lookup meta-address (C3/C4)                           │
  │  2. Generate stealth address + ephemeral key              │
  │  3. Send funds + emit Announcement (ERC-5564)             │
  │                                                           │
  │                    ┌──────────────┐                       │
  │───────────────────▶│  Blockchain  │◀──────────────────────│
  │                    └──────────────┘                       │
  │                                                           │
  │                              4. Scan announcements (C5)   │
  │                              5. Detect own payments (C6)  │
  │                              6. Query balances (C7)       │
  │                              7. Derive stealth key (C10)  │
  │                              8. Withdraw funds (C8)       │
```

---

## Component Index

### C1: Creation of Spending and Viewing Key Pairs

> **[Full Document](./components/Creation-Key-Pairs.md)**

Generates the dual-key pair required by ERC-5564 SchemeId = 1: a **spending key** (controls funds) and a **viewing key** (detects payments). Two production approaches exist: signature-based derivation (Umbra: split `keccak256` of wallet signature) and BIP-32 hierarchical derivation (Fluidkey: path `m/5564'/N'/c0'/c1'/0'/p'/n'`). Both compressed public keys are concatenated into the 66-byte stealth meta-address format (`st:eth:0x<P_spend><P_view>`).

---

### C2: Storing Spending and Viewing Key Pairs

> **[Full Document](./components/Storing-Key-Pairs.md)**

Defines storage architecture with strict separation: spending keys require maximum security (hardware wallet, Secure Enclave, or encrypted IndexedDB with Web Crypto AES-256-GCM), while viewing keys can be delegated to parsing providers for real-time scanning. Covers `extractViewingPrivateKeyNode()` for BIP-32 delegation, PBKDF2 key derivation (1M iterations, SHA-512), and RFC 6979 deterministic recovery mechanisms. Both Umbra and Fluidkey enable full recovery from the original wallet signature alone.

---

### C3: Storing the Stealth Meta-Address for Fast Access

> **[Full Document](./components/Storing-Stealth-Meta-Address.md)**

Covers on-chain storage via the canonical **ERC6538Registry** (`0x6538...6538`, CREATE2-deployed on all major EVM chains), ENS integration (standard resolution + Fluidkey's CCIP Read/ERC-3668 approach that returns a fresh stealth address per query), multi-source resolution strategies with caching, and privacy implications of on-chain meta-address queries.

---

### C4: Attaching the Meta-Address to the Account

Registers the stealth meta-address on-chain via `ERC6538Registry.registerKeys(schemeId, stealthMetaAddress)`. Supports both direct registration (~45k-60k gas) and gasless registration via EIP-712 signature + relayer (`registerKeysOnBehalf()`). The same meta-address works across all EVM chains, but each chain's registry is independent. Key rotation is handled by re-calling `registerKeys()` (overwrites previous entry).

```solidity
// Direct registration
function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external;

// Gasless via EIP-712 signature
function registerKeysOnBehalf(
    address registrant,
    uint256 schemeId,
    bytes calldata signature,
    bytes calldata stealthMetaAddress
) external;
```

---

### C5: Event Listener / Announcement Indexer

> **[Full Document](./components/Event-Listener.md)**

Indexes `Announcement` events from **ERC5564Announcer** (`0x5564...5564`) across multiple chains. Implements ViewTag-based filtering (1-byte tag, 99.6% skip rate) to reduce expensive ECDH operations. Covers The Graph subgraph schema, custom RPC indexer implementation, ScopeLift SDK integration (`createStealthClient`, `getAnnouncements`, `getAnnouncementsForUser`), multi-chain polling configurations (Ethereum/Arbitrum/Base/Optimism/Polygon), chain reorganization handling, and caching strategies.

---

### C6: Managing Stealth Accounts in Wallet

> **[Full Document](./components/Managing-Stealth-Accounts.md)**

Manages the lifecycle of discovered stealth addresses: detection, portfolio display, spending coordination, and privacy preservation. Covers Fluidkey's unified dashboard model (single consolidated view, counterfactual Safe accounts) vs Umbra's individual-address approach (privacy health indicators, WalletConnect per address). Includes database schemas for stealth address and balance tracking, gap-limit scanning for BIP-32 recovery, and privacy-preserving spending patterns (single-address vs UTXO-like selection vs multi-address consolidation).

---

### C7: Balance Aggregation (Multi-Chain)

> **[Full Document](./components/Balance-Aggregation.md)**

Queries balances across potentially hundreds of stealth addresses on multiple chains. Primary method: **Multicall3** (`0xcA11...CA11`, 100+ chains) batching up to ~1,000 `getEthBalance` / `balanceOf` calls per transaction. Covers API-based alternatives (Alchemy Portfolio API, Covalent GoldRush, Moralis), tiered caching strategies (30s active / 5min funded / 1h inactive / 24h empty), and anonymity considerations from the Chainalysis/ACM research perspective.

---

### C8: Spending Actions from Stealth Accounts

Handles the gas bootstrapping problem (stealth addresses start with zero ETH) and the withdrawal transaction flow. Four production solutions:

| Solution | Approach | Used By |
|----------|----------|---------|
| **Paymaster sponsorship** | ERC-4337 paymaster covers gas | Fluidkey |
| **Meta-transaction relay** | Relayer submits tx, fee deducted from tokens | Umbra/GSN |
| **EIP-7702 delegation** | EOA delegates to smart contract (Pectra upgrade) | Emerging |
| **Sender pre-funding** | Sender includes ETH with stealth payment | Any (privacy trade-off) |

Privacy-preserving spending patterns ranked: single-address spend (best) > UTXO-like selection (good) > multi-address consolidation (poor, links addresses on-chain).

---

### C9: Metadata Storage for Stealth Private Key Recovery

> **[Full Document](./components/Metadata-Storage-Stealth-Private-Key-Recovery.md)**

Defines what metadata must be stored to enable stealth private key recovery (`ephemeralPubKey`, `viewTag`, `schemeId`, `stealthAddress`, `blockNumber`), and where to store it. Covers three storage tiers: on-chain event logs (always available, no trust), encrypted local cache (fast access), and server-side database schemas. Includes restore-height optimization, social recovery mechanisms, encrypted backup strategies, minimum backup requirements, and privacy considerations for metadata exposure.

---

### C10: Stealth Private Key Recovery and Wallet Injection

> **[Full Document](./components/Stealth-Private-Key-Recovery-Wallet-Injection.md)**

The bridge between passive detection and active fund control. Derives the stealth private key (`p_stealth = p_spend + keccak256(p_view * P_ephemeral) mod n`) and injects it into a wallet client for transaction signing. Covers three production implementations: ScopeLift SDK (`computeStealthKey()` + viem), Umbra Protocol (ethers.js + meta-transaction relayer + `withdrawTokenOnBehalf()`), and Fluidkey (BIP-32 deterministic derivation + ERC-4337 Safe accounts + paymaster). Addendum covers Fluidkey's `@fluidkey/stealth-account-kit` complete wallet injection flow and MoonChute's aggregate ECDSA approach (no key injection needed).

---
