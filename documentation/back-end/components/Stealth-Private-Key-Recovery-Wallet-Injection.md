# Component 10: Stealth Private Key Recovery and Wallet Injection

## Deep Research — Production Implementations for ERC-5564 SchemeId = 1 (SECP256k1)

---

## 1. Executive Summary

The stealth address lifecycle reaches its critical inflection point at withdrawal time. Components 1 through 9 of this research series have addressed how keys are generated, how meta-addresses are published, how announcements are indexed, how wallets are managed, and how metadata is stored for recovery. But none of those components actually move funds. The moment a recipient needs to spend assets locked behind a stealth address, they must solve two tightly coupled problems: **derive the stealth private key** from cryptographic inputs, and **inject that key into a wallet client** capable of signing and broadcasting a transaction to the network.

This is the domain of Component 10 — the bridge between passive detection ("I know someone sent me tokens to this address") and active control ("I can now sign a transaction moving those tokens wherever I want"). The cryptographic derivation itself is straightforward: a single ECDH shared secret computation, a hash, and a scalar addition on the SECP256k1 curve. But the surrounding infrastructure — wallet client integration, gas funding for an address that starts with zero balance, privacy-preserving withdrawal routing, and secure in-memory key handling — is where production implementations diverge significantly and where engineering decisions have lasting privacy and security consequences.

Production systems have converged on three distinct withdrawal architectures. **Umbra Protocol** derives stealth private keys client-side using ethers.js, injects them into ephemeral `Wallet` instances, and relies on a meta-transaction relayer (integrated with the Gas Station Network) to fund token withdrawals without pre-funding the stealth address. **Fluidkey** avoids per-transaction ephemeral key management entirely by using BIP-32 deterministic derivation, treats all stealth addresses as ERC-4337 smart accounts, and uses built-in paymaster sponsorship to eliminate the gas funding problem altogether. **ScopeLift's Stealth Address SDK** provides the canonical reference implementation of `computeStealthKey()` with native viem integration, leaving gas funding as an application-layer concern.

The gas funding problem deserves special emphasis. A freshly generated stealth address holds zero native tokens. If the recipient funds it from a known address, they immediately create an on-chain link that destroys the privacy guarantee. Four solutions have emerged in production: paymaster sponsorship (ERC-4337), meta-transaction relayers (Umbra/GSN), EIP-7702 EOA delegation (Pectra upgrade, mainnet since May 2025), and sender-side pre-funding with privacy trade-offs. Each solution carries different trust assumptions, cost structures, and privacy profiles.

This document examines every production implementation of stealth private key recovery and wallet injection, including complete code paths, gas funding architectures, security audit findings, withdrawal hygiene requirements, and integration recommendations for Openfort's Account Abstraction infrastructure.

---

## 2. The Core Cryptographic Derivation

### 2.1. The Formula

The stealth private key is derived through a deterministic sequence of elliptic curve operations. Given the sender's ephemeral public key (extracted from the `Announcement` event) and the recipient's root keys, the derivation is:

```
p_stealth = p_spend + hash(s)  (mod n)

where:
  s   = p_view × P_ephemeral       (ECDH shared secret)
  s_h = hash(s)                     (scalar derived from shared secret)
  n   = SECP256k1 curve order       (0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141)

Inputs (recipient possesses):
  p_spend       — Spending private key (from root key backup)
  p_view        — Viewing private key (from root key backup)
  P_ephemeral   — Sender's ephemeral public key (from Announcement event)

Output:
  p_stealth     — Private key controlling the stealth address
```

The hash function in the ERC-5564 SECP256k1 scheme (schemeId = 1) uses `keccak256` applied to the compressed shared secret point. The result is interpreted as a 256-bit scalar and added to the spending private key modulo the curve order `n`.

### 2.2. Step-by-Step Derivation

```
Step 1: Extract P_ephemeral from Announcement event
        ├── Source: ERC5564Announcer.Announcement.ephemeralPubKey
        ├── Format: 33 bytes compressed or 65 bytes uncompressed
        └── Validated in Component 5 (Event Indexer)

Step 2: Compute ECDH shared secret
        ├── s = p_view × P_ephemeral
        ├── This is elliptic curve point multiplication
        ├── Result is a curve point (x, y)
        └── Use the compressed encoding of this point for hashing

Step 3: Hash the shared secret
        ├── s_h = keccak256(s_compressed)
        ├── s_compressed = 33 bytes (0x02/0x03 prefix + 32 bytes x-coordinate)
        ├── Result: 32-byte scalar
        └── View tag = s_h[0] (first byte, used for filtering in Component 5)

Step 4: Derive stealth private key (scalar addition on SECP256k1)
        ├── p_stealth = (p_spend + s_h) mod n
        ├── Both p_spend and s_h are 256-bit integers
        ├── Addition is modular over the SECP256k1 curve order
        └── Result: 32-byte private key

Step 5: Validate derived key
        ├── P_stealth_derived = p_stealth × G  (derive public key from private key)
        ├── a_stealth_derived = keccak256(P_stealth_derived)[12:]  (Ethereum address)
        ├── Compare a_stealth_derived with announced stealthAddress
        └── If mismatch → derivation error or wrong announcement
```

### 2.3. Why This Is Secure

The security of stealth private key derivation rests on three cryptographic assumptions:

