// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { Data } from "../data/Data.t.sol";
import { Vm } from "lib/forge-std/src/Vm.sol";
import { LibBytes } from "lib/solady/src/utils/LibBytes.sol";
import { IERC20 } from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";

abstract contract Helpers is Data {
    // ------------------------------------------------------------------------------------
    //
    //                           Helper Functions
    //
    // ------------------------------------------------------------------------------------

    // Fund an address with ETH
    function _deal(address _to, uint256 _amount) internal {
        vm.deal(_to, _amount);
    }

    // Mint ERC20 tokens to an address
    function _mint(address _to, uint256 _amount) internal {
        erc20mock.mint(_to, _amount);
    }

    // Approve ERC20 tokens from an owner to a spender
    function _approveToken(address _owner, address _spender, uint256 _amount, IERC20 _token) internal {
        vm.prank(_owner);
        IERC20(_token).approve(_spender, _amount);
    }

    // ------------------------------------------------------------------------------------
    //
    //                       Helper Functions ERC5564 & ERC6538
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
    function _decodeStealthMetaAddress(bytes memory _stealthMetaAddress)
        internal
        pure
        returns (bytes memory spendingPublicKey, bytes memory viewingPublicKey)
    {
        require(_stealthMetaAddress.length == 66, "invalid stealth meta address length");
        spendingPublicKey = LibBytes.slice(_stealthMetaAddress, 0, 33);
        viewingPublicKey = LibBytes.slice(_stealthMetaAddress, 33, 66);
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
        bytes memory _viewingPublicKey
    )
        internal
        returns (bytes32 sharedSecretX)
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
        require(out.length == 32, "shared secret length");

        // FFI already converts hex string output to raw bytes, so no parsing needed
        assembly ("memory-safe") {
            sharedSecretX := mload(add(out, 0x20))
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
        string memory spendHex = vm.toString(__SPENDING_PUBLIC_KEYS);
        string[] memory cmd = new string[](5);
        cmd[0] = "npx";
        cmd[1] = "tsx";
        cmd[2] = "script/computeStealthPublicKey.ts";
        cmd[3] = hashHex;
        cmd[4] = spendHex;

        bytes memory out = vm.ffi(cmd);
        // FFI already converts hex string output to raw bytes, so no parsing needed
        (stealthPublicKey, stealthAddress) = abi.decode(out, (bytes, address));
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

    // Derive stealth private key from announcement data (Stage 5 & 6 of EIP-5564)
    // Bob uses his spending and viewing private keys + announcement data to derive stealth private key
    function _deriveStealthPrivateKey(
        bytes memory _ephemeralPublicKey,
        bytes memory _metadata
    )
        internal
        returns (uint256 stealthPrivateKey)
    {
        string[] memory cmd = new string[](7);
        cmd[0] = "npx";
        cmd[1] = "tsx";
        cmd[2] = "script/detectPayment.ts";
        cmd[3] = vm.toString(bytes32(__SPENDING_PRIVATE_KEYS));
        cmd[4] = vm.toString(bytes32(__VIEWING_PRIVATE_KEYS));
        cmd[5] = vm.toString(_ephemeralPublicKey);
        cmd[6] = vm.toString(_metadata);

        bytes memory out = vm.ffi(cmd);
        // FFI already converts hex string to raw bytes
        bytes32 stealthPrivKey;
        assembly ("memory-safe") {
            stealthPrivKey := mload(add(out, 0x20))
        }

        // If view tag doesn't match, script returns 0x00...00
        stealthPrivateKey = uint256(stealthPrivKey);
    }
}
