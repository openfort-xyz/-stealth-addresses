# Storing the Stealth Meta-Address for Fast Access

## Deep Research — ERC-5564 SchemeId=1 (SECP256k1) Stealth Address Systems

---

## 1. Executive Summary

The stealth meta-address is the public-facing artifact of the stealth address system — a 66-byte payload encoding the recipient's compressed spending and viewing public keys. Every sender needs to retrieve this payload before they can generate a one-time stealth address. The speed, reliability, and discoverability of that retrieval directly determines the practical usability of the entire protocol.

Production systems have converged on two fundamentally different storage philosophies: **on-chain registry** (ERC-6538, used by Umbra/ScopeLift) where the meta-address is written to a canonical singleton contract deployed deterministically across all chains, and **off-chain resolution** (Fluidkey) where an ENS offchain resolver backed by a server generates a fresh stealth address on every lookup — never exposing the meta-address itself. The on-chain approach is trust-minimized and interoperable but costs gas to register and publicly reveals the meta-address. The off-chain approach has zero setup cost and hides the meta-address from public view but introduces a server dependency and viewing-key delegation requirement.

The optimal architecture layers both approaches: register on ERC-6538 as the canonical interoperability layer (any wallet can query it), and optionally integrate ENS resolution for human-readable identifiers. This combination provides a fallback chain — ENS resolution → ERC-6538 registry lookup → direct meta-address exchange — ensuring senders can always find the recipient's keys.

---

## 2. The Stealth Meta-Address: What Gets Stored

Before examining *where* to store, we must understand *what* is being stored and its exact format.

### 2.1 Format Specification

The stealth meta-address encodes two compressed SECP256k1 public keys:

```
┌───────────────────────────────────────────────────────────────────┐
│                  Stealth Meta-Address Format                      │
├───────────────────────────────────────────────────────────────────┤
│ URI:  st:<chain>:0x<spendingPubKey><viewingPubKey>                │
│                                                                   │
│ Spending Public Key (P_spend)  │ 33 bytes │ Compressed SECP256k1  │
│ Viewing Public Key  (P_view)   │ 33 bytes │ Compressed SECP256k1  │
├───────────────────────────────────────────────────────────────────┤
│ Raw bytes payload:             │ 66 bytes │                       │
│ URI total (Ethereum):          │ ~143 chars (with st:eth:0x...)   │
└───────────────────────────────────────────────────────────────────┘

Chain prefix follows EIP-3770 shortnames:
  st:eth:0x...   (Ethereum mainnet)
  st:oeth:0x...  (Optimism)
  st:arb1:0x...  (Arbitrum One)
  st:base:0x...  (Base)
```

### 2.2 Security Classification

The stealth meta-address contains **only public keys** — not private keys. Its exposure does not compromise funds. However, knowing a meta-address does reveal:

```
┌───────────────────────────────────────────────────────────────────┐
│               META-ADDRESS EXPOSURE MODEL                         │
├───────────────────────────┬───────────────────────────────────────┤
│  What a meta-address      │  What a meta-address does             │
│  does NOT reveal:         │  reveal:                              │
├───────────────────────────┼───────────────────────────────────────┤
│  ✗ Spending private key   │  ✓ That this address uses stealth     │
│  ✗ Viewing private key    │  ✓ The spending + viewing public keys │
│  ✗ Any stealth addresses  │  ✓ Someone *could* send stealth txs   │
│  ✗ Transaction history    │    to this user if they choose        │
│  ✗ Balance information    │  ✓ Association: addr → stealth user   │
└───────────────────────────┴───────────────────────────────────────┘
```

This classification matters: because the meta-address is purely public material, it can be stored on-chain, in ENS, in a public registry, or shared openly without security risk. The privacy consideration is about *metadata* — whether you want the world to know you are a stealth address user — not about key compromise.

---

## 3. On-Chain Storage: ERC-6538 Registry

### 3.1 The Canonical Registry Contract

ERC-6538 defines the standard stealth meta-address registry — a singleton contract deployed at a deterministic address across all EVM chains:

```
┌───────────────────────────────────────────────────────────────────┐
│                    ERC-6538 REGISTRY                              │
├───────────────────────────────────────────────────────────────────┤
│ Contract:   0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538            │
│ Deployer:   0x4e59b44847b379578588920ca78fbf26c0b4956c            │
│ Method:     CREATE2 (deterministic, same address all chains)      │
│ Audit:      Trail of Bits (ERC-5564 + ERC-6538 contracts)         │
│ Status:     Release Candidate                                     │
└───────────────────────────────────────────────────────────────────┘
```

