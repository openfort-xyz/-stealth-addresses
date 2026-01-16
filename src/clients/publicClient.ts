import { createPublicClient, http, type PublicClient } from "viem";
import { foundry } from "viem/chains";

import "dotenv/config"
import dotenv from "dotenv";
dotenv.config();

const DEFAULT_RPC_URL: string = process.env.RPC_URL_ANVIL! as string;

export async function getPublicClient(rpcUrl: string = process.env.RPC_URL ?? DEFAULT_RPC_URL): Promise<PublicClient> {
    return createPublicClient({
        chain: foundry,
        transport: http(rpcUrl),
    });
}
