import { getCode } from "viem/actions";
import { abis } from "../../../src/data/abis"
import { PrivateKeyAccount } from "viem/accounts";
import { constants } from "../../../src/data/constants";
import { UserOperation } from "viem/account-abstraction";
import { type Account } from "./../clients/walletsClient";
import { SignAuthorizationReturnType } from "viem/accounts";
import { addressBook } from "../../../src/data/addressBook";
import { PaymasterData } from "./../data/paymasterConstants";
import { pad, toHex, encodeFunctionData, concat, Address, Call, Hex } from "viem";
import { formatUserOperationRequest, formatUserOperationGas, toPackedUserOperation } from "viem/account-abstraction";

export enum CallDataType {
    MINT_AND_APPROVE,
    REGISTER_KEYS,
    ANNOUNCE_AND_SEND_ERC20,
}

// Openfort v0.9 implementation
const OPENFORT_ADDRESS = "0x77020901f40BE88Df754E810dA9868933787652B" as Address;

async function _getCallData(
    account: Account,
    callDataType: CallDataType,
    stealthMetaAddress?: Hex,
    ephemeralPublicKey?: Hex,
    metadata?: Hex,
    receiver?: Address,
    amount?: bigint,
    schemeId: bigint = constants.SCHEME_ID,
): Promise<Call[]> {
    switch (callDataType) {
        case CallDataType.MINT_AND_APPROVE: {
            return [
                {
                    to: PaymasterData.ERC20_ADDRESS,
                    value: 0n,
                    data: encodeFunctionData({
                        abi: abis.ABI_ERC20,
                        functionName: 'mint',
                        args: [
                            account.smartAccount.address,
                            1000000000000000000000n
                        ]
                    }),
                },
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
        }
        case CallDataType.REGISTER_KEYS: {
            if (!stealthMetaAddress) {
                throw new Error("stealthMetaAddress is required for REGISTER_KEYS");
            }
            return [
                {
                    to: addressBook.ERC6538_ADDRESS,
                    value: 0n,
                    data: encodeFunctionData({
                        abi: abis.ABI_ERC6538,
                        functionName: 'registerKeys',
                        args: [schemeId, stealthMetaAddress]
                    }),
                },
            ];
        }
        case CallDataType.ANNOUNCE_AND_SEND_ERC20: {
            if (!receiver || !amount || !ephemeralPublicKey || !metadata) {
                throw new Error("receiver, amount, ephemeralPublicKey, and metadata are required for ANNOUNCE_AND_SEND_ERC20");
            }
            return [
                {
                    to: PaymasterData.ERC20_ADDRESS,
                    value: 0n,
                    data: encodeFunctionData({
                        abi: abis.ABI_ERC20,
                        functionName: 'transfer',
                        args: [receiver, amount]
                    }),
                },
                {
                    to: addressBook.ERC5564_ADDRESS,
                    value: 0n,
                    data: encodeFunctionData({
                        abi: abis.ABI_ERC5564,
                        functionName: 'announce',
                        args: [schemeId, receiver, ephemeralPublicKey, metadata]
                    }),
                },
            ];
        }
        default: {
            throw new Error("Unknown CallDataType");
        }
    }
}

export async function _sendUserOp(
    account: Account,
    paymasterSignerAccount: PrivateKeyAccount,
    callDataType: CallDataType,
    stealthMetaAddress?: Hex,
    ephemeralPublicKey?: Hex,
    metadata?: Hex,
    receiver?: Address,
    amount?: bigint,
    schemeId: bigint = constants.SCHEME_ID,
) {
    const calls: Call[] = await _getCallData(
        account,
        callDataType,
        stealthMetaAddress,
        ephemeralPublicKey,
        metadata,
        receiver,
        amount,
        schemeId
    );

    const gasPrice = await account.client.estimateFeesPerGas()

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
    }

    let authorization: SignAuthorizationReturnType | undefined;

    const bytecode = await getCode(account.client, { address: account.smartAccount.address })

    if (bytecode) {
        const bc = bytecode.toLowerCase()
        // "0x" + "ef0100" + 20-byte address (40 hex chars)
        if (bc.startsWith("0xef0100") && bc.length >= 48) {
            const attachedAddress = "0x" + bc.slice(8, 48)
            if (attachedAddress.toLowerCase() === OPENFORT_ADDRESS.toLowerCase()) {
                console.log(`Account ${account.smartAccount.address} Already Authorized with ${attachedAddress}`);
            }
        }
    } else {
        authorization = await account.client.signAuthorization(account.smartAccount.authorization!);
    }

    if (authorization) {
        userOp = {
            ...userOp,
            authorization
        }
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

    return receipt;
}
