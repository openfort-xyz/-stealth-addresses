# Component 1: Creation of Spending and Viewing Key Pairs

## Deep Research — Production Implementations for ERC-5564 SchemeId = 1 (SECP256k1)

---

## 1. Executive Summary

The dual-key stealth address protocol (ERC-5564, schemeId = 1) requires each recipient to hold two mathematically independent private keys: a **spending key** (`p_spend`) that controls funds at stealth addresses, and a **viewing key** (`p_view`) that detects incoming payments. This separation is the foundational architectural decision enabling privacy delegation — recipients can share their viewing key with third-party parsers for automatic transaction scanning while keeping the spending key air-gapped.

Production systems have converged on a common pattern for key generation: **signature-based derivation from the user's existing wallet**. Rather than asking users to manage a separate seed phrase or key file, both Umbra and Fluidkey derive stealth keys deterministically from a message signature produced by the user's Ethereum wallet (MetaMask, Ledger, etc.). This means key recovery is always possible as long as the user retains access to their original wallet — no additional backup is required.

The resulting key pair is encoded into a **stealth meta-address** of the form `st:eth:0x<P_spend><P_view>` (66 bytes of compressed public keys), which is the user's public identifier for receiving stealth payments.

---

## 2. Cryptographic Foundation: SECP256k1 Curve Parameters

ERC-5564 schemeId = 1 mandates the SECP256k1 elliptic curve — the same curve used by Ethereum and Bitcoin for transaction signing. This is deliberate: it allows stealth address key operations to reuse existing wallet infrastructure.

### Private Key Constraints

A valid SECP256k1 private key is a 256-bit integer `k` where:

```
1 ≤ k ≤ n - 1
```

Any value outside this range is invalid. The probability of a random 256-bit integer falling outside the valid range is negligible (~3.73 × 10⁻³⁹), but implementations MUST validate this constraint.

### Compressed Public Key Format

Public keys on SECP256k1 are points `(x, y)` on the curve. The compressed format encodes only the x-coordinate with a single prefix byte indicating y-parity:

```
Compressed public key: [prefix][x-coordinate]
  prefix = 0x02 if y is even
  prefix = 0x03 if y is odd
  Total:  1 + 32 = 33 bytes
```

Both `P_spend` and `P_view` in the stealth meta-address use compressed format, yielding 66 bytes total.

---

## 3. The Dual-Key Architecture

### Why Two Keys?

The ERC-5564 specification separates spending and viewing capabilities for a critical reason: **privacy delegation without custody risk**.

```
┌────────────────────────────────────────────────────────────────────┐
│                     Recipient Key Hierarchy                        │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  Spending Key (p_spend)          Viewing Key (p_view)              │
│  ├─ Controls funds               ├─ Detects incoming payments      │
│  ├─ NEVER leaves client           ├─ CAN be delegated to servers   │
│  ├─ Used to derive stealth        ├─ Used to compute shared        │
│  │  private keys for spending     │  secrets with ephemeral keys   │
│  └─ Equivalent to wallet          └─ Equivalent to read-only       │
│     private key in security           access in security model     │
│                                                                    │
│  Public Key: P_spend = p_spend × G    P_view = p_view × G          │
│  (33 bytes compressed)                (33 bytes compressed)        │
│                                                                    │
│  Combined as Stealth Meta-Address:                                 │
│  st:eth:0x<P_spend (33 bytes)><P_view (33 bytes)>                  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### How Each Key Participates in the Protocol

**Sender side (generating a stealth address):**

```
1. Parse recipient meta-address → extract P_spend and P_view
2. Generate random ephemeral private key: r ← random()
3. Compute ephemeral public key: R = r × G
4. Compute shared secret (ECDH): S = r × P_view    ← uses P_view
5. Hash the shared secret: s_h = keccak256(S)
6. Extract view tag: v = s_h[0]
7. Derive stealth public key: P_stealth = P_spend + (s_h × G)  ← uses P_spend
8. Compute stealth address: addr = last20Bytes(keccak256(P_stealth))
```

**Recipient side (detecting and spending):**

```
Detection (uses viewing key only):
1. For each Announcement event, extract R (ephemeral pubkey) and v (view tag)
2. Compute shared secret: S = p_view × R            ← uses p_view
3. Hash: s_h = keccak256(S)
4. Check view tag: if s_h[0] ≠ v → skip (99.6% of announcements filtered)
5. Derive expected stealth address: P_stealth = P_spend + (s_h × G)
6. Compare with announced stealth address