### 3.2 Storage Layout

The registry uses a minimal storage design:

```solidity
// Core storage: registrant → schemeId → stealth meta-address bytes
mapping(address registrant => mapping(uint256 schemeId => bytes stealthMetaAddress))
    public stealthMetaAddressOf;

// Replay protection for signature-based registration
mapping(address registrant => uint256 nonce) public nonceOf;
```

For SchemeId=1 (SECP256k1), the `bytes stealthMetaAddress` value is exactly 66 bytes — the concatenation of the two compressed public keys. The `schemeId` dimension allows future crypto schemes to be registered independently.

### 3.3 Registration Interface

Two registration paths exist:

```solidity
// Path 1: Direct registration (msg.sender is registrant)
function registerKeys(
    uint256 schemeId,
    bytes calldata stealthMetaAddress
) external;

// Path 2: Delegated registration (third party submits on behalf)
function registerKeysOnBehalf(
    address registrant,
    uint256 schemeId,
    bytes memory signature,      // EIP-712 typed signature
    bytes calldata stealthMetaAddress
) external;
```

**Direct registration** is the standard flow: user connects wallet, signs a transaction that writes their meta-address to the registry.

**Delegated registration** enables a relayer or dApp to submit the registration on behalf of the user, using an EIP-712 typed data signature. The nonce mapping prevents replay attacks — each signature is valid only once per registrant.

```
EIP-712 Domain & Type (registerKeysOnBehalf):
┌─────────────────────────────────────────────────────────────┐
│ Domain: ERC6538Registry, version 1, chainId, verifyingAddr  │
│ Type:   RegisterKeys(address registrant, uint256 schemeId,  │
│         bytes stealthMetaAddress, uint256 nonce)            │
└─────────────────────────────────────────────────────────────┘
```

### 3.4 Lookup Interface

Retrieving a stealth meta-address is a single `view` call:

```solidity
// Returns the registered meta-address, or empty bytes if unregistered
bytes memory metaAddr = registry.stealthMetaAddressOf(recipientAddress, schemeId);
```

This is a zero-gas read operation for off-chain callers (static call). On-chain consumers (other contracts composing with stealth addresses) pay only the standard SLOAD cost.

### 3.5 Multi-Chain Strategy

The deterministic CREATE2 deployment means the registry lives at `0x6538...6538` on every chain. However, registration is **per-chain** — registering on Ethereum L1 does not automatically register on Optimism.

```
┌───────────────────────────────────────────────────────────────────┐
│                MULTI-CHAIN REGISTRATION                           │
├───────────────────────────────────────────────────────────────────┤
│                                                                   │
│   ETH L1: registry.registerKeys(1, metaAddr)  ← Chain 1           │
│   OP:     registry.registerKeys(1, metaAddr)  ← Chain 10          │
│   Base:   registry.registerKeys(1, metaAddr)  ← Chain 8453        │
│   ARB:    registry.registerKeys(1, metaAddr)  ← Chain 42161       │
│                                                                   │
│   Same contract address: 0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d   │
│   Same meta-address payload: can reuse across chains              │
│   Separate storage: each chain has independent state              │
│                                                                   │
│   Strategy: Register on all chains where you expect to receive    │
│   funds. L2 registration is cheap (~$0.01-0.05 per chain).        │
└───────────────────────────────────────────────────────────────────┘
```

**Permissionless deployment:** If the registry has not been deployed on a target chain, anyone can deploy it by sending the same CREATE2 transaction to the deterministic deployer at `0x4e59b44847b379578588920ca78fbf26c0b4956c`. This guarantees the same address without requiring coordination.

---

## 4. Off-Chain Storage: ENS Offchain Resolver (Fluidkey Model)

### 4.1 Architecture Overview

Fluidkey takes a fundamentally different approach: instead of storing the stealth meta-address on-chain, it uses an ENS offchain resolver that generates a **fresh stealth address on every query**. The meta-address never appears publicly.

