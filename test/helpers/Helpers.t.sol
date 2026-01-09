// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Data } from "../data/Data.t.sol";
import { Vm } from "lib/forge-std/src/Vm.sol";

abstract contract Helpers is Data {
    // ------------------------------------------------------------------------------------
    //
    //                           Helper Functions
    //
    // ------------------------------------------------------------------------------------

    // Compress stealth meta-address from spending and viewing public keys
    function _compressStealthMetaAddress(
        bytes calldata _spendingPublicKey,
        bytes calldata _viewingPublicKey
    )
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(_spendingPublicKey, _viewingPublicKey);
    }

    // Decode stealth meta-address into spending and viewing public keys
    function _decodeStealthMetaAddress(bytes calldata _stealthMetaAddress)
        internal
        pure
        returns (bytes calldata spendingPublicKey, bytes calldata viewingPublicKey)
    {
        require(_stealthMetaAddress.length == 66, "invalid stealth meta address length");
        (spendingPublicKey, viewingPublicKey) =
        (_stealthMetaAddress[0:33], _stealthMetaAddress[33:_stealthMetaAddress.length]);
    }

    // Compress secp256k1 public key
    function _compressSecp256k1(uint256 x, uint256 y) internal pure returns (bytes memory) {
        uint8 prefix = (y & 1) == 0 ? 0x02 : 0x03;
        return abi.encodePacked(prefix, bytes32(x));
    }

    // Create ephemeral keypair
    function _createEphemeralKeypair()
        internal
        returns (address ephemeralAddress, uint256 ephemeralPrivateKey, bytes memory ephemeralPublicKey)
    {
        (ephemeralAddress, ephemeralPrivateKey) = makeAddrAndKey("ephemeral");
        Vm.Wallet memory w = vm.createWallet(ephemeralPrivateKey);
        ephemeralPublicKey = _compressSecp256k1(w.publicKeyX, w.publicKeyY);
    }

    // Compute shared secret using ECDH
    function _computeSharedSecret(
        uint256 _ephemeralPrivateKey,
        bytes calldata _viewingPublicKey
    )
        internal
        returns (bytes32 sharedSecretX, bytes32 sharedSecretY)
    {
        string memory privKeyHex = vm.toString(bytes32(_ephemeralPrivateKey));
        string memory pubKeyHex = vm.toString(_viewingPublicKey);
        string[] memory cmd = new string[](5);
        cmd[0] = "npx";
        cmd[1] = "tsx";
        cmd[2] = "script/computeSharedSecret.ts";
        cmd[3] = privKeyHex;
        cmd[4] = pubKeyHex;

        bytes memory out = vm.ffi(cmd);
        bytes memory xy = vm.parseBytes(string(out));
        require(xy.length == 64, "shared secret length");

        assembly ("memory-safe") {
            sharedSecretX := mload(add(xy, 0x20))
            sharedSecretY := mload(add(xy, 0x40))
        }
    }

    // Hash the x-coordinate of the shared secret
    function _hashX(bytes32 _x) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(_x));
    }

    // Get view tag from hashed shared secret
    function _getViewTag(bytes32 _hash) internal pure returns (bytes1) {
        return bytes1(_hash);
    }

    // Compute stealth public key and address from hashed shared secret
    function _computeStealthPublicKey(bytes32 _hashedSharedSecretX)
        internal
        returns (bytes memory stealthPublicKey, address stealthAddress)
    {
        string memory hashHex = vm.toString(_hashedSharedSecretX);
        string memory spendHex = vm.toString(__SEPNDIG_PUBLIC_KEYS);
        string[] memory cmd = new string[](5);
        cmd[0] = "npx";
        cmd[1] = "tsx";
        cmd[2] = "script/computeStealthPublicKey.ts";
        cmd[3] = hashHex;
        cmd[4] = spendHex;

        bytes memory out = vm.ffi(cmd);
        bytes memory raw = vm.parseBytes(string(out));
        (stealthPublicKey, stealthAddress) = abi.decode(raw, (bytes, address));
    }

    // Create metadata for stealth address transaction
    function _createMetaData(
        bytes1 _viewTag,
        bytes4 _selector,
        address _assetAddress,
        uint256 _amount
    )
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodePacked(_viewTag, _selector, _assetAddress, _amount);
    }

    // Parse stealth meta-address to get stealth private key
    function _parseStealthMetaAddress(bytes memory _stealthMetaAddress) internal returns (uint256) {
        bytes memory ephemeralPubKey = vm.envBytes("EPHEMERAL_PUBLIC_KEY");

        string[] memory cmd = new string[](7);
        cmd[0] = "npx";
        cmd[1] = "tsx";
        cmd[2] = "script/detectPayment.ts";
        cmd[3] = vm.toString(bytes32(__SPENDING_PRIVATE_KEYS));
        cmd[4] = vm.toString(bytes32(__VIEWING_PRIVATE_KEYS));
        cmd[5] = vm.toString(ephemeralPubKey);
        cmd[6] = vm.toString(_stealthMetaAddress);

        bytes memory out = vm.ffi(cmd);
        bytes32 stealthPrivateKey = vm.parseBytes32(string(out));
        return uint256(stealthPrivateKey);
    }
}
