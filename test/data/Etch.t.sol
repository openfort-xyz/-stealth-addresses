// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Test } from "lib/forge-std/src/Test.sol";
import { Constants } from "../data/Constants.sol";

abstract contract Etch is Test, Constants {
    // ------------------------------------------------------------------------------------
    //
    //                        Helpers for Contracts and Accounts
    //
    // ------------------------------------------------------------------------------------

    // Etch ERC5564 and ERC6538 bytecode at their canonical addresses
    function _ethc() internal {
        vm.etch(ERC5564_ADDRESS, ERC5564_BYTECODE);
        vm.etch(ERC6538_ADDRESS, ERC6538_BYTECODE);
    }

    // Label ERC5564 and ERC6538 canonical addresses
    function _label() internal {
        vm.label(ERC5564_ADDRESS, "ERC5564-Announcer");
        vm.label(ERC6538_ADDRESS, "ERC6538-Registry");
    }

    // Etch contract at _account with implementation _implementation using EIP-7702
    function _etch7702(address _account, address _implementation) internal {
        vm.etch(_account, abi.encodePacked(bytes3(0xef0100), address(_implementation)));
    }
}