**Discrete Logarithm Problem (DLP):** An observer who sees `P_ephemeral` and `P_view` on-chain cannot compute the shared secret `s = p_view × P_ephemeral` without knowing either private key. This is the standard ECDH security guarantee on SECP256k1.

**Hash Pre-image Resistance:** Even if an attacker observes the stealth address (and thus knows `P_stealth`), they cannot reverse `keccak256` to find `s_h`, and therefore cannot compute `p_stealth = p_spend + s_h` without knowing `p_spend`.

**Key Separation:** The viewing key `p_view` participates in shared secret computation but not in spending. This means a parsing provider given `p_view` (for announcement scanning) can detect incoming payments but cannot derive `p_stealth` — they would also need `p_spend`. This separation is the foundation of delegated scanning.

### 2.4. Edge Cases in Derivation

Several edge cases can arise during stealth private key derivation:

```
┌────────────────────────────────────────────────────────────────────────┐
│                    Derivation Edge Cases                               │
├─────────────────────┬──────────────────────────────────────────────────┤
│ s_h ≥ n             │ Extremely unlikely (~2^-128 probability).        │
│                     │ If hash output exceeds curve order, reduce       │
│                     │ modulo n. All implementations handle this.       │
├─────────────────────┼──────────────────────────────────────────────────┤
│ p_stealth = 0       │ Astronomically unlikely. Would mean              │
│                     │ p_spend + s_h ≡ 0 (mod n), i.e., s_h = -p_spend. │
│                     │ No known implementation guards against this      │
│                     │ because the probability is negligible (~2^-256). │
├─────────────────────┼──────────────────────────────────────────────────┤
│ Invalid P_ephemeral │ Malformed or off-curve point. Must validate      │
│                     │ that P_ephemeral is a valid SECP256k1 point      │
│                     │ before performing ECDH. ScopeLift SDK handles    │
│                     │ this via noble-secp256k1 point validation.       │
├─────────────────────┼──────────────────────────────────────────────────┤
│ Wrong announcement  │ View tag matched (1/256 false positive rate)     │
│                     │ but full derivation produces wrong address.      │
│                     │ Handle gracefully: skip and continue scanning.   │
├─────────────────────┼──────────────────────────────────────────────────┤
│ Compressed vs       │ P_ephemeral may arrive in either format.         │
│ uncompressed        │ Always normalize to compressed before hashing    │
│                     │ per ERC-5564 schemeId=1 specification.           │
└─────────────────────┴──────────────────────────────────────────────────┘
```

---

## 3. Production Implementation: ScopeLift Stealth Address SDK

### 3.1. Overview

The ScopeLift Stealth Address SDK is the canonical reference implementation for ERC-5564 and ERC-6538 in TypeScript. It provides the `computeStealthKey()` function that performs the cryptographic derivation described in Section 2, along with announcement scanning utilities that feed into the key recovery pipeline. The SDK is built on viem and uses the `@noble/secp256k1` library for all elliptic curve operations.

### 3.2. Key Recovery with computeStealthKey()

```typescript
import {
  computeStealthKey,
  VALID_SCHEME_ID
} from "@scopelift/stealth-address-sdk";

// Derives the stealth private key (see Section 2.1 for the formula)
const stealthPrivateKey: `0x${string}` = computeStealthKey({
  viewingPrivateKey:  "0xabc...123",   // Recipient's p_view
  spendingPrivateKey: "0xdef...456",   // Recipient's p_spend
  ephemeralPublicKey: "0x02fab...789", // From Announcement event
  schemeId: VALID_SCHEME_ID.SCHEME_ID_1  // SECP256k1
});

// stealthPrivateKey is a 32-byte hex string: "0x..."
// This key controls the stealth address announced in the event
```

### 3.3. Full Pipeline: Scan → Filter → Derive → Inject

> **See:** [Event Listener](./Event-Listener.md), Section 7 — for the ScopeLift SDK setup (`createStealthClient`), announcement retrieval (`getAnnouncements`), and user-specific filtering (`getAnnouncementsForUser`) code. The code below continues from the filtered `myAnnouncements` result.

```typescript
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, parseEther } from "viem";
import { mainnet } from "viem/chains";

// After scanning and filtering announcements (see Event Listener, Section 7):
// myAnnouncements = filtered announcements for this recipient
// Each entry includes: { stealthAddress, ephemeralPubKey, metadata }

// ────────────────────────────────────────────────────
// Step 1: For each matched announcement, derive stealth key
// ────────────────────────────────────────────────────
for (const announcement of myAnnouncements) {
  const stealthPrivateKey = computeStealthKey({
    viewingPrivateKey:  recipientViewingPrivKey,
    spendingPrivateKey: recipientSpendingPrivKey,
    ephemeralPublicKey: announcement.ephemeralPubKey,
    schemeId: VALID_SCHEME_ID.SCHEME_ID_1
  });

  // ────────────────────────────────────────────────────
  // Step 4: Inject into viem wallet client
  // ────────────────────────────────────────────────────
  const stealthAccount = privateKeyToAccount(stealthPrivateKey);

  const walletClient = createWalletClient({
    account: stealthAccount,
    chain: mainnet,
    transport: http("https://eth-mainnet.g.alchemy.com/v2/YOUR_KEY")
  });

  // Validate: derived address matches announcement
  if (stealthAccount.address.toLowerCase() !==
      announcement.stealthAddress.toLowerCase()) {
    console.error("Address mismatch — skipping");
    continue;
  }

  // ────────────────────────────────────────────────────
  // Step 5: Sign and send transaction
  // ────────────────────────────────────────────────────
  const txHash = await walletClient.sendTransaction({
    to: recipientMainAddress,
    value: parseEther("1.0")
  });

  console.log(`Withdrawal from ${announcement.stealthAddress}: ${txHash}`);

  // ────────────────────────────────────────────────────
  // Step 6: Clear stealth private key from memory
  // ────────────────────────────────────────────────────
  // In production: overwrite the key variable
  // JavaScript GC limitations apply — consider using Uint8Array + crypto.getRandomValues() to zero out
}
```

