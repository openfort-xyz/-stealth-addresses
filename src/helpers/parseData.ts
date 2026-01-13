import { keccak_256 } from "@noble/hashes/sha3";
import { KeyPair } from "@/helpers/createKeys";
import { secp256k1 } from "@noble/curves/secp256k1";
import { mod } from "@noble/curves/abstract/modular";
import { Address, bytesToHex, Hex, hexToBytes } from "viem";

export interface StealthMetaData {
    schemeId: bigint;
    stealthAddress: Address;
    caller: Address;
    ephemeralPubKey: Hex;
    metadata: Hex;
}

export async function parseData(keyPairs: KeyPair[] , stealthMetaData: StealthMetaData): Promise<Hex | null>  {
    const spendingPrivHex = keyPairs[0].privateKey;
    const viewingPrivHex = keyPairs[1].privateKey;

    const metadataBytes = hexToBytes(stealthMetaData.metadata);
    const viewTag = metadataBytes[0];

    const shared = secp256k1.getSharedSecret(
        viewingPrivHex.slice(2),
        stealthMetaData.ephemeralPubKey.slice(2),
        true
    );
    const sharedX = shared.slice(1);
    const sharedHash = keccak_256(sharedX);
    const computedViewTag = sharedHash[0];

    if (computedViewTag !== viewTag) {
        return null;
    }

    const sharedHashHex = bytesToHex(sharedHash);
    const sharedScalar = BigInt(sharedHashHex);
    const spendingScalar = BigInt(spendingPrivHex);

    const stealthPriv = mod(spendingScalar + sharedScalar, secp256k1.CURVE.n);
    return `0x${stealthPriv.toString(16).padStart(64, "0")}` as Hex;
}
