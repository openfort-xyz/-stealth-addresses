// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

interface IERC6538Registry {
    /// @notice Emitted when an invalid signature is provided to `registerKeysOnBehalf`.
    error ERC6538Registry__InvalidSignature();

    /// @notice Emitted when a registrant updates their stealth meta-address.
    /// @param registrant The account that registered the stealth meta-address.
    /// @param schemeId Identifier corresponding to the applied stealth address scheme, e.g. 1 for
    /// secp256k1, as specified in ERC-5564.
    /// @param stealthMetaAddress The stealth meta-address.
    /// [ERC-5564](https://eips.ethereum.org/EIPS/eip-5564) bases the format for stealth
    /// meta-addresses on [ERC-3770](https://eips.ethereum.org/EIPS/eip-3770) and specifies them as:
    ///   st:<shortName>:0x<spendingPubKey>:<viewingPubKey>
    /// The chain (`shortName`) is implicit based on the chain the `ERC6538Registry` is deployed on,
    /// therefore this `stealthMetaAddress` is just the compressed `spendingPubKey` and
    /// `viewingPubKey` concatenated.
    event StealthMetaAddressSet(address indexed registrant, uint256 indexed schemeId, bytes stealthMetaAddress);

    /// @notice Emitted when a registrant increments their nonce.
    /// @param registrant The account that incremented the nonce.
    /// @param newNonce The new nonce value.
    event NonceIncremented(address indexed registrant, uint256 newNonce);

    /// @notice Sets the caller's stealth meta-address for the given scheme ID.
    /// @param schemeId Identifier corresponding to the applied stealth address scheme, e.g. 1 for
    /// secp256k1, as specified in ERC-5564.
    /// @param stealthMetaAddress The stealth meta-address to register.
    function registerKeys(uint256 schemeId, bytes calldata stealthMetaAddress) external;

    /// @notice Sets the `registrant`'s stealth meta-address for the given scheme ID.
    /// @param registrant Address of the registrant.
    /// @param schemeId Identifier corresponding to the applied stealth address scheme, e.g. 1 for
    /// secp256k1, as specified in ERC-5564.
    /// @param signature A signature from the `registrant` authorizing the registration.
    /// @param stealthMetaAddress The stealth meta-address to register.
    /// @dev Supports both EOA signatures and EIP-1271 signatures.
    /// @dev Reverts if the signature is invalid.
    function registerKeysOnBehalf(
        address registrant,
        uint256 schemeId,
        bytes memory signature,
        bytes calldata stealthMetaAddress
    )
        external;

    /// @notice Increments the nonce of the sender to invalidate existing signatures.
    function incrementNonce() external;

    /// @notice Returns the domain separator used in this contract.
    /// @dev The domain separator is re-computed if there's a chain fork.
    function DOMAIN_SEPARATOR() external view returns (bytes32);

    /// @notice Next nonce expected from `user` to use when signing for `registerKeysOnBehalf`.
    /// @dev `registrant` may be a standard 160-bit address or any other identifier.
    /// @dev `schemeId` is an integer identifier for the stealth address scheme.
    function stealthMetaAddressOf(address registrant, uint256 schemeId) external view returns (bytes memory);
}