### 3.4. SDK Internals: What computeStealthKey() Does

Under the hood, the ScopeLift SDK delegates to `@noble/secp256k1` for all curve operations:

```
computeStealthKey() internals:
│
├── 1. Parse ephemeralPublicKey → ProjectivePoint
│      └── noble.ProjectivePoint.fromHex(ephemeralPublicKey)
│      └── Validates point is on curve (throws if invalid)
│
├── 2. ECDH: multiply ephemeral point by viewing key
│      └── sharedSecret = ephemeralPoint.multiply(viewingPrivateKey)
│      └── Result: ProjectivePoint (x, y)
│
├── 3. Compress shared secret
│      └── compressed = sharedSecret.toRawBytes(true)  // 33 bytes
│
├── 4. Hash compressed shared secret
│      └── hashedSecret = keccak256(compressed)
│      └── Result: 32-byte Uint8Array
│
├── 5. Scalar addition: spendingPrivateKey + hashedSecret
│      └── Interpret both as BigInt
│      └── stealthKey = (spending + hashed) % CURVE_ORDER
│      └── Result: BigInt → hex string
│
└── 6. Return "0x" + stealthKey.toString(16).padStart(64, '0')
```

### 3.5. SDK Version and Dependencies

```
@scopelift/stealth-address-sdk
├── viem (peer dependency)
├── @noble/secp256k1 (elliptic curve operations)
├── @noble/hashes (keccak256)
└── TypeScript 5.x

Key exports used in Component 10:
  - computeStealthKey()
  - getAnnouncementsForUser()
  - createStealthClient()
  - VALID_SCHEME_ID
  - checkStealthAddress()
```

---

## 4. Production Implementation: Umbra Protocol

### 4.1. Architecture Overview

Umbra (by ScopeLift) is the first production deployment of stealth addresses on Ethereum. Its key recovery and withdrawal architecture is tightly integrated with a meta-transaction relayer system that solves the gas funding problem for token withdrawals. The flow:

```
┌──────────────────────────────────────────────────────────────────────┐
│                  Umbra Withdrawal Architecture                       │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────┐     scan     ┌───────────────────┐                  │
│  │  Recipient  │─────────────▶│  Announcement DB  │                  │
│  │  (browser)  │              │  (on-chain events)│                  │
│  └─────┬───────┘              └───────────────────┘                  │
│        │                                                             │
│        │ derive p_stealth                                            │
│        │ (client-side)                                               │
│        ▼                                                             │
│  ┌─────────────┐                                                     │
│  │  Ephemeral  │──── ETH withdrawal ────▶ Direct sendTransaction()   │
│  │   Wallet    │                                                     │
│  │  (ethers)   │──── Token withdrawal ──▶ Meta-tx via Relayer        │
│  └─────────────┘              │                                      │
│                               ▼                                      │
│                    ┌──────────────────┐                              │
│                    │  Umbra Contract  │                              │
│                    │  withdrawToken   │                              │
│                    │  OnBehalf()      │                              │
│                    └──────────────────┘                              │
│                               │                                      │
│                    ┌──────────┴──────────┐                           │
│                    │                     │                           │
│               Tokens to              Gas fee to                      │
│               recipient              relayer/sponsor                 │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 4.2. Key Recovery in Umbra

Umbra's client-side key derivation implements the formula from Section 2.1 using ethers.js rather than viem:

```typescript
// Umbra key recovery (ethers.js-based)
// Implements: p_stealth = p_spend + keccak256(p_view × P_ephemeral) mod n
// See Section 2.1 for the full derivation formula
import { ethers } from "ethers";

function computeStealthKey(
  ephemeralPublicKey: string,
  viewingPrivateKey: string,
  spendingPrivateKey: string
): string {
  const sharedSecret = /* ECDH: p_view × P_ephemeral (noble-secp256k1) */;
  const hashedSecret = ethers.utils.keccak256(sharedSecret);
  return addScalars(spendingPrivateKey, hashedSecret); // mod n
}

// Create ephemeral wallet from derived key
const stealthPrivateKey = computeStealthKey(
  announcement.ephemeralPubKey,
  viewingPrivateKey,
  spendingPrivateKey
);

const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

// Validate: wallet address matches announcement
console.assert(
  stealthWallet.address.toLowerCase() ===
  announcement.stealthAddress.toLowerCase()
);
```

### 4.3. ETH Withdrawal (Direct)

For native ETH held at a stealth address, Umbra performs a direct `sendTransaction()` from the ephemeral wallet. This requires the stealth address to already hold enough ETH to cover gas:

```typescript
// Direct ETH withdrawal — requires gas balance at stealth address
const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

