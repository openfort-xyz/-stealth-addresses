import { Hex } from "viem";
import { createKeyPair } from "./utils/createKeys";
import { Listener } from "../../src/utils/listener";
import { privateKeyToAccount } from "viem/accounts";
import { _attachAccounts } from "./utils/authorizeAccount";
import { accounts, type Account } from "./clients/walletsClient";
// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

// Paymaster signer owner account
const paymasterSignerAccount = privateKeyToAccount(process.env.PAYMASTER_SIGNER_PRIVATE_KEY! as Hex);

const listener = new Listener();

const main = async () => {
    const ephemeralKey = await createKeyPair("Ephemeral Key");

    const aliceAccount = await accounts.ALICE_7702_ACCOUNT();
    const bobAccount = await accounts.BOB_7702_ACCOUNT();

    await _attachAccounts(aliceAccount, paymasterSignerAccount);
    await _attachAccounts(bobAccount, paymasterSignerAccount);
}

main().catch(console.error);