```
┌──────────────────────────────────────────────────────────────────────┐
│              FLUIDKEY OFFCHAIN RESOLVER FLOW                         │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Sender queries:  alice.fkey.eth  (or alice.fkey.id)                 │
│        │                                                             │
│        ▼                                                             │
│  ┌─────────────┐    CCIP-Read    ┌──────────────────┐                │
│  │ ENS Resolver│ ───────────────▶│  Fluidkey Server │                │
│  │ (on-chain)  │                 │  (offchain)      │                │
│  │ 0xabE739... │◀────────────────│                  │                │
│  └─────────────┘  new stealth    │  Holds BIP-32    │                │
│        │          address        │  viewing node:   │                │
│        ▼                         │  m/5564'/N'      │                │
│  Return fresh                    │                  │                │
│  stealth address                 │  Increments p/n  │                │
│  to sender                       │  on each query   │                │
│                                  └──────────────────┘                │
│                                                                      │
│  Key insight: The meta-address NEVER appears on-chain or publicly.   │
│  Only individual stealth addresses are returned per-query.           │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2 CCIP-Read (EIP-3668) Integration

The offchain resolution relies on CCIP-Read (Cross-Chain Interoperability Protocol), defined in EIP-3668. When a client resolves `alice.fkey.eth`:

1. The client calls the ENS resolver contract on-chain
2. The resolver reverts with `OffchainLookup(sender, urls, callData, callbackFunction, extraData)`
3. The client follows the URL to Fluidkey's server
4. The server generates a new stealth address using the BIP-32 viewing node
5. The server returns the stealth address (signed or verifiable)
6. The client calls the resolver's callback with the result
7. The resolver validates and returns the stealth address to the caller

```
Fluidkey Offchain Resolver Contract:
  0xabE739AF28742cA9B9Aa83E5A01439A66F0361E3
  (deployed at ETHRome 23 hackathon, now production)
```

### 4.3 BIP-32 Derivation Path

Fluidkey uses a BIP-32 hierarchical deterministic (HD) derivation scheme to generate stealth addresses deterministically.

> **See:** [Creation of Key Pairs](./Creation-Key-Pairs.md), Section 4.2 — "BIP-32 Hierarchical Derivation" for the full derivation path structure (`m/5564'/N'/c0'/c1'/0'/p'/n'`), ENSIP-11 coinType encoding, and multi-chain derivation details.

**Critical trust model:** Fluidkey holds the BIP-32 viewing node at `m/5564'/N'`, which allows the server to:
- Generate stealth addresses on behalf of the user
- Scan the blockchain for incoming payments
- Build a unified dashboard of all stealth addresses

But the server **cannot** spend funds — the spending key derivation path is only known to the client. This is the same split-trust model as viewing key delegation, but implemented via HD tree structure rather than direct key sharing.

### 4.4 Recovery Without Fluidkey

Because the derivation is deterministic (BIP-32), users can recover all their stealth addresses independently:

```
Recovery flow:
1. User has their root seed (mnemonic)
2. Derive m/5564'/0'/c0'/c1'/0' (spending) and .../1' (viewing)
3. Iterate through p=0,1,2,...N and n=0,1,...
4. For each (p,n): derive stealth address, check on-chain for balance
5. Continue until sufficient gap (e.g., 20 consecutive empty addresses)

Hosted recovery interface: recovery.fluidkey.com (SARA)
Open-source kit: fluidkey/fluidkey-stealth-account-kit
```

This eliminates single-point-of-failure risk — even if Fluidkey ceases to operate, users can access all funds using only their seed phrase.

---

## 5. ENS Integration Patterns (Umbra Historical Approach)

### 5.1 Evolution from ENS-Only to Registry-First

Umbra's approach to stealth meta-address storage evolved significantly:

```
Timeline:
┌───────────────────────────────────────────────────────────────────┐
│ Phase 1 (2020-2021): ENS-only                                     │
│   - Custom resolver contracts for stealth keys                    │
│   - ForwardingStealthKeyResolver                                  │
│   - PublicStealthKeyResolver                                      │
│   - Problem: required ENS domain name (confusing UX)              │
│                                                                   │
│ Phase 2 (2021, Issue #214): Registry-first proposal             │
│   - "StealthKeyRegistry" — plain address-based lookup             │
│   - No ENS name required                                          │
│   - Rationale: simpler UX, any address can register               │
│                                                                   │
│ Phase 3 (2023-present): ERC-6538 standardization                  │
│   - ScopeLift (Umbra team) co-authored ERC-6538                   │
│   - Registry became the canonical standard                        │
│   - ENS integration demoted to optional secondary layer           │
│   - Trail of Bits audited the final contracts                     │
└───────────────────────────────────────────────────────────────────┘
```

