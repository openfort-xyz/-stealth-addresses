import { Hex, toHex, keccak256 } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";

export async function computeSharedSecret(ephemeralPrivateKey: Hex, viewingPublicKey: Hex): Promise<Hex> {
    const shared: Uint8Array = secp256k1.getSharedSecret(
        ephemeralPrivateKey.slice(2),
        viewingPublicKey.slice(2),
        true
    );

    const sharedSecretX: Uint8Array = shared.slice(1);
    return toHex(sharedSecretX);
}

export async function hashSharedSecret(sharedSecretX: Hex): Promise<Hex> {
    return keccak256(sharedSecretX);
}

export async function getViewTag(sharedSecretHash: Hex): Promise<Hex> {
    return sharedSecretHash.slice(0, 4) as Hex;
}