// Calculate withdrawal amount (total balance minus gas)
const balance = await provider.getBalance(stealthWallet.address);
const gasPrice = await provider.getGasPrice();
const gasLimit = 21000n; // Simple ETH transfer
const gasCost = gasPrice * gasLimit;

const withdrawalAmount = balance - gasCost;

if (withdrawalAmount <= 0n) {
  throw new Error("Insufficient balance to cover gas");
}

const tx = await stealthWallet.sendTransaction({
  to: recipientAddress,  // Where to send withdrawn ETH
  value: withdrawalAmount,
  gasLimit: gasLimit,
  gasPrice: gasPrice
});

await tx.wait();
```

**Privacy limitation:** The recipient must specify a `recipientAddress` that is not linkable to their main identity. If they withdraw to their registrant address (the address that registered the stealth meta-address), the privacy guarantee is destroyed. This is the most common user error identified in Umbra's anonymity analysis.

### 4.4. Token Withdrawal (Meta-Transaction via Relayer)

For ERC-20 tokens at a stealth address, the gas funding problem is acute: the stealth address holds tokens but no ETH for gas. Umbra solves this with the `withdrawTokenOnBehalf()` pattern:

```solidity
// Umbra.sol — Simplified withdrawal on behalf
function withdrawTokenOnBehalf(
    address payable _stealthAddr,
    address         _acceptor,
    address         _tokenAddr,
    address         _sponsor,
    uint256         _sponsorFee,
    IUmbraHookReceiver _hook,
    bytes memory    _hookData,
    bytes memory    _v, uint8 _r, bytes32 _s  // EIP-712 signature
) external {
    // 1. Validate EIP-712 signature from stealth address owner
    bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(
        _WITHDRAW_TYPEHASH,
        _stealthAddr,
        _acceptor,
        _tokenAddr,
        _sponsor,
        _sponsorFee,
        address(_hook),
        keccak256(_hookData)
    )));
    address signer = ecrecover(digest, _v, _r, _s);
    require(signer == _stealthAddr, "Umbra: invalid signature");

    // 2. Transfer tokens minus sponsor fee to acceptor
    uint256 amount = tokenBalance[_stealthAddr][_tokenAddr];
    IERC20(_tokenAddr).safeTransfer(_acceptor, amount - _sponsorFee);

    // 3. Pay sponsor fee (covers relayer's gas cost)
    if (_sponsorFee > 0) {
        IERC20(_tokenAddr).safeTransfer(_sponsor, _sponsorFee);
    }

    // 4. Optional post-withdrawal hook
    if (address(_hook) != address(0)) {
        _hook.tokensWithdrawn(
            amount - _sponsorFee,
            _tokenAddr,
            _acceptor,
            _hookData
        );
    }
}
```

The client-side flow for meta-transaction withdrawal:

```typescript
// Client-side: sign withdrawal authorization with stealth private key
const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

// EIP-712 typed data for withdrawal authorization
const domain = {
  name: "Umbra",
  version: "1",
  chainId: chainId,         // Critical: prevents cross-chain replay
  verifyingContract: umbraContractAddress
};

const types = {
  WithdrawToken: [
    { name: "stealthAddr",  type: "address" },
    { name: "acceptor",     type: "address" },
    { name: "tokenAddr",    type: "address" },
    { name: "sponsor",      type: "address" },
    { name: "sponsorFee",   type: "uint256" },
    { name: "hook",         type: "address" },
    { name: "hookData",     type: "bytes"   }
  ]
};

const value = {
  stealthAddr: stealthWallet.address,
  acceptor:    recipientAddress,
  tokenAddr:   usdcAddress,
  sponsor:     relayerAddress,
  sponsorFee:  ethers.utils.parseUnits("2", 6),  // 2 USDC relayer fee
  hook:        ethers.constants.AddressZero,
  hookData:    "0x"
};

// Sign with stealth private key (never leaves browser)
const signature = await stealthWallet._signTypedData(domain, types, value);