The key insight from Issue #214: requiring ENS names was a barrier to adoption. Users who just want to receive stealth payments shouldn't need to purchase and manage an ENS domain. A plain Ethereum address should be sufficient for registration.

### 5.2 Umbra ENS Resolver Types

ScopeLift developed two custom ENS resolver contracts (available at github.com/ScopeLift/ens-resolvers):

**ForwardingStealthKeyResolver:** Allows a user to store stealth keys in association with an ENS name they control. When queried, it forwards the lookup to the stored stealth key data.

**PublicStealthKeyResolver:** A shared resolver that anyone can register stealth keys against, associated with an ENS name. This was designed for users who don't want to change their existing resolver.

### 5.3 ENS Setup Flow (Historical)

The Umbra ENS integration required navigating the user's existing resolver configuration:

```
┌──────────────────────────────────────────────────────────────────┐
│               UMBRA ENS SETUP DECISION TREE                      │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Step 1: Check current resolver                                  │
│  registry.resolver(namehash(name)) → currentResolver             │
│     │                                                            │
│     ├── Public Resolver?                                         │
│     │   ├── Authorize Umbra resolver                             │
│     │   ├── Set stealth keys on Umbra resolver                   │
│     │   └── Change resolver to Umbra resolver                    │
│     │                                                            │
│     ├── Umbra Resolver already?                                  │
│     │   ├── Check stealthKeys() → exists?                        │
│     │   └── If missing: set stealth keys                         │
│     │                                                            │
│     └── Other resolver?                                          │
│         └── Cannot use Umbra ENS integration                     │
│             (must switch to public resolver first)               │
│                                                                  │
│  Step 2: Optional subdomain registration                         │
│  Register username.umbra.eth via custom registrar                │
│  (free, one per address)                                         │
│                                                                  │
│  Step 3: Reverse resolution                                      │
│  setName() on reverse resolver for proper reverse lookup         │
└──────────────────────────────────────────────────────────────────┘
```

This complexity was a significant contributor to the decision to prioritize the registry over ENS. The registry requires zero resolver configuration.

### 5.4 umbra-js ENS Utilities

The Umbra SDK provides helper functions for ENS integration:

```typescript
// Check if an ENS name has a compatible resolver
getResolverContract(ensName: string): Promise<Contract | null>

// Validate stealth key support on the resolver
supportsStealthKeys(resolver: Contract): Promise<boolean>

// Retrieve stealth keys from ENS
getStealthKeys(ensName: string): Promise<{
  spendingPubKey: string;
  viewingPubKey: string;
}>
```

---

## 6. Sender Lookup Flow: Finding the Meta-Address

The sender's workflow to find a recipient's stealth meta-address follows a fallback chain:

### 6.1 Complete Lookup Algorithm

```
┌──────────────────────────────────────────────────────────────────────┐
│               SENDER LOOKUP FLOW                                     │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Input: recipientIdentifier (address or ENS name)                    │
│                                                                      │
│  Step 1: Resolve identifier                                          │
│  ┌──────────────────────────────────────────────────┐                │
│  │ if (isENSName(identifier)):                      │                │
│  │   resolvedAddress = ens.resolve(identifier)      │                │
│  │   // Also check: offchain resolver?              │                │
│  │   // If offchain → may return stealth addr       │                │
│  │   //   directly (Fluidkey model)                 │                │
│  │ else:                                            │                │
│  │   resolvedAddress = identifier                   │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│  Step 2: Query ERC-6538 registry                                     │
│  ┌──────────────────────────────────────────────────┐                │
│  │ metaAddr = registry.stealthMetaAddressOf(        │                │
│  │   resolvedAddress, 1  // schemeId=1 (SECP256k1)  │                │
│  │ )                                                │                │
│  │ if (metaAddr.length > 0) → FOUND, proceed        │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│  Step 3: Fallback — check ENS resolver for stealth keys              │
│  ┌──────────────────────────────────────────────────┐                │
│  │ if (hasENSName):                                 │                │
│  │   resolver = ens.resolver(namehash)              │                │
│  │   if (supportsStealthKeys(resolver)):            │                │
│  │     keys = resolver.stealthKeys(namehash)        │                │
│  │     if (keys) → FOUND, construct meta-address    │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│  Step 4: Fallback — direct exchange                                  │
│  ┌──────────────────────────────────────────────────┐                │
│  │ Prompt user to paste meta-address URI directly   │                │
│  │ (out-of-band: shared via QR code, message, etc.) │                │
│  └──────────────────────────────────────────────────┘                │
│                                                                      │
│  Step 5: Generate stealth address                                    │
│  ┌──────────────────────────────────────────────────┐                │
│  │ { stealthAddress, ephemeralPubKey, viewTag } =   │                │
│  │   generateStealthAddress({                       │                │
│  │     stealthMetaAddressURI: metaAddr              │                │
│  │   })                                             │                │
│  │ // Send funds to stealthAddress                  │                │
│  │ // Announce via ERC5564Announcer                 │                │
│  └──────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 SDK Implementation

Using the ScopeLift SDK (`@scopelift/stealth-address-sdk`):

```typescript
import {
  generateStealthAddress,
  prepareAnnounce,
  prepareRegisterKeys
} from '@scopelift/stealth-address-sdk';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

