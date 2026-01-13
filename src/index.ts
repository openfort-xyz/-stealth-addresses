import "dotenv/config";
import { Hex,parseEther } from "viem";
import { constants } from "@/data/constants";
import { preConditions } from "@/helpers/preConditions";
import { getPublicClient } from "@/clients/publicClient";
import { createMetaData } from "@/helpers/createMetaData";
import { createKeys, createKeyPair, type KeyPair } from "@/helpers/createKeys";
import { getWalletAccounts, type WalletAccounts } from "@/clients/walletsClient";
import { registerPair, getStealthMetaAddress, decodeStealthMetaAddress } from "@/helpers/erc6538";
import { computeSharedSecret, hashSharedSecret, getViewTag } from "@/helpers/computeSharedSecret";
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

    await preConditions(walletAccounts[0].walletClient.account!.address, 0.8, publicClient);

    await registerPair([walletAccounts[0], walletAccounts[1]]);
    const stealthMetaAddress: Hex = await getStealthMetaAddress(walletAccounts[0].walletClient.account!.address);
    console.log("stealthMetaAddress:", stealthMetaAddress);

    const {spendingPublicKey, viewingPublicKey } = await decodeStealthMetaAddress(stealthMetaAddress);
    const sharedSecretX = await computeSharedSecret(walletAccounts[walletAccounts.length - 1], viewingPublicKey);
    const sharedSecretHash = await hashSharedSecret(sharedSecretX);
    const viewTag = await getViewTag(sharedSecretHash);

    const metaData = await createMetaData(
      viewTag,
      constants.ETH_TRANSACTION_SELECTOR,
      constants.ETH_ADDRESS,
      parseEther("0.1")
  );
};

// Call it immediately
main().catch(console.error);
