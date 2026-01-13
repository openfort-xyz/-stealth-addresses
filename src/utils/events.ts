import { abis } from "@/data/abis";
import type { Abi, Address } from 'viem';
import { addressBook } from "@/data/addressBook";

export type LogFormatterCtx = { chainName: string; eventName: string };
export type LogFormatter = (log: any, ctx: LogFormatterCtx) => void;

export type EventDefinition = {
  eventName: string;
  abi: Abi;
  addressResolver: Address;
  format?: LogFormatter;
};


const fmtUserOperationEvent: LogFormatter = (log, { chainName, eventName }) => {
  const { schemeId, stealthAddress, caller, ephemeralPubKey, metadata } = log.args || {};
  console.log(
    `[schemeId=${schemeId}] stealthAddress=${stealthAddress} caller=${caller} ephemeralPubKey=${ephemeralPubKey} metadata=${metadata}`
  );
};

const fmtUserOperationRevertReason: LogFormatter = (log, { chainName, eventName }) => {
  const { userOpHash, sender, nonce, revertReason } = log.args || {};
  console.log(
    `[${chainName}] ${eventName} hash=${userOpHash} sender=${sender} nonce=${nonce} reason=${revertReason}`
  );
};

export const eventsToWatch: EventDefinition[] = [
  {
    eventName: 'Announcement',
    abi: abis.ABI_ERC5564,
    addressResolver: addressBook.ERC5564_ADDRESS,
    format: fmtUserOperationEvent,
  }
];
