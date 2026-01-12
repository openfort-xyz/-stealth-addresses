import { createKeys } from "./helpers/createKeys";

// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

const main = async () => {
    const keys = await createKeys();
    console.log(keys);
};

// Call it immediately
main().catch(console.error);
