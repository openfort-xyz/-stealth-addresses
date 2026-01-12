import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, encodeAbiParameters } from "viem";

function normalizeHex(arg: string): string {
    return arg.startsWith("0x") ? arg.slice(2) : arg;
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        process.stderr.write(
            "usage: computeStealthPublicKey <hashedSharedSecretX> <spendingPublicKey>\n"
        );
        process.exit(1);
    }

    const hashHex = normalizeHex(args[0]);
    const spendHex = normalizeHex(args[1]);

    if (hashHex.length !== 64) {
        process.stderr.write("invalid hashedSharedSecretX length\n");
        process.exit(1);
    }
    if (spendHex.length !== 66 && spendHex.length !== 130) {
        process.stderr.write("invalid spending public key length\n");
        process.exit(1);
    }

    const scalar = BigInt(`0x${hashHex}`) % secp256k1.CURVE.n;
    if (scalar === 0n) {
        process.stderr.write("invalid scalar derived from shared secret hash\n");
        process.exit(1);
    }

    const spendPoint = secp256k1.ProjectivePoint.fromHex(spendHex);
    const sharedPoint = secp256k1.ProjectivePoint.BASE.multiply(scalar);
    const stealthPoint = spendPoint.add(sharedPoint);

    const stealthCompressed = stealthPoint.toRawBytes(true);
    const stealthUncompressed = stealthPoint.toRawBytes(false);
    const addrHash = keccak_256(stealthUncompressed.slice(1));
    const addressHex = bytesToHex(addrHash.slice(12));
    const stealthCompressedHex = bytesToHex(stealthCompressed);

    const encoded = encodeAbiParameters(
        [{ type: "bytes" }, { type: "address" }],
        [stealthCompressedHex, addressHex]
    );
    process.stdout.write(encoded);
}

main();
