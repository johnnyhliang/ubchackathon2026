// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "openzeppelin-contracts/contracts/utils/cryptography/SignatureChecker.sol";

/// @title GuardianVault
/// @notice A USDC vault where risky actions are held for a delay and a trusted guardian
///         can cancel them or approve them early. The guardian can never spend.
///
/// Instant path: payments to trusted recipients that fit inside the daily limit.
/// Held path:    every other payment, plus anything that weakens protection
///               (trusting a new address, raising the limit, changing the guardian).
///
/// Guardian decisions can be sent directly or as EIP-712 signatures relayed by anyone.
/// Signatures are checked with SignatureChecker, so the guardian may be an EOA or an
/// ERC-1271 smart account (e.g. a passkey wallet). A voice on a phone call carries no
/// signature, so a cloned voice cannot approve anything.
///
/// Escape hatch: the owner can always move everything to a fixed recovery address
/// after a long delay that the guardian cannot cancel. A hostile guardian can slow
/// Mom down but never trap her money; a stolen owner key can only send it home.
contract GuardianVault is EIP712 {
    using SafeERC20 for IERC20;

    enum Kind {
        Transfer,
        AddTrusted,
        RaiseLimit,
        SetGuardian
    }

    enum Status {
        None,
        Pending,
        Executed,
        Cancelled
    }

    struct Action {
        Kind kind;
        Status status;
        uint64 readyAt;
        address target; // recipient / address to trust / new guardian
        uint256 amount; // transfer amount / new daily limit
    }

    bytes32 public constant DECISION_TYPEHASH =
        keccak256("Decision(address vault,uint256 actionId,bool approve,uint256 deadline)");

    IERC20 public immutable usdc;
    address public immutable owner;
    address public guardian;
    address public immutable recovery;
    uint256 public immutable escapeDelay;
    uint64 public escapeReadyAt; // 0 = no escape requested

    uint256 public delay;
    uint256 public dailyLimit;
    uint256 public spentToday;
    uint256 public spentDay;

    mapping(address => bool) public trusted;
    Action[] internal _actions;

    event InstantPayment(address indexed to, uint256 amount);
    event ActionQueued(
        uint256 indexed id, Kind kind, address indexed target, uint256 amount, uint64 readyAt
    );
    event ActionApproved(uint256 indexed id);
    event ActionCancelled(uint256 indexed id);
    event ActionExecuted(uint256 indexed id);
    event TrustedRemoved(address indexed who);
    event DailyLimitLowered(uint256 newLimit);
    event EscapeRequested(address indexed recovery, uint64 readyAt);
    event EscapeCancelled();
    event Escaped(address indexed recovery, uint256 amount);

    error NotOwner();
    error NotGuardian();
    error BadStatus();
    error NotReady();
    error Expired();
    error BadSignature();
    error ZeroAddress();
    error NoEscape();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        IERC20 usdc_,
        address owner_,
        address guardian_,
        uint256 dailyLimit_,
        uint256 delay_,
        address recovery_,
        uint256 escapeDelay_
    ) EIP712("GuardianVault", "1") {
        if (
            address(usdc_) == address(0) || owner_ == address(0) || guardian_ == address(0)
                || recovery_ == address(0)
        ) revert ZeroAddress();
        recovery = recovery_;
        escapeDelay = escapeDelay_;
        usdc = usdc_;
        owner = owner_;
        guardian = guardian_;
        dailyLimit = dailyLimit_;
        delay = delay_;
    }

    // ----------------------------------------------------------------- owner

    /// @notice Pay `amount` USDC to `to`. Instant if trusted and within today's limit,
    ///         otherwise queued. Returns whether it was instant and the action id if queued.
    function pay(address to, uint256 amount) external onlyOwner returns (bool instant, uint256 id) {
        if (to == address(0)) revert ZeroAddress();
        _rollDay();
        if (trusted[to] && spentToday + amount <= dailyLimit) {
            spentToday += amount;
            usdc.safeTransfer(to, amount);
            emit InstantPayment(to, amount);
            return (true, 0);
        }
        return (false, _queue(Kind.Transfer, to, amount));
    }

    function requestTrust(address who) external onlyOwner returns (uint256) {
        if (who == address(0)) revert ZeroAddress();
        return _queue(Kind.AddTrusted, who, 0);
    }

    /// @notice Removing trust only tightens protection, so it is instant.
    function removeTrusted(address who) external onlyOwner {
        trusted[who] = false;
        emit TrustedRemoved(who);
    }

    /// @notice Lowering the limit is instant; raising it is held.
    function requestDailyLimit(uint256 newLimit) external onlyOwner returns (uint256) {
        if (newLimit <= dailyLimit) {
            dailyLimit = newLimit;
            emit DailyLimitLowered(newLimit);
            return type(uint256).max;
        }
        return _queue(Kind.RaiseLimit, address(0), newLimit);
    }

    function requestGuardian(address newGuardian) external onlyOwner returns (uint256) {
        if (newGuardian == address(0)) revert ZeroAddress();
        return _queue(Kind.SetGuardian, newGuardian, 0);
    }

    // ---------------------------------------------------------- escape hatch
    /// @notice Start moving everything to `recovery`. The guardian is notified via the
    ///         event but has no power to cancel it.
    function requestEscape() external onlyOwner returns (uint64 readyAt) {
        readyAt = uint64(block.timestamp + escapeDelay);
        escapeReadyAt = readyAt;
        emit EscapeRequested(recovery, readyAt);
    }

    function cancelEscape() external onlyOwner {
        escapeReadyAt = 0;
        emit EscapeCancelled();
    }

    /// @notice Callable by anyone once the escape delay has passed; funds only go to `recovery`.
    function escape() external {
        if (escapeReadyAt == 0) revert NoEscape();
        if (block.timestamp < escapeReadyAt) revert NotReady();
        escapeReadyAt = 0;
        uint256 amount = usdc.balanceOf(address(this));
        usdc.safeTransfer(recovery, amount);
        emit Escaped(recovery, amount);
    }

    // -------------------------------------------------------------- guardian

    function approve(uint256 id) external {
        if (msg.sender != guardian) revert NotGuardian();
        _approve(id);
    }

    function cancel(uint256 id) external {
        if (msg.sender != guardian) revert NotGuardian();
        _cancel(id);
    }

    /// @notice Relay a guardian decision signed off-chain (EOA or ERC-1271 account).
    function decideBySig(uint256 id, bool approve_, uint256 deadline, bytes calldata signature) external {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest = decisionDigest(id, approve_, deadline);
        if (!SignatureChecker.isValidSignatureNow(guardian, digest, signature)) revert BadSignature();
        if (approve_) _approve(id);
        else _cancel(id);
    }

    function decisionDigest(uint256 id, bool approve_, uint256 deadline) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(DECISION_TYPEHASH, address(this), id, approve_, deadline))
        );
    }

    // -------------------------------------------------------------- anyone

    /// @notice Execute a held action once its delay has passed (or the guardian approved).
    ///         Callable by anyone so a keeper can finish approved payments.
    function execute(uint256 id) external {
        Action storage a = _actions[id];
        if (a.status != Status.Pending) revert BadStatus();
        if (block.timestamp < a.readyAt) revert NotReady();
        a.status = Status.Executed;

        if (a.kind == Kind.Transfer) {
            usdc.safeTransfer(a.target, a.amount);
        } else if (a.kind == Kind.AddTrusted) {
            trusted[a.target] = true;
        } else if (a.kind == Kind.RaiseLimit) {
            dailyLimit = a.amount;
        } else {
            guardian = a.target;
        }
        emit ActionExecuted(id);
    }

    // ---------------------------------------------------------------- views

    function action(uint256 id) external view returns (Action memory) {
        return _actions[id];
    }

    function actionCount() external view returns (uint256) {
        return _actions.length;
    }

    function balance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function remainingToday() external view returns (uint256) {
        uint256 spent = (block.timestamp / 1 days == spentDay) ? spentToday : 0;
        return spent >= dailyLimit ? 0 : dailyLimit - spent;
    }

    // ------------------------------------------------------------- internal

    function _queue(Kind kind, address target, uint256 amount) internal returns (uint256 id) {
        id = _actions.length;
        uint64 readyAt = uint64(block.timestamp + delay);
        _actions.push(Action(kind, Status.Pending, readyAt, target, amount));
        emit ActionQueued(id, kind, target, amount, readyAt);
    }

    function _approve(uint256 id) internal {
        Action storage a = _actions[id];
        if (a.status != Status.Pending) revert BadStatus();
        a.readyAt = uint64(block.timestamp);
        emit ActionApproved(id);
    }

    function _cancel(uint256 id) internal {
        Action storage a = _actions[id];
        if (a.status != Status.Pending) revert BadStatus();
        a.status = Status.Cancelled;
        emit ActionCancelled(id);
    }

    function _rollDay() internal {
        uint256 today = block.timestamp / 1 days;
        if (today != spentDay) {
            spentDay = today;
            spentToday = 0;
        }
    }
}
