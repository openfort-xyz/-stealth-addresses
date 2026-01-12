# Full ERC-5564 send lifecycle
> This doc is the full ERC-5564 send lifecycle for “Alice sends 1 ETH to Bob”, assuming the most common scheme: schemeId = 1 (secp256k1 + view tags).

![Stealth Addresses diagram](./assets/StealthAddresses.png)

## Stage 0 — Bob prepares (one-time setup)
**0.1 Bob generates two keypairs**
Bob creates:
spending keypair: `p_spend` → `P_spend`
viewing keypair: `p_view` → `P_view`

**0.2 Bob publishes his “stealth meta-address”**

Format on Ethereum is:

- `st:eth:0x<spendingPubKey><viewingPubKey>`

Bob can share it directly with Alice or register it in the ERC-6538 registry so Alice can look it up by Bob’s “normal” identity address/ENS.

**0.3 (Optional but common) Bob registers in ERC-6538**

Bob calls `registerKeys(schemeId, stealthMetaAddressBytes)` where schemeId=1.
Ethereum Improvement Proposals
> Note: the registry stores the meta-address as raw bytes (compressed pubkeys concatenated).

## Stage 1 — Alice resolves Bob’s stealth meta-address (before sending)
Alice does one of:
**1.1 Direct**
Bob gives Alice the meta-address string `(st:eth:...)`.

**1.2 Via ERC-6538 registry**
Alice queries the singleton registry mapping:
- `stealthMetaAddressOf[bobAddress][schemeId]`

## Stage 2 — Alice derives Bob’s one-time stealth address (off-chain)
Given Bob’s `P_spend` and `P_view` (from the meta-address), Alice runs the schemeId=1 derivation:
1. Sample random ephemeral private key `p_ephemeral` (32 bytes)
2. Compute ephemeral public key `P_ephemeral`
3. Compute shared secret `s = p_ephemeral · P_view`
4. Hash it: `s_h = h(s)`
5. View tag `v = s_h[0]` (most significant byte)
6. Compute `S_h = s_h · G`
7. Compute stealth pubkey: `P_stealth = P_spend + S_h`
8. Compute stealth EOA address: `a_stealth = pubkeyToAddress(P_stealth)`

Outputs Alice now has:
- `stealthAddress = a_stealth`
- `ephemeralPubKey = P_ephemeral` (as bytes)
- `viewTag = v` (1 byte)


## Stage 3 — Alice builds the “announcement metadata” for an ETH transfer (off-chain)
ERC-5564 requires:
- metadata[0] MUST be the view tag

For **native ETH**, ERC-5564 recommends:
- Byte 1: `viewTag`
- Bytes 2–5: `0xeeeeeeee`
- Bytes 6–25: `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE` (native token sentinel)
- Bytes 26–57: amount of ETH sent

For 1 ETH, the amount is `1e18` wei, encoded into those 32 bytes (as a `uint256`-style 32-byte value).

## Stage 4 — Alice sends on-chain transactions
**Key on-chain contract**

The singleton **ERC5564Announcer** is defined by ERC-5564 and deployed at:
`0x55649E01B5Df198D18D95b5cc5051630cfD45564` (deterministic deployment).

## 4.A The ETH transfer (normal Ethereum tx)
Alice sends a standard ETH transaction:
- `to = stealthAddress`
- `value = 1 ETH`
- `data = 0x` (empty)

This is just a plain L1 transfer to a fresh EOA address (the stealth address).

## 4.B The ERC-5564 announce call (so Bob can discover it efficiently)
Alice calls the announcer contract:
`announce(schemeId, stealthAddress, ephemeralPubKey, metadata)`

This emits the standard event:
`Announcement(schemeId, stealthAddress, caller, ephemeralPubKey, metadata)` where `caller` is `msg.sender`.

> Make a batch transaction with ERC4337 / EIP7702

## Stage 5 — Bob detects the payment (off-chain scanning)
Bob monitors **Announcement** logs from the singleton announcer contract (that’s the whole point of the standard).
1. Compute shared secret: `s = p_view · P_ephemeral`
2. Hash: `s_h = h(s)`
3. Compare `s_h[0]` with the view tag in `metadata[0]`:
    - If mismatch, skip (fast path)
    - If match, continue
4. Recompute derived stealth address from `P_spend + s_h·G` and confirm it matches `stealthAddress` in the event

> View tags are explicitly to make scanning ~6× cheaper by skipping most events early.

## Stage 6 — Bob takes control of the stealth account (private key derivation)
For matching announcements, Bob derives the stealth private key:
- `p_stealth = p_spend + s_h`

Now Bob can sign transactions as the **stealth EOA** and spend the 1 ETH (gas comes out of that same 1 ETH, so ETH transfers don’t have the “no gas” problem that ERC-20/NFT stealth receipts do).