Spending (uses spending key):
7. Compute stealth private key: p_stealth = p_spend + s_h  (mod n)  ← uses p_spend
8. Sign transaction with p_stealth
```

### Key Independence Requirement

The spending and viewing keys MUST be cryptographically independent — knowing `p_view` must not reveal any information about `p_spend`. This is achieved by:

- Deriving each key from a different portion of the same signature (Umbra/Fluidkey approach)
- Using separate derivation paths in BIP-32 hierarchy (Fluidkey extended approach)
- Generating completely independent random keys (reference approach)

ERC-5564 also allows a special case where `P_spend == P_view` (single-key mode), encoded as a meta-address of length `n` instead of `2n`. In this mode, there is no viewing/spending separation — the same key does both. This is simpler but eliminates the ability to delegate scanning.

---

## 4. Production Key Generation Approaches

### 4.1 Approach A: Signature-Based Derivation (Umbra + Fluidkey)

This is the dominant production approach. Both Umbra and Fluidkey use the same fundamental technique: the user signs a deterministic message with their existing Ethereum wallet, and the resulting signature is split and hashed to produce the two stealth keys.

**Why this approach won:**
- No new seed phrase or backup for users to manage
- Keys are deterministically recoverable from the original wallet
- Works with any wallet that supports `personal_sign` (MetaMask, Ledger, Trezor, etc.)
- No key storage required — keys can be re-derived on every session

#### Umbra's Implementation

```
Step 1: User signs a deterministic message
  message = "Sign this message to access Umbra account.\n\n
             Only sign this message for a trusted client!"

Step 2: Wallet produces ECDSA signature (65 bytes)
  signature = wallet.signMessage(message)
  // signature format: r (32 bytes) || s (32 bytes) || v (1 byte)
  // Total as hex string: "0x" + 130 hex chars

Step 3: Split signature into two halves and hash each
  firstHalf  = signature[2..66]    // First 32 bytes (r component)
  secondHalf = signature[66..130]  // Second 32 bytes (s component)

  p_spend = keccak256(firstHalf)   // Spending private key
  p_view  = keccak256(secondHalf)  // Viewing private key

Step 4: Derive compressed public keys
  P_spend = getPublicKey(p_spend, compressed=true)  // 33 bytes
  P_view  = getPublicKey(p_view, compressed=true)    // 33 bytes

Step 5: Construct stealth meta-address
  metaAddress = "st:eth:0x" + hex(P_spend) + hex(P_view)
```

**Key properties of Umbra's approach:**
- The message is constant across all chains (no chainId in the message in the latest version)
- The signature `r` and `s` components are each 256-bit values with high entropy
- The `keccak256` hash ensures valid private keys with overwhelming probability
- Keys are never stored — re-derived by re-signing the same message on every session
- Earlier versions included `chainId` in the message, which caused complications for cross-chain deployments (see ScopeLift Issue #214)

#### Fluidkey's Implementation

Fluidkey uses the same signature-splitting technique but adds additional layers:

```
Step 1: Generate a key-generation message
  secret = hash(walletAddress + userPIN)
  message = generateFluidkeyMessage(secret)
  // The PIN adds an additional authentication factor

Step 2: User signs the message
  signature = wallet.signMessage(message)

Step 3: Split and hash (same as Umbra)
  p_spend = keccak256(signature[2..66])
  p_view  = keccak256(signature[66..130])

