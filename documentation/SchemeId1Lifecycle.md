# Fully-Worked ERC-5564 (schemeId = 1, secp256k1 + view tags)
## Stage 0 — Bob prepares (one-time setup)
**0.1 Bob generates 2 keypairs**
We pick:
- Spending private key `p_spend` (32 bytes):
    - `0x1111111111111111111111111111111111111111111111111111111111111111`
- Viewing private key `p_view` (32 bytes):
    - `0x2222222222222222222222222222222222222222222222222222222222222222`
Compute public keys on secp256k1:
- `P_spend = p_spend · G`
    - compressed (33 bytes):
        - `0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa`
    - (Ethereum address of this pubkey, just for intuition:
        - `0x19e7e376e7c213b7e7e7e46cc70a5dd086daff2a`)
- `P_view = p_view · G`
    - compressed (33 bytes):
        - `0x02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27`
    - (intuition address: `0x1563915e194d8cfba1943570603f7606a3115508`)

**What these mean (quick):**
- *spending keypair* is the “money key”: once Bob derives the stealth private key later, he can sign spends from the stealth address.
- *viewing keypair* is the “scanner key”: used to detect which announcements are his without giving spend power.

**0.2 Bob publishes his stealth meta-address**
ERC-5564 defines the meta-address format as `st:eth:0x<spendingPubKey><viewingPubKey>`.

So Bob’s stealth meta-address bytes (66 bytes) are:
- `stealthMetaAddress = P_spend_compressed || P_view_compressed`
- `0x034f355bdcb7cc0af728ef3cceb9615d90684bb5b2ca5f859ab0f0b704075871aa02466d7fcae563e5cb09a0d1870bb580344804617879a14949cf22285f1bae3f27`

And the URI form is:
- `st:eth:0x034f...871aa0246...e3f27`
Bob can share it directly, or register it in ERC-6538 (optional). ERC-5564 explicitly mentions registry-based discovery.

## Stage 1 — Alice gets Bob’s stealth meta-address
Alice obtains:
- `P_spend` (compressed 33B)
- `P_view` (compressed 33B)
(That’s exactly what’s inside the `st:eth:`... value above.)

## Stage 2 — Alice generates an ephemeral keypair (per payment)

Pick Alice’s ephemeral private key (again fixed for reproducibility):
- `p_ephemeral = 0x3333333333333333333333333333333333333333333333333333333333333333`
Compute ephemeral public key:
- `P_ephemeral = p_ephemeral · G`
- compressed (33 bytes):
    - 0x023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1
- (intuition address: `0x5cbdd86a2fa8dc4bddd8a8f69dba48572eec07fb`)

## Stage 3 — Alice computes stealth address + view tag

ERC-5564 scheme 1:
1. Shared secret point
    `s = p_ephemeral · P_view`
Resulting point (affine coords):
- `s.x = 0x9110f876452167ee4c1e3c792d5d7df90f6c7e59b9c0f1d0d857c4f39082fe01`
- `s.y = 0x34ee6c2c30ac40de... (y omitted here; x is what we hash in this worked example)`
2. Hash it
    ERC-5564 says `s_h = h(s)` but doesn’t pin down byte-serialization details; in most Ethereum implementations, you hash 32 bytes derived from the shared secret. Here I hash the 32-byte x-coordinate:
    - `s_bytes = s.x (32 bytes big-endian)`
    - `s_h = keccak256(s_bytes)`
    - `s_h = 0x838e570ca42604a2c43f86f5e1ab60ce7165eb7b872939e6f8d1b7107eee114e`
3. View tag (first byte)
    - `v = s_h[0]`
    - `viewTag = 0x83`
4. Stealth pubkey
    Compute `S_h = s_h · G`, then:
    `P_stealth = P_spend + S_h`
5. Stealth address
    - `a_stealth = pubkeyToAddress(P_stealth)`
    - stealthAddress = 0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8
So Alice’s output is:
    - `stealthAddress: 0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8`
    - `ephemeralPubKey: 0x023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1`
    - `viewTag: 0x83`

