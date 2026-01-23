// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

/**
 * @title Stealths
 * @author Openfort
 * @notice Abstract contract for EIP-7702 accounts to manage stealth address announcements
 * @dev Implements ERC-5564 compatible announcements with privacy preservation
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *                              PRIVACY MODEL
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * • stealthAddress is intentionally OMITTED from the event for unlinkability
 * • Only the viewing key holder can derive stealth addresses from ephemeralPubKey
 * • viewTag (first byte of metadata) enables efficient log filtering (~1/256 scan)
 * • caller is included but cannot be linked to stealth addresses without viewing key
 *
 * ══════════════════════════════════════════════════════════════════════════════
 *                                 USAGE
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * • Bob (recipient) can announce self-generated stealth addresses
 * • Alice (sender) can announce stealth addresses she created for Bob
 *
 * Off-chain stealth address recovery:
 *   1. Scan logs filtered by viewTag (indexed)
 *   2. For each event, compute: S = viewingPrivKey * ephemeralPubKey
 *   3. Derive: stealthPrivKey = spendingPrivKey + hash(S)
 *   4. Compute address from stealthPrivKey
 *   5. Check if address has balance → user owns it
 *
 */
abstract contract Stealth {
    /*//////////////////////////////////////////////////////////////
                                 ERRORS
    //////////////////////////////////////////////////////////////*/

    /// @notice Thrown when schemeId is not id=1
    error InvalidSchemeId();

    /// @notice Thrown when ephemeralPubKey has invalid length
    /// @dev Valid lengths: 33 bytes (compressed)
    error InvalidEphemeralPubKeyLength();

    /// @notice Thrown when metadata is empty (must contain at least viewTag)
    error EmptyMetadata();

    /*//////////////////////////////////////////////////////////////
                                 EVENTS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Emitted when a stealth address is announced for discovery
     * @dev stealthAddress intentionally omitted - derived off-chain using viewing key
     *
     * @param schemeId Cryptographic scheme identifier
     *                 • 1 = secp256k1 with view tags
     *                 • 2 = BabyJubJub (future)
     * @param caller Address that called announce (sender or recipient)
     * @param viewTag First byte of shared secret hash - extracted from metadata[0]
     *                Indexed for efficient log filtering (reduces scan to ~1/256)
     * @param ephemeralPubKey Sender's ephemeral public key (R = r*G)
     *                        Used by recipient to derive stealth private key
     * @param metadata Arbitrary data where metadata[0] = viewTag
     *                 Can contain encrypted: token address, amount, memo, etc.
     *
     * @custom:erc StealthAddress ommited
     */
    event Announcement(
        uint256 indexed schemeId, address indexed caller, bytes1 indexed viewTag, bytes ephemeralPubKey, bytes metadata
    );

    /*//////////////////////////////////////////////////////////////
                                 STORAGE
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Stealth meta-address URI for receiving stealth payments
     * @dev Format: st:eth:0x<spendingPubKey><viewingPubKey>
     *      • spendingPubKey: 33 bytes (compressed) - for spending funds
     *      • viewingPubKey: 33 bytes (compressed) - for scanning announcements
     */
    bytes public stealthMetaAddress;

    /*//////////////////////////////////////////////////////////////
                              CONSTRUCTOR
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Initialize the stealth meta-address for this account
     * @param _stealthMetaAddress The stealth meta-address URI
     *        Format: st:eth:0x<spendingPubKey><viewingPubKey>
     */
    constructor(bytes memory _stealthMetaAddress) {
        stealthMetaAddress = _stealthMetaAddress;
    }

    /*///////////////////////////////////////////////s///////////////
                           ANNOUNCE FUNCTION
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Announce a stealth payment for off-chain discovery
     * @dev Can be called by either:
     *      • Sender (Alice): after creating stealth address for recipient
     *      • Recipient (Bob): to track self-generated stealth addresses
     *
     *      The viewTag is automatically extracted from metadata[0] and indexed
     *      for efficient log filtering. Recipients only need to scan ~1/256 of
     *      all announcements.
     *
     *      Security: stealthAddress is NOT included in the event. An observer
     *      seeing this event cannot determine which stealth address it refers to
     *      without access to the viewing private key.
     *
     * @param schemeId Cryptographic scheme identifier (1 = secp256k1)
     * @param ephemeralPubKey Ephemeral public key R = r*G
     *                        • 33 bytes for compressed format
     *                        • 65 bytes for uncompressed format
     * @param metadata Arbitrary data where:
     *                 • metadata[0] = viewTag (first byte of hash(sharedSecret))
     *                 • metadata[1:] = optional encrypted data (token, amount, etc.)
     *
     * @custom:example
     *   // Off-chain: compute viewTag and build metadata
     *   sharedSecret = ephemeralPrivKey * viewingPubKey
     *   viewTag = keccak256(sharedSecret)[0]
     *   metadata = abi.encodePacked(viewTag, encryptedData)
     *
     *   // On-chain: announce
     *   announce(1, ephemeralPubKey, metadata)
     */
    function announce(uint256 schemeId, bytes calldata ephemeralPubKey, bytes calldata metadata) external {
        // Validate ephemeral public key length (33)
        if (schemeId != 1) {
            revert InvalidSchemeId();
        }

        // Validate ephemeral public key length (33)
        if (ephemeralPubKey.length != 33) {
            revert InvalidEphemeralPubKeyLength();
        }

        // Validate metadata contains at least viewTag
        if (metadata.length == 0) {
            revert EmptyMetadata();
        }

        // Extract viewTag from first byte of metadata
        bytes1 viewTag = metadata[0];

        emit Announcement(schemeId, msg.sender, viewTag, ephemeralPubKey, metadata);
    }
}
