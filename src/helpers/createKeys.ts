// createKeys.ts

import { Hex, toHex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";

export interface KeyPair {
    name: string;
    privateKey: Hex;
    publicKey: Hex;
}

export async function createKeys(): Promise<KeyPair[]> {
    const spendingPrivateKey = generatePrivateKey();
    const viewingPrivateKey = generatePrivateKey();

    const p_spend: KeyPair = {
        name: "Spending Private Key",
        privateKey: spendingPrivateKey,
        publicKey: await getPublicKeyFromPrivateKey(spendingPrivateKey),
    };

    const p_view: KeyPair = {
        name: "Viewing Private Key",
        privateKey: viewingPrivateKey,
        publicKey: await getPublicKeyFromPrivateKey(viewingPrivateKey),
    };

    return [p_spend, p_view];
}

async function getPublicKeyFromPrivateKey(privateKey: Hex): Promise<Hex> {
    return toHex(
        secp256k1.getPublicKey(privateKey.slice(2), true)
    );
}
