// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Data } from "test/data/Data.t.sol";
import { console2 as console } from "lib/forge-std/src/console2.sol";

contract StealthMetaAddressLength is Data {
    // ERC6538Registry instance
    bytes stealthMetaAddress;

    function test_stealt_meta_address_length() external {
        stealthMetaAddress = abi.encodePacked(__SPENDING_PUBLIC_KEYS, __VIEWING_PUBLIC_KEYS);

        console.log("Length:", stealthMetaAddress.length);
    }
}
