import { createKeys } from "./helpers/createKeys";

// ------------------------------------------------------------------------------------
//
//                         Create Spending and Viewing Keys
//
// ------------------------------------------------------------------------------------

const main = () => {
    const keys = createKeys();
    console.log(keys);
};

// Call it immediately
main();
