import { Address, Hex } from "viem";

const SCHEME_ID: bigint = 1n;

const ETH_TRANSACTION_SELECTOR: Hex = "0xeeeeeeee";

const ETH_ADDRESS: Address = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";

export const constants = {
    SCHEME_ID,
    ETH_TRANSACTION_SELECTOR,
    ETH_ADDRESS
};
