// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

/// Local anvil setup: mock USDC, a family vault and a public honeypot vault.
/// Uses anvil default accounts: #0 deployer/relayer, #1 owner ("mom"), #2 guardian.
contract DeployLocal is Script {
    function run() external {
        address owner = vm.addr(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        address guardian = vm.addr(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a);
        address relayer = vm.addr(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);

        vm.startBroadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        MockUSDC usdc = new MockUSDC();
        GuardianVault family = new GuardianVault(IERC20(address(usdc)), owner, guardian, 100e6, 10 minutes);
        // Honeypot: the relayer acts as both owner and guardian so the server can
        // submit strangers' theft attempts and cancel them.
        GuardianVault honeypot = new GuardianVault(IERC20(address(usdc)), relayer, relayer, 0, 10 minutes);
        usdc.mint(address(family), 5_000e6);
        usdc.mint(address(honeypot), 1_000e6);
        vm.stopBroadcast();

        // Trust the grandson (anvil #3): owner requests, guardian approves, anyone executes.
        address grandson = vm.addr(0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6);
        vm.broadcast(0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d);
        uint256 id = family.requestTrust(grandson);
        vm.broadcast(0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a);
        family.approve(id);
        vm.broadcast(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80);
        family.execute(id);

        console.log("GRANDSON", grandson);
        console.log("USDC", address(usdc));
        console.log("FAMILY_VAULT", address(family));
        console.log("HONEYPOT_VAULT", address(honeypot));
    }
}
