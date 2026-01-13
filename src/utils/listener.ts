import { subscriptionConfig as cfg } from "./config";
import { eventsToWatch, type EventDefinition, type LogFormatter } from "./events";
import { Abi, Address, createPublicClient, getAbiItem, http, type AbiEvent, type Chain } from "viem";
import { type StealthMetaData } from "@/helpers/parseData";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
type PaymasterFilter = Address | Address[];

export class Listener {
    public async lastBlock(chain: Chain, rpcUrl?: string): Promise<{ chainId: number; chainName: string; blockNumber: bigint }> {
        const client = this.buildClient(chain, rpcUrl);
        const blockNumber = await client.getBlockNumber();
        return { chainId: chain.id, chainName: chain.name, blockNumber };
    }

    public async eventSubscription(opts: {
        chain: Chain;
        address?: Address;
        paymaster?: PaymasterFilter;
        rpcUrl?: string;
        fromBlock?: bigint;
    }): Promise<StealthMetaData> {
        const client = this.buildClient(opts.chain, opts.rpcUrl);
        const unsubscribers: Array<() => void> = [];
        let resolveOnce: (value: StealthMetaData) => void = () => {};
        let rejectOnce: (error: Error) => void = () => {};
        let resolved = false;
        let timeoutId: NodeJS.Timeout | undefined;
        const fromBlock = opts.fromBlock ?? await client.getBlockNumber();

        const stopAll = () => {
            for (const stop of unsubscribers) stop();
        };

        const outputPromise = new Promise<StealthMetaData>((resolve, reject) => {
            resolveOnce = resolve;
            rejectOnce = reject;
        });

        for (const def of eventsToWatch) {
            await sleep(cfg.startupStaggerMs);

            const address = opts.address ?? def.addressResolver;
            const args = this.buildEventArgs(def, opts.paymaster);

            if (cfg.debug) {
                console.log(`[subscribe] ${opts.chain.name} -> ${def.eventName} @ ${address}` + (args ? ` args=${JSON.stringify(args)}` : " (no args)"));
            }

            const pastLogs = await client.getContractEvents({
                address,
                abi: def.abi as Abi,
                eventName: def.eventName as any,
                ...(args ? { args } : {}),
                fromBlock,
            });
            if (pastLogs.length > 0) {
                const onLogs = this.onLogsFactory(def, opts.chain.name);
                onLogs(pastLogs);
                return (pastLogs[pastLogs.length - 1]?.args ?? {}) as StealthMetaData;
            }

            const onLogs = this.onLogsFactory(def, opts.chain.name);
            const unwatch = client.watchContractEvent({
                address,
                abi: def.abi as Abi,
                eventName: def.eventName as any,
                ...(args ? { args } : {}),
                onLogs: (logs) => {
                    onLogs(logs);
                    if (!resolved && logs.length > 0) {
                        resolved = true;
                        if (timeoutId) clearTimeout(timeoutId);
                        stopAll();
                        resolveOnce((logs[0]?.args ?? {}) as StealthMetaData);
                    }
                },
                onError: async () => { await sleep(cfg.retryDelayMs); },
                poll: true,
                pollingInterval: cfg.pollingIntervalMs,
            });

            unsubscribers.push(unwatch);
        }

        if (cfg.timeoutMs && cfg.timeoutMs > 0) {
            timeoutId = setTimeout(() => {
                stopAll();
                if (!resolved) {
                    rejectOnce(new Error("Event subscription timed out"));
                }
            }, cfg.timeoutMs);
        }

        return outputPromise;
    }

    private onLogsFactory(def: EventDefinition, chainName: string) {
        const formatter: LogFormatter | undefined = def.format;
        return (logs: any[]) => {
            for (const log of logs) {
                if (formatter) {
                    formatter(log, { chainName, eventName: def.eventName });
                } else {
                    this.defaultFormat(def, chainName, log);
                }
            }
        };
    }

    private defaultFormat(def: EventDefinition, chainName: string, log: any) {
        const tx = log.transactionHash ?? '';
        const args = log.args ?? {};
        console.log(`[${chainName}] ${def.eventName} ${tx} ${JSON.stringify(args)}`.trim());
    }

    private buildEventArgs(def: EventDefinition, paymaster?: PaymasterFilter) {
        if (!paymaster) return undefined;
        const ev = getAbiItem({ abi: def.abi, name: def.eventName }) as AbiEvent | undefined;
        const hasPaymaster = !!ev?.inputs?.some(i => i.name === 'paymaster' && i.type === 'address');
        if (!hasPaymaster) return undefined;
        const list = Array.isArray(paymaster) ? paymaster : [paymaster];
        return { paymaster: list as readonly Address[] };
    }

    private buildClient(chain: Chain, rpcUrl?: string) {
        const resolvedRpcUrl = rpcUrl ?? process.env.RPC_URL ?? process.env.RPC_URL_ANVIL;
        if (!resolvedRpcUrl) {
            throw new Error("RPC_URL or RPC_URL_ANVIL is required");
        }
        return createPublicClient({
            chain,
            transport: http(resolvedRpcUrl),
        });
    }
}
