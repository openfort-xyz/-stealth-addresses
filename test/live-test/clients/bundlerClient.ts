import { Client, http } from "viem";
import { createBundlerClient, SmartAccount, type BundlerClient } from "viem/account-abstraction";


// Create Bundler Client
const BUNDLER_API_URL = "http://0.0.0.0:3000";

export async function getBundlerClient(client: Client, smartAccount: SmartAccount): Promise<BundlerClient<SmartAccount>> {
    return createBundlerClient({
        account: smartAccount,
        client,
        transport: http(BUNDLER_API_URL),
    });
}