// --- RECIPIENT: Register meta-address ---
const registerTx = prepareRegisterKeys({
  account: recipientAddress,
  args: {
    schemeId: 1n,
    stealthMetaAddress: `0x${spendingPubKeyHex}${viewingPubKeyHex}`,
  },
});
// Submit registerTx via wallet

// --- SENDER: Lookup and generate ---
const client = createPublicClient({ chain: mainnet, transport: http() });

// Query the registry
const metaAddress = await client.readContract({
  address: '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538',
  abi: erc6538RegistryAbi,
  functionName: 'stealthMetaAddressOf',
  args: [recipientAddress, 1n],
});

if (metaAddress && metaAddress !== '0x') {
  // Generate stealth address
  const { stealthAddress, ephemeralPublicKey, viewTag } =
    generateStealthAddress({
      stealthMetaAddressURI: `st:eth:0x${metaAddress.slice(2)}`,
    });

  // Send funds to stealthAddress, then announce
  const announceTx = prepareAnnounce({
    account: senderAddress,
    args: {
      schemeId: 1n,
      stealthAddress,
      ephemeralPublicKey,
      metadata: `0x${viewTag.slice(2)}...`, // view tag + transfer metadata
    },
  });
}
```

---

## 7. Production Comparison: Umbra vs. Fluidkey

> **See also:** [Creation of Key Pairs](./Creation-Key-Pairs.md), Section 6 — "Production System Comparison" for the key generation and derivation comparison between Umbra, Fluidkey, and ScopeLift SDK.

### 7.1 Architecture Comparison

```
┌──────────────────────────────────────────────────────────────────────────┐
│              STORAGE ARCHITECTURE COMPARISON                             │
├──────────────────────┬───────────────────────┬───────────────────────────┤
│ Dimension            │ Umbra (ScopeLift)     │ Fluidkey                  │
├──────────────────────┼───────────────────────┼───────────────────────────┤
│ Primary storage      │ ERC-6538 registry     │ Fluidkey server (offchain)│
│ Secondary storage    │ ENS custom resolvers  │ ENS offchain resolver     │
│ What's stored        │ Full meta-address     │ BIP-32 viewing node       │
│                      │ (66 bytes on-chain)   │ (server-side only)        │
│ What sender receives │ Meta-address          │ Fresh stealth address     │
│ Registration cost    │ ~61,000 gas           │ Zero (offchain)           │
│ Lookup method        │ eth_call to registry  │ CCIP-Read via ENS         │
│ Lookup cost          │ Zero gas (view call)  │ Zero gas + HTTP request   │
│ Trust model          │ Zero server trust     │ Server has viewing access │
│ Multi-chain          │ Register per chain    │ Single ENS works globally │
│ Meta-address visible │ Yes (public on-chain) │ No (only server knows)    │
│ Interoperability     │ Any app can query     │ Requires ENS + CCIP-Read  │
│ Server dependency    │ None                  │ Fluidkey server required  │
│ Offline resilience   │ Full (blockchain)     │ Requires server uptime    │
│ Key rotation         │ Update registry entry │ Update server-side node   │
│ Standards compliance │ ERC-6538 native       │ ENS + EIP-3668 (CCIP)     │
│ Smart account model  │ EOA-based stealth     │ Safe smart accounts       │
├──────────────────────┼───────────────────────┼───────────────────────────┤
│ Best for             │ Maximum               │ Maximum UX                │
│                      │ decentralization      │ convenience               │
│                      │ and interoperability  │ and privacy               │
└──────────────────────┴───────────────────────┴───────────────────────────┘
```

### 7.2 Privacy Trade-offs

```
┌──────────────────────────────────────────────────────────────────────┐
│                   PRIVACY COMPARISON                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Umbra / ERC-6538:                                                   │
│  ✓ No server can see your transactions                               │
│  ✓ No trust delegation required                                      │
│  ✗ Anyone can see your meta-address on-chain                         │
│  ✗ Your address is publicly linked to "stealth user" status          │
│  ✗ Spending + viewing public keys are permanently visible            │
│                                                                      │
│  Fluidkey / Offchain:                                                │
│  ✓ Meta-address never appears on-chain                               │
│  ✓ Each sender gets a unique stealth address (no public keys shown)  │
│  ✓ No on-chain "stealth user" signal                                 │
│  ✗ Fluidkey server can see all incoming payments (viewing key)       │
│  ✗ Server could theoretically correlate senders                      │
│  ✗ Server downtime blocks new stealth address generation             │
│                                                                      │
│  Fundamental tension:                                                │
│    On-chain = visible meta-address but no server trust               │
│    Off-chain = hidden meta-address but server has viewing access     │
└──────────────────────────────────────────────────────────────────────┘
```

### 7.3 ENS Comparison: Fluidkey vs. Others

Fluidkey's ENS integration is unique compared to other .eth subdomain services:

```
┌───────────────────────────────────────────────────────────────┐
│           ENS SUBDOMAIN COMPARISON                            │
├─────────────────┬───────────────┬─────────────────────────────┤
│ Service         │ Resolution    │ Privacy                     │
├─────────────────┼───────────────┼─────────────────────────────┤
│ Coinbase cb.id  │ Static addr   │ None (same address always)  │
│ Uniswap uni.eth │ Static addr   │ None (same address always)  │
│ Fluidkey fkey.* │ Dynamic addr  │ New stealth address per     │
│                 │ (offchain)    │ resolution query            │
│ Umbra umbra.eth │ Static addr   │ Meta-address in resolver,   │
│                 │ + stealth keys│ sender generates stealth    │
└─────────────────┴───────────────┴─────────────────────────────┘
```

Only Fluidkey provides unlinkability at the ENS resolution layer itself — every query returns a different address, making it impossible for observers to correlate senders by destination address.

---

## 8. Caching and Performance Optimization

### 8.1 Client-Side Caching

For applications that make repeated lookups (e.g., a wallet's address book), caching meta-addresses avoids redundant RPC calls:

```
┌──────────────────────────────────────────────────────────────────────┐
│                CACHING STRATEGY                                      │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Layer 1: In-memory LRU cache                                        │
│  ┌────────────────────────────────────────┐                          │
│  │ Map<address, { metaAddr, timestamp }>  │                          │
│  │ TTL: 24 hours (meta-addresses rarely   │                          │
│  │ change, but key rotation is possible)  │                          │
│  │ Max entries: 1,000 (address book size) │                          │
│  └────────────────────────────────────────┘                          │
│                                                                      │
│  Layer 2: localStorage / IndexedDB (persistent)                      │
│  ┌────────────────────────────────────────┐                          │
│  │ Store for offline access and fast      │                          │
│  │ startup. Re-validate on app load by    │                          │
│  │ checking registry for updates.         │                          │
│  └────────────────────────────────────────┘                          │
│                                                                      │
│  Layer 3: Event-driven invalidation                                  │
│  ┌────────────────────────────────────────┐                          │
│  │ Listen for StealthMetaAddressSet event │                          │
│  │ on the registry contract. Invalidate   │                          │
│  │ cached entry when the registrant       │                          │
│  │ updates their keys.                    │                          │
│  └────────────────────────────────────────┘                          │
│                                                                      │
│  Invalidation event:                                                 │
│  event StealthMetaAddressSet(                                        │
│    address indexed registrant,                                       │
│    uint256 indexed schemeId,                                         │
│    bytes stealthMetaAddress                                          │
│  );                                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 Batch Lookup Optimization

