// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Data } from "../data/Data.t.sol";
import { Vm } from "lib/forge-std/src/Vm.sol";
import { IPaymaster } from "../interfaces/IPaymaster.sol";
import { LibBytes } from "lib/solady/src/utils/LibBytes.sol";
import { SignatureCheckerLib } from "lib/solady/src/utils/SignatureCheckerLib.sol";
import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { IEntryPoint } from "lib/account-abstraction/contracts/interfaces/IEntryPoint.sol";
import { UserOperationLib } from "lib/account-abstraction/contracts/core/UserOperationLib.sol";
import { PackedUserOperation } from "lib/account-abstraction/contracts/interfaces/PackedUserOperation.sol";

abstract contract AAHelpers is Data {
    // Sponsor type of token used to sponsor user operation
    enum Sponsor_Type {
        ETH,
        ERC20
    }

    // Struct for calls
    struct Call {
        address target;
        uint256 value;
        bytes data;
    }

    // Mode constant ERC7281
    bytes32 internal constant mode_1 = bytes32(uint256(0x01000000000000000000) << (22 * 8));

    // Deposit ETH into the Paymaster
    function _depositPaymaster() internal {
        vm.prank(address(__PAYMASTER_OWNER_ADDRESS));
        IPaymaster(PAYMASTER_V3_V9_ADDRESS).deposit{ value: ETH_VALUE }();
    }

    // Add PAYMASTER_SIGNER as authorized signer
    function _addPaymasterSigner() internal {
        address paymaster = PAYMASTER_V3_V9_ADDRESS;
        address signer = vm.addr(__PAYMASTER_SIGNER);
        bytes32 signerSlot = keccak256(abi.encode(signer, uint256(2)));
        vm.store(paymaster, signerSlot, bytes32(uint256(1)));
    }

    // Get nonce for _sender from EntryPoint
    function _getNonce(address _sender) internal view returns (uint256) {
        return IEntryPoint(EP_V9_ADDRESS).getNonce(_sender, 0);
    }

    // Create UserOperation for AA transaction
    function _getUserOp(
        address _sender,
        uint256 _pk,
        bytes memory _callData,
        Sponsor_Type _sponsorType
    )
        internal
        view
        returns (PackedUserOperation[] memory)
    {
        PackedUserOperation[] memory u = new PackedUserOperation[](1);
        u[0].sender = _sender;
        u[0].nonce = _getNonce(_sender);
        u[0].accountGasLimits = bytes32(uint256(1_000_000 | (1_000_000 << 128)));
        u[0].gasFees = bytes32(uint256(1_000_000 | (1_000_000 << 128)));
        u[0].callData = _callData;

        if (_sponsorType == Sponsor_Type.ETH) {
            u[0].paymasterAndData = abi.encodePacked(
                PAYMASTER_V3_V9_ADDRESS, uint128(1_000_000), uint128(1_000_000), uint8(1), type(uint48).max, uint48(0)
            );

            bytes32 hash =
                SignatureCheckerLib.toEthSignedMessageHash(IPaymaster(PAYMASTER_V3_V9_ADDRESS).getHash(0, u[0]));

            (uint8 v, bytes32 r, bytes32 s) = vm.sign(__PAYMASTER_SIGNER, hash);

            u[0].paymasterAndData = abi.encodePacked(u[0].paymasterAndData, abi.encodePacked(r, s, v));

            bytes32 userOpHash = IEntryPoint(EP_V9_ADDRESS).getUserOpHash(u[0]);
            (v, r, s) = vm.sign(_pk, userOpHash);
            u[0].signature = abi.encode(uint8(0), abi.encodePacked(r, s, v));
        }

        return u;
    }

    // Helper to create Call struct
    function _createCall(address _target, uint256 _value, bytes memory _data) internal pure returns (Call memory call) {
        call = Call({ target: _target, value: _value, data: _data });
    }

    // Pack call data for execute function
    function _packCallData(bytes32 _mode, Call[] memory _calls) internal pure returns (bytes memory callData) {
        bytes memory executionData = abi.encode(_calls);
        callData = abi.encodeWithSelector(bytes4(keccak256("execute(bytes32,bytes)")), _mode, executionData);
    }

    // Relay UserOperation to EntryPoint
    function _relayUserOp(PackedUserOperation[] memory _userOps) internal {
        vm.prank(__PAYMASTER_OWNER_ADDRESS, __PAYMASTER_OWNER_ADDRESS);
        IEntryPoint(EP_V9_ADDRESS).handleOps(_userOps, payable(__PAYMASTER_OWNER_ADDRESS));
    }
}
