# Component 2: Storing Spending and Viewing Key Pairs

## Deep Research — ERC-5564 SchemeId=1 (SECP256k1) Stealth Address Systems

---

## 1. Executive Summary

Storing stealth address key pairs is fundamentally different from storing standard Ethereum wallet keys. The dual-key architecture (spending key + viewing key) creates a split-trust model where each key type demands a different storage strategy. The spending key controls all funds at stealth addresses and must never leave the client environment. The viewing key detects incoming payments and *can* be safely delegated to a server or trusted third party — this delegation is the architectural enabler for real-time payment notifications.

Production systems have converged on two dominant storage philosophies: **derive-on-demand** (Umbra, Fluidkey client-side) where keys are re-derived from a wallet signature each session and never persisted, and **encrypted-at-rest** (MetaMask-style, mobile wallets) where keys are encrypted using password-derived symmetric keys and stored locally. The derive-on-demand approach eliminates persistent storage risk entirely but requires user interaction each session. Encrypted-at-rest enables richer UX but introduces a persistent attack surface.

---

## 2. The Fundamental Storage Asymmetry

The dual-key architecture creates a deliberate asymmetry in storage requirements:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    KEY STORAGE SECURITY MODEL                           │
├─────────────────────────────┬───────────────────────────────────────────┤
│     SPENDING KEY (p_spend)  │       VIEWING KEY (p_view)                │
├─────────────────────────────┼───────────────────────────────────────────┤
│ Compromise = CRITICAL       │ Compromise = HIGH                         │
│ All stealth funds lost      │ Transaction visibility exposed            │
│ Irrecoverable               │ Funds remain safe                         │
│ NEVER on server             │ CAN be on server (delegated scanning)     │
│ NEVER in plaintext at rest  │ Can be shared with trusted parser         │
│ Minimal exposure time       │ Extended exposure acceptable              │
│ Client-only, memory-only    │ Server-side storage for BIP-32 node       │
│ if derive-on-demand         │ is a valid production pattern             │
└─────────────────────────────┴───────────────────────────────────────────┘
```

This asymmetry is the design rationale behind the dual-key system itself. As the Umbra protocol documentation states: users can give their viewing key to third-party scanning services that alert them of received funds, without giving those services access to their funds. The separation of concerns is the foundation of the entire storage architecture.

---

## 3. Production Storage Approaches

### 3.1 Approach A: Derive-On-Demand (No Persistent Storage)

**Used by: Umbra Cash, Fluidkey (client-side)**

This is the dominant pattern in production stealth address systems. Keys are never stored — they are re-derived from a wallet signature each session.

**How it works:**

```
┌──────────────┐     sign message     ┌────────────────────┐
│  User Wallet │ ──────────────────►  │  Deterministic     │
│  (MetaMask)  │                      │  Signature         │
└──────────────┘                      └────────┬───────────┘
                                               │
                                    ┌──────────▼──────────────┐
                                    │  Split & Hash           │
                                    │  r → keccak256 → p_spend│
                                    │  s → keccak256 → p_view │
                                    └──────────┬──────────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │  Keys in Memory      │
                                    │  (session-only)      │
                                    └──────────┬───────────┘
                                               │
                                    ┌──────────▼───────────┐
                                    │  Session Ends →      │
                                    │  Keys Discarded      │
                                    └──────────────────────┘