## Stage 4 — Alice sends 1 ETH + announces it
**4.A The ETH transfer itself**
Alice sends a normal ETH transfer:
    - `to = 0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8`
    - `value = 1 ETH = 0xde0b6b3a7640000`
    - `data = 0x`
**4.B The Announcement (ERC-5564 singleton announcer)**
ERC-5564 defines a singleton announcer contract emitting:
`Announcement(schemeId, stealthAddress, caller, ephemeralPubKey, metadata)`

It also defines the recommended metadata format for native ETH:

- Byte 1: view tag
- Bytes 2–5: `0xeeeeeeee`
- Bytes 6–25: address `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (20 bytes of 0xee)
- Bytes 26–57: amount (32 bytes)

So for 1 ETH:
    - `amount32 = 0x0000000000000000000000000000000000000000000000000de0b6b3a7640000`

**metadata (57 bytes):**
    - 0x83
    - eeeeeeee
    - eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee
    - 0000000000000000000000000000000000000000000000000de0b6b3a7640000

Full metadata hex:
    - `0x83eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000000000000000000000000000000000000de0b6b3a7640000`

**Announcer address**
ERC-5564 states the singleton announcer is deployed at:
    - `0x55649E01B5Df198D18D95b5cc5051630cfD45564`

Calldata bytes for `announce(...)`
Function selector:
    - `selector = keccak256("announce(uint256,address,bytes,bytes)")[0:4] = 0x4d1f9583`
Arguments:
    - `schemeId = 1`
    - `stealthAddress = 0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8`
    - `ephemeralPubKey = 0x023c72...c7b1b1 (33B)`
    - `metadata = 0x83eeee...640000 (57B)`

**Full calldata (324 bytes):**
```ts
0x4d1f9583
  0000000000000000000000000000000000000000000000000000000000000001
  00000000000000000000000035cfea8cf9c3e33bc210a65793840aa5a86f51a8
  0000000000000000000000000000000000000000000000000000000000000080
  00000000000000000000000000000000000000000000000000000000000000e0
  0000000000000000000000000000000000000000000000000000000000000021
  023c72addb4fdf09af94f0c94d7fe92a386a7e70cf8a1d85916386bb2535c7b1b1
  0000000000000000000000000000000000000000000000000000000000000000
  0000000000000000000000000000000000000000000000000000000000000039
  83eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee0000000000000000
  0000000000000000000000000000000000000000000000000de0b6b3a7640000
  0000000000000000000000000000000000000000000000000000000000000000
```
> *(That’s the exact ABI encoding: offsets 0x80 and 0xe0, then length+data for each bytes blob.)*

## Stage 5 — Bob detects the payment (off-chain scanning)
Bob watches `Announcement` logs (singleton contract is the shared “bulletin board”).

For each announcement:
1. Read `ephemeralPubKey` and `metadata[0]` (the view tag)
2. Compute:
    - `s = p_view · P_ephemeral`
    - `s_h = h(s)`
    - `v' = s_h[0]`
3. If `v' != metadata[0]`, skip ~255/256 of events cheaply.
4. If it matches, compute:
    - `P_stealth = P_spend + (s_h · G)`
    - `a_stealth = pubkeyToAddress(P_stealth)`
    - Check `a_stealth == stealthAddress` in the event.
In our numbers, Bob recomputes the same:
    - `viewTag = 0x83`
    - derived stealthAddress = `0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8`

## Stage 6 — Bob derives the stealth private key (and can spend)
ERC-5564 scheme 1 private key derivation:
    - `p_stealth = p_spend + s_h` (mod curve order)
Using our values:
    - `p_spend = 0x1111...1111`
    - `s_h (as scalar) = 0x838e570ca42604a2c43f86f5e1ab60ce7165eb7b872939e6f8d1b7107eee114e`
So:
    - `p_stealth = 0x949f681db53715b3d5509806f2bc71df8276fc8c983a4af809e2c8218fff225f`
    - (mod n; and yes, `p_stealth·G` equals the stealth pubkey that hashes to `0x35cf...51a8`.)

Now Bob can import `p_stealth` into a wallet (or use it programmatically) and sweep the 1 ETH from:
    - `from = 0x35cfea8cf9c3e33bc210a65793840aa5a86f51a8` to wherever he wants.
