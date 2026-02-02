import { abis } from "../../src/data/abis"
import { _announce } from "./utils/announce";
import { accounts } from "./clients/walletsClient";
import { Listener } from "../../src/utils/listener";
import { privateKeyToAccount } from "viem/accounts";
import { constants } from "../../src/data/constants";
import { parseData } from "../../src/helpers/parseData";
import { addressBook } from "../../src/data/addressBook";
import { PaymasterData } from "./data/paymasterConstants";
import { _attachAccounts } from "./utils/authorizeAccount";
import { createMetaData } from "../../src/helpers/createMetaData";
import { _registerMetaAddress } from "./utils/registerMetaAddress";
import { _announceAndSendERC20 } from "./utils/announceAndSendERC20";
import { Hex, concat, Address, parseEther, formatEther } from "viem";
import { createKeyPair, KeyPair, createKeys } from "./utils/createKeys";
import { computeStealthPublicKeyAndAddress } from "../../src/helpers/computeStealthPublicKey";
import { computeSharedSecret, hashSharedSecret, getViewTag } from "./utils/computeSharedSecret";
import { registerPair, getStealthMetaAddress, decodeStealthMetaAddress } from "../../src/helpers/erc6538";
import { optimismSepolia } from "viem/chains";
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

    await _attachAccounts(aliceAccount, paymasterSignerAccount);
    await _attachAccounts(bobAccount, paymasterSignerAccount);

    await _registerMetaAddress(bobAccount, paymasterSignerAccount, stealthMetaAddress);

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

    const announceReceipt = await _announceAndSendERC20(aliceAccount, paymasterSignerAccount, stealthAddress, ephemeralKey.publicKey, metaData, stealthAddress, parseEther('10'));

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