```

**Umbra's implementation detail:**

The Umbra protocol asks the user to sign a message, then uses the hash of the signature to generate private keys. The message includes the chain ID to prevent replay attacks across networks. The `r` and `s` components of the signature are hashed separately to generate the two independent private keys. The signing occurs lazily — Umbra does not prompt for a signature until it is needed, specifically on the Receive and Setup pages.

**Critical security consideration from Umbra:**

The protocol explicitly rejects storing unencrypted data in localStorage: "A browser extension could probably just read from local storage and de-anonymize all your transactions." When Umbra considered adding send history, the design options under consideration were all encryption-based — either using the Umbra-specific private key for encryption, or using the `eth_getEncryptionPublicKey` RPC method.

**Fluidkey's implementation detail:**

When a user signs into Fluidkey, they sign a key generation message with their existing Ethereum account. The private key pair never leaves the user's client and is not stored locally. Every time the user re-opens the Fluidkey app and wants to send funds out, they must sign the key generation message again to derive their private keys.

However, Fluidkey adds a critical extension: the BIP-32 viewing key node (`m/5564'/N'`) is extracted and shared with the Fluidkey server during onboarding. The spending key is generated client-side and immediately discarded after Safe creation. This hybrid approach combines derive-on-demand (spending key) with server delegation (viewing key node).

**Advantages:**
- Zero persistent attack surface for spending keys
- No encrypted storage to brute-force offline
- Recovery via wallet re-signing (no separate backup needed)
- Consistent across all devices — same wallet, same keys

**Disadvantages:**
- Requires wallet interaction (signature) every session
- UX friction from repeated signing prompts
- All downstream operations blocked until signing completes
- Cannot operate in background without prior user interaction

---

### 3.2 Approach B: Encrypted Local Storage (Persistent)

**Used by: MetaMask (general key storage), Browser extension wallets**

When persistent storage is required (e.g., for stealth keys that must survive page reloads without re-signing), the industry-standard pattern uses password-derived encryption with authenticated symmetric ciphers.

#### 3.2.1 Ethereum's Web3 Secret Storage Definition (V3)

The canonical encrypted key storage format used across the Ethereum ecosystem:

```json
{
  "version": 3,
  "id": "uuid-v4",
  "Crypto": {
    "cipher": "aes-128-ctr",
    "cipherparams": {
      "iv": "random-16-bytes-hex"
    },
    "ciphertext": "encrypted-private-key-hex",
    "kdf": "scrypt",
    "kdfparams": {
      "dklen": 32,
      "salt": "random-32-bytes-hex",
      "n": 262144,
      "r": 8,
      "p": 1
    },
    "mac": "keccak256(DK[16..31] || ciphertext)"
  }
}
```

**Encryption flow:**

```
Password
    │
    ▼
┌──────────────────────────────────────────────────────────┐
│  KDF: scrypt(password, salt, N=262144, r=8, p=1)         │
│  Output: 32-byte derived key (DK)                        │
└──────────────────────────────┬───────────────────────────┘
                               │
              ┌────────────────┼────────────────┐
              ▼                │                ▼
    DK[0..15] = AES key       │     DK[16..31] = MAC key
              │                │                │
              ▼                │                ▼
    AES-128-CTR encrypt        │     MAC = keccak256(
    (private_key, IV)          │       DK[16..31] || ciphertext)
              │                │                │
              ▼                ▼                ▼
         ciphertext          salt, IV          mac
              │                │                │
              └────────────────┼────────────────┘
                               ▼
                      JSON Keystore File
```

**This format is used by:** geth, Parity, MetaMask, MyEtherWallet, ethers.js, and most Ethereum wallet implementations.

#### 3.2.2 MetaMask's KeyringController Pattern

MetaMask's architecture provides a practical reference for browser-based encrypted key storage:

- **`this.store`**: Stores the encrypted vault (persisted to `chrome.storage.local`)
- **`this.memStore`**: Stores decrypted keys in memory (volatile, never persisted)
- **Browser extension encryptor**: PBKDF2 (10,000 iterations) → AES-GCM
- **Mobile app encryptor**: PBKDF2 (5,000 iterations) → AES-CBC
- **Mobile password storage**: The MetaMask mobile app stores the user password in the device Keychain/Keystore via `react-native-keychain`, enabling biometric unlock without re-entering the password

**Vault access (browser extension):**
```javascript
// The encrypted vault is accessible via:
chrome.storage.local.get('data', result => {
  var vault = result.data.KeyringController.vault;
  // vault = { data: "...", iv: "...", salt: "..." }
});
```

#### 3.2.3 Adapted Pattern for Stealth Keys

For a stealth address system that needs persistent encrypted storage:

```typescript
import { scrypt } from '@noble/hashes/scrypt';
import { gcm } from '@noble/ciphers/aes';
import { randomBytes } from '@noble/hashes/utils';
import { keccak_256 } from '@noble/hashes/sha3';

interface EncryptedStealthKeystore {
  version: 1;
  keyType: 'spending' | 'viewing';
  crypto: {
    cipher: 'aes-256-gcm';
    cipherparams: { iv: string };    // 12 bytes hex
    ciphertext: string;               // encrypted private key hex
    kdf: 'scrypt';
    kdfparams: {
      dklen: 32;
      salt: string;                   // 32 bytes hex
      n: number;                      // cost factor
      r: number;                      // block size
      p: number;                      // parallelism
    };
    mac: string;                      // integrity check
  };
}

