import { abis } from "@/data/abis";
import { foundry } from "viem/chains";
import { addressBook } from "@/data/addressBook";
import { Address, encodeFunctionData } from "viem";
import { anvilClient } from "@/clients/anvilClient";
import { WalletAccounts } from "@/clients/walletsClient";

export async function mint(to: Address, amount: bigint) {
    const txHash = await anvilClient.sendTransaction({
        account: anvilClient.account!,
        to: addressBook.MOCK_ERC20_ADDRESS,
        data: encodeFunctionData({
            abi: abis.ABI_ERC20,
            functionName: 'mint',
            args: [to, amount]
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

export async function transfer(walletAccounts: WalletAccounts, to: Address, amount: bigint) {
    const txHash = await walletAccounts.walletClient.sendTransaction({
        account: walletAccounts.walletClient.account!,
        to: addressBook.MOCK_ERC20_ADDRESS,
        data: encodeFunctionData({
            abi: abis.ABI_ERC20,
            functionName: 'transfer',
            args: [to, amount]
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

export async function balanceOf(address: Address): Promise<bigint> {
    return await anvilClient.readContract({
        address: addressBook.MOCK_ERC20_ADDRESS,
        abi: abis.ABI_ERC20,
        functionName: 'balanceOf',
        args: [address]
    });
}
