import "dotenv/config";
import { type Client } from "viem";
import { optimismSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createOpenfortAccount } from "../openfort7702";
import { getBundlerClient } from "./../clients/bundlerClient";
import { type SmartAccount, type BundlerClient } from "viem/account-abstraction";
import { KeyPair, getPublicKeyFromPrivateKey } from "../utils/createKeys";
import { Hex, http, publicActions, walletActions, createClient } from "viem";

export interface Account {
    keyPair: KeyPair;
    client: Client;
    bundler: BundlerClient<SmartAccount>;
    smartAccount: SmartAccount;
}

const ALICE_PRIVATE_KEY: Hex = process.env.ALICE_PRIVATE_KEY! as Hex;
const BOB_PRIVATE_KEY: Hex = process.env.BOB_PRIVATE_KEY! as Hex;

async function _create7702Account(pK: Hex, name: string): Promise<Account> {
    const ownerAccount = privateKeyToAccount(pK);

    const keyPair: KeyPair = {
        name: name,
        privateKey: pK,
        publicKey: await getPublicKeyFromPrivateKey(pK),
    };

    const client = createClient({
        account: ownerAccount,
        chain: optimismSepolia,
        transport: http()
    })
        .extend(publicActions)
        .extend(walletActions);

    const smartAccount = await createOpenfortAccount({
        client,
        owner: ownerAccount,
    });

    const bundler = await getBundlerClient(client, smartAccount);

    const account: Account = {
        keyPair,
        client,
        bundler,
        smartAccount
    }

    return account
}

const ALICE_7702_ACCOUNT = async () => _create7702Account(ALICE_PRIVATE_KEY, "Alice");
const BOB_7702_ACCOUNT = async () => _create7702Account(BOB_PRIVATE_KEY, "Bob");

export const accounts = { ALICE_7702_ACCOUNT, BOB_7702_ACCOUNT };
