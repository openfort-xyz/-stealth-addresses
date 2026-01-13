import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { Address, bytesToHex, Hex } from "viem";

export async function computeStealthPublicKeyAndAddress(
    sharedSecretHash: Hex,
    spendingPublicKey: Hex
): Promise<{ stealthPublicKey: Hex, stealthAddress: Address }> {
    const scalar = BigInt(sharedSecretHash) % secp256k1.CURVE.n;
    if (scalar === 0n) {
        throw new Error("Invalid scalar derived from shared secret hash");
    }

    const spendPoint = secp256k1.ProjectivePoint.fromHex(spendingPublicKey.slice(2));

    const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(scalar);

    const stealthPoint = spendPoint.add(sharedPoint);

    const stealthCompressed = stealthPoint.toRawBytes(true);
    const stealthUncompressed = stealthPoint.toRawBytes(false);

    const addrHash = keccak_256(stealthUncompressed.slice(1));
    const stealthAddress = `0x${bytesToHex(addrHash.slice(12))}` as Address;
    const stealthPublicKey = `0x${bytesToHex(stealthCompressed)}` as Hex;

    return { stealthPublicKey, stealthAddress };
}
