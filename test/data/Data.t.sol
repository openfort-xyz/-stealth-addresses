// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Etch } from "./Etch.t.sol";
import { IERC5564Announcer } from "contracts/interfaces/IERC5564.sol";
import { IERC6538Registry } from "contracts/interfaces/IERC6538.sol";

abstract contract Data is Etch {
    // ------------------------------------------------------------------------------------
    //
    //                                    Structs
    //
    // ------------------------------------------------------------------------------------

    // Stealth Address struct
    struct StealthAddress {
        uint256 schemeId;
        bytes stealthAddress;
        bytes ephemeralPubKey;
        bytes metadata;
    }

    // ------------------------------------------------------------------------------------
    //
    //                                   Storage
    //
    // ------------------------------------------------------------------------------------

    // ERC5564_ADDRESS
    IERC5564Announcer internal announcer;
    // ERC6538_ADDRESS
    IERC6538Registry internal registry;

    // Spending keyspair
    uint256 internal __SPENDING_PRIVATE_KEYS = vm.envUint("SPENDING_PRIVATE_KEYS");
    bytes internal __SEPNDIG_PUBLIC_KEYS = vm.envBytes("SEPNDIG_PUBLIC_KEYS");
    address internal __SEPNDIG_ADDRESS = vm.addr(__SPENDING_PRIVATE_KEYS);

    // Viewing keyspair
    uint256 internal __VIEWING_PRIVATE_KEYS = vm.envUint("VIEWING_PRIVATE_KEYS");
    bytes internal __VIEWING_PUBLIC_KEYS = vm.envBytes("VIEWING_PUBLIC_KEYS");
    address internal __VIEWING_ADDRESS = vm.addr(__VIEWING_PRIVATE_KEYS);

    // Alice
    uint256 internal __ALICE_PRIVATE_KEYS;
    address internal __ALICE_ADDRESS;

    function setUp() public virtual {
        _ethc();
        _label();
        announcer = IERC5564Announcer(ERC5564_ADDRESS);
        registry = IERC6538Registry(ERC6538_ADDRESS);

        (__ALICE_ADDRESS, __ALICE_PRIVATE_KEYS) = makeAddrAndKey("alice");
    }
}