Step 4: Extract BIP-32 viewing key node (Fluidkey-specific)
  // Convert p_view into a BIP-32 extended private key
  // Extract node at path m/5564'/0'
  // Share this node with Fluidkey's server for scanning
  viewingKeyNode = extractViewingPrivateKeyNode(p_view)
```

**Fluidkey's additions to the base pattern:**
- The **PIN code** provides an additional factor: even if someone gains access to the wallet, they cannot derive stealth keys without the PIN
- The **BIP-32 node extraction** enables hierarchical key derivation from the viewing key, allowing Fluidkey's server to generate ephemeral keys and scan for payments
- The spending key is immediately discarded after Safe creation — it only exists momentarily in the browser

**Security audit finding (Dedaub, May 2024):** The audit noted that `generateKeysFromSignature` simply receives the signature as an argument — the exact message to sign must be reproducible by the user independently. If the user cannot reconstruct the message (which includes their PIN-derived secret), they cannot recover their keys without Fluidkey's server. Fluidkey has since documented the message generation process to address this.

### 4.2 Approach B: BIP-32 Hierarchical Derivation (Fluidkey Extended)

Beyond the initial key pair generation, Fluidkey extends the system with BIP-32 hierarchical deterministic (HD) key derivation for generating ephemeral keys used in stealth address creation.

#### Derivation Path Structure

```
m / 5564' / N' / c0' / c1' / 0' / p' / n'
│    │      │    │     │     │    │    │
│    │      │    │     │     │    │    └─ Address index (increments for each new stealth address)
│    │      │    │     │     │    └─ Address index high bits
│    │      │    │     │     └─ Account index (always 0 currently)
│    │      │    │     └─ coinType low bits (per ENSIP-11)
│    │      │    └─ coinType high bits (per ENSIP-11)
│    │      └─ Node identifier (0 for all users currently)
│    └─ ERC-5564 standard identifier (hardened)
└─ Master key
```

**Why this structure?**

1. **`5564'`** — References the ERC-5564 standard, ensuring namespace separation from other BIP-32 derivation purposes
2. **`N'`** — Node identifier allows future segmentation:
   - Different `N` values could represent different time periods
   - Enable selective view access (share only specific nodes with specific parties)
   - Currently fixed at `0` for all users
3. **`c0'/c1'`** — ENSIP-11 coinType encoding split into two parts to respect BIP-32's constraint that no single derivation index can equal or exceed `2³¹` (`0x80000000`)
4. **`0'`** — Account index for future multi-account support
5. **`p'/n'`** — Address counter split into two parts (same BIP-32 constraint)

#### CoinType Encoding (ENSIP-11)

For EVM chains, the coinType is derived from chainId:

```
coinType = 0x80000000 | chainId

For chainId = 0 (multi-chain):
  coinType = 0x80000000 | 0 = 0x80000000

Split for BIP-32 path:
  c0 = (coinType >> 16) & 0x7FFF = 0x8000 = 32768  → but this exceeds...

Fluidkey's actual encoding for chainId 0:
  Path: m/5564'/0'/8'/0'/0'/p'/n'
  (c0=8, c1=0 for coinType corresponding to chainId 0)
```

**Multi-chain benefit:** By using `chainId = 0`, Fluidkey generates stealth addresses valid on ALL EVM chains from a single derivation tree. The same stealth address works on Ethereum, Arbitrum, Base, Optimism, Polygon, etc.

#### Shared Viewing Key Node

The key innovation is sharing the node at `m/5564'/0'` with Fluidkey's server:

```
Shared with server:     m/5564'/0' (viewing key node)
Kept by user only:      p_spend (spending private key)

What the server can do:
  ✓ Derive all child viewing keys at m/5564'/0'/c0'/c1'/0'/p'/n'
  ✓ Generate ephemeral private keys for new stealth addresses
  ✓ Compute shared secrets to detect incoming payments
  ✓ Monitor all stealth addresses for the user

What the server CANNOT do:
  ✗ Derive the spending key
  ✗ Move funds from any stealth address
  ✗ Sign transactions on behalf of the user
```

