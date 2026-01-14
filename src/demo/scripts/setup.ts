import { spawn } from "child_process";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { resolve } from "path";
import { foundry } from "viem/chains";
import { secp256k1 } from "@noble/curves/secp256k1";
import { privateKeyToAccount } from "viem/accounts";
import { generatePrivateKey } from "viem/accounts";
import {
  parseEther,
  formatEther,
  toHex,
  createPublicClient,
  createWalletClient,
  http,
  publicActions,
  encodeFunctionData,
  type Hex,
  type Address,
  type PublicClient,
  type WalletClient,
} from "viem";

// Hardcoded Anvil defaults (no .env needed)
const RPC_URL = "http://127.0.0.1:8545";
const ANVIL_PRIVATE_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Contract addresses (deterministic deployments)
const ERC5564_ADDRESS: Address = "0x55649E01B5Df198D18D95b5cc5051630cfD45564";
const ERC6538_ADDRESS: Address = "0x6538E6bf4B0eBd30A8Ea093027Ac2422ce5d6538";
const MOCK_ERC20_ADDRESS: Address = "0x96A65c633DD8855221830b90D09763809378D57e";

// ABIs (minimal)
const ERC20_ABI = [
  {
    name: "mint",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const ERC6538_ABI = [
  {
    name: "registerKeys",
    type: "function",
    inputs: [
      { name: "schemeId", type: "uint256" },
      { name: "stealthMetaAddress", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

// KeyPair interface (same as helpers/createKeys.ts)
interface KeyPair {
  name: string;
  privateKey: Hex;
  publicKey: Hex;
}

const OPENFORT_ETH_AMOUNT = 10; // ETH to fund Openfort
const SPENDING_ETH_AMOUNT = 1; // ETH to fund spending key
const OPENFORT_USDC_AMOUNT = parseEther("100000"); // USDC to mint to Openfort
const SPENDING_USDC_AMOUNT = parseEther("92340.18"); // USDC to mint to Spending Key
const SCHEME_ID = 1n;

interface SetupResult {
  openfortKeyPair: KeyPair;
  spendingKeyPair: KeyPair;
  viewingKeyPair: KeyPair;
}

// ============================================================================
// Inline helper functions (same logic as src/helpers, no imports needed)
// ============================================================================

function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });
}

function getAnvilClient(): WalletClient {
  return createWalletClient({
    chain: foundry,
    account: privateKeyToAccount(ANVIL_PRIVATE_KEY),
    transport: http(RPC_URL),
  }).extend(publicActions);
}

async function createKeyPair(name: string): Promise<KeyPair> {
  const privateKey = generatePrivateKey();
  const publicKeyBytes = secp256k1.getPublicKey(privateKey.slice(2), true);
  const publicKey = toHex(publicKeyBytes);

  return {
    name,
    privateKey,
    publicKey,
  };
}

function getAddressFromKeyPair(keyPair: KeyPair): Address {
  return privateKeyToAccount(keyPair.privateKey).address;
}

async function sendEth(to: Address, amount: number): Promise<void> {
  const client = getAnvilClient();
  const publicClient = getPublicClient();
  const value = parseEther(String(amount));

  const txHash = await client.sendTransaction({
    account: client.account!,
    chain: foundry,
    to,
    value,
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
  const balance = await publicClient.getBalance({ address: to });
  console.log(`  Transferred ${formatEther(value)} ETH to ${to.slice(0, 10)}...`);
  console.log(`  New balance: ${formatEther(balance)} ETH`);
}

async function mint(to: Address, amount: bigint): Promise<void> {
  const client = getAnvilClient();
  const publicClient = getPublicClient();

  const txHash = await client.sendTransaction({
    account: client.account!,
    chain: foundry,
    to: MOCK_ERC20_ADDRESS,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "mint",
      args: [to, amount],
    }),
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
}

async function balanceOf(address: Address): Promise<bigint> {
  const publicClient = getPublicClient();
  return publicClient.readContract({
    address: MOCK_ERC20_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address],
  });
}

async function registerKeys(spendingKeyPair: KeyPair, viewingKeyPair: KeyPair): Promise<void> {
  const publicClient = getPublicClient();
  const spendingAddress = getAddressFromKeyPair(spendingKeyPair);

  // Create wallet client for spending key
  const walletClient = createWalletClient({
    chain: foundry,
    account: privateKeyToAccount(spendingKeyPair.privateKey),
    transport: http(RPC_URL),
  }).extend(publicActions);

  // Concatenate public keys for stealth meta-address
  const stealthMetaAddress = (spendingKeyPair.publicKey + viewingKeyPair.publicKey.slice(2)) as Hex;

  const txHash = await walletClient.sendTransaction({
    account: walletClient.account!,
    chain: foundry,
    to: ERC6538_ADDRESS,
    data: encodeFunctionData({
      abi: ERC6538_ABI,
      functionName: "registerKeys",
      args: [SCHEME_ID, stealthMetaAddress],
    }),
  });

  await publicClient.waitForTransactionReceipt({ hash: txHash });
}

// ============================================================================
// Setup flow
// ============================================================================

async function startAnvil(): Promise<void> {
  console.log("🔧 Checking Anvil...");

  const publicClient = getPublicClient();

  // Check if anvil is already running
  try {
    await publicClient.getBlockNumber();
    console.log("✅ Anvil is already running");
    return;
  } catch {
    // Anvil not running, start it
  }

  console.log("🔧 Starting Anvil...");

  return new Promise((resolve, reject) => {
    const anvil = spawn("anvil", [], {
      detached: true,
      stdio: "ignore",
    });

    anvil.unref();

    // Wait for anvil to start
    setTimeout(async () => {
      try {
        await publicClient.getBlockNumber();
        console.log("✅ Anvil started successfully");
        resolve();
      } catch (error) {
        reject(new Error("Failed to start Anvil. Make sure Foundry is installed."));
      }
    }, 2000);
  });
}

async function deployContracts(): Promise<void> {
  console.log("\n📦 Deploying contracts...");

  const publicClient = getPublicClient();

  // Check if contracts are already deployed
  const erc5564Code = await publicClient.getCode({ address: ERC5564_ADDRESS });
  if (erc5564Code && erc5564Code !== "0x") {
    console.log("✅ Contracts already deployed");
    return;
  }

  // Deploy using make commands (requires being in project root)
  const { execSync } = await import("child_process");
  const rootDir = process.cwd().replace("/src/demo", "");

  try {
    console.log("  Deploying ERC5564...");
    execSync("make deploy-erc5564", { cwd: rootDir, stdio: "pipe" });

    console.log("  Deploying ERC6538...");
    execSync("make deploy-6538", { cwd: rootDir, stdio: "pipe" });

    console.log("  Deploying Mock ERC20...");
    execSync("make deploy-mock-erc20", { cwd: rootDir, stdio: "pipe" });

    console.log("✅ All contracts deployed");
  } catch (error: any) {
    console.error("❌ Failed to deploy contracts. Run from project root.");
    throw error;
  }
}

async function createOpenfortKeyPair(): Promise<KeyPair> {
  console.log("\n🔑 Creating Openfort keypair...");
  const keyPair = await createKeyPair("Openfort");
  const address = getAddressFromKeyPair(keyPair);
  console.log(`✅ Openfort Address: ${address}`);
  return keyPair;
}

async function createStealthKeyPairs(): Promise<{ spending: KeyPair; viewing: KeyPair }> {
  console.log("\n🔑 Creating Stealth keypairs...");
  const spending = await createKeyPair("Spending Key");
  const viewing = await createKeyPair("Viewing Key");

  const spendingAddress = getAddressFromKeyPair(spending);
  console.log(`✅ Spending Key Address: ${spendingAddress}`);
  console.log(`✅ Viewing Key created`);

  return { spending, viewing };
}

async function topUpAccounts(
  openfortKeyPair: KeyPair,
  spendingKeyPair: KeyPair
): Promise<void> {
  console.log("\n💰 Topping up accounts...");

  const openfortAddress = getAddressFromKeyPair(openfortKeyPair);
  const spendingAddress = getAddressFromKeyPair(spendingKeyPair);

  // Send ETH to Openfort
  console.log(`\n📤 Funding Openfort with ${OPENFORT_ETH_AMOUNT} ETH...`);
  await sendEth(openfortAddress, OPENFORT_ETH_AMOUNT);

  // Send ETH to spending key
  console.log(`\n📤 Funding Spending Key with ${SPENDING_ETH_AMOUNT} ETH...`);
  await sendEth(spendingAddress, SPENDING_ETH_AMOUNT);

  // Mint USDC to Openfort
  console.log(`\n🪙 Minting ${formatEther(OPENFORT_USDC_AMOUNT)} USDC to Openfort...`);
  await mint(openfortAddress, OPENFORT_USDC_AMOUNT);
  const openfortBalance = await balanceOf(openfortAddress);
  console.log(`  Openfort USDC balance: ${formatEther(openfortBalance)}`);

  // Mint USDC to Spending Key
  console.log(`\n🪙 Minting ${formatEther(SPENDING_USDC_AMOUNT)} USDC to Spending Key...`);
  await mint(spendingAddress, SPENDING_USDC_AMOUNT);
  const spendingBalance = await balanceOf(spendingAddress);
  console.log(`  Spending Key USDC balance: ${formatEther(spendingBalance)}`);

  console.log("\n✅ All accounts funded!");
}

async function registerStealthKeys(
  spendingKeyPair: KeyPair,
  viewingKeyPair: KeyPair
): Promise<void> {
  console.log("\n📝 Registering stealth meta-address in ERC-6538...");
  await registerKeys(spendingKeyPair, viewingKeyPair);
  console.log("✅ Stealth meta-address registered");
}

function saveKeysToFile(result: SetupResult): void {
  const keysData = {
    openfort: result.openfortKeyPair,
    spending: result.spendingKeyPair,
    viewing: result.viewingKeyPair,
    spendingAddress: getAddressFromKeyPair(result.spendingKeyPair),
    generatedAt: new Date().toISOString(),
  };

  // Save to public folder so Vite can serve it
  const publicDir = resolve(process.cwd(), "public");
  const keysPath = resolve(publicDir, "session-keys.json");

  try {
    // Create public dir if it doesn't exist
    if (!existsSync(publicDir)) {
      mkdirSync(publicDir, { recursive: true });
    }

    writeFileSync(keysPath, JSON.stringify(keysData, null, 2));
    console.log(`\n💾 Keys saved to: ${keysPath}`);
  } catch (error) {
    console.warn("Failed to save keys to file:", error);
  }
}

function printKeys(result: SetupResult): void {
  const spendingAddress = getAddressFromKeyPair(result.spendingKeyPair);

  console.log("\n💾 Generated Keys:");
  console.log("═".repeat(70));
  console.log(`OPENFORT_PRIVATE_KEY=${result.openfortKeyPair.privateKey}`);
  console.log(`OPENFORT_PUBLIC_KEY=${result.openfortKeyPair.publicKey}`);
  console.log("");
  console.log(`SPENDING_PRIVATE_KEY=${result.spendingKeyPair.privateKey}`);
  console.log(`SPENDING_PUBLIC_KEY=${result.spendingKeyPair.publicKey}`);
  console.log(`SPENDING_ADDRESS=${spendingAddress}`);
  console.log("");
  console.log(`VIEWING_PRIVATE_KEY=${result.viewingKeyPair.privateKey}`);
  console.log(`VIEWING_PUBLIC_KEY=${result.viewingKeyPair.publicKey}`);
  console.log("═".repeat(70));
}

async function main(): Promise<void> {
  console.log("╔══════════════════════════════════════════════════════════════════╗");
  console.log("║              Stealth Demo - Environment Setup                    ║");
  console.log("╚══════════════════════════════════════════════════════════════════╝\n");

  try {
    // 1. Start Anvil
    await startAnvil();

    // 2. Deploy contracts
    await deployContracts();

    // 3. Create Openfort keypair
    const openfortKeyPair = await createOpenfortKeyPair();

    // 4. Create Stealth keypairs
    const { spending: spendingKeyPair, viewing: viewingKeyPair } = await createStealthKeyPairs();

    // 5. Top up accounts with ETH and ERC20
    await topUpAccounts(openfortKeyPair, spendingKeyPair);

    // 6. Register stealth keys in ERC-6538
    await registerStealthKeys(spendingKeyPair, viewingKeyPair);

    // 7. Output keys
    const result: SetupResult = {
      openfortKeyPair,
      spendingKeyPair,
      viewingKeyPair,
    };

    // Save keys to file for demo to load
    saveKeysToFile(result);
    printKeys(result);

    console.log("\n🎉 Setup completed successfully!");
    console.log("🚀 Starting Vite dev server...\n");

  } catch (error) {
    console.error("\n❌ Setup failed:", error);
    process.exit(1);
  }
}

main();