For wallets or dApps that need to check multiple recipients:

```typescript
// Multicall pattern: batch multiple registry reads into a single RPC call
import { createPublicClient, http } from 'viem';

const client = createPublicClient({ chain: mainnet, transport: http() });

const results = await client.multicall({
  contracts: recipientAddresses.map(addr => ({
    address: '0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538',
    abi: erc6538RegistryAbi,
    functionName: 'stealthMetaAddressOf',
    args: [addr, 1n],
  })),
});

// results[i] = meta-address for recipientAddresses[i]
// Filter out empty results (unregistered recipients)
const registered = results
  .map((r, i) => ({ address: recipientAddresses[i], metaAddr: r.result }))
  .filter(r => r.metaAddr && r.metaAddr !== '0x');
```

### 8.3 Indexing for Backend Services

Backend services that need high-throughput meta-address lookups can index the registry:

```
Strategy: Event-sourced index
1. Index all historical StealthMetaAddressSet events from block 0
2. Build a local database: address → latest meta-address
3. Subscribe to new events via WebSocket for real-time updates
4. Serve lookup queries from local DB (sub-millisecond)

Database options:
- PostgreSQL: for full-featured querying, JSONB for meta-address
- Redis: for ultra-fast key-value lookup (address → meta-address)
- SQLite: for embedded/lightweight applications
```

