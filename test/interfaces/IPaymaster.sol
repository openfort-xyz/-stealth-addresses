// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { PackedUserOperation } from "lib/account-abstraction/contracts/interfaces/PackedUserOperation.sol";

// Paymaster interface
interface IPaymaster {
    function deposit() external payable;
    function getHash(uint8 _mode, PackedUserOperation calldata _userOp) external view returns (bytes32);
}