async function encryptStealthKey(
  privateKey: Uint8Array,
  password: string,
  keyType: 'spending' | 'viewing'
): Promise<EncryptedStealthKeystore> {
  const salt = randomBytes(32);
  const iv = randomBytes(12);  // AES-GCM uses 12-byte IV

  // Derive encryption key with strong scrypt parameters
  const dk = scrypt(
    new TextEncoder().encode(password),
    salt,
    { N: 2 ** 18, r: 8, p: 1, dkLen: 32 }  // 256MB memory
  );

  // Encrypt with AES-256-GCM (authenticated encryption)
  const aes = gcm(dk, iv);
  const ciphertext = aes.encrypt(privateKey);

  // MAC for additional integrity verification
  const mac = keccak_256(
    new Uint8Array([...dk.slice(16), ...ciphertext])
  );

  // CRITICAL: Zero out the derived key and plaintext
  dk.fill(0);
  privateKey.fill(0);

  return {
    version: 1,
    keyType,
    crypto: {
      cipher: 'aes-256-gcm',
      cipherparams: { iv: toHex(iv) },
      ciphertext: toHex(ciphertext),
      kdf: 'scrypt',
      kdfparams: {
        dklen: 32,
        salt: toHex(salt),
        n: 2 ** 18,
        r: 8,
        p: 1,
      },
      mac: toHex(mac),
    },
  };
}
```

---

### 3.3 Approach C: Web Crypto API with Non-Extractable CryptoKey

**Used by: Browser-native applications requiring hardware-backed isolation**

The Web Crypto API provides a mechanism where private keys can be stored as opaque `CryptoKey` objects in IndexedDB, marked as non-extractable. JavaScript code cannot access the raw key material — all cryptographic operations are delegated to the browser's implementation, which may use hardware-backed storage on supported platforms.

```typescript
// Generate a wrapping key from user password
const passwordKey = await crypto.subtle.importKey(
  'raw',
  new TextEncoder().encode(password),
  { name: 'PBKDF2' },
  false,
  ['deriveBits', 'deriveKey']
);

const wrappingKey = await crypto.subtle.deriveKey(
  {
    name: 'PBKDF2',
    salt: crypto.getRandomValues(new Uint8Array(32)),
    iterations: 600_000,  // OWASP PBKDF2 minimum (FIPS)
    hash: 'SHA-256'
  },
  passwordKey,
  { name: 'AES-GCM', length: 256 },
  false,          // non-extractable wrapping key
  ['wrapKey', 'unwrapKey']
);

// Import the stealth private key as a non-extractable CryptoKey
const stealthCryptoKey = await crypto.subtle.importKey(
  'raw',
  stealthPrivateKeyBytes,
  { name: 'HMAC', hash: 'SHA-256' },  // Opaque container
  false,          // NON-EXTRACTABLE — cannot be read by JS
  ['sign']
);

// Wrap (encrypt) for IndexedDB storage
const iv = crypto.getRandomValues(new Uint8Array(12));
const wrappedKey = await crypto.subtle.wrapKey(
  'raw',
  stealthCryptoKey,
  wrappingKey,
  { name: 'AES-GCM', iv }
);

