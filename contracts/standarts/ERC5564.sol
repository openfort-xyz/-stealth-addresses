// SPDX-License-Identifier: MIT
pragma solidity 0.8.33;

import { IERC5564Announcer } from "../interfaces/IERC5564.sol";

contract ERC5564Announcer is IERC5564Announcer {
    /// @inheritdoc IERC5564Announcer
    function announce(
        uint256 schemeId,
        address stealthAddress,
        bytes memory ephemeralPubKey,
        bytes memory metadata
    )
        external
    {
        emit Announcement(schemeId, stealthAddress, msg.sender, ephemeralPubKey, metadata);
    }
}
