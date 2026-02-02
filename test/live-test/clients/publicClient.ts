import { optimismSepolia } from "viem/chains";
import { createPublicClient, http, type PublicClient, type HttpTransport } from "viem";


export async function getPublicClient(): Promise<PublicClient<HttpTransport, typeof optimismSepolia>> {
    return createPublicClient({
        chain: optimismSepolia,
        transport: http(optimismSepolia.rpcUrls.default.http[0]),
    });
}
