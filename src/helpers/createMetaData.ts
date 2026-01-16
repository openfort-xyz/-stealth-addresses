import { Address, concat, Hex, pad, toHex } from "viem";

export async function createMetaData(
    viewTag: Hex,
    selector: Hex,
    assetAddress: Address,
    amount: bigint
): Promise<Hex> {
    return concat([
        pad(viewTag, { size: 1 }),
        pad(selector, { size: 4 }),
        assetAddress,
        pad(toHex(amount), { size: 32 })
    ]);
}