// Submit to relayer (Umbra's relayer or any GSN-compatible relayer)
await relayerApi.submitWithdrawal({
  stealthAddr: stealthWallet.address,
  acceptor:    recipientAddress,
  tokenAddr:   usdcAddress,
  sponsorFee:  value.sponsorFee,
  signature:   signature
});
```

### 4.5. Umbra's Relayer Integration

Umbra's relayer architecture evolved from a direct GSN (Gas Station Network) integration in Phase 1 to a custom relayer in production. Key characteristics:

```
Umbra Relayer Flow:
│
├── 1. Recipient signs EIP-712 withdrawal authorization
│      └── Signed by stealth private key (in browser)
│
├── 2. Relayer receives signed authorization
│      └── Validates signature off-chain
│      └── Checks sponsor fee covers estimated gas cost
│
├── 3. Relayer submits withdrawTokenOnBehalf() transaction
│      └── Relayer pays ETH gas
│      └── Transaction executes on-chain
│
├── 4. Umbra contract validates signature on-chain
│      └── ecrecover must match stealth address
│
├── 5. Token distribution:
│      ├── Tokens minus fee → _acceptor (recipient's chosen address)
│      └── Fee → _sponsor (relayer, reimbursed in tokens)
│
└── 6. If relayer needs ETH: swap fee tokens to ETH via Uniswap
       └── Umbra's custom relayer handles this internally
```

**Generalized withdrawal:** Umbra's `withdrawTokenOnBehalf()` is intentionally permissionless — any address can call it with a valid signature. This means any relayer system can plug into Umbra, not just ScopeLift's official relayer. The GSN integration in Phase 1 demonstrated this composability.

### 4.6. Audit Findings Relevant to Key Recovery

The Consensys Diligence security review (2021) identified several findings directly relevant to Component 10:

**Chain ID in EIP-712 Signature:** The original implementation did not include `chainId` in the EIP-712 domain separator. This allowed a withdrawal signature created on one chain to be replayed on another chain where Umbra was deployed. The fix was to include `chainId` in the domain, which is now standard in all production deployments.

**Signature Malleability:** EIP-2 requires the `s` value in ECDSA signatures to be in the lower half of the curve order (s ≤ secp256k1n/2). Umbra's on-chain validation enforces this to prevent signature malleability attacks where a relayer could modify the signature to claim a different sponsor fee.

**Withdrawal Hygiene:** The audit noted that withdrawing to the registrant address (the EOA that registered the stealth meta-address on-chain) immediately links the stealth address to the recipient's identity. This is not a contract-level vulnerability but a critical UX concern. Umbra's interface warns users against this pattern, but enforcement is impossible at the protocol level.

---

## 5. Production Implementation: Fluidkey

### 5.1. Architecture Overview

Fluidkey takes a fundamentally different approach to stealth private key recovery. Instead of ECDH-based per-transaction ephemeral keys (Umbra/ScopeLift), Fluidkey uses **BIP-32 hierarchical deterministic derivation** — the stealth private key for any payment can be re-derived purely from the user's wallet private key and a PIN, with no announcement scanning required. Each derived key becomes the owner of an ERC-4337 smart account (1-of-1 Safe), with paymaster-sponsored gas eliminating the need for pre-funding.

> **See:** [Creation of Key Pairs](./Creation-Key-Pairs.md), Section 4.2 — "BIP-32 Hierarchical Derivation" for the full derivation path structure (`m/5564'/N'/c0'/c1'/0'/p'/n'`), ENSIP-11 coinType encoding, shared viewing key node details, and multi-chain derivation.
>
> **See:** [Managing Stealth Accounts](./Managing-Stealth-Accounts.md), Section 4 — "Fluidkey: Unified Dashboard Model" for the key generation/delegation process, stealth address derivation, dashboard architecture, and spending logic.

### 5.2. Key Recovery Flow

> **Note:** Fluidkey's recovery uses BIP-32 deterministic derivation, NOT the ECDH-based formula from Section 2.1. See [Creation of Key Pairs](./Creation-Key-Pairs.md), Section 4.2 for the full BIP-32 path structure (`m/5564'/N'/c0'/c1'/0'/p'/n'`), and [Managing Stealth Accounts](./Managing-Stealth-Accounts.md), Section 13.1 for the gap limit scanning model.

The recovery process derives all keys from the user's wallet signature: sign deterministic message → BIP-32 master node → sequential child key derivation → for each key, predict the Safe smart account address (CREATE2) and check on-chain balance → stop after 20 consecutive empty addresses (gap limit, similar to BIP-44). The final step is **wallet injection**:

```
Wallet Injection (Fluidkey):
└── Derived stealth private key → signer for ERC-4337 UserOperation
    └── Paymaster sponsors gas (no ETH pre-funding required)
    └── Safe deployed counterfactually on first withdrawal if needed
```

---

## 6. Wallet Client Integration Patterns

### 6.1. Pattern 1: Viem privateKeyToAccount (Recommended)

The viem library provides the most ergonomic integration for injecting stealth private keys into a wallet client. The `privateKeyToAccount()` function creates an in-memory account that can sign transactions, messages, and typed data.

```typescript
import { privateKeyToAccount } from "viem/accounts";
import {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  encodeFunctionData
} from "viem";
import { mainnet } from "viem/chains";

// ──────────────────────────────────────────────────
// Create account from stealth private key
// ──────────────────────────────────────────────────
const stealthAccount = privateKeyToAccount(stealthPrivateKey);
// stealthAccount.address === announced stealth address

// ──────────────────────────────────────────────────
// Create wallet client (for signing + sending)
// ──────────────────────────────────────────────────
const walletClient = createWalletClient({
  account: stealthAccount,
  chain: mainnet,
  transport: http(rpcUrl)
});

// ──────────────────────────────────────────────────
// Create public client (for reading chain state)
// ──────────────────────────────────────────────────
const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl)
});

// ──────────────────────────────────────────────────
// Operation: Send ETH
// ──────────────────────────────────────────────────
const ethTxHash = await walletClient.sendTransaction({
  to: recipientAddress,
  value: parseEther("1.0")
});

// ──────────────────────────────────────────────────
// Operation: Transfer ERC-20 tokens
// ──────────────────────────────────────────────────
const tokenTxHash = await walletClient.sendTransaction({
  to: tokenAddress,
  data: encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [recipientAddress, tokenAmount]
  })
});

// ──────────────────────────────────────────────────
// Operation: Sign message (for meta-transactions)
// ──────────────────────────────────────────────────
const signature = await walletClient.signMessage({
  message: "Withdraw authorization"
});

