// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { IERC6538Registry } from "../interfaces/IERC6538.sol";

/// @notice `ERC6538Registry` contract to map accounts to their stealth meta-address. See
/// [ERC-6538](https://eips.ethereum.org/EIPS/eip-6538) to learn more.
contract ERC6538Registry is IERC6538Registry {
    /// @notice Next nonce expected from `user` to use when signing for `registerKeysOnBehalf`.
    /// @dev `registrant` may be a standard 160-bit address or any other identifier.
    /// @dev `schemeId` is an integer identifier for the stealth address scheme.
    mapping(address registrant => mapping(uint256 schemeId => bytes)) public stealthMetaAddressOf;

    /// @notice A nonce used to ensure a signature can only be used once.
    /// @dev `registrant` is the user address.
    /// @dev `nonce` will be incremented after each valid `registerKeysOnBehalf` call.
    mapping(address registrant => uint256) public nonceOf;

    /// @notice The EIP-712 type hash used in `registerKeysOnBehalf`.
    bytes32 public constant ERC6538REGISTRY_ENTRY_TYPE_HASH =
        keccak256("Erc6538RegistryEntry(uint256 schemeId,bytes stealthMetaAddress,uint256 nonce)");

    /// @notice The chain ID where this contract is initially deployed.
    uint256 internal immutable INITIAL_CHAIN_ID;

    /// @notice The domain separator used in this contract.
    bytes32 internal immutable INITIAL_DOMAIN_SEPARATOR;

    constructor() {
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _computeDomainSeparator();
    }

    /// @inheritdoc IERC6538Registry
    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external {
        stealthMetaAddressOf[msg.sender][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(msg.sender, schemeId, stealthMetaAddress);
    }

    /// @inheritdoc IERC6538Registry
    function registerKeysOnBehalf(
        address registrant,
        uint256 schemeId,
        bytes memory signature,
        bytes calldata stealthMetaAddress
    )
        external
    {
        bytes32 dataHash;
        address recoveredAddress;

        unchecked {
            dataHash = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            ERC6538REGISTRY_ENTRY_TYPE_HASH,
                            schemeId,
                            keccak256(stealthMetaAddress),
                            nonceOf[registrant]++
                        )
                    )
                )
            );
        }

        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly ("memory-safe") {
                r := mload(add(signature, 0x20))
                s := mload(add(signature, 0x40))
                v := byte(0, mload(add(signature, 0x60)))
            }
            recoveredAddress = ecrecover(dataHash, v, r, s);
        }

        if (((recoveredAddress == address(0) || recoveredAddress != registrant)
                    && (IERC1271(registrant).isValidSignature(dataHash, signature)
                            != IERC1271.isValidSignature.selector))) revert ERC6538Registry__InvalidSignature();

        stealthMetaAddressOf[registrant][schemeId] = stealthMetaAddress;
        emit StealthMetaAddressSet(registrant, schemeId, stealthMetaAddress);
    }

    /// @inheritdoc IERC6538Registry
    function incrementNonce() external {
        unchecked {
            nonceOf[msg.sender]++;
        }
        emit NonceIncremented(msg.sender, nonceOf[msg.sender]);
    }

    /// @inheritdoc IERC6538Registry
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _computeDomainSeparator();
    }

    /// @notice Computes the domain separator for this contract.
    function _computeDomainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ERC6538Registry"),
                keccak256("1.0"),
                block.chainid,
                address(this)
            )
        );
    }
}

/// @notice Interface of the ERC1271 standard signature validation method for contracts as defined
/// in https://eips.ethereum.org/EIPS/eip-1271[ERC-1271].
interface IERC1271 {
    /// @notice Should return whether the signature provided is valid for the provided data
    /// @param hash Hash of the data to be signed
    /// @param signature Signature byte array associated with _data
    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4 magicValue);
}
