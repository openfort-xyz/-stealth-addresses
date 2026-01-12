import { secp256k1 } from "@noble/curves/secp256k1";
import { mod } from "@noble/curves/abstract/modular";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "viem";

function normalizeHex(arg: string): string {
    return arg.startsWith("0x") ? arg.slice(2) : arg;
}

function zeroBytes32(): string {
    return "0x" + "0".repeat(64);
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 4) {
        process.stderr.write(
            "usage: detectPayment <spendingPrivKey> <viewingPrivKey> <ephemeralPubKey> <metadata>\n"
        );
        process.exit(1);
    }

    const spendingPrivHex = normalizeHex(args[0]);
    const viewingPrivHex = normalizeHex(args[1]);
    const ephemeralPubHex = normalizeHex(args[2]);
    const metadataHex = normalizeHex(args[3]);

    if (spendingPrivHex.length !== 64 || viewingPrivHex.length !== 64) {
        process.stderr.write("invalid private key length\n");
        process.exit(1);
    }
    if (ephemeralPubHex.length !== 66 && ephemeralPubHex.length !== 130) {
        process.stderr.write("invalid ephemeral public key length\n");
        process.exit(1);
    }
    if (metadataHex.length < 2 || metadataHex.length % 2 !== 0) {
        process.stderr.write("invalid metadata length\n");
        process.exit(1);
    }

    const metadataBytes = hexToBytes(`0x${metadataHex}`);
    const viewTag = metadataBytes[0];

    const shared = secp256k1.getSharedSecret(viewingPrivHex, ephemeralPubHex, true);
    const sharedX = shared.slice(1);
    const sharedHash = keccak_256(sharedX);
    const computedViewTag = sharedHash[0];

    if (computedViewTag !== viewTag) {
        process.stdout.write(zeroBytes32());
        return;
    }

    const sharedHashHex = bytesToHex(sharedHash);
    const sharedScalar = BigInt(sharedHashHex);
    const spendingScalar = BigInt(`0x${spendingPrivHex}`);

    const stealthPriv = mod(spendingScalar + sharedScalar, secp256k1.CURVE.n);
    const stealthPrivHex = `0x${stealthPriv.toString(16).padStart(64, "0")}`;
    process.stdout.write(stealthPrivHex);
}

main();
