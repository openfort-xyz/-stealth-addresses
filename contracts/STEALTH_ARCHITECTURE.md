# Stealth Address Architecture for EIP-7702 Accounts

## Overview

This document describes the stealth address announcement system designed for EIP-7702 accounts, implementing ERC-5564 compatible privacy-preserving announcements.

---

## Privacy Model

### Key Principle: Unlinkability

The stealth address is **intentionally omitted** from on-chain events. This ensures that observers cannot link the announcing account to any specific stealth address.

| Data | On-chain? | Can link to stealth address? |
|------|-----------|------------------------------|
| `schemeId` | Yes (indexed) | No |
| `caller` | Yes (indexed) | No - without viewing key |
| `viewTag` | Yes (indexed) | No - shared by ~1/256 users |
| `ephemeralPubKey` | Yes | No - requires viewing key |
| `stealthAddress` | **NO** | N/A - omitted for privacy |

### Security Guarantee

```
┌─────────────────────────────────────────────────────────────────┐
│                    WHAT ATTACKER SEES                           │
├─────────────────────────────────────────────────────────────────┤
│  • schemeId: 1                                                  │
│  • caller: 0xBob7702...                                         │
│  • viewTag: 0xa7                                                │
│  • ephemeralPubKey: 0x02abc123...                               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                 WHAT ATTACKER CAN DERIVE                        │
├─────────────────────────────────────────────────────────────────┤
│  • Nothing about which stealth address                          │
│  • Cannot compute: stealthAddress = ???                         │
│  • Missing: viewing private key                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Who Can Announce?

Both **sender (Alice)** and **recipient (Bob)** can call the `announce()` function.

### Scenario 1: Alice (Sender) Announces

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         ALICE ANNOUNCES (Sender Flow)                         │
└──────────────────────────────────────────────────────────────────────────────┘

     ALICE (Sender)                                        BOB (Recipient)
          │                                                      │
          │  1. Lookup Bob's stealthMetaAddress                  │
          │◄─────────────────────────────────────────────────────│
          │     (spendingPubKey + viewingPubKey)                 │
          │                                                      │
          │  2. Generate ephemeral keypair (r, R)                │
          │     R = r * G                                        │
          │                                                      │
          │  3. Compute shared secret                            │
          │     S = r * viewingPubKey                            │
          │                                                      │
          │  4. Compute stealth address                          │
          │     stealthAddr = pubToAddr(spendingPubKey + hash(S)*G)
          │                                                      │
          │  5. Send funds to stealthAddr                        │
          │─────────────────────► [stealthAddr receives funds]   │
          │                                                      │
          │  6. Build metadata                                   │
          │     viewTag = hash(S)[0]                             │
          │     metadata = viewTag || encryptedData              │
          │                                                      │
          │  7. Call announce(schemeId, R, metadata)             │
          │─────────────────────► [Event emitted]                │
          │                                                      │
          │                       8. Bob scans events by viewTag │
          │                       9. Derives stealth private key │
          │                       10. Controls stealthAddr       │
          │                                                      │
```

**Use case:** Alice pays Bob privately. Alice announces so Bob can discover the payment.

---

### Scenario 2: Bob (Recipient) Announces

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        BOB ANNOUNCES (Self-Tracking Flow)                     │
└──────────────────────────────────────────────────────────────────────────────┘

     BOB (7702 Account)
          │
          │  1. Bob generates his own ephemeral keypair (r, R)
          │     R = r * G
          │
          │  2. Compute shared secret with own viewing key
          │     S = r * viewingPubKey
          │
          │  3. Compute stealth address
          │     stealthAddr = pubToAddr(spendingPubKey + hash(S)*G)
          │
          │  4. Build metadata
          │     viewTag = hash(S)[0]
          │     metadata = viewTag || optionalData
          │
          │  5. Call announce(schemeId, R, metadata)
          │─────────────────────► [Event emitted]
          │
          │  6. Bob now has on-chain record for discovery
          │     (Can scan logs later to recover all stealth addresses)
          │