---

## 9. Sources

### Standards and Specifications
- **ERC-6538**: Stealth Meta-Address Registry — https://eips.ethereum.org/EIPS/eip-6538
- **ERC-5564**: Stealth Addresses — https://eips.ethereum.org/EIPS/eip-5564
- **EIP-3770**: Chain-Specific Addresses — https://eips.ethereum.org/EIPS/eip-3770
- **EIP-3668**: CCIP-Read (Offchain Data Retrieval) — https://eips.ethereum.org/EIPS/eip-3668
- **EIP-712**: Typed Structured Data Hashing and Signing — https://eips.ethereum.org/EIPS/eip-712

### Reference Implementations
- **ScopeLift Contracts**: https://github.com/ScopeLift/stealth-address-erc-contracts
- **ScopeLift SDK**: https://github.com/ScopeLift/stealth-address-sdk (`@scopelift/stealth-address-sdk`)
- **ScopeLift ENS Resolvers**: https://github.com/ScopeLift/ens-resolvers
- **Umbra Protocol**: https://github.com/ScopeLift/umbra-protocol
- **Fluidkey Stealth Account Kit**: https://github.com/fluidkey/fluidkey-stealth-account-kit
- **Fluidkey ETHRome 23**: https://github.com/fluidkey/eth-rome-23
- **stealthaddress.dev**: https://stealthaddress.dev/contracts/erc6538-contract

### Production Implementations
- **Umbra Cash**: https://app.umbra.cash — Registry-first model with optional ENS
- **Fluidkey**: https://fluidkey.com — Offchain resolver model with fkey.eth subdomains
- **Fluidkey Recovery (SARA)**: https://recovery.fluidkey.com
- **Fluidkey Docs**: https://docs.fluidkey.com

### Audit Reports
- **Trail of Bits**: ERC-5564 + ERC-6538 canonical contracts audit
- **Consensys Diligence**: Umbra protocol audit (signature schemes, replay protection)
- **Dedaub**: Fluidkey offchain cryptography audit (May 2024)

### Design Discussions
- **Umbra Issue #214**: Registry vs. ENS discussion — https://github.com/ScopeLift/umbra-protocol/issues/214
- **ENS + Fluidkey Blog**: https://www.fluidkey.com/blog/ens-making-crypto-readable
- **Vitalik's Stealth Guide**: https://vitalik.ca/general/2023/01/20/stealth.html

### Contract Addresses
- **ERC-6538 Registry**: `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` (all EVM chains)
- **ERC-5564 Announcer**: `0x55649E01B5Df198D18D95b5cc5051630cfD45564` (all EVM chains)
- **Deterministic Deployer**: `0x4e59b44847b379578588920ca78fbf26c0b4956c`
- **Fluidkey Offchain Resolver**: `0xabE739AF28742cA9B9Aa83E5A01439A66F0361E3`
