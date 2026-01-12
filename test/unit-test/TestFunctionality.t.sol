// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Helpers } from "../helpers/Helpers.t.sol";
import { console2 as console } from "lib/forge-std/src/console2.sol";
import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

contract TestFunctionality is Helpers {
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
        _mint(__ALICE_ADDRESS, 1000 ether);
    }

    // Test registering stealth keys
    function test_registerKeys() external {
        _registerKeys();
        _assertRegisterKeys();
    }

    // Test announcing stealth address
    function test_announce_eth_transfer() external {
        _registerKeys();
        _assertRegisterKeys();

        (, bytes memory viewingPublicKey) = _decodeStealthMetaAddress(registeredStealthMetaAddress);

        (, uint256 ephemeralPrivateKey, bytes memory ephemeralPublicKey) = _createEphemeralKeypair();

        bytes32 sharedSecretX = _computeSharedSecret(ephemeralPrivateKey, viewingPublicKey);

        bytes32 hashedX = _hashX(sharedSecretX);

        viewTag = _getViewTag(hashedX);

        (, address stealthAddress) = _computeStealthPublicKey(hashedX);

        bytes memory metaData = _createMetaData(viewTag, ETH_TRANSACTION_SELECTOR, ETH_ADDRESS, ETH_VALUE);

        vm.prank(__ALICE_ADDRESS);
        (bool succ,) = payable(stealthAddress).call{ value: ETH_VALUE }("");
        assertTrue(succ, "ETH transfer to stealth address failed");
        announcer.announce(SECP256K1_SCHEME_ID, stealthAddress, ephemeralPublicKey, metaData);

        uint256 stealthPrivateKey = _deriveStealthPrivateKey(ephemeralPublicKey, metaData);

        address derivedStealthAddress = vm.addr(stealthPrivateKey);
        assertEq(stealthAddress, derivedStealthAddress, "stealth addresses do not match");
        assertEq(stealthAddress.balance, ETH_VALUE, "stealth address balance incorrect");

        vm.prank(stealthAddress);
        (bool success,) = __SPENDING_ADDRESS.call{ value: ETH_VALUE }("");
        assertTrue(success, "stealth address withdrawal failed");
        assertEq(stealthAddress.balance, 0, "stealth address balance not zero after withdrawal");
        assertEq(
            __SPENDING_ADDRESS.balance, 10 ether + ETH_VALUE, "spending address balance incorrect after withdrawal"
        );
    }

    function test_announce_erc20_transfer() external {
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

        _approveToken(__ALICE_ADDRESS, address(erc20mock), ERC20_TOKEN_VALUE, erc20mock);

        vm.prank(__ALICE_ADDRESS);
        IERC20(erc20mock).transfer(stealthAddress, ERC20_TOKEN_VALUE);
        announcer.announce(SECP256K1_SCHEME_ID, stealthAddress, ephemeralPublicKey, metaData);

        uint256 stealthPrivateKey = _deriveStealthPrivateKey(ephemeralPublicKey, metaData);

        address derivedStealthAddress = vm.addr(stealthPrivateKey);
        assertEq(stealthAddress, derivedStealthAddress, "stealth addresses do not match");
        assertEq(IERC20(erc20mock).balanceOf(stealthAddress), ERC20_TOKEN_VALUE, "stealth address balance incorrect");

        vm.prank(stealthAddress);
        IERC20(erc20mock).transfer(__SPENDING_ADDRESS, ERC20_TOKEN_VALUE);
        assertEq(IERC20(erc20mock).balanceOf(stealthAddress), 0, "stealth address balance incorrect");
                assertEq(
            IERC20(erc20mock).balanceOf(__SPENDING_ADDRESS), ERC20_TOKEN_VALUE, "spending address balance incorrect after withdrawal"
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
