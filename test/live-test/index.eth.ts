import { createKeyPair } from "./utils/createKeys";
import { Listener } from "../../src/utils/listener";
import { accounts, type Account } from "./clients/walletsClient";

// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

const listener = new Listener();

const main = async () => {
    const ephemeralKey = await createKeyPair("Ephemeral Key");
}

main().catch(console.error);
