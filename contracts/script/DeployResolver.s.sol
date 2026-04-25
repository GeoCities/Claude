// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {GeoCitiesResolver} from "../src/GeoCitiesResolver.sol";

contract DeployResolver is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PK");
        address gatewaySigner = vm.envAddress("GATEWAY_SIGNER");
        string memory gatewayUrl = vm.envString("GATEWAY_URL");

        string[] memory urls = new string[](1);
        urls[0] = gatewayUrl;

        vm.startBroadcast(pk);
        GeoCitiesResolver resolver = new GeoCitiesResolver(gatewaySigner, urls);
        vm.stopBroadcast();

        console2.log("");
        console2.log("===== GeoCitiesResolver deployed =====");
        console2.log("address :", address(resolver));
        console2.log("signer  :", gatewaySigner);
        console2.log("gateway :", gatewayUrl);
        console2.log("");
        console2.log("Next steps:");
        console2.log(" 1. In the ENS app on Sepolia, set the resolver of geocities.eth");
        console2.log("    to the address above.");
        console2.log(" 2. Set RESOLVER_ADDRESS in gateway/.env to this address.");
        console2.log(" 3. Confirm the gateway's signer matches this signer; rotate via");
        console2.log("    setSigner(address) if not.");
        console2.log("");
    }
}
