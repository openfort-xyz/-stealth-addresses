// createKeys.ts

import { Hex, toHex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";

export interface KeyPair {
    name: string;
    privateKey: Hex;
    publicKey: Hex;
}

export async function createKeyPair(name: string): Promise<KeyPair> {
    const privateKey = generatePrivateKey();

    const keyPair: KeyPair = {
        name: name,
        privateKey: privateKey,
        publicKey: await getPublicKeyFromPrivateKey(privateKey),
    };

    return keyPair;
}

export async function createKeys(): Promise<KeyPair[]> {
    return [await createKeyPair("Spending Private Key"), await createKeyPair("Viewing Private Key")];
}

async function getPublicKeyFromPrivateKey(privateKey: Hex): Promise<Hex> {
    return toHex(
        secp256k1.getPublicKey(privateKey.slice(2), true)
    );
}