### 4.3 Approach C: Independent Random Generation (Reference / SDK)

The ScopeLift stealth-address-sdk does not include a key generation function — it assumes the caller provides pre-existing spending and viewing keys. This is by design: key generation is considered an application-level concern, not a protocol-level one.

For reference implementations or custom integrations, independent random generation is the simplest approach:

```typescript
import * as secp from '@noble/secp256k1';

// Generate spending key pair
const spendingPrivateKey = secp.utils.randomPrivateKey(); // 32 bytes from CSPRNG
const spendingPublicKey = secp.getPublicKey(spendingPrivateKey, true); // compressed

// Generate viewing key pair (independent)
const viewingPrivateKey = secp.utils.randomPrivateKey();
const viewingPublicKey = secp.getPublicKey(viewingPrivateKey, true);

// Construct stealth meta-address
const metaAddress = Buffer.concat([spendingPublicKey, viewingPublicKey]); // 66 bytes
const metaAddressURI = `st:eth:0x${metaAddress.toString('hex')}`;
```

**Tradeoffs:**
- Produces highest entropy keys (256 bits each from CSPRNG)
- Requires separate backup mechanism (user must save the private keys)
- No deterministic recovery from wallet signature
- Best suited for programmatic/backend use cases where key management is handled externally

---

## 5. Implementation Details

### 5.1 Library Selection: @noble/secp256k1 vs @noble/curves

Two libraries from the noble-cryptography suite are suitable:

| Library | Size | API Style | Best For |
|---------|------|-----------|----------|
| `@noble/secp256k1` | ~5KB gzipped | Standalone, minimal | Smallest attack surface, auditable |
| `@noble/curves` | Larger | Feature-rich, MSM, DER | Advanced operations, drop-in replacement |

**Both are used in production:** Fluidkey's stealth-account-kit uses noble-based primitives. The ScopeLift SDK relies on viem's internal curve operations (which also use noble under the hood).

#### Key Generation with @noble/secp256k1 v2

```typescript
import * as secp from '@noble/secp256k1';

// Method 1: Using keygen() (v2+)
const { secretKey, publicKey } = secp.keygen();
// secretKey: Uint8Array (32 bytes) — CSPRNG
// publicKey: Uint8Array (33 bytes) — compressed by default in v2

// Method 2: From existing private key bytes
const privKey = new Uint8Array(32); // your key bytes
const pubKey = secp.getPublicKey(privKey); // compressed (33 bytes) by default
// For uncompressed (65 bytes): secp.getPublicKey(privKey, false)

// Method 3: ECDH shared secret (used in stealth address derivation)
const sharedSecret = secp.getSharedSecret(alicePrivKey, bobPubKey);
// Returns compressed point by default
```

**Important v2 changes:**
- `getPublicKey()` returns compressed keys by default (v1 returned uncompressed)
- `keygen()` is the recommended key generation method
- The library relies on `crypto.getRandomValues()` for entropy
- Benchmarks (Apple M4): keygen at ~7,643 ops/sec (~130μs per key)

#### Key Validation

```typescript
import { ProjectivePoint } from '@noble/secp256k1';

function isValidPrivateKey(key: Uint8Array): boolean {
  if (key.length !== 32) return false;
  const n = BigInt('0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141');
  const keyBigInt = BigInt('0x' + Buffer.from(key).toString('hex'));
  return keyBigInt >= 1n && keyBigInt < n;
}

function isValidPublicKey(key: Uint8Array): boolean {
  try {
    ProjectivePoint.fromHex(key);
    return true;
  } catch {
    return false;
  }
}
```

### 5.2 Full Signature-Based Key Derivation (Production Pattern)