// ──────────────────────────────────────────────────
// Operation: Sign EIP-712 typed data
// ──────────────────────────────────────────────────
const typedSignature = await walletClient.signTypedData({
  domain: { name: "Umbra", version: "1", chainId: 1 },
  types: { Withdraw: [{ name: "acceptor", type: "address" }] },
  primaryType: "Withdraw",
  message: { acceptor: recipientAddress }
});
```

### 6.2. Pattern 2: Ethers.js Wallet (Umbra Legacy)

```typescript
import { ethers } from "ethers";

// ──────────────────────────────────────────────────
// Create wallet from stealth private key
// ──────────────────────────────────────────────────
const provider = new ethers.providers.JsonRpcProvider(rpcUrl);
const stealthWallet = new ethers.Wallet(stealthPrivateKey, provider);

// ──────────────────────────────────────────────────
// Send ETH
// ──────────────────────────────────────────────────
const tx = await stealthWallet.sendTransaction({
  to: recipientAddress,
  value: ethers.utils.parseEther("1.0"),
  gasLimit: 21000
});
await tx.wait();

// ──────────────────────────────────────────────────
// Transfer ERC-20 tokens
// ──────────────────────────────────────────────────
const tokenContract = new ethers.Contract(tokenAddress, erc20Abi, stealthWallet);
const tokenTx = await tokenContract.transfer(recipientAddress, tokenAmount);
await tokenTx.wait();

// ──────────────────────────────────────────────────
// Sign EIP-712 typed data
// ──────────────────────────────────────────────────
const signature = await stealthWallet._signTypedData(domain, types, value);
```

### A.1. Fluidkey: Stealth Account Kit — Safe Deployment with Viem

**Package:** `@fluidkey/stealth-account-kit` (npm, MIT license, audited by Dedaub May 2024)

Fluidkey's architecture fundamentally differs from Umbra: stealth addresses are **counterfactual Safe smart accounts** (1-of-1 multisig), not EOAs.

#### A.1.1. Core SDK Functions

> **See:** [Managing Stealth Accounts](./Managing-Stealth-Accounts.md), Section 4.1–4.2 — for the `generateKeysFromSignature()`, `extractViewingPrivateKeyNode()`, `generateEphemeralPrivateKey()`, and `generateStealthAddresses()` function signatures and their role in key generation and address derivation.

The wallet injection–specific SDK functions (not covered in other components):

```typescript
// ──────────────────────────────────────────────────────
// Recover stealth EOA private key (controls the Safe)
// ──────────────────────────────────────────────────────
generateStealthPrivateKey(
  ephemeralSecret: Hex,
  viewingPrivateKey: Hex,
  spendingPrivateKey: Hex
): Hex
// Returns: stealth EOA private key (owner of the Safe)

// ──────────────────────────────────────────────────────
// Predict Safe address (CREATE2 — no deployment needed)
// ──────────────────────────────────────────────────────
predictStealthSafeAddressWithClient(
  owners: Address[],        // Stealth EOA addresses
  threshold: number,        // Always 1 for Fluidkey
  safeVersion: '1.3.0',    // Safe version
  chainId: number           // 0 for cross-chain compat
): Promise<Address>

