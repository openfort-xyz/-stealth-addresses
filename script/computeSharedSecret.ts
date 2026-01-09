import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";

function normalizeHex(arg: string): string {
    return arg.startsWith("0x") ? arg.slice(2) : arg;
}

function main(): void {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        process.stderr.write("usage: computeSharedSecret <privKeyHex> <pubKeyHex>\n");
        process.exit(1);
    }

    const privHex = normalizeHex(args[0]);
    const pubHex = normalizeHex(args[1]);

    if (privHex.length !== 64) {
        process.stderr.write("invalid private key length\n");
        process.exit(1);
    }
    if (pubHex.length !== 66 && pubHex.length !== 130) {
        process.stderr.write("invalid public key length\n");
        process.exit(1);
    }

    const shared = secp256k1.getSharedSecret(privHex, pubHex, false);
    const xy = shared.slice(1);
    process.stdout.write(`0x${bytesToHex(xy)}`);
}

main();