```typescript
import { keccak256, toBytes, Hex } from 'viem';
import * as secp from '@noble/secp256k1';

// ─── Constants ───
const UMBRA_MESSAGE =
  "Sign this message to access Umbra account.\n\nOnly sign this message for a trusted client!";

// ─── Key Generation ───

interface StealthKeyPair {
  spendingPrivateKey: Hex;
  spendingPublicKey: Hex;
  viewingPrivateKey: Hex;
  viewingPublicKey: Hex;
  stealthMetaAddressURI: string;
}

async function generateStealthKeys(
  walletClient: WalletClient,
  message: string = UMBRA_MESSAGE
): Promise<StealthKeyPair> {
  // Step 1: Sign deterministic message
  const signature = await walletClient.signMessage({ message });
  // signature: "0x" + r (64 hex) + s (64 hex) + v (2 hex) = 132 hex chars

  // Step 2: Split signature and hash each half
  const sigBytes = signature.slice(2); // Remove "0x" prefix
  const r = `0x${sigBytes.slice(0, 64)}` as Hex;  // First 32 bytes
  const s = `0x${sigBytes.slice(64, 128)}` as Hex; // Second 32 bytes

  const spendingPrivateKey = keccak256(r);  // 32-byte hash → private key
  const viewingPrivateKey = keccak256(s);   // 32-byte hash → private key

  // Step 3: Derive compressed public keys
  const spendKeyBytes = toBytes(spendingPrivateKey);
  const viewKeyBytes = toBytes(viewingPrivateKey);

  const spendingPublicKey = `0x${Buffer.from(
    secp.getPublicKey(spendKeyBytes, true) // true = compressed
  ).toString('hex')}` as Hex;

  const viewingPublicKey = `0x${Buffer.from(
    secp.getPublicKey(viewKeyBytes, true)
  ).toString('hex')}` as Hex;

  // Step 4: Construct stealth meta-address
  // Format: st:eth:0x<P_spend (33 bytes)><P_view (33 bytes)>
  const metaAddress = `0x${spendingPublicKey.slice(2)}${viewingPublicKey.slice(2)}`;
  const stealthMetaAddressURI = `st:eth:${metaAddress}`;

  return {
    spendingPrivateKey,
    spendingPublicKey,
    viewingPrivateKey,
    viewingPublicKey,
    stealthMetaAddressURI,
  };
}
```

### 5.3 Fluidkey BIP-32 Viewing Key Node Extraction

```typescript
import { HDKey } from '@scure/bip32';
import { keccak256, toBytes, Hex } from 'viem';

function extractViewingPrivateKeyNode(
  viewingPrivateKey: Hex,
  nodeIndex: number = 0
): HDKey {
  // Convert the viewing private key into a BIP-32 master key
  // This creates a new HD tree rooted at the viewing key
  const viewKeyBytes = toBytes(viewingPrivateKey);

  // Create HD key from the viewing private key as seed
  // The viewing private key acts as entropy for the BIP-32 tree
  const masterKey = HDKey.fromMasterSeed(viewKeyBytes);

  // Derive the shared node: m/5564'/N'
  // 5564 = ERC-5564 standard identifier
  // N = node index (0 for current Fluidkey implementation)
  const viewingNode = masterKey
    .derive(`m/5564'/${nodeIndex}'`);

  return viewingNode;
}

function generateEphemeralPrivateKey(
  viewingKeyNode: HDKey,
  chainId: number = 0,
  addressIndex: number = 0
): Hex {
  // Compute ENSIP-11 coinType from chainId
  const coinType = (0x80000000 | chainId) >>> 0;

  // Split coinType into two BIP-32 compatible indices
  // Each must be < 2^31 for hardened derivation
  const c0 = (coinType >>> 16) & 0x7FFF;
  const c1 = coinType & 0xFFFF;

  // Split address index similarly
  const p = (addressIndex >>> 16) & 0x7FFF;
  const n = addressIndex & 0xFFFF;

  // Derive: m/5564'/N'/c0'/c1'/0'/p'/n'
  // (viewingKeyNode is already at m/5564'/N')
  const leaf = viewingKeyNode
    .derive(`m/${c0}'/${c1}'/0'/${p}'/${n}'`);

  if (!leaf.privateKey) throw new Error('Failed to derive ephemeral key');

  return `0x${Buffer.from(leaf.privateKey).toString('hex')}` as Hex;
}
```

### 5.4 Stealth Meta-Address Parsing

```typescript
interface ParsedMetaAddress {
  prefix: string;      // "st"
  chain: string;       // "eth"
  schemeId: number;     // Inferred: 1 for SECP256k1
  spendingPublicKey: Hex;
  viewingPublicKey: Hex;
}