```

**Use case:** Bob wants to pre-generate stealth addresses or track addresses he created himself.

---

## Event Structure

```solidity
event Announcement(
    uint256 indexed schemeId,      // Cryptographic scheme (1 = secp256k1)
    address indexed caller,        // Who announced (Alice or Bob)
    bytes1 indexed viewTag,        // First byte of hash(sharedSecret)
    bytes ephemeralPubKey,         // R = r*G (33 or 65 bytes)
    bytes metadata                 // viewTag || optional encrypted data
);
```

### Indexed Fields for Efficient Filtering

| Field | Why Indexed? |
|-------|--------------|
| `schemeId` | Filter by cryptographic scheme |
| `caller` | Track announcements by specific account |
| `viewTag` | **Critical:** Reduces scan from 100% to ~0.4% of events |

---

## ViewTag Optimization

The `viewTag` is the first byte of `hash(sharedSecret)`, providing efficient filtering:

```
┌─────────────────────────────────────────────────────────────────┐
│                     WITHOUT viewTag                             │
├─────────────────────────────────────────────────────────────────┤
│  Scan: 100% of all announcements                                │
│  For each: Compute full shared secret + stealth address         │
│  Cost: O(n) expensive EC operations                             │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      WITH viewTag                               │
├─────────────────────────────────────────────────────────────────┤
│  Scan: ~1/256 of announcements (matching viewTag)               │
│  For each match: Compute full shared secret + stealth address   │
│  Cost: O(n/256) expensive EC operations                         │
│  Speedup: ~256x                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Metadata Structure

```
metadata = [viewTag (1 byte)] + [optional encrypted data]

┌────────┬─────────────────────────────────────────┐
│ Byte 0 │ Bytes 1..n                              │
├────────┼─────────────────────────────────────────┤
│viewTag │ Encrypted: token address, amount, memo  │
└────────┴─────────────────────────────────────────┘
```

The contract extracts `viewTag` from `metadata[0]` and indexes it for efficient queries.

---

## Off-chain Recovery Process

```
┌─────────────────────────────────────────────────────────────────┐
│                  STEALTH ADDRESS RECOVERY                        │
└─────────────────────────────────────────────────────────────────┘

Step 1: Query events by viewTag
─────────────────────────────────
    logs = getLogs({
        topics: [Announcement, null, null, myViewTag]
    })

Step 2: For each matching event
─────────────────────────────────
    ephemeralPubKey = event.ephemeralPubKey  // R

Step 3: Compute shared secret
─────────────────────────────────
    S = viewingPrivateKey * R

Step 4: Verify viewTag matches
─────────────────────────────────
    if hash(S)[0] != event.viewTag:
        continue  // Not ours

Step 5: Derive stealth private key
─────────────────────────────────
    stealthPrivKey = spendingPrivKey + hash(S)

Step 6: Compute stealth address
─────────────────────────────────
    stealthAddress = privateKeyToAddress(stealthPrivKey)

Step 7: Check balance
─────────────────────────────────
    if balanceOf(stealthAddress) > 0:
        // We own this stealth address!
        // Can now spend from it using stealthPrivKey
```

---

## Contract Interface

```solidity
abstract contract Stealths {
    // Errors
    error InvalidEphemeralPubKeyLength();
    error EmptyMetadata();

    // Event (stealthAddress intentionally omitted)
    event Announcement(
        uint256 indexed schemeId,
        address indexed caller,
        bytes1 indexed viewTag,
        bytes ephemeralPubKey,
        bytes metadata
    );

    // Public stealth meta-address for receiving
    bytes public immutable stealthMetaAddress;

    // Announce function - callable by sender OR recipient
    function announce(
        uint256 schemeId,
        bytes calldata ephemeralPubKey,
        bytes calldata metadata
    ) external;
}
```

---

## Security Considerations

| Threat | Status | Notes |
|--------|--------|-------|
| Direct address linking | **Mitigated** | stealthAddress omitted from event |
| ViewTag analysis | **Mitigated** | ~256-way k-anonymity |
| Caller enumeration | **Acceptable** | Cannot derive stealth addresses |
| Timing correlation | **User responsibility** | Behavioral, not protocol |
| Key compromise | **User responsibility** | Protect viewing/spending keys |

### Critical Security Requirements

1. **NEVER** expose viewing private key
2. **NEVER** expose spending private key
3. Both are required to link announcements to stealth addresses

---

## Comparison: With vs Without stealthAddress

| Aspect | With stealthAddress | Without stealthAddress |
|--------|---------------------|------------------------|
| Privacy | Broken - direct link | Preserved |
| Gas cost | Higher | Lower |
| Off-chain complexity | Lower | Slightly higher |
| ERC-5564 compliant | Partial | Full |

---

## Summary

- **Announcements are unlinkable** to stealth addresses without viewing key
- **Both sender and recipient** can announce
- **viewTag indexing** enables efficient ~256x faster scanning
- **stealthAddress omitted** by design for privacy
- **Off-chain recovery** derives addresses from ephemeralPubKey + viewing key
