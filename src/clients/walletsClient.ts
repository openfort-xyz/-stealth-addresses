import "dotenv/config";
import { foundry } from "viem/chains";
import { KeyPair } from "@/helpers/createKeys";
import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, Hex, http, type WalletClient, publicActions } from "viem";

export interface WalletAccounts {
    keyPair: KeyPair;
    walletClient: WalletClient;
}

export function createWallet(privateKey: Hex, rpcUrl: string): WalletClient {
    return createWalletClient({
        account: privateKeyToAccount(privateKey),
        chain: foundry,
        transport: http(rpcUrl),
    }).extend(publicActions);
}
export async function getWalletAccounts(keyPairs: KeyPair[], rpcUrl?: string): Promise<WalletAccounts[]> {
    const resolvedRpcUrl = rpcUrl ?? process.env.RPC_URL ?? process.env.RPC_URL_ANVIL;
    if (!resolvedRpcUrl) {
        throw new Error("RPC_URL or RPC_URL_ANVIL is required");
    }

    return keyPairs.map((keyPair) => {
        const walletClient = createWallet(keyPair.privateKey, resolvedRpcUrl);
        return { keyPair, walletClient };
    });
}

export async function getWalletClients(keyPairs: KeyPair[], rpcUrl?: string): Promise<WalletClient[]> {
    const accounts = await getWalletAccounts(keyPairs, rpcUrl);
    return accounts.map(({ walletClient }) => walletClient);
}