function parseStealthMetaAddress(uri: string): ParsedMetaAddress {
  // Format: st:<chain>:0x<spendingPubKey><viewingPubKey>
  const parts = uri.split(':');

  if (parts.length !== 3 || parts[0] !== 'st') {
    throw new Error('Invalid stealth meta-address URI format');
  }

  const [prefix, chain, keyData] = parts;
  const hexData = keyData.slice(2); // Remove "0x"

  // Each compressed public key is 33 bytes = 66 hex chars
  if (hexData.length === 132) {
    // Two distinct keys (spending + viewing)
    return {
      prefix,
      chain,
      schemeId: 1,
      spendingPublicKey: `0x${hexData.slice(0, 66)}` as Hex,
      viewingPublicKey: `0x${hexData.slice(66, 132)}` as Hex,
    };
  } else if (hexData.length === 66) {
    // Single key mode: P_spend == P_view
    return {
      prefix,
      chain,
      schemeId: 1,
      spendingPublicKey: `0x${hexData}` as Hex,
      viewingPublicKey: `0x${hexData}` as Hex,
    };
  }

  throw new Error(`Invalid meta-address key length: ${hexData.length} hex chars`);
}
```

---

## 6. Production System Comparison

### 6.1 Umbra Cash

| Aspect | Detail |
|--------|--------|
| **Key derivation method** | Signature-based: sign constant message, hash signature halves |
| **Message format** | Fixed English string (no chainId, no PIN) |
| **Spending key lifecycle** | Re-derived on each session from signature; never stored |
| **Viewing key delegation** | Supported (user can share viewing key with parsing provider) |
| **BIP-32 usage** | None — flat key derivation from signature |
| **Key storage** | Memory only; no persistent storage; re-sign to re-derive |
| **Recovery mechanism** | Re-sign the same message with original wallet |
| **Multi-chain** | Same keys work across all chains (message is chain-agnostic) |
| **Meta-address registration** | On-chain StealthKeyRegistry per chain |
| **Library** | ethers.js (earlier), transitioning to ERC-5564 SDK |
| **Audit status** | Production since 2021; $250M+ in transactions processed |

**Umbra's key design decision:** The original Umbra implementation (pre ERC-5564) used a slightly different stealth address derivation than the ERC-5564 specification (multiplication-based vs. addition-based for the stealth public key). However, the key generation mechanism (signature-based derivation) remains the same pattern and has been adopted by the ERC-5564 ecosystem.

### 6.2 Fluidkey

| Aspect | Detail |
|--------|--------|
| **Key derivation method** | Signature-based + PIN: sign hash(address + PIN), hash signature halves |
| **Message format** | Dynamic: includes user-specific secret derived from PIN |
| **Spending key lifecycle** | Derived once, used to create Safe ownership, immediately discarded |
| **Viewing key delegation** | YES — BIP-32 node m/5564'/0' shared with Fluidkey server |
| **BIP-32 usage** | Extensive: hierarchical derivation for ephemeral key generation |
| **Key storage** | Spending key: never stored. Viewing key node: server-side |
| **Recovery mechanism** | Re-sign with wallet + PIN to regenerate; all stealth addresses replayable |
| **Multi-chain** | chainId = 0 derivation → addresses valid on all EVM chains |
| **Meta-address registration** | ENS offchain resolver (CCIP Read / ERC-3668); no on-chain registry |
| **Library** | @fluidkey/stealth-account-kit (open source, audited by Dedaub) |
| **Audit status** | Dedaub audit May 2024; production since 2024 |

**Fluidkey's key design decisions:**
1. **PIN as second factor:** The PIN prevents key derivation even if the wallet is compromised — an attacker needs both wallet access AND the PIN
2. **BIP-32 for ephemeral keys:** Rather than random ephemeral keys (standard ERC-5564), Fluidkey derives ephemeral keys deterministically from the viewing key node, enabling the user to independently replay all stealth addresses
3. **Safe smart accounts:** The spending key's sole purpose is computing the stealth EOA that becomes the Safe's owner — the key itself is never used for direct transaction signing after initial setup

### 6.3 ScopeLift stealth-address-sdk

| Aspect | Detail |
|--------|--------|
| **Key derivation method** | Not included — SDK assumes keys are provided |
| **Core functions** | `generateStealthAddress`, `checkStealthAddress`, `computeStealthKey` |
| **Key format expected** | Hex-encoded private keys and compressed public keys |
| **SchemeId support** | Only `VALID_SCHEME_ID.SCHEME_ID_1` (SECP256k1) |
| **Meta-address format** | `st:<chain>:0x<spendingPubKey><viewingPubKey>` |
| **Library** | TypeScript SDK using viem internals |
| **Latest version** | 1.0.0-beta.2 |

The SDK deliberately separates key generation from key usage — it is a protocol-level tool, not an application-level wallet. This design choice allows different applications to use their own key generation strategy (signature-based, BIP-32, independent random, hardware-derived, etc.) while sharing the same stealth address operations.

---

## 7. Entropy and CSPRNG Requirements

### 7.1 Sources of Entropy

For direct key generation (Approach C), the CSPRNG must provide at least 128 bits of security:

| Environment | CSPRNG Function | Notes |
|-------------|----------------|-------|
| Browser | `crypto.getRandomValues()` | Web Crypto API; non-extractable |
| Node.js | `crypto.randomBytes()` | OpenSSL-based |
| noble-secp256k1 | `secp.utils.randomPrivateKey()` | Wraps `crypto.getRandomValues()` |
| React Native | Requires polyfill | `react-native-get-random-values` |

For signature-based derivation (Approaches A/B), the entropy comes from two sources:
1. **The wallet's ECDSA signature** — contains the random nonce `k` used in signing (256 bits of entropy)
2. **The keccak256 hash** — provides uniform distribution over the output space

The combined entropy of this process is at least 128 bits (SECP256k1 security level), assuming the wallet's signing implementation uses a proper CSPRNG for the ECDSA nonce.

### 7.2 Security Considerations for Signature-Based Derivation

**RFC 6979 (Deterministic ECDSA):** Many wallets (including MetaMask with recent Ledger firmware) use deterministic nonce generation per RFC 6979. This means signing the same message with the same key always produces the same signature — which is actually **desired** for stealth key derivation, as it ensures deterministic key recovery.

**Risk: Signature malleability.** ECDSA signatures have an inherent malleability: for any signature `(r, s)`, the signature `(r, n - s)` is also valid. However, since both Umbra and Fluidkey hash each half independently with keccak256, even if a different `s` value were used, it would produce a completely different viewing key. Wallets implementing EIP-2 (low-S normalization) mitigate this by always returning the canonical (low-S) form.

**Risk: Message signing phishing.** If an attacker tricks a user into signing the stealth key generation message on a malicious site, the attacker obtains the same signature and can derive the user's stealth keys. Mitigations:
- Fluidkey's PIN adds a second factor (attacker needs the PIN too)
- Users should verify the signing prompt contents carefully
- The EIP-191 prefix (`\x19Ethereum Signed Message:\n`) provides some protection against cross-protocol signature reuse

---

## 8. Stealth Meta-Address Format Specification

### 8.1 Encoding

Per ERC-5564 and EIP-3770 (chain-specific address format):

```
┌──────────────────────────────────────────────────────────────────────┐
│                    Stealth Meta-Address URI                          │
├──────────────────────────────────────────────────────────────────────┤
│  st : eth : 0x [P_spend (33 bytes)] [P_view (33 bytes)]             │
│  │    │         │                    │                               │
│  │    │         │                    └─ Viewing public key           │
│  │    │         └─ Spending public key (compressed SECP256k1)       │
│  │    └─ Chain shortname per EIP-3770 (eth, arb1, oeth, base, etc.) │
│  └─ Stealth address prefix                                          │
│                                                                      │
│  Total public key data: 66 bytes (132 hex characters)                │
│  URI length: ~142 characters including prefix                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 8.2 Example

