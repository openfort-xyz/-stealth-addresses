import "dotenv/config";
import { abis } from "@/data/abis";
import { foundry } from "viem/chains";
import { constants } from "@/data/constants";
import { addressBook } from "@/data/addressBook";
import { anvilClient } from "@/clients/anvilClient";
import { type WalletAccounts } from "@/clients/walletsClient";
import { Address, Hex, concat, encodeFunctionData } from "viem";


export async function registerPair(walletAccounts: WalletAccounts[]) {
    const stealthMetaAddress = concat([
        walletAccounts[0].keyPair.publicKey,
        walletAccounts[1].keyPair.publicKey,
    ]) as Address;

    const txHash = await walletAccounts[0].walletClient.sendTransaction({
        account: walletAccounts[0].walletClient.account!,
        to: addressBook.ERC6538_ADDRESS,
        data: encodeFunctionData({
            abi: abis.ABI_ERC6538,
            functionName: 'registerKeys',
            args: [constants.SCHEME_ID as bigint, stealthMetaAddress]
        }),
        chain: foundry
    });
    const receipt = await anvilClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status === 'success') {
        console.log('Transaction hash:', receipt.transactionHash)
    } else {
        console.log('\n=== Transaction Failed ===')
        console.log('Receipt:', receipt)
    }
}

export async function getStealthMetaAddress(address: Address): Promise<Hex> {
    return await anvilClient.readContract({
        address: addressBook.ERC6538_ADDRESS,
        abi: abis.ABI_ERC6538,
        functionName: 'stealthMetaAddressOf',
        args: [address, constants.SCHEME_ID as bigint]
    });
}

export async function decodeStealthMetaAddress(stealthMetaAddress: Hex): Promise<{ spendingPublicKey: Hex; viewingPublicKey: Hex }> {
    const body = stealthMetaAddress.slice(2);
    const spendingPublicKey: Hex = `0x${body.slice(0, 66)}`;
    const viewingPublicKey: Hex = `0x${body.slice(66, 132)}`;
    return { spendingPublicKey, viewingPublicKey };
}
