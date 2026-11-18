// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {GuardianVault} from "../src/GuardianVault.sol";

/// Usage (Arc testnet):
///   OWNER=0x.. GUARDIAN=0x.. forge script script/Deploy.s.sol \
///     --rpc-url https://rpc.testnet.arc.network --private-key $PK --broadcast
contract Deploy is Script {
    // Arc testnet USDC ERC-20 interface (6 decimals). Verify against docs.arc.io contract addresses.
    address constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        address owner = vm.envAddress("OWNER");
        address guardian = vm.envAddress("GUARDIAN");
        uint256 dailyLimit = vm.envOr("DAILY_LIMIT", uint256(100e6)); // $100
        uint256 delay = vm.envOr("DELAY", uint256(10 minutes));
        address usdc = vm.envOr("USDC", ARC_USDC);

        vm.startBroadcast();
        GuardianVault vault = new GuardianVault(IERC20(usdc), owner, guardian, dailyLimit, delay);
        vm.stopBroadcast();

        console.log("GuardianVault deployed at", address(vault));
    }
}
