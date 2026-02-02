import { abis } from "../../../src/data/abis"
import { PrivateKeyAccount } from "viem/accounts";
import { UserOperation } from "viem/account-abstraction";
import { type Account } from "./../clients/walletsClient";
import { SignAuthorizationReturnType } from "viem/accounts";
import { PaymasterData } from "./../data/paymasterConstants";
import { pad, erc20Abi, toHex, encodeFunctionData, concat } from "viem";
import { formatUserOperationRequest, formatUserOperationGas, toPackedUserOperation } from "viem/account-abstraction";

export async function _attachAccounts(account: Account, paymasterSignerAccount: PrivateKeyAccount) {
    const authorization: SignAuthorizationReturnType = await account.client.signAuthorization(account.smartAccount.authorization!);

    // Get gas price from bundler
    const gasPrice = await account.client.estimateFeesPerGas()

    const calls = [
        {
            to: PaymasterData.ERC20_ADDRESS,
            value: 0n,
            data: encodeFunctionData({
                abi: abis.ABI_ERC20,
                functionName: 'approve',
                args: [
                    PaymasterData.PAYMASTER_ADDRESS_V9_ASYNC,
                    115792089237316195423570985008687907853269984665640564039457584007913129639935n
                ]
            }),
        },
    ];

    let userOp: UserOperation<'0.9'> = {
            sender: await account.smartAccount.getAddress(),
            nonce: await account.smartAccount.getNonce(),
            callData: await account.smartAccount.encodeCalls(calls),
            callGasLimit: 0n,
            verificationGasLimit: 0n,
            preVerificationGas: 0n,
            maxFeePerGas: gasPrice.maxFeePerGas,
            maxPriorityFeePerGas: gasPrice.maxPriorityFeePerGas,
            signature: await account.smartAccount.getStubSignature(),
            authorization,
        }


    // ------------------------------------------------------------------------------------
    //
    //                           Create Paymaster Stub Data
    //
    // ------------------------------------------------------------------------------------

    const paymasterStubData = concat([
            PaymasterData.MODE_ERC20,
            PaymasterData.COMBINED_BYTE_BASIC,
            PaymasterData.VALID_UNTIL,
            PaymasterData.VALID_AFTER,
            PaymasterData.ERC20_ADDRESS,
            pad(toHex(PaymasterData.POST_GAS_LIMIT), { size: 16 }),
            pad(toHex(BigInt(PaymasterData.EXCHANGE_RATE)), { size: 32 }),
            pad(toHex(PaymasterData.PAYMASTER_VALIDATION_GAS_LIMIT), { size: 16 }),
            PaymasterData.TREASURY,
        ]);

    userOp = {
        ...userOp,
        paymaster: PaymasterData.PAYMASTER_ADDRESS_V9_ASYNC,
        paymasterData: paymasterStubData,
        paymasterSignature: PaymasterData.DUMMY_PAYMASTER_SIGNATURE,
    }

    // ------------------------------------------------------------------------------------
    //
    //                              Estimate User Operation
    //
    // ------------------------------------------------------------------------------------

    const estimateResult = await account.bundler.request({
        method: 'eth_estimateUserOperationGas',
        params: [
            formatUserOperationRequest(userOp),
            account.smartAccount.entryPoint.address
        ],
    });

    console.log("estimateResult", estimateResult);
    userOp = {
        ...userOp,
        ...formatUserOperationGas(estimateResult),
    }

    // ------------------------------------------------------------------------------------
    //
    //                    Sign UserOp and Paymaster in Parallel
    //
    // ------------------------------------------------------------------------------------

    const [accountSignature, paymasterSignature] = await Promise.all([
        (async () => {
            return await account.smartAccount.signUserOperation(userOp);
        })(),

        (async () => {
            const paymasterHash = await account.client.readContract({
                address: PaymasterData.PAYMASTER_ADDRESS_V9_ASYNC,
                abi: abis.ABI_PAYMASTER_V3,
                functionName: 'getHash',
                args: [1, toPackedUserOperation(userOp)]
            });

            return await paymasterSignerAccount.signMessage({
                message: { raw: paymasterHash }
            });
        })()
    ]);

    userOp = {
        ...userOp,
        signature: accountSignature,
        paymasterData: concat([
            PaymasterData.MODE_ERC20,
            PaymasterData.COMBINED_BYTE_BASIC,
            PaymasterData.VALID_UNTIL,
            PaymasterData.VALID_AFTER,
            PaymasterData.ERC20_ADDRESS,
            pad(toHex(PaymasterData.POST_GAS_LIMIT), { size: 16 }),
            pad(toHex(BigInt(PaymasterData.EXCHANGE_RATE)), { size: 32 }),
            pad(toHex(PaymasterData.PAYMASTER_VALIDATION_GAS_LIMIT), { size: 16 }),
            PaymasterData.TREASURY,
        ]),
        paymasterSignature: paymasterSignature
    }

    // ------------------------------------------------------------------------------------
    //
    //                                Send User Operation
    //
    // ------------------------------------------------------------------------------------

    const finalUserOpHash = await account.bundler.request({
        method: 'eth_sendUserOperation',
        params: [
            formatUserOperationRequest(userOp),
            account.smartAccount.entryPoint.address
        ],
    });

    const receipt = await account.bundler.waitForUserOperationReceipt({ hash: finalUserOpHash })
    console.log('UserOperationReceipt:', receipt)
    console.log('Transaction hash:', receipt.receipt.transactionHash)
}
