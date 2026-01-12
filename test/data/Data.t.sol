// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Etch } from "./Etch.t.sol";
import { IERC5564Announcer } from "contracts/interfaces/IERC5564.sol";
import { IERC6538Registry } from "contracts/interfaces/IERC6538.sol";
import { ERC20Mock } from "lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";

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
    bytes internal __SPENDING_PUBLIC_KEYS = vm.envBytes("SPENDING_PUBLIC_KEYS");
    address internal __SPENDING_ADDRESS = vm.addr(__SPENDING_PRIVATE_KEYS);

    // Viewing keyspair
    uint256 internal __VIEWING_PRIVATE_KEYS = vm.envUint("VIEWING_PRIVATE_KEYS");
    bytes internal __VIEWING_PUBLIC_KEYS = vm.envBytes("VIEWING_PUBLIC_KEYS");
    address internal __VIEWING_ADDRESS = vm.addr(__VIEWING_PRIVATE_KEYS);

    // Paymaster Keys
    uint256 internal __PAYMASTER_OWNER = vm.envUint("PAYMASTER_OWNER");
    address internal __PAYMASTER_OWNER_ADDRESS = vm.addr(__PAYMASTER_OWNER);
    uint256 internal __PAYMASTER_MANAGER = vm.envUint("PAYMASTER_MANAGER");
    uint256 internal __PAYMASTER_SIGNER = vm.envUint("PAYMASTER_SIGNER");
    // Alice
    uint256 internal __ALICE_PRIVATE_KEYS;
    address internal __ALICE_ADDRESS;

    // ERC20 Mock Tokens
    ERC20Mock internal erc20mock;

    function setUp() public virtual {
        _ethc();
        _label();
        announcer = IERC5564Announcer(ERC5564_ADDRESS);
        registry = IERC6538Registry(ERC6538_ADDRESS);

        (__ALICE_ADDRESS, __ALICE_PRIVATE_KEYS) = makeAddrAndKey("alice");

        erc20mock = new ERC20Mock();
    }
}
