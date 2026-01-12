import "dotenv/config";
import { sendEth } from "@/helpers/preConditions";
import { preConditions } from "@/helpers/preConditions";
import { getPublicClient } from "@/clients/publicClient";
import { createKeys, createKeyPair, type KeyPair } from "@/helpers/createKeys";
import { getWalletAccounts, type WalletAccounts } from "@/clients/walletsClient";
// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

const main = async () => {
    const keys: KeyPair[] = await createKeys();
    keys.push(await createKeyPair("Alice"));
    keys.push(await createKeyPair("Ephemeral Key"));

    const walletAccounts: WalletAccounts[] = await getWalletAccounts(keys);
    // console.log(walletAccounts);

    const publicClient = await getPublicClient();
    const blockNumber = await publicClient.getBlockNumber();
    console.log("Current Block Number:", blockNumber);

    await preConditions(walletAccounts[3].walletClient.account!.address, 0.8, publicClient);

};

// Call it immediately
main().catch(console.error);
