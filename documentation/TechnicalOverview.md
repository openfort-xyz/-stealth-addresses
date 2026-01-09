# ERC-5564 (Stealth Addresses)

## Mental model: what “stealth addresses”
Stealth addresses give you recipient unlinkability: Alice can pay Bob without putting Bob’s known address on-chain. Instead, Alice derives a one-time “stealth” EOA address that only Bob can control. Observers see “payment to some random address” — but this does not automatically give untraceability (e.g., it doesn’t “mix” funds). If Bob later sweeps to a known address, he can re-link

## Standard

**1) A common “Announcer” event for discovery**
It defines a singleton `ERC5564Announcer` contract (one per chain) that emits an A`nnouncement(schemeId, stealthAddress, caller, ephemeralPubKey, metadata)` event.
Why this matters: recipients (or a scanning service) can watch one well-known event stream instead of every dapp inventing its own logs.

**2) A scheme registry via `schemeId`**
ERC-5564 supports multiple stealth schemes. Each scheme defines compatible interfaces like:
- `generateStealthAddress(...)`
- `checkStealthAddress(...)`
- `computeStealthKey(...)`

The scheme is identified by a 256-bit `schemeId`. ERC-5564 introduces `schemeId = 1` as “secp256k1 + view tags”.

**3) A standard “stealth meta-address” string format**
Stealth meta-addresses extend chain-specific address formats with a st: prefix:

- `st:eth:0x<spendingPubKey><viewingPubKey>`

This is the thing Bob publishes (or registers) so senders can derive one-time stealth addresses for him.

## SchemeId 1 (secp256k1 + view tags): the actual cryptographic flow (common approach)
This is the “default” scheme most people mean when they say “ERC-5564 stealth addresses”.

**Keys (Bob, the recipient)**
Bob has:
- spending private key `p_spend` → public key `P_spend`
- viewing private key `p_view` → public key `P_view`

He publishes `(P_spend, P_view)` as his stealth meta-address.

**Sender derivation (Alice → Bob stealth address)**
Alice does:
1. Generate random ephemeral private key `p_ephemeral`, compute `P_ephemeral`
2. Shared secret: `s = p_ephemeral · P_view`
3. Hash: `s_h = h(s)`
4. View tag: `v = s_h[0] (top byte)`
5. Compute `S_h = s_h · G`
6. Stealth pubkey: `P_stealth = P_spend + S_h`
7. Stealth address: `a_stealth = pubkeyToAddress(P_stealth)`

Alice then:
- sends funds/tokens to `a_stealth`
- calls `ERC5564Announcer.announce(...)` with `P_ephemeral` and metadata whose first byte is the view tag `v`.

**Recipient scanning (Bob finds payments)**
Bob watches announcements and, for each one:
1. Compute `s = p_view · P_ephemeral`
2. Hash `s_h = h(s)`
3. Compare `s_h[0]` to the emitted view tag; if mismatch, skip
4. If match, derive `P_stealth`, compute derived address, and confirm it equals the announced stealthAddress

**Why view tags exist:** they reduce scanning cost ~6×. With a 1-byte tag, you skip the expensive ops with probability 255/256.
Tradeoff: revealing 1 byte reduces the privacy security margin (ERC notes 128→124 bits) but does not break correctness.

**Stealth private key derivation (Bob controls the stealth EOA)**
Once Bob identifies a matching announcement:
- `p_stealth = p_spend + s_h`
Now he can import/use that key as a normal EOA signer.

## Metadata: how wallets/dapps attach context
ERC-5564 requires:
- `Byte 1 = view tag`
    and recommends a structure so wallets can show “what this stealth thing is about”:
- Native token interaction:
    - byte1 view tag
    - bytes 2–5 = `0xeeeeeeee`
    - bytes 6–25 = `0xEeee…EEeE` (native token sentinel)
    - bytes 26–57 = amount

- ERC-20 / ERC-721 / etc:
    - byte1 view tag
    - bytes 2–5 = function selector (must use if available)
    - bytes 6–25 = token contract
    - bytes 26–57 = amount or tokenId

This is critical UX-wise: otherwise stealth announcements look like opaque spam.

## ERC-6538: where recipients publish their stealth meta-addresses
ERC-6538 is the “directory” layer so senders can do:
> “I know Bob’s normal address; what stealth meta-address(es) should I use for scheme X?”
It defines a registry mapping:
- registrant address → schemeId → stealthMetaAddress

## Registering keys (self or gas-sponsored)
Important registration paths:
1. `registerKeys(schemeId, stealthMetaAddress)`
    Direct on-chain update by the registrant.
2. `registerKeysOnBehalf(registrant, schemeId, signature, stealthMetaAddress)`
    A relayer can submit it, authorized by a signature. It supports:

- EOA signatures (via ecrecover if signature length is 65)
- EIP-1271 signatures for smart contract wallets


## Sources
https://eips.ethereum.org/EIPS/eip-5564
https://eips.ethereum.org/EIPS/eip-5564
https://vitalik.eth.limo/general/2023/01/20/stealth.html
https://ethereum-magicians.org/t/erc-5564-stealth-addresses/10614
https://www.youtube.com/watch?v=3pbPkcQnS6o
https://www.youtube.com/watch?v=9I6VPDSy7hw
https://www.youtube.com/watch?v=brIW-2r61hs
https://nerolation.github.io/stealth-utils/
