import { abis } from "@/data/abis";
import { foundry } from "viem/chains";
import { constants } from "@/data/constants";
import { addressBook } from "@/data/addressBook";
import { anvilClient } from "@/clients/anvilClient";
import { Address, Hex, encodeFunctionData } from "viem";
import { type WalletAccounts } from "@/clients/walletsClient";

export async function announce(
    walletAccounts: WalletAccounts,
    stealthAddress: Address,
    ephemeralPublicKey: Hex,
    metadata: Hex,
    schemeId: bigint = constants.SCHEME_ID
) {
    const txHash = await walletAccounts.walletClient.sendTransaction({
        account: walletAccounts.walletClient.account!,
        to: addressBook.ERC5564_ADDRESS,
        data: encodeFunctionData({
            abi: abis.ABI_ERC5564,
            functionName: 'announce',
            args: [schemeId, stealthAddress, ephemeralPublicKey, metadata]
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