// Store wrapped key + IV + salt in IndexedDB
// The key material is never accessible to JavaScript
```

**Important caveat**: While non-extractable keys cannot be read via browser APIs, the underlying data still exists on disk as part of the browser's IndexedDB storage. Physical access or browser profile copying could theoretically compromise the data. The consensus in the security community is that this approach is stronger than encrypted `localStorage` but weaker than hardware-backed storage (Secure Enclave, Android Keystore).

---

### 3.4 Approach D: Mobile Platform Secure Storage

**Used by: Mobile wallet applications (MEW, Trust Wallet, Fabriik)**

Mobile platforms provide hardware-backed key storage through dedicated security hardware.

#### iOS: Secure Enclave + Keychain

```
┌──────────────────────────────────────────────────────┐
│                    iOS Architecture                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────┐     ┌─────────────────────────┐ │
│  │  App Process    │     │   Secure Enclave        │ │
│  │                 │     │   (Hardware Isolated)   │ │
│  │  Stealth key ──►│─────│──► ECC P-256 wrapping   │ │
│  │  (encrypted)    │     │     key (never leaves)  │ │
│  │                 │     │                         │ │
│  │  Keychain ◄─────│─────│──◄ Encrypted blob       │ │
│  │  (encrypted     │     │                         │ │
│  │   at rest)      │     │   Biometric gate:       │ │
│  │                 │     │   Face ID / Touch ID    │ │
│  └─────────────────┘     └─────────────────────────┘ │
│                                                      │
│  Access control:                                     │
│  kSecAttrAccessibleWhenUnlockedThisDeviceOnly        │
│  + kSecAccessControlBiometryCurrentSet               │
└──────────────────────────────────────────────────────┘
```

```swift
// iOS Keychain storage for stealth spending key
let stealthKeyData = spendingPrivateKey.data(using: .utf8)!
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrAccount as String: "stealth_spending_key",
    kSecValueData as String: stealthKeyData,
    kSecAttrAccessible as String:
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
    kSecUseAuthenticationUI as String:
        kSecUseAuthenticationUIAllow
]
SecItemAdd(query as CFDictionary, nil)
```

**Important limitation**: Apple's Secure Enclave only supports P-256 (secp256r1) curves natively, not secp256k1 used by Ethereum/ERC-5564. The Secure Enclave cannot directly generate or store secp256k1 keys. Mobile wallets work around this by using a Secure Enclave P-256 key to *encrypt* the secp256k1 private key, then storing the encrypted blob in the Keychain. MEW wallet describes this as double-encryption: the key is first encrypted with a password-derived key, then that encrypted result is encrypted again with a hardware-backed Secure Enclave key.

#### Android: Keystore + StrongBox

```kotlin
// Android Keystore for stealth key encryption
val keyGenerator = KeyGenerator.getInstance(
    KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore"
)
keyGenerator.init(
    KeyGenParameterSpec.Builder(
        "stealth_key_wrapper",
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
    .setKeySize(256)
    .setUserAuthenticationRequired(true)      // Biometric gate
    .setIsStrongBoxBacked(true)               // Hardware isolation
    .build()
)
val wrapperKey = keyGenerator.generateKey()

// Encrypt stealth private key
val cipher = Cipher.getInstance("AES/GCM/NoPadding")
cipher.init(Cipher.ENCRYPT_MODE, wrapperKey)
val encryptedKey = cipher.doFinal(stealthPrivateKeyBytes)
val iv = cipher.iv
// Store encryptedKey + iv in app's encrypted SharedPreferences
```

**Android requirement**: Since Android 7, new devices must have a hardware-backed security element (TEE or StrongBox). Use `KeyInfo.isInsideSecurityHardware()` to verify at runtime.

---

## 4. Viewing Key Delegation: Server-Side Storage

The viewing key's lower sensitivity level enables a unique storage pattern: server-side delegation for automated scanning.

### 4.1 Fluidkey's BIP-32 Viewing Node Delegation

Fluidkey's production implementation shares a BIP-32 derived *node* (not the raw viewing key) with their server:

```typescript
import { HDKey } from '@scure/bip32';
import { toBytes, isHex } from 'viem';

// Client-side: Extract viewing key node for server delegation
function extractViewingPrivateKeyNode(
  privateViewingKey: `0x${string}`,
  node: number = 0
): HDKey {
  if (!isHex(privateViewingKey) || privateViewingKey.length !== 66) {
    throw new Error('Hex private viewing key is not valid.');
  }

  const uint8PrivateViewingKey = toBytes(privateViewingKey);

  // Generate master HDKey from the private viewing key
  const hdkey = HDKey.fromMasterSeed(uint8PrivateViewingKey);

  // Derive the node m/5564'/N' to be shared with the server
  const viewingNode = hdkey
    .deriveChild(5564 + 0x80000000)   // 5564' (hardened)
    .deriveChild(node + 0x80000000);   // N' (hardened)

  return viewingNode;
}
```

**What the server receives:**
- A BIP-32 extended private key node at path `m/5564'/0'`
- This node can derive all ephemeral keys at `m/5564'/0'/c0'/c1'/0'/p'/n'`
- The server can generate stealth addresses on behalf of the user
- The server can detect incoming payments (scanning)

**What the server CANNOT do:**
- Derive the spending key (independently generated, different hash of signature)
- Move funds from any stealth address
- Access the master viewing key (hardened derivation is one-way)

**Server-side storage requirements for the viewing node:**

```
┌────────────────────────────────────────────────────────────┐
│              SERVER-SIDE VIEWING NODE STORAGE              │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Storage: Encrypted database (AES-256-GCM at rest)         │
│  Access: Authenticated API only (user session tokens)      │
│  Backup: Encrypted backup with key rotation                │
│  Audit: Access logging for compliance                      │
│                                                            │
│  Schema:                                                   │
│  ┌───────────────────────────────────────────────────────┐ │
│  │ user_id           │ UUID                              │ │
│  │ viewing_node_xprv │ encrypted(xprv...) AES-256-GCM    │ │
│  │ node_index        │ 0 (default)                       │ │
│  │ scheme_id         │ 1 (SECP256k1)                     │ │
│  │ created_at        │ timestamp                         │ │
│  │ last_derived_idx  │ integer (next p'/n' to derive)    │ │
│  └───────────────────────────────────────────────────────┘ │
│                                                            │
│  THREAT MODEL:                                             │
│  • Server compromise → viewing access to all user txns     │
│  • Server compromise ≠ fund access (spending key separate) │
│  • Mitigations: HSM for encryption keys, access logging,   │
│    key rotation, encryption at rest + in transit           │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

### 4.2 Dedaub Audit Findings on Fluidkey's Model

The Dedaub security audit of Fluidkey's Stealth Account Kit identified an important architectural note: although the legitimate Fluidkey application code does not store or transmit the spending private key, if the Fluidkey server gets compromised it could potentially serve malicious JavaScript code to the user. That malicious code would have access to the spending key during the session. The audit concluded that "the overall security of stealth addresses currently relies on the security of the Fluidkey server" for preventing supply-chain attacks.

The critical functions `generateKeysFromSignature`, `extractViewingPrivateKeyNode`, and `generateStealthPrivateKey` should only be used client-side, as they expose the user's private keys.

---

## 5. Key Derivation Functions: Choosing the Right KDF

For any approach that encrypts keys with a user password, the KDF is the critical security component. The wrong choice makes offline brute-force trivially fast.

### 5.1 KDF Comparison for Stealth Key Encryption

```
┌─────────────┬───────────────┬──────────────┬────────────────────────────┐
│ KDF         │ Memory        │ OWASP Rec.   │ Best For                   │
├─────────────┼───────────────┼──────────────┼────────────────────────────┤
│ Argon2id    │ 19-128 MiB    │ FIRST CHOICE │ New implementations         │
│             │ per hash      │ m=19456,t=2  │ Maximum GPU resistance      │
│             │               │ p=1          │ RFC 9106 standardized       │
├─────────────┼───────────────┼──────────────┼────────────────────────────┤
│ scrypt      │ 32-256 MB     │ SECOND       │ Ethereum ecosystem default  │
│             │ configurable  │ N=2^17,r=8   │ Web3 Secret Storage format  │
│             │               │ p=1          │ Proven in geth/Parity       │
├─────────────┼───────────────┼──────────────┼────────────────────────────┤
│ PBKDF2      │ Negligible    │ FIPS only    │ Browser Web Crypto API      │
│             │               │ 600K iters   │ (no scrypt/argon2 support)  │
│             │               │ HMAC-SHA256  │ Legacy compatibility        │
├─────────────┼───────────────┼──────────────┼────────────────────────────┤
│ bcrypt      │ 4 KB          │ LEGACY       │ Not recommended for new     │
│             │               │ cost=12-13   │ stealth address systems     │
└─────────────┴───────────────┴──────────────┴────────────────────────────┘
```

**Recommendation for stealth key encryption:**

- **Server-side / Node.js**: Use Argon2id (m=64MiB, t=3, p=1) via `argon2` npm package
- **Browser (Web Crypto API)**: Use PBKDF2 with 600,000+ iterations (HMAC-SHA256) — this is the only KDF available in the Web Crypto API natively
- **Browser (with WASM)**: Use scrypt via `@noble/hashes/scrypt` — matches Ethereum ecosystem conventions and can use strong parameters
- **Mobile**: Leverage hardware-backed encryption (Secure Enclave / Keystore) and password-gate with the platform's built-in KDF

### 5.2 MetaMask's KDF Parameters (Reference)

MetaMask's browser extension uses PBKDF2 with only 10,000 iterations — significantly below the OWASP minimum of 600,000. The mobile app uses 5,000 iterations. These are known weak points. A production stealth address system should use substantially stronger parameters:

```typescript
// RECOMMENDED: For new stealth key encryption (browser WASM)
const SCRYPT_PARAMS = {
  N: 2 ** 18,   // 262144 — strong cost factor
  r: 8,          // block size
  p: 1,          // parallelism
  dkLen: 32      // 256-bit derived key
};
// Memory: ~256 MB, Time: ~1-3 seconds on modern hardware

// ALTERNATIVE: For Web Crypto API only (no WASM)
const PBKDF2_PARAMS = {
  iterations: 600_000,  // OWASP FIPS minimum
  hash: 'SHA-256',
  dkLen: 32
};
```

---

## 6. Memory Security: Handling Keys in Runtime

Regardless of storage approach, stealth private keys exist in plaintext in memory during use. Securing this in-memory exposure is critical.

### 6.1 The JavaScript Memory Problem

JavaScript (and by extension TypeScript) presents inherent challenges for secure key handling:

- **Strings are immutable**: A `string` containing a private key cannot be zeroed — the garbage collector may retain copies indefinitely. The `ethers.js` issue #887 specifically calls out this problem: private keys should be `Uint8Array`, not `string`, because strings cannot be wiped from memory.
- **Garbage collection is non-deterministic**: Even after a reference is dropped, the GC may not reclaim memory immediately, and freed memory is not zeroed.
- **No `memset_s` equivalent**: JavaScript has no guaranteed secure memory erasure primitive.

### 6.2 Best Practices for Stealth Key Memory Handling

```typescript
// PATTERN: Use Uint8Array for all key material
function deriveAndUseStealthKey(
  viewingKey: Uint8Array,
  spendingKey: Uint8Array,
  ephemeralPubKey: Uint8Array
): Uint8Array {
  let stealthPrivateKey: Uint8Array | null = null;

  try {
    // Derive stealth key (returns Uint8Array)
    stealthPrivateKey = computeStealthKey({
      viewingPrivateKey: viewingKey,
      spendingPrivateKey: spendingKey,
      ephemeralPublicKey: ephemeralPubKey,
      schemeId: 1
    });

    // Use immediately for signing
    const signedTx = signTransaction(stealthPrivateKey, txData);
    return signedTx;

  } finally {
    // ALWAYS zero key material
    if (stealthPrivateKey) {
      stealthPrivateKey.fill(0);
    }
  }
}

// PATTERN: Secure wipe utility
function secureWipe(buffer: Uint8Array): void {
  // Fill with zeros
  buffer.fill(0);
  // Fill with random data (prevent optimizing compiler from removing)
  crypto.getRandomValues(buffer);
  // Fill with zeros again
  buffer.fill(0);
}
```

### 6.3 The `Uint8Array` Advantage

Using `Uint8Array` for all key material provides genuine memory control:

- Typed arrays represent real memory locations
- `fill(0)` actually zeroes the underlying `ArrayBuffer`
- Unlike strings, typed arrays are mutable — overwriting is possible
- The `tweetnacl-js` library specifically designed around this property: Uint8Arrays "represent real memory and when zeroed out really do erase the data from RAM"

**Key protocol for stealth address systems:**
1. All private keys MUST be `Uint8Array`, never `string`
2. Zero key buffers immediately after use (`buffer.fill(0)`)
3. Use `try/finally` blocks to ensure cleanup on errors
4. Minimize the window between derivation and use
5. Never log, serialize to JSON, or stringify key material

---

## 7. Recovery Mechanisms

### 7.1 Signature-Based Recovery (Umbra + Fluidkey)

Both production systems enable full key recovery through the original wallet:

```
┌────────────────────────────────────────────────────────────────────┐
│                     RECOVERY FLOW                                  │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  1. User connects SAME wallet (same private key / seed phrase)     │
│                                                                    │
│  2. App presents SAME deterministic message for signing            │
│     Umbra:    "Sign this message to access your Umbra account."    │
│     Fluidkey: Fluidkey-specific key generation message             │
│                                                                    │
│  3. Wallet produces IDENTICAL signature                            │
│     (ECDSA is deterministic per RFC 6979)                          │
│                                                                    │
│  4. Same split + hash → same p_spend, p_view                       │
│                                                                    │
│  5. Rescan announcements to rediscover stealth addresses           │
│     With view tag optimization: ~6× faster than full scan          │
│                                                                    │
│  RESULT: Full recovery with ZERO additional backup                 │
│  The wallet IS the backup. No separate key storage needed.         │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

This recovery model is the strongest argument for the derive-on-demand approach: if keys are never stored, they can never be lost (as long as the wallet is recoverable).

### 7.2 Encrypted Backup Recovery

For systems that store keys persistently:

```
Recovery requires:
  1. Encrypted keystore file (from IndexedDB / local storage backup)
  2. User password (to derive decryption key via KDF)

If password is lost:
  → Keystore is irrecoverable (no backdoor by design)
  → Must fall back to wallet signature re-derivation
  → Full chain rescan required to rediscover stealth addresses

If keystore is lost:
  → Re-derive keys from wallet signature
  → Or restore from encrypted cloud backup
```

### 7.3 Multi-Cloud Key Splitting (Advanced)

The InvisibleKeys MetaMask Snap demonstrates an advanced pattern: private keys are split across two or more non-colluding cloud storage services (e.g., Google Drive + Dropbox). Even if one service is compromised, the key remains safe. The key is only reconstructed in memory at signing time and immediately erased afterward.

---

## 8. Threat Model and Attack Vectors

### 8.1 Attack Surface by Storage Method

```
┌────────────────────────┬──────────┬──────────┬──────────┬──────────┐
│ Attack Vector          │ Derive   │ Encrypted│ Web      │ Mobile   │
│                        │ On-Demand│ Storage  │ Crypto   │ Secure   │
│                        │          │          │ API      │ Enclave  │
├────────────────────────┼──────────┼──────────┼──────────┼──────────┤
│ XSS / Malicious JS     │ HIGH(1)  │ HIGH(2)  │ LOW(3)   │ N/A      │
│ Extension keylogging   │ HIGH     │ HIGH     │ MED      │ N/A      │
│ Offline brute-force    │ N/A      │ MED(4)   │ LOW      │ VERY LOW │
│ Physical device access │ N/A      │ MED      │ MED      │ LOW      │
│ Server compromise      │ N/A(5)   │ N/A      │ N/A      │ N/A      │
│ Supply chain attack    │ HIGH     │ HIGH     │ HIGH     │ MED      │
│ Memory forensics       │ MED      │ MED      │ LOW      │ VERY LOW │
│ Browser profile copy   │ N/A      │ HIGH     │ MED      │ N/A      │
└────────────────────────┴──────────┴──────────┴──────────┴──────────┘

(1) Only during active session while keys are in memory
(2) If attacker extracts encrypted vault + captures password
(3) Non-extractable CryptoKey — JS cannot read raw key
(4) Depends entirely on KDF strength (scrypt N, argon2 memory)
(5) Spending key never on server. Viewing key node on server
    in Fluidkey model — server compromise exposes tx visibility
```

### 8.2 The Supply Chain Attack Problem

The Dedaub audit of Fluidkey identified the most significant threat to web-based stealth address systems: if the server serving the application JavaScript is compromised, malicious code could capture the spending key during the brief window it exists in memory after signature derivation. This applies to ALL web-based approaches.

**Mitigations:**
- Subresource Integrity (SRI) for all loaded scripts
- Content Security Policy (CSP) headers
- Code signing and reproducible builds
- Browser extension distribution (code reviewed by store)
- Client-side hash verification of loaded JavaScript
- Open source + audited stealth kit libraries (Fluidkey's approach)

---

## 9. Production System Comparison

```
┌─────────────────────┬───────────────────────┬───────────────────────┐
│ Dimension           │ Umbra Cash            │ Fluidkey              │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Spending key        │ Derive-on-demand      │ Derive-on-demand      │
│ storage             │ Never persisted       │ Never persisted       │
│                     │ Memory only per       │ Discarded after Safe  │
│                     │ session               │ creation              │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Viewing key         │ Derive-on-demand      │ BIP-32 node shared    │
│ storage             │ Never persisted       │ with Fluidkey server  │
│                     │ Memory only           │ Server stores xprv    │
│                     │                       │ node at m/5564'/0'    │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Signature           │ "Sign this message    │ Fluidkey-specific     │
│ message             │ to access your Umbra  │ key generation        │
│                     │ account." + chainId   │ message               │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Re-signing          │ Every session on      │ Every session when    │
│ frequency           │ Receive/Setup pages   │ sending funds out     │
│                     │ (lazy evaluation)     │                       │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Server trust        │ No server trust       │ Viewing key node on   │
│ requirements        │ required              │ server — trust for    │
│                     │                       │ tx privacy, not funds │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Payment detection   │ Client-side scanning  │ Server-side scanning  │
│ model               │ (user must be active) │ (real-time push       │
│                     │                       │ notifications)        │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Recovery            │ Re-sign same message  │ Re-sign same message  │
│ mechanism           │ + chain rescan        │ + deterministic       │
│                     │                       │ replay via BIP-32     │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Audited             │ Multiple audits       │ Dedaub audit (May '24)│
│                     │ ScopeLift team        │ Stealth Account Kit   │
├─────────────────────┼───────────────────────┼───────────────────────┤
│ Open source kit     │ umbra-js              │ @fluidkey/stealth-    │
│                     │                       │ account-kit           │
└─────────────────────┴───────────────────────┴───────────────────────┘
```

---

## 10. Recommended Storage Architecture

### 10.1 For a New Production Stealth Address System

```
┌─────────────────────────────────────────────────────────────────────┐
│              RECOMMENDED ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SPENDING KEY (p_spend):                                            │
│  ├─ PRIMARY: Derive-on-demand from wallet signature                 │
│  │   • Sign deterministic message → split r/s → keccak256           │
│  │   • Key exists in memory only during active operations           │
│  │   • Zero Uint8Array immediately after use                        │
│  │   • NEVER persist to disk, localStorage, IndexedDB               │
│  │                                                                  │
│  └─ FALLBACK (if UX requires persistence):                          │
│      • Encrypt with AES-256-GCM                                     │
│      • KDF: scrypt (N=2^18, r=8, p=1) or Argon2id (64MiB,t=3)       │
│      • Store in IndexedDB (browser) or Keychain/Keystore (mobile)   │
│      • Biometric gate on mobile                                     │
│      • Auto-lock after configurable timeout (default: 5 min)        │
│                                                                     │
│  VIEWING KEY (p_view):                                              │
│  ├─ CLIENT: Same as spending key (derive-on-demand or encrypted)    │
│  │                                                                  │
│  └─ SERVER DELEGATION (for real-time scanning):                     │
│      • Extract BIP-32 node: m/5564'/N' (hardened)                   │
│      • Share only the derived node, not the master viewing key      │
│      • Server stores encrypted (AES-256-GCM at rest)                │
│      • Server can derive ephemeral keys for scanning                │
│      • Server CANNOT derive spending key                            │
│      • Enable user to revoke by rotating to new node (N+1)          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Technology Stack

```
┌────────────────────────┬────────────────────────────────────────────┐
│ Component              │ Recommended Library                        │
├────────────────────────┼────────────────────────────────────────────┤
│ KDF (scrypt)           │ @noble/hashes/scrypt                       │
│ KDF (Argon2id)         │ argon2-browser (WASM) or hash-wasm         │
│ Symmetric encryption   │ @noble/ciphers (AES-GCM)                   │
│                        │ or Web Crypto API (SubtleCrypto)           │
│ Key derivation (BIP32) │ @scure/bip32 (HDKey)                       │
│ Secp256k1 operations   │ @noble/secp256k1 v2                        │
│ Browser IndexedDB      │ idb (Promise wrapper)                      │
│ Mobile Keychain (RN)   │ react-native-keychain                      │
│ Memory wiping          │ Manual Uint8Array.fill(0)                  │
│ Stealth key derivation │ @scopelift/stealth-address-sdk             │
│ Fluidkey recovery      │ @fluidkey/stealth-account-kit              │
└────────────────────────┴────────────────────────────────────────────┘
```

---

## 11. Sources

### Primary Sources (Production Implementations)
- Umbra Protocol: https://github.com/ScopeLift/umbra-protocol
- Umbra JS Technical Docs: https://github.com/ScopeLift/umbra-protocol/tree/master/umbra-js
- Fluidkey Technical Walkthrough: https://docs.fluidkey.com/technical-documentation/technical-walkthrough
- Fluidkey Stealth Account Kit: https://github.com/fluidkey/fluidkey-stealth-account-kit
- Dedaub Audit (Fluidkey): https://dedaub.com/audits/fluidkey/fluidkey-stealth-account-kit-may-24-2024/

### Cryptographic Standards
- ERC-5564 Specification: https://eips.ethereum.org/EIPS/eip-5564
- ERC-6538 Specification: https://eips.ethereum.org/EIPS/eip-6538
- Web3 Secret Storage Definition: https://ethereum.org/developers/docs/data-structures-and-encoding/web3-secret-storage/
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- RFC 9106 (Argon2): https://www.rfc-editor.org/rfc/rfc9106
- W3C Web Cryptography API: https://w3c.github.io/webcrypto/

### Key Management References
- MetaMask KeyringController: https://github.com/MetaMask/KeyringController
- MetaMask Vault Storage Analysis: https://www.wispwisp.com/index.php/2020/12/25/how-metamask-stores-your-wallet-secret/
- @noble/hashes (scrypt): https://github.com/paulmillr/noble-hashes
- @scure/bip32 (HDKey): https://github.com/paulmillr/scure-bip32

### Security Research
- Anonymity Analysis of Umbra: https://arxiv.org/pdf/2308.01703
- OWASP Cryptographic Storage: https://owasp.deteact.com/cheat/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html
- Memory Clearing in Cryptographic Software: https://www.sjoerdlangkemper.nl/2016/05/22/should-passwords-be-cleared-from-memory/
