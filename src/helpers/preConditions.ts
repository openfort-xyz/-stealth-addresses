import "dotenv/config";
import { foundry } from "viem/chains";
import { execSync } from "child_process";
import { addressBook } from "@/data/addressBook";
import { createWallet } from "@/clients/walletsClient";
import { Address, Hex, formatEther, parseEther, type PublicClient, type WalletClient } from "viem";

const PRIVATE_KEY_ANVIL: Hex = process.env.PRIVATE_KEY_ANVIL! as Hex;
const ANVIL_WALLET: WalletClient = createWallet(PRIVATE_KEY_ANVIL, process.env.RPC_URL_ANVIL! as string)

export async function sendEth(to: Address, amount: bigint | number | string, publicClient: PublicClient) {
    const value = typeof amount === "bigint" ? amount : parseEther(String(amount));
    const txHash = await ANVIL_WALLET.sendTransaction({ account: ANVIL_WALLET.account!, chain: foundry, to, value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "success") {
        console.log(`Transferred ${formatEther(value)} ETH to ${to} : TX Hash: ${txHash}`);
        const balance = await publicClient.getBalance({ address: to });
        console.log(`New Balance of ${to}: ${formatEther(balance)} ETH`);

    } else {
        throw new Error(`Transaction failed: ${txHash}`);
    }
}

async function deployERC5564(publicClient: PublicClient) {
    if (await getCode(addressBook.ERC5564_ADDRESS, publicClient)) {
        console.log("✅ ERC5564 already deployed, skipping...\n");
        return;
    }

    try {
        const output = execSync("make deploy-erc5564", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ ERC5564 Announcer deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy ERC5564:", error.message);
        throw error;
    }
}

async function deployERC6538(publicClient: PublicClient) {
    if (await getCode(addressBook.ERC6638_ADDRESS, publicClient)) {
        console.log("✅ ERC6538 already deployed, skipping...\n");
        return;
    }
    try {
        const output = execSync("make deploy-6538", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ ERC6538 Registry deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy ERC6538:", error.message);
        throw error;
    }
}

async function deployEntryPointV9(publicClient: PublicClient) {
    if (await getCode(addressBook.ENTRY_POINT_V9_ADDRESS, publicClient)) {
        console.log("✅ EntryPoint V9 already deployed, skipping...\n");
        return;
    }
    try {
        const output = execSync("make deploy-epv9", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ EntryPoint V9 deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy EntryPoint V9:", error.message);
        throw error;
    }
}

async function deployPaymaster(publicClient: PublicClient) {
    if (await getCode(addressBook.PAYMASTER_V3_V9_ADDRESS, publicClient)) {
        console.log("✅ Paymaster V3 V9 already deployed, skipping...\n");
        return;
    }
    try {
        const output = execSync("make deploy-paymaster", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ Paymaster V3 V9 deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy Paymaster:", error.message);
        throw error;
    }
}

async function deployErc20(publicClient: PublicClient) {
    if (await getCode(addressBook.MOCK_ERC20_ADDRESS, publicClient)) {
        console.log("✅ Mock ERC20 already deployed, skipping...\n");
        return;
    }
    try {
        const output = execSync("make deploy-mock-erc20", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ Mock ERC20 deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy Mock ERC20:", error.message);
        throw error;
    }
}

async function deploy7702(publicClient: PublicClient) {
    if (await getCode(addressBook.IMPLEMENTATION_7702_ADDRESS, publicClient)) {
        console.log("✅ 7702 Implementation already deployed, skipping...\n");
        return;
    }
    try {
        const output = execSync("make deploy-7702", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
        console.log("✅ 7702 deployed successfully\n");
    } catch (error: any) {
        console.error("❌ Failed to deploy 7702:", error.message);
        throw error;
    }
}


async function getCode(address: Address, publicClient: PublicClient): Promise<boolean> {
    const code = await publicClient.getCode({ address });
    const hasCode = code !== undefined && code !== "0x" && code !== null;
    return hasCode;
}

async function deployContracts(publicClient: PublicClient) {
    // Deploy contracts in order
    await deployERC5564(publicClient);
    await deployERC6538(publicClient);
    await deployEntryPointV9(publicClient);
    await deployPaymaster(publicClient);
    await deployErc20(publicClient);
    await deploy7702(publicClient);

    console.log("🎉 All contracts deployed successfully!");
}

export async function preConditions(to: Address, amount: bigint | number | string, publicClient: PublicClient) {
    await deployContracts(publicClient);
    await sendEth(to, amount, publicClient);
}
