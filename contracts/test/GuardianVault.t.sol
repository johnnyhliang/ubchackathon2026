// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {GuardianVault} from "../src/GuardianVault.sol";
import {MockUSDC} from "../src/mocks/MockUSDC.sol";

contract GuardianVaultTest is Test {
    MockUSDC usdc;
    GuardianVault vault;

    address owner = makeAddr("owner");
    uint256 guardianKey = 0xA11CE;
    address guardian;
    address grandson = makeAddr("grandson");
    address scammer = makeAddr("scammer");
    address recovery = makeAddr("recovery");

    uint256 constant USD = 1e6;
    uint256 constant DELAY = 10 minutes;

    function setUp() public {
        vm.warp(1_800_000_000);
        guardian = vm.addr(guardianKey);
        usdc = new MockUSDC();
        vault = new GuardianVault(IERC20(address(usdc)), owner, guardian, 100 * USD, DELAY, recovery, 7 days);
        usdc.mint(address(vault), 5_000 * USD);

        // trust the grandson (held, guardian approves)
        vm.prank(owner);
        uint256 id = vault.requestTrust(grandson);
        vm.prank(guardian);
        vault.approve(id);
        vault.execute(id);
    }

    function _sign(uint256 id, bool approve_, uint256 deadline) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(guardianKey, vault.decisionDigest(id, approve_, deadline));
        return abi.encodePacked(r, s, v);
    }

    function test_trustedSmallPaymentIsInstant() public {
        vm.prank(owner);
        (bool instant,) = vault.pay(grandson, 20 * USD);
        assertTrue(instant);
        assertEq(usdc.balanceOf(grandson), 20 * USD);
    }

    function test_overDailyLimitIsHeld() public {
        vm.startPrank(owner);
        vault.pay(grandson, 90 * USD);
        (bool instant,) = vault.pay(grandson, 20 * USD);
        vm.stopPrank();
        assertFalse(instant);
        assertEq(usdc.balanceOf(grandson), 90 * USD);
    }

    function test_dailyLimitResetsNextDay() public {
        vm.prank(owner);
        vault.pay(grandson, 100 * USD);
        vm.warp(block.timestamp + 1 days);
        vm.prank(owner);
        (bool instant,) = vault.pay(grandson, 100 * USD);
        assertTrue(instant);
    }

    function test_scamPaymentHeldThenCancelledByGuardian() public {
        vm.prank(owner);
        (bool instant, uint256 id) = vault.pay(scammer, 2_000 * USD);
        assertFalse(instant);

        vm.prank(guardian);
        vault.cancel(id);

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert(GuardianVault.BadStatus.selector);
        vault.execute(id);
        assertEq(usdc.balanceOf(scammer), 0);
    }

    function test_heldPaymentExecutesAfterDelay() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 500 * USD);
        vm.expectRevert(GuardianVault.NotReady.selector);
        vault.execute(id);
        vm.warp(block.timestamp + DELAY);
        vault.execute(id);
        assertEq(usdc.balanceOf(scammer), 500 * USD);
    }

    function test_guardianApprovalSkipsDelay() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 500 * USD);
        vm.prank(guardian);
        vault.approve(id);
        vault.execute(id);
        assertEq(usdc.balanceOf(scammer), 500 * USD);
    }

    function test_signedCancelRelayedByAnyone() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 2_000 * USD);
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(id, false, deadline);
        vm.prank(makeAddr("relayer"));
        vault.decideBySig(id, false, deadline, sig);
        assertEq(uint8(vault.action(id).status), uint8(GuardianVault.Status.Cancelled));
    }

    /// The "deepfake" case: someone other than the guardian signs an approval.
    function test_approvalFromImpostorKeyRejected() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 2_000 * USD);
        uint256 deadline = block.timestamp + 5 minutes;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xBAD, vault.decisionDigest(id, true, deadline));
        vm.expectRevert(GuardianVault.BadSignature.selector);
        vault.decideBySig(id, true, deadline, abi.encodePacked(r, s, v));
    }

    function test_signatureForOtherDecisionRejected() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 2_000 * USD);
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory cancelSig = _sign(id, false, deadline);
        vm.expectRevert(GuardianVault.BadSignature.selector);
        vault.decideBySig(id, true, deadline, cancelSig);
    }

    function test_expiredSignatureRejected() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 2_000 * USD);
        uint256 deadline = block.timestamp + 5 minutes;
        bytes memory sig = _sign(id, true, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(GuardianVault.Expired.selector);
        vault.decideBySig(id, true, deadline, sig);
    }

    function test_onlyOwnerCanPay() public {
        vm.prank(scammer);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.pay(scammer, 1 * USD);
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.pay(guardian, 1 * USD);
    }

    function test_onlyGuardianCanCancel() public {
        vm.prank(owner);
        (, uint256 id) = vault.pay(scammer, 2_000 * USD);
        vm.prank(owner);
        vm.expectRevert(GuardianVault.NotGuardian.selector);
        vault.cancel(id);
    }

    function test_weakeningProtectionIsHeld() public {
        vm.startPrank(owner);
        uint256 t = vault.requestTrust(scammer);
        uint256 l = vault.requestDailyLimit(10_000 * USD);
        uint256 g = vault.requestGuardian(scammer);
        vm.stopPrank();
        assertFalse(vault.trusted(scammer));
        assertEq(vault.dailyLimit(), 100 * USD);
        assertEq(vault.guardian(), guardian);

        vm.startPrank(guardian);
        vault.cancel(t);
        vault.cancel(l);
        vault.cancel(g);
        vm.stopPrank();
    }

    function test_loweringLimitIsInstant() public {
        vm.prank(owner);
        vault.requestDailyLimit(10 * USD);
        assertEq(vault.dailyLimit(), 10 * USD);
    }

    function test_guardianChangeAfterDelay() public {
        address newGuardian = makeAddr("newGuardian");
        vm.prank(owner);
        uint256 id = vault.requestGuardian(newGuardian);
        vm.warp(block.timestamp + DELAY);
        vault.execute(id);
        assertEq(vault.guardian(), newGuardian);
    }

    // ------------------------------------------------------------ escape hatch

    function test_escapeBeatsHostileGuardian() public {
        // guardian blocks everything, including being replaced
        vm.prank(owner);
        (, uint256 pay) = vault.pay(grandson, 1_000 * USD);
        vm.prank(guardian);
        vault.cancel(pay);
        vm.prank(owner);
        uint256 swap = vault.requestGuardian(makeAddr("newGuardian"));
        vm.prank(guardian);
        vault.cancel(swap);

        vm.prank(owner);
        vault.requestEscape();
        vm.expectRevert(GuardianVault.NotReady.selector);
        vault.escape();

        vm.warp(block.timestamp + 7 days);
        vault.escape();
        assertEq(usdc.balanceOf(recovery), 5_000 * USD);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_guardianCannotStopOrTriggerEscape() public {
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.cancelEscape();
        vm.prank(guardian);
        vm.expectRevert(GuardianVault.NotOwner.selector);
        vault.requestEscape();
    }

    function test_stolenOwnerKeyCanOnlyEscapeToRecovery() public {
        vm.prank(owner); // thief holding the owner key
        vault.requestEscape();
        vm.warp(block.timestamp + 7 days);
        vm.prank(scammer);
        vault.escape();
        assertEq(usdc.balanceOf(scammer), 0);
        assertEq(usdc.balanceOf(recovery), 5_000 * USD);
    }

    function test_ownerCanCancelEscape() public {
        vm.startPrank(owner);
        vault.requestEscape();
        vault.cancelEscape();
        vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(GuardianVault.NoEscape.selector);
        vault.escape();
    }
}