```
Spending Private Key:
  0x596b90994791623a08f25c2ea709ad0a35b865893e9508fb450698acd47472fa

Viewing Private Key:
  0x74a08ee7e9097ee3da4124a5c340a35b9da698654bdd5b7b0135816e995aeca6

Spending Public Key (compressed):
  0x02f3309b76677ea657f82a93414e3a23e76c156148d6586c62c415968e4bda1008

Viewing Public Key (compressed):
  0x03fbd90600c993cc02635eccb9d872ff100adced6144497c7548f712b8b57a2399

Stealth Meta-Address:
  st:eth:0x02f3309b76677ea657f82a93414e3a23e76c156148d6586c62c415968e4bda100803fbd90600c993cc02635eccb9d872ff100adced6144497c7548f712b8b57a2399
```

### 8.3 Single-Key Mode (P_spend == P_view)

ERC-5564 allows a meta-address of length `n` (33 bytes for SECP256k1) instead of `2n`:

```
st:eth:0x02f3309b76677ea657f82a93414e3a23e76c156148d6586c62c415968e4bda1008
```

In this mode, the same key serves both spending and viewing. This eliminates the ability to delegate scanning but simplifies the protocol. No production system currently uses single-key mode.

---

## 9. Recovery Mechanisms

### 9.1 Signature-Based Recovery (Umbra/Fluidkey)