predictStealthSafeAddressWithBytecode(
  owners: Address[],
  threshold: number,
  safeVersion: '1.3.0'
): Address
// Pure computation — no RPC call needed
```

#### A.1.2. Complete Wallet Injection + Safe Withdrawal Flow

```typescript
import { privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';
import {
  generateKeysFromSignature,
  extractViewingPrivateKeyNode,
  generateEphemeralPrivateKey,
  generateStealthPrivateKey,
  predictStealthSafeAddressWithBytecode,
} from '@fluidkey/stealth-account-kit';

// ════════════════════════════════════════════════════════
// STEP 1: Derive root keys (one-time, from wallet signature)
// ════════════════════════════════════════════════════════
const signature = await mainWallet.signMessage({
  message: generateFluidkeyMessage(),
});
const { spendingPrivateKey, viewingPrivateKey } =
  generateKeysFromSignature(signature);

// ════════════════════════════════════════════════════════
// STEP 2: BIP-32 deterministic recovery of stealth address N
// ════════════════════════════════════════════════════════
const viewingKeyNode = extractViewingPrivateKeyNode(viewingPrivateKey);
const ephemeralSecret = generateEphemeralPrivateKey(viewingKeyNode, /* nonce */ 42);

// ════════════════════════════════════════════════════════
// STEP 3: Derive stealth EOA private key
// THIS IS THE WALLET INJECTION KEY
// ════════════════════════════════════════════════════════
const stealthEOAKey = generateStealthPrivateKey(
  ephemeralSecret,
  viewingPrivateKey,
  spendingPrivateKey
);

// ════════════════════════════════════════════════════════
// STEP 4: Create Viem Local Account (wallet injection)
// ════════════════════════════════════════════════════════
const stealthEOA = privateKeyToAccount(stealthEOAKey);

// ════════════════════════════════════════════════════════
// STEP 5: Predict Safe address (counterfactual — not deployed yet)
// ════════════════════════════════════════════════════════
const safeAddress = predictStealthSafeAddressWithBytecode(
  [stealthEOA.address],  // Single owner
  1,                      // 1-of-1 threshold
  '1.3.0'                // Safe version
);

// ════════════════════════════════════════════════════════
// STEP 6: Create Wallet Client for signing
// ════════════════════════════════════════════════════════
const walletClient = createWalletClient({
  account: stealthEOA,
  chain: base,
  transport: http(),
});

// ════════════════════════════════════════════════════════
// STEP 7: Sign Safe transaction (as 1-of-1 owner)
// ════════════════════════════════════════════════════════
const safeTransaction = {
  to: destinationAddress,
  value: parseEther('1.0'),
  data: '0x' as Hex,
  operation: 0,  // CALL
};

// Compute Safe message hash
const safeTxHash = getSafeTransactionHash(
  safeAddress,
  safeTransaction,
  nonce
);

const ownerSignature = await walletClient.signMessage({
  message: { raw: safeTxHash },
});

// ════════════════════════════════════════════════════════
// STEP 8: Submit via paymaster-sponsored UserOperation
// (Safe deployed on first withdrawal if not yet deployed)
// ════════════════════════════════════════════════════════
await executeSafeTransaction({
  safeAddress: safeAddress,
  transaction: safeTransaction,
  signature: ownerSignature,
  paymaster: fluidkeyPaymasterAddress,  // Sponsors gas
  // initCode included if Safe not yet deployed
  // → deploys Safe + executes withdrawal in single UserOp
});

// ════════════════════════════════════════════════════════
// STEP 9: Cleanup — discard ephemeral signer
// ════════════════════════════════════════════════════════
// stealthEOA and walletClient go out of scope
// No persistence, no localStorage, no IndexedDB
```

#### A.1.3. BIP-32 Deterministic Recovery (No Announcement Scanning)

Fluidkey's most significant innovation is that **all stealth addresses are deterministically recoverable** from root keys without scanning announcements:

```typescript
// Recover ALL stealth addresses offline
async function recoverAllStealthSafes(
  spendingPrivateKey: Hex,
  viewingPrivateKey: Hex,
  maxIndex: number = 1000
): Promise<{ index: number; safeAddress: Address; balance: bigint }[]> {
  const viewingKeyNode = extractViewingPrivateKeyNode(viewingPrivateKey);
  const funded: typeof results = [];

  for (let i = 0; i < maxIndex; i++) {
    // Deterministic derivation — same keys always produce same addresses
    const ephemeralSecret = generateEphemeralPrivateKey(viewingKeyNode, i);
    const stealthEOAKey = generateStealthPrivateKey(
      ephemeralSecret,
      viewingPrivateKey,
      spendingPrivateKey
    );
    const stealthEOA = privateKeyToAccount(stealthEOAKey);
    const safeAddress = predictStealthSafeAddressWithBytecode(
      [stealthEOA.address], 1, '1.3.0'
    );

    // Check balance (Multicall3 batch for efficiency)
    const balance = await publicClient.getBalance({ address: safeAddress });
    if (balance > 0n) {
      funded.push({ index: i, safeAddress, balance });
    }
  }

  return funded;
}
```

**Key difference from Umbra:** No reliance on on-chain `Announcement` events. Recovery only needs the root signature + BIP-32 derivation path index.

#### A.1.4. Fluidkey Recovery Parameters

Per the SDK README, to recover stealth accounts generated by Fluidkey:

```typescript
const chainId = 0;              // Cross-chain compatible
const safeVersion = '1.3.0';   // Safe version used
const useDefaultAddress = true; // Standard deployment factory
const threshold = 1;            // 1-of-1 ownership
```

---

### A.2. MoonChute: Aggregate ECDSA Smart Account Plugin (No Key Injection)

**Documentation:** https://docs.moonchute.xyz/blog/Stealth%20Address%20AA%20Plugin

MoonChute takes a fundamentally different approach: the **stealth private key is never recovered or injected**. Instead, the user signs with their main wallet, and a custom smart account validator proves control of the stealth address via a modified ECDSA verification equation.

#### A.2.1. The Problem MoonChute Solves

Standard ERC-4337 smart account validation:

```solidity
// Standard ECDSA Validator (e.g., ZeroDev Kernel)
function validateUserOp(
    UserOperation calldata userOp,
    bytes32 userOpHash
) external returns (uint256) {
    address signer = ecrecover(userOpHash, v, r, s);
    require(signer == owner, "Invalid signature");
    return 0; // SIG_VALIDATION_SUCCESS
}
```

**Problem:** `owner` is the user's main wallet, but the stealth smart account is controlled by `p_stealth` — a different key. Importing `p_stealth` into the main wallet **links the two addresses on-chain**, destroying privacy.

#### A.2.2. Aggregate ECDSA Verification

MoonChute modifies the ECDSA verification equation to accept signatures from `p_owner` that mathematically prove control of the stealth account through a shared secret:

```
┌─────────────────────────────────────────────────────────────────┐
│  Standard ECDSA                                                 │
│  ─────────────                                                  │
│  Sign:   s = k⁻¹ * (h + r * p_owner)    mod n                   │
│  Verify: R' = (h * s⁻¹) * G + (r * s⁻¹) * P_owner               │
│          Accept if: r == R'.x                                   │
│                                                                 │
│  MoonChute Aggregate ECDSA                                      │
│  ─────────────────────────                                      │
│  Pre-stored in smart account:                                   │
│    P_owner  = public key of user's main wallet                  │
│    P_shared = public key of shared secret                       │
│    dh_key   = P_owner * p_shared  (Diffie-Hellman point)        │
│                                                                 │
│  Signature generation (client-side):                            │
│    s_owner = k⁻¹ * (h + r * p_owner)           // standard      │
│    s'      = s_owner * (h + r * p_shared)       // aggregate    │
│                                                                 │
│  Verification (on-chain):                                       │
│    R' = (h² * s'⁻¹) * G                                         │
│       + (h * r * s'⁻¹) * (P_owner + P_shared)                   │
│       + (r² * s'⁻¹) * dh_key                                    │
│    Accept if: r == R'.x                                         │
│                                                                 │
│  RESULT: Owner signs with p_owner, verifier accepts             │
│  as if p_stealth signed — WITHOUT ever revealing p_stealth      │
└─────────────────────────────────────────────────────────────────┘
```

#### A.2.3. Smart Account Validator (Solidity)

```solidity
contract StealthAddressValidator {
    struct StealthData {
        address ownerAddress;     // User's main wallet address
        bytes pubShared;          // P_shared (compressed, 33 bytes)
        bytes dhKey;              // dh_key = P_owner * p_shared (compressed)
    }

    mapping(address => StealthData) public stealthAccounts;

    function validateUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash
    ) external returns (uint256) {
        StealthData memory data = stealthAccounts[userOp.sender];

        // Mode byte: 0x00 = standard ECDSA, 0x01 = aggregate ECDSA
        uint8 mode = uint8(userOp.signature[0]);

        if (mode == 0x00) {
            // Standard: direct ownership verification
            return _verifyStandardECDSA(
                userOpHash,
                userOp.signature[1:],
                data.ownerAddress
            );
        } else if (mode == 0x01) {
            // Aggregate: stealth ownership proof
            return _verifyAggregateECDSA(
                userOpHash,
                userOp.signature[1:],
                data
            );
        }

        return SIG_VALIDATION_FAILED;
    }

    function _verifyAggregateECDSA(
        bytes32 hash,
        bytes memory signature,
        StealthData memory data
    ) internal view returns (uint256) {
        (bytes32 r, bytes32 s_prime) = abi.decode(signature, (bytes32, bytes32));

        // Elliptic curve math:
        // R' = (h² * s'⁻¹) * G
        //    + (h * r * s'⁻¹) * (P_owner + P_shared)
        //    + (r² * s'⁻¹) * dh_key

        // Implementation uses precompiled EC operations
        // or a Solidity EC math library (e.g., EllipticCurve.sol)

        // Verify r == R'.x
        // return SIG_VALIDATION_SUCCESS or SIG_VALIDATION_FAILED
    }
}
```

#### A.2.4. Client-Side Signing Flow (No Key Injection)

```typescript
// MoonChute: User signs with MAIN wallet — no stealth key needed
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, concat } from 'viem';

