// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Helpers } from "../helpers/Helpers.t.sol";
import { console2 as console } from "lib/forge-std/src/console2.sol";

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
    }

    // Test registering stealth keys
    function test_registerKeys() external {
        _registerKeys();
        _assertRegisterKeys();
    }

    // Test announcing stealth address
    function test_announce() external {
        _registerKeys();
        _assertRegisterKeys();

        (bytes memory spendingPublicKey, bytes memory viewingPublicKey) =
            _decodeStealthMetaAddress(registeredStealthMetaAddress);

        (, uint256 ephemeralPrivateKey, bytes memory ephemeralPublicKey) = _createEphemeralKeypair();

        bytes32 sharedSecretX = _computeSharedSecret(ephemeralPrivateKey, viewingPublicKey);

        bytes32 hashedX = _hashX(sharedSecretX);

        viewTag = _getViewTag(hashedX);

        (, address stealthAddress) = _computeStealthPublicKey(hashedX);

        bytes memory metaData = _createMetaData(viewTag, ETH_TRANSACTION_SELECTOR, ETH_ADDRESS, ETH_VALUE);

        vm.prank(__ALICE_ADDRESS);
        payable(stealthAddress).transfer(ETH_VALUE);
        announcer.announce(SECP256K1_SCHEME_ID, stealthAddress, ephemeralPublicKey, metaData);

        uint256 stealthPrivateKey = _deriveStealthPrivateKey(ephemeralPublicKey, metaData);

        address derivedStealthAddress = vm.addr(stealthPrivateKey);
        assertEq(stealthAddress, derivedStealthAddress, "stealth addresses do not match");
        assertEq(stealthAddress.balance, ETH_VALUE, "stealth address balance incorrect");

        vm.prank(stealthAddress);
        (bool success, ) = __SPENDING_ADDRESS.call{ value: ETH_VALUE }("");
        assertTrue(success, "stealth address withdrawal failed");
        assertEq(stealthAddress.balance, 0, "stealth address balance not zero after withdrawal");
        assertEq(__SPENDING_ADDRESS.balance, 10 ether + ETH_VALUE, "spending address balance incorrect after withdrawal");
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