Recovery is straightforward: the user re-signs the same deterministic message with the same wallet. Since ECDSA signatures with RFC 6979 are deterministic, the same signature is produced, yielding the same stealth keys.

```
Recovery flow:
1. User connects original wallet
2. Prompt: "Sign this message to recover your stealth keys"
3. Wallet signs → produces identical signature
4. Hash signature halves → same spending and viewing keys
5. Scan chain for announcements → recover all stealth addresses
```

**Recovery conditions:**
- User must have access to the original wallet (or its seed phrase)
- For Fluidkey: user must also remember their PIN
- If wallet is lost but seed phrase is available: import seed phrase into new wallet, re-sign

### 9.2 Full Chain Rescan Recovery

If local metadata (announcement cache, scan position) is lost, a full chain rescan can recover all stealth addresses:

```
1. Re-derive viewing key from wallet signature
2. Fetch ALL Announcement events from ERC5564Announcer since deployment
3. For each announcement:
   a. Extract view tag from metadata[0]
   b. Compute expected view tag from viewing key + ephemeral pubkey
   c. If view tags match (1/256 probability): perform full derivation
   d. If stealth address matches: this payment belongs to user
4. Derive spending key → compute stealth private key for each match
```

**Performance impact of view tag:**
- Without view tag: every announcement requires full ECDH (1× ecMUL + 1× hash + 1× ecADD + address derivation)
- With view tag: 255/256 announcements require only (1× ecMUL + 1× hash + 1× byte comparison)
- Net speedup: ~6× faster scanning

---
