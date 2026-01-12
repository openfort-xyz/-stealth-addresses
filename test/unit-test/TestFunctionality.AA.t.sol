// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Helpers } from "../helpers/Helpers.t.sol";
import { console2 as console } from "lib/forge-std/src/console2.sol";
import { IERC5564Announcer } from "contracts/interfaces/IERC5564.sol";
import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import { PackedUserOperation } from "lib/account-abstraction/contracts/interfaces/PackedUserOperation.sol";

contract TestFunctionalityAA is Helpers {
    // ERC6538Registry instance
    bytes stealthMetaAddress;
    // Registered stealth meta-address
    bytes registeredStealthMetaAddress;
    // View tag
    bytes1 viewTag;
    // ERC6538Registry struct
    StealthAddress stealthAddressInfo;

    function setUp() public override {
        super.setUp();
        _deal(__SPENDING_ADDRESS, 10 ether);
        _deal(__ALICE_ADDRESS, 10 ether);
        _deal(__PAYMASTER_OWNER_ADDRESS, 10 ether);
        _mint(__ALICE_ADDRESS, 1000 ether);
        _depositPaymaster();
        _addPaymasterSigner();
        _etch7702(__ALICE_ADDRESS, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
        _etch7702(__SPENDING_ADDRESS, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
    }

    // Test registering stealth keys
    function test_registerKeys() external {
        _registerKeys();
        _assertRegisterKeys();
    }

    // Test announcing stealth address
    function test_announce_eth_transfer_aa() external {
        _registerKeys();
        _assertRegisterKeys();

        (, bytes memory viewingPublicKey) = _decodeStealthMetaAddress(registeredStealthMetaAddress);

        (, uint256 ephemeralPrivateKey, bytes memory ephemeralPublicKey) = _createEphemeralKeypair();

        bytes32 sharedSecretX = _computeSharedSecret(ephemeralPrivateKey, viewingPublicKey);

        bytes32 hashedX = _hashX(sharedSecretX);

        viewTag = _getViewTag(hashedX);

        (, address stealthAddress) = _computeStealthPublicKey(hashedX);

        bytes memory metaData = _createMetaData(viewTag, ETH_TRANSACTION_SELECTOR, ETH_ADDRESS, ETH_VALUE);

        bytes memory callDataAnnounce = abi.encodeWithSelector(
            IERC5564Announcer.announce.selector, SECP256K1_SCHEME_ID, stealthAddress, ephemeralPublicKey, metaData
        );

        Call[] memory calls = new Call[](2);

        calls[0] = _createCall(stealthAddress, ETH_VALUE, "");
        calls[1] = _createCall(address(announcer), 0, callDataAnnounce);

        PackedUserOperation[] memory userOps =
            _getUserOp(__ALICE_ADDRESS, __ALICE_PRIVATE_KEYS, _packCallData(mode_1, calls), Sponsor_Type.ETH);

        _etch7702(__ALICE_ADDRESS, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
        _relayUserOp(userOps);

        uint256 stealthPrivateKey = _deriveStealthPrivateKey(ephemeralPublicKey, metaData);

        address derivedStealthAddress = vm.addr(stealthPrivateKey);
        assertEq(stealthAddress, derivedStealthAddress, "stealth addresses do not match");
        assertEq(stealthAddress.balance, ETH_VALUE, "stealth address balance incorrect");

        Call[] memory call = new Call[](1);
        call[0] = _createCall(__SPENDING_ADDRESS, ETH_VALUE, "");

        userOps = _getUserOp(stealthAddress, stealthPrivateKey, _packCallData(mode_1, call), Sponsor_Type.ETH);

        _etch7702(stealthAddress, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
        _relayUserOp(userOps);

        assertEq(stealthAddress.balance, 0, "stealth address balance not zero after withdrawal");
        assertEq(
            __SPENDING_ADDRESS.balance, 10 ether + ETH_VALUE, "spending address balance incorrect after withdrawal"
        );
    }

    function test_announce_erc20_transfer_aa() external {
        _registerKeys();
        _assertRegisterKeys();
        (, bytes memory viewingPublicKey) = _decodeStealthMetaAddress(registeredStealthMetaAddress);

        (, uint256 ephemeralPrivateKey, bytes memory ephemeralPublicKey) = _createEphemeralKeypair();

        bytes32 sharedSecretX = _computeSharedSecret(ephemeralPrivateKey, viewingPublicKey);

        bytes32 hashedX = _hashX(sharedSecretX);

        viewTag = _getViewTag(hashedX);

        (, address stealthAddress) = _computeStealthPublicKey(hashedX);

        bytes memory metaData =
            _createMetaData(viewTag, IERC20.transfer.selector, address(erc20mock), ERC20_TOKEN_VALUE);

        bytes memory callDataAnnounce = abi.encodeWithSelector(
            IERC5564Announcer.announce.selector, SECP256K1_SCHEME_ID, stealthAddress, ephemeralPublicKey, metaData
        );

        Call[] memory calls = new Call[](3);

        calls[0] = _createCall(
            address(erc20mock),
            0,
            abi.encodeWithSelector(IERC20.approve.selector, PAYMASTER_V3_V9_ADDRESS, type(uint256).max)
        );
        calls[1] = _createCall(
            address(erc20mock), 0, abi.encodeWithSelector(IERC20.transfer.selector, stealthAddress, ERC20_TOKEN_VALUE)
        );
        calls[2] = _createCall(address(announcer), 0, callDataAnnounce);

        PackedUserOperation[] memory userOps =
            _getUserOp(__ALICE_ADDRESS, __ALICE_PRIVATE_KEYS, _packCallData(mode_1, calls), Sponsor_Type.ERC20);

        _etch7702(__ALICE_ADDRESS, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
        _relayUserOp(userOps);

        uint256 stealthPrivateKey = _deriveStealthPrivateKey(ephemeralPublicKey, metaData);

        address derivedStealthAddress = vm.addr(stealthPrivateKey);
        assertEq(stealthAddress, derivedStealthAddress, "stealth addresses do not match");
        assertEq(IERC20(erc20mock).balanceOf(stealthAddress), ERC20_TOKEN_VALUE, "stealth address balance incorrect");

        Call[] memory calls_2 = new Call[](2);
        calls_2[0] = _createCall(
            address(erc20mock),
            0,
            abi.encodeWithSelector(IERC20.approve.selector, PAYMASTER_V3_V9_ADDRESS, type(uint256).max)
        );
        calls_2[1] = _createCall(
            address(erc20mock),
            0,
            abi.encodeWithSelector(IERC20.transfer.selector, __SPENDING_ADDRESS, ERC20_TOKEN_VALUE - 1 ether)
        );

        userOps = _getUserOp(stealthAddress, stealthPrivateKey, _packCallData(mode_1, calls_2), Sponsor_Type.ERC20);

        _etch7702(stealthAddress, ACCOUNT_IMPLEMENTATION_V9_ADDRESS);
        _relayUserOp(userOps);

        // Stealth address should have a small remaining balance (< 1 token) used for gas fees
        assertTrue(IERC20(erc20mock).balanceOf(stealthAddress) < 1 ether, "stealth address should have minimal balance");
        assertEq(
            IERC20(erc20mock).balanceOf(__SPENDING_ADDRESS),
            ERC20_TOKEN_VALUE - 1 ether,
            "spending address balance incorrect after withdrawal"
        );
    }

    // Helper to register stealth keys
    function _registerKeys() internal {
        stealthMetaAddress = abi.encodePacked(__SPENDING_PUBLIC_KEYS, __VIEWING_PUBLIC_KEYS);

        vm.prank(__SPENDING_ADDRESS);
        registry.registerKeys(SECP256K1_SCHEME_ID, stealthMetaAddress);
    }

    // Helper to assert registered stealth keys
    function _assertRegisterKeys() internal {
        registeredStealthMetaAddress = registry.stealthMetaAddressOf(__SPENDING_ADDRESS, SECP256K1_SCHEME_ID);

        // console.log("registeredStealthMetaAddress:", vm.toString(registeredStealthMetaAddress));
        assertEq(stealthMetaAddress, registeredStealthMetaAddress, "stealth meta-addresses do not match");
    }
}
