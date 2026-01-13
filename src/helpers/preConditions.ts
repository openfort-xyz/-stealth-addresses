import "dotenv/config";
import { foundry } from "viem/chains";
import { execSync } from "child_process";
import { addressBook } from "@/data/addressBook";
import { anvilClient } from "@/clients/anvilClient";
import { WalletAccounts } from "@/clients/walletsClient";
import { Address, formatEther, parseEther, type PublicClient} from "viem";


export async function sendEth(to: Address, amount: bigint | number | string, publicClient: PublicClient) {
    const value = typeof amount === "bigint" ? amount : parseEther(String(amount));
    const txHash = await anvilClient.sendTransaction({ account: anvilClient.account!, chain: foundry, to, value });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    if (receipt.status === "success") {
        console.log(`Transferred ${formatEther(value)} ETH to ${to} : TX Hash: ${txHash}`);
        const balance = await publicClient.getBalance({ address: to });
        console.log(`New Balance of ${to}: ${formatEther(balance)} ETH`);

    } else {
        throw new Error(`Transaction failed: ${txHash}`);
    }
}

export async function sendEthFrom(walletAccounts: WalletAccounts, to: Address, amount: bigint | number | string, publicClient: PublicClient) {
    const value = typeof amount === "bigint" ? amount : parseEther(String(amount));
    const txHash = await walletAccounts.walletClient.sendTransaction({ account: walletAccounts.walletClient.account!, chain: foundry, to, value });
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
        return;
    }
    try {
        const output = execSync("make deploy-erc5564", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
    } catch (error: any) {
        console.error("❌ Failed to deploy ERC5564:", error.message);
        throw error;
    }
}

async function deployERC6538(publicClient: PublicClient) {
    if (await getCode(addressBook.ERC6538_ADDRESS, publicClient)) {
        return;
    }
    try {
        const output = execSync("make deploy-6538", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
    } catch (error: any) {
        console.error("❌ Failed to deploy ERC6538:", error.message);
        throw error;
    }
}

async function deployEntryPointV9(publicClient: PublicClient) {
    if (await getCode(addressBook.ENTRY_POINT_V9_ADDRESS, publicClient)) {
        return;
    }
    try {
        const output = execSync("make deploy-epv9", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
    } catch (error: any) {
        console.error("❌ Failed to deploy EntryPoint V9:", error.message);
        throw error;
    }
}

async function deployPaymaster(publicClient: PublicClient) {
    if (await getCode(addressBook.PAYMASTER_V3_V9_ADDRESS, publicClient)) {
        return;
    }
    try {
        const output = execSync("make deploy-paymaster", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
    } catch (error: any) {
        console.error("❌ Failed to deploy Paymaster:", error.message);
        throw error;
    }
}

async function deployErc20(publicClient: PublicClient) {
    if (await getCode(addressBook.MOCK_ERC20_ADDRESS, publicClient)) {
        return;
    }
    try {
        const output = execSync("make deploy-mock-erc20", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
    } catch (error: any) {
        console.error("❌ Failed to deploy Mock ERC20:", error.message);
        throw error;
    }
}

async function deploy7702(publicClient: PublicClient) {
    if (await getCode(addressBook.IMPLEMENTATION_7702_ADDRESS, publicClient)) {
        return;
    }
    try {
        const output = execSync("make deploy-7702", { encoding: "utf-8", cwd: process.cwd() });
        console.log(output);
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
