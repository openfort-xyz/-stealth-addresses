import { abis } from "../../src/data/abis"
import { _announce } from "./utils/announce";
import { optimismSepolia } from "viem/chains";
import { accounts } from "./clients/walletsClient";
import { Listener } from "../../src/utils/listener";
import { privateKeyToAccount } from "viem/accounts";
import { constants } from "../../src/data/constants";
import { parseData } from "../../src/helpers/parseData";
import { addressBook } from "../../src/data/addressBook";
import { PaymasterData } from "./data/paymasterConstants";
import { _attachAccounts } from "./utils/authorizeAccount";
import { _sendUserOp, CallDataType } from "./utils/sendUserOp";
import { createMetaData } from "../../src/helpers/createMetaData";
import { _registerMetaAddress } from "./utils/registerMetaAddress";
import { decodeStealthMetaAddress } from "../../src/helpers/erc6538";
import { _announceAndSendERC20 } from "./utils/announceAndSendERC20";
import { createKeyPair, KeyPair, createKeys } from "./utils/createKeys";
import { Hex, concat, Address, parseEther, formatEther, encodeFunctionData } from "viem";
import { computeStealthPublicKeyAndAddress } from "../../src/helpers/computeStealthPublicKey";
import { computeSharedSecret, hashSharedSecret, getViewTag } from "./utils/computeSharedSecret";
// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

// Paymaster signer owner account
const paymasterSignerAccount = privateKeyToAccount(process.env.PAYMASTER_SIGNER! as Hex);

const listener = new Listener();

const main = async () => {
    const ephemeralKey = await createKeyPair("Ephemeral Key");
    const stealthKeyPair: KeyPair[] = await createKeys();

    const stealthMetaAddress = concat([
        stealthKeyPair[0].publicKey,
        stealthKeyPair[1].publicKey,
    ]) as Address;

    const aliceAccount = await accounts.ALICE_7702_ACCOUNT();
    const bobAccount = await accounts.BOB_7702_ACCOUNT();

    await _sendUserOp(aliceAccount, paymasterSignerAccount, CallDataType.MINT_AND_APPROVE);
    await _sendUserOp(bobAccount, paymasterSignerAccount, CallDataType.MINT_AND_APPROVE);

    await _sendUserOp(bobAccount, paymasterSignerAccount, CallDataType.REGISTER_KEYS, stealthMetaAddress);

    // Small delay to ensure RPC has indexed the event
    await new Promise(resolve => setTimeout(resolve, 2000));

    const { spendingPublicKey, viewingPublicKey } = await decodeStealthMetaAddress(stealthMetaAddress);
    const sharedSecretX = await computeSharedSecret(ephemeralKey.privateKey, viewingPublicKey);
    const sharedSecretHash = await hashSharedSecret(sharedSecretX);
    const viewTag = await getViewTag(sharedSecretHash);

    const { stealthPublicKey, stealthAddress } = await computeStealthPublicKeyAndAddress(sharedSecretHash, spendingPublicKey);

    const metaData = await createMetaData(
        viewTag,
        constants.TRANSFER_ERC20_SELECTOR,
        addressBook.MOCK_ERC20_ADDRESS,
        parseEther("10")
    );

    const announceReceipt = await _sendUserOp(bobAccount, paymasterSignerAccount, CallDataType.ANNOUNCE_AND_SEND_ERC20, stealthAddress, ephemeralKey.publicKey, metaData, stealthAddress, parseEther('10'));

    // Small delay to ensure RPC has indexed the event
    await new Promise(resolve => setTimeout(resolve, 2000));

    const output = await listener.eventSubscription({
        chain: optimismSepolia,
        address: addressBook.ERC5564_ADDRESS,
        fromBlock: announceReceipt.receipt.blockNumber,
        rpcUrl: 'https://sepolia.optimism.io',
    });

    const stealthPrivKey = await parseData([stealthKeyPair[0], stealthKeyPair[1]], output);

    if (!stealthPrivKey) return "Error";

    const stealthAccount = privateKeyToAccount(stealthPrivKey);

    console.log(":stealthAccount:", stealthAccount.address);

    const balanceStealthAddress = await aliceAccount.client.readContract({
        address: PaymasterData.ERC20_ADDRESS,
        abi: abis.ABI_ERC20,
        functionName: 'balanceOf',
        args: [stealthAddress]
    });
    console.log(":balanceStealthAddress:", formatEther(balanceStealthAddress));
}

main().catch(console.error);
