// SPDX-License-Identifier: MIT

pragma solidity 0.8.33;

import { Script, console2 as console } from "lib/forge-std/src/Script.sol";
import { ERC20Mock } from "lib/openzeppelin-contracts/contracts/mocks/token/ERC20Mock.sol";

contract DeployMockERC20 is Script {
    bytes32 constant salt = 0x0000000000000000000000000000000000000000000000000000000209e8c229;
    address private CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    function run() public {
        vm.startBroadcast();

        bytes memory creationCode = abi.encodePacked(type(ERC20Mock).creationCode);
        console.logBytes(creationCode);

        address expectedAddress = vm.computeCreate2Address(salt, keccak256(creationCode), CREATE2_DEPLOYER);

        console.log("Expected deployment address:", expectedAddress);
        console.log("Using salt:", vm.toString(salt));
        console.log("CREATE2 Deployer:", CREATE2_DEPLOYER);

        if (expectedAddress.code.length > 0) {
            console.log("Contract already deployed at:", expectedAddress);
            vm.stopBroadcast();
            return;
        }

        bytes memory deploymentData = abi.encodePacked(salt, creationCode);

        (bool success, bytes memory res) = CREATE2_DEPLOYER.call(deploymentData);
        require(address(bytes20(res)) == expectedAddress, "Wrong Addres Delpoyed");

        require(success, "CREATE2 deployment failed");

        console.log("Contract deployed successfully!");
        console.log("Deployed to expected address:", expectedAddress);

        require(expectedAddress.code.length > 0, "No code at deployed address");

        console.log("Deployment completed successfully!");

        vm.stopBroadcast();
    }
}