// User's MAIN wallet (MetaMask, hardware wallet, etc.)
const mainWallet = privateKeyToAccount(userMainPrivateKey);

// 1. Build UserOperation for the stealth smart account
const userOp = {
  sender: stealthSmartAccountAddress,  // The stealth smart account
  nonce: await getAccountNonce(stealthSmartAccountAddress),
  callData: encodeFunctionData({
    abi: AccountABI,
    functionName: 'execute',
    args: [
      destinationAddress,       // Where to send funds
      parseEther('1.0'),        // Amount
      '0x' as Hex,              // No calldata (simple transfer)
    ],
  }),
  // ... gas parameters, paymaster data
};

// 2. Get UserOperation hash
const userOpHash = getUserOpHash(userOp, entryPointAddress, chainId);

// 3. Sign with MAIN wallet (standard ECDSA)
const ownerSignature = await mainWallet.signMessage({
  message: { raw: userOpHash },
});

// 4. Client-side aggregate step:
// Multiply owner signature's `s` component by (h + r * p_shared)
// This is done in the client SDK — NOT on-chain
const aggregatedSignature = aggregateSignature(
  ownerSignature,
  sharedSecret,      // p_shared — known to the user
  userOpHash         // h (message hash)
);

// 5. Prepend mode byte (0x01 = aggregate ECDSA)
const finalSignature = concat([
  '0x01',              // Mode: aggregate verification
  aggregatedSignature, // r, s' (aggregated)
]);

// 6. Submit UserOperation to bundler
userOp.signature = finalSignature;
await bundler.sendUserOperation(userOp);

// RESULT: Stealth smart account executes withdrawal
// User NEVER handled the stealth private key
```

### A.3. Additional Sources (Addendum)

| Source | URL |
|--------|-----|
| Fluidkey Stealth Account Kit (GitHub) | https://github.com/fluidkey/fluidkey-stealth-account-kit |
| Fluidkey Technical Walkthrough | https://docs.fluidkey.com/technical-walkthrough |
| Fluidkey Stealth Account Kit (npm) | https://www.npmjs.com/package/@fluidkey/stealth-account-kit |
| Fluidkey Audit (Dedaub, May 2024) | Referenced in GitHub repo `/audits/` |
| MoonChute Stealth AA Plugin | https://docs.moonchute.xyz/blog/Stealth%20Address%20AA%20Plugin |
| Umbra Protocol (GitHub) | https://github.com/ScopeLift/umbra-protocol |
| Umbra.sol Contracts | https://github.com/ScopeLift/umbra-protocol/tree/master/contracts |
| Bankless: Umbra Privacy Payments | https://www.bankless.com/sending-stealth-payments-with-umbra |
| Bankless: Fluidkey On-Chain Privacy | https://www.bankless.com/onchain-privacy-fluidkey |
