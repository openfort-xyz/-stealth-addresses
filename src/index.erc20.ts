import "dotenv/config";
import { constants } from "@/data/constants";
import { announce } from "@/helpers/erc5564";
import { privateKeyToAccount } from "viem/accounts";
import { Hex, parseEther, formatEther } from "viem";
import { getPublicClient } from "@/clients/publicClient";
import { createMetaData } from "@/helpers/createMetaData";
import { mint, transfer, balanceOf } from "@/helpers/erc20";
import { parseData, type StealthMetaData } from "@/helpers/parseData";
import { preConditions, sendEth, sendEthFrom } from "@/helpers/preConditions";
import { createKeys, createKeyPair, type KeyPair } from "@/helpers/createKeys";
import { getWalletAccounts, type WalletAccounts } from "@/clients/walletsClient";
import { computeStealthPublicKeyAndAddress } from "@/helpers/computeStealthPublicKey";
import { registerPair, getStealthMetaAddress, decodeStealthMetaAddress } from "@/helpers/erc6538";
import { computeSharedSecret, hashSharedSecret, getViewTag } from "@/helpers/computeSharedSecret";

import { Listener } from "@/utils/listener";
import { foundry } from "viem/chains";
import { addressBook } from "@/data/addressBook";

// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

const listener = new Listener();


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
    await mint(walletAccounts[2].walletClient.account!.address, parseEther("1000"));

    await registerPair([walletAccounts[0], walletAccounts[1]]);
    const stealthMetaAddress: Hex = await getStealthMetaAddress(walletAccounts[0].walletClient.account!.address);
    console.log("stealthMetaAddress:", stealthMetaAddress);

    const { spendingPublicKey, viewingPublicKey } = await decodeStealthMetaAddress(stealthMetaAddress);
    const sharedSecretX = await computeSharedSecret(walletAccounts[walletAccounts.length - 1], viewingPublicKey);
    const sharedSecretHash = await hashSharedSecret(sharedSecretX);
    const viewTag = await getViewTag(sharedSecretHash);

    const metaData = await createMetaData(
        viewTag,
        constants.TRANSFER_ERC20_SELECTOR,
        addressBook.MOCK_ERC20_ADDRESS,
        parseEther("10")
    );

    const { stealthPublicKey, stealthAddress } = await computeStealthPublicKeyAndAddress(sharedSecretHash, spendingPublicKey);
    await sendEth(walletAccounts[2].walletClient.account!.address, 0.5, publicClient);
    await transfer(walletAccounts[2], stealthAddress, parseEther("10"));
    await announce(walletAccounts[2], stealthAddress, walletAccounts[walletAccounts.length - 1].keyPair.publicKey, metaData);

    const output = await listener.eventSubscription({
        chain: foundry,
        address: addressBook.ERC5564_ADDRESS,
    });

    const stealthPrivKey = await parseData([keys[0], keys[1]], output);

    if (!stealthPrivKey) return "Error";

    const stealthAccount = privateKeyToAccount(stealthPrivKey);

    console.log(":stealthAccount:", stealthAccount.address);
    const balanceStealthAddress = await balanceOf(stealthAccount.address);
    console.log(":balanceStealthAddress:", formatEther(balanceStealthAddress));

};

// Call it immediately
main().catch(console.error);
