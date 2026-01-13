import "dotenv/config";
import { foundry } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { Hex, createWalletClient, publicActions, http } from "viem";

const ANVIL_ACCOUNT = privateKeyToAccount(process.env.PRIVATE_KEY_ANVIL! as Hex);

export const anvilClient = createWalletClient({
    chain: foundry,
    account: ANVIL_ACCOUNT,
    transport: http(process.env.RPC_URL_ANVIL! as string)
}).extend(publicActions);
