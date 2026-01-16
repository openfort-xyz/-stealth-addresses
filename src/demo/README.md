# Openfort Stealth Addresses Demo

A demo application showcasing ERC-5564 Stealth Addresses for private payments on Ethereum.

## Overview

This demo demonstrates how to receive funds privately using stealth addresses. Users can generate one-time private accounts that cannot be linked to their public identity on-chain, while maintaining full internal visibility for treasury and compliance.

### What are Stealth Addresses?

Stealth addresses provide **recipient unlinkability**: a sender can pay a recipient without putting the recipient's known address on-chain. Instead, the sender derives a one-time "stealth" EOA address that only the recipient can control.

Key benefits:
- **Privacy**: Deposits cannot be linked externally to the recipient's identity
- **One-time addresses**: Each payment uses a fresh, unique address
- **Full control**: Recipients can derive the private key and spend funds normally

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (for Anvil local node)

### Installation

```bash
# From the demo directory
cd src/demo

# Install dependencies
npm install
```

### Running the Demo

```bash
# Start Anvil, deploy contracts, and run the demo
npm run dev
```

This command will:
1. Start a local Anvil node (if not already running)
2. Deploy the required contracts (ERC-5564 Announcer, ERC-6538 Registry, Mock ERC20)
3. Generate keypairs and fund accounts
4. Start the Vite dev server

Then open [http://localhost:5173](http://localhost:5173) in your browser.

## How It Works

### The Flow

1. **Click "Receive Money"** - Enter the request flow
2. **Click "Receive"** - Generates a new stealth channel with:
   - Fresh spending/viewing keypairs
   - Stealth meta-address registration in ERC-6538
   - Pre-computed stealth address
3. **Enter amount and click "Receive USDC"** - Triggers:
   - USDC minting to Openfort account
   - Stealth address computation
   - Private transfer to the stealth address
   - ERC-5564 announcement for discovery
   - Ownership verification
4. **Confirmation** - Shows transaction details with option to "Receive again"

### Key Concepts

| Concept | Description |
|---------|-------------|
| **Stealth Meta-Address** | Published identifier (`st:eth:0x<spendingPubKey><viewingPubKey>`) that senders use to derive one-time addresses |
| **Spending Key** | Used to derive the stealth private key and spend funds |
| **Viewing Key** | Used to scan announcements and detect incoming payments |
| **View Tag** | 1-byte optimization that reduces scanning cost ~6x |
| **Ephemeral Key** | Random per-payment key used by sender to derive the stealth address |

### Contracts

| Contract | Address | Purpose |
|----------|---------|---------|
| ERC-5564 Announcer | `0x55649E01B5Df198D18D95b5cc5051630cfD45564` | Emits `Announcement` events for payment discovery |
| ERC-6538 Registry | `0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538` | Stores stealth meta-addresses for lookup |
| Mock ERC20 (USDC) | `0x96A65c633DD8855221830b90D09763809378D57e` | Test token for demo |

## Project Structure

```
src/demo/
├── scripts/
│   └── setup.ts        # Anvil setup, contract deployment, key generation
├── src/
│   ├── main.js         # Main application logic
│   └── styles.css      # UI styles
├── public/
│   └── session-keys.json  # Generated keys (created by setup)
├── index.html          # Entry point
├── vite.config.js      # Vite configuration
└── package.json
```

## Documentation

For detailed technical documentation on ERC-5564 and the cryptographic flow, see:

- [Technical Overview](../../documentation/TechnicalOverview.md) - Mental model and standard overview
- [ERC-5564 Lifecycle](../../documentation/ERC-5564Lifecycle.md) - Full send lifecycle walkthrough
- [SchemeId 1 Lifecycle](../../documentation/SchemeId1Lifecycle.md) - Worked example with actual values

### External Resources

- [EIP-5564: Stealth Addresses](https://eips.ethereum.org/EIPS/eip-5564)
- [EIP-6538: Stealth Meta-Address Registry](https://eips.ethereum.org/EIPS/eip-6538)
- [Vitalik's Stealth Addresses Post](https://vitalik.eth.limo/general/2023/01/20/stealth.html)

## Technology Stack

- **Frontend**: Vanilla JS + Vite
- **Blockchain**: [viem](https://viem.sh/) for Ethereum interactions
- **Cryptography**: [@noble/curves](https://github.com/paulmillr/noble-curves) for secp256k1 operations
- **Local Node**: [Anvil](https://book.getfoundry.sh/anvil/) (Foundry)

## License

MIT
