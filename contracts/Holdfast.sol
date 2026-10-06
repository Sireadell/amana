// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @dev The few ERC-4626 reads Holdfast needs from the vault.
interface IVault is IERC20 {
    function convertToAssets(uint256 shares) external view returns (uint256);
    function convertToShares(uint256 assets) external view returns (uint256);
    function maxRedeem(address owner) external view returns (uint256);
}

/// @title Holdfast
/// @notice A due-date guarantee. A buyer pledges yield-bearing vault shares to a seller's
/// request. The pledge keeps earning yield. Nobody can take it before the due date plus a
/// grace hour. A payment through the contract frees it. After the date the seller can claim
/// only the shares worth what is still owed, and the rest goes back to the buyer in the same
/// transaction.
/// @dev No owner, no pause, no upgrade, no fees. USDC and the vault are fixed at deploy.
contract Holdfast {
    enum State {
        NONE,
        OPEN, // created, no pledge yet
        PLEDGED, // buyer has pledged shares
        PAID, // fully paid through the contract, shares returned
        CLAIMED, // seller claimed after the due date
        RELEASED, // seller released the pledge
        RECLAIMED, // buyer reclaimed after the seller did nothing
        CANCELLED // seller cancelled before any pledge
    }

    struct Request {
        address seller;
        address buyer;
        State state;
        uint64 dueAt;
        uint256 amount; // USDC owed in total, 6 decimals
        uint256 paid; // USDC paid so far through the contract
        uint256 shares; // vault shares pledged
        bytes32 termsHash;
    }

    IERC20 public immutable usdc;
    IVault public immutable vault;

    /// @notice Nothing can be claimed until this long after the due date.
    uint64 public constant GRACE = 1 hours;
    /// @notice If the seller does nothing, the buyer can reclaim this long after the claim opens.
    uint64 public constant RECLAIM_AFTER = 30 days;
    /// @notice Smallest request, 1 USDC.
    uint256 public constant MIN_AMOUNT = 1e6;
    /// @notice Largest request, 1,000,000 USDC.
    uint256 public constant MAX_AMOUNT = 1_000_000e6;
    /// @notice Furthest a due date can be set, so a pledge cannot be locked for centuries.
    uint64 public constant MAX_TERM = 365 days;
    /// @notice The pledge must be worth at least this percent of the amount.
    uint256 public constant COVER_PERCENT = 105;

    uint256 public requestCount;
    mapping(uint256 => Request) private _requests;
    /// @notice USDC a seller could not receive directly (for example blocked) and can collect later.
    mapping(address => uint256) public credited;

    uint256 private _locked = 1;

    error BadAddress();
    error BadAmount();
    error BadDate();
    error BadState();
    error NotSeller();
    error NotBuyer();
    error WrongTerms();
    error TooLate();
    error TooEarly();
    error NotCovered();
    error NotCashable();
    error TransferFailed();
    error NothingCredited();
    error Reentrancy();

    event RequestCreated(
        uint256 indexed id, address indexed seller, address indexed buyer, uint256 amount, uint64 dueAt, bytes32 termsHash
    );
    event Pledged(uint256 indexed id, address indexed buyer, uint256 shares, uint256 worthUsdc);
    event Paid(uint256 indexed id, address indexed payer, uint256 amount, uint256 owedLeft, bool credited);
    event Claimed(uint256 indexed id, address indexed seller, uint256 sharesToSeller, uint256 sharesToBuyer, uint256 owedAtClaim);
    event Released(uint256 indexed id, uint256 sharesToBuyer);
    event Reclaimed(uint256 indexed id, uint256 sharesToBuyer);
    event Cancelled(uint256 indexed id);
    event CreditCollected(address indexed seller, uint256 amount);

    modifier nonReentrant() {
        if (_locked != 1) revert Reentrancy();
        _locked = 2;
        _;
        _locked = 1;
    }

    constructor(address usdc_, address vault_) {
        if (usdc_ == address(0) || vault_ == address(0) || usdc_.code.length == 0 || vault_.code.length == 0) {
            revert BadAddress();
        }
        usdc = IERC20(usdc_);
        vault = IVault(vault_);
    }

    // ---------------------------------------------------------------- seller

    /// @notice Seller makes a request. Terms cannot be edited afterwards.
    /// @param buyer Optional. Zero means any buyer may pledge.
    function createRequest(uint256 amount, uint64 dueAt, address buyer) external returns (uint256 id) {
        if (amount < MIN_AMOUNT || amount > MAX_AMOUNT) revert BadAmount();
        if (dueAt <= block.timestamp || dueAt > block.timestamp + MAX_TERM) revert BadDate();
        if (buyer == msg.sender) revert BadAddress();
        id = ++requestCount;
        bytes32 hash = _termsHash(id, msg.sender, buyer, amount, dueAt);
        _requests[id] = Request({
            seller: msg.sender,
            buyer: buyer,
            state: State.OPEN,
            dueAt: dueAt,
            amount: amount,
            paid: 0,
            shares: 0,
            termsHash: hash
        });
        emit RequestCreated(id, msg.sender, buyer, amount, dueAt, hash);
    }

    /// @notice Seller cancels a request that has no pledge yet.
    function cancel(uint256 id) external {
        Request storage r = _requests[id];
        if (r.seller != msg.sender) revert NotSeller();
        if (r.state != State.OPEN) revert BadState();
        r.state = State.CANCELLED;
        emit Cancelled(id);
    }

    /// @notice Seller claims once the claim window is open. Pays the seller in shares worth what
    /// is still owed (capped at the pledge) and returns the rest to the buyer in the same call.
    function claim(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.seller != msg.sender) revert NotSeller();
        if (r.state != State.PLEDGED) revert BadState();
        if (block.timestamp < uint256(r.dueAt) + GRACE) revert TooEarly();

        uint256 owedNow = r.amount - r.paid;
        uint256 toSeller = _sharesFor(owedNow);
        if (toSeller > r.shares) toSeller = r.shares;
        uint256 toBuyer = r.shares - toSeller;

        r.state = State.CLAIMED;
        r.shares = 0;
        _sendShares(r.seller, toSeller);
        _sendShares(r.buyer, toBuyer);
        emit Claimed(id, r.seller, toSeller, toBuyer, owedNow);
    }

    /// @notice Seller releases the whole pledge at any time, for example after being paid outside.
    function release(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.seller != msg.sender) revert NotSeller();
        if (r.state != State.PLEDGED) revert BadState();
        uint256 back = r.shares;
        r.state = State.RELEASED;
        r.shares = 0;
        _sendShares(r.buyer, back);
        emit Released(id, back);
    }

    /// @notice Seller collects USDC that could not be sent directly.
    function withdrawCredit() external nonReentrant {
        uint256 amount = credited[msg.sender];
        if (amount == 0) revert NothingCredited();
        credited[msg.sender] = 0;
        if (!_send(address(usdc), msg.sender, amount)) revert TransferFailed();
        emit CreditCollected(msg.sender, amount);
    }

    // ----------------------------------------------------------------- buyer

    /// @notice Buyer pledges vault shares worth at least 105% of the amount. The buyer must have
    /// approved exactly `shares` first, and must pass the terms hash they saw.
    function pledge(uint256 id, bytes32 termsHash, uint256 shares) external nonReentrant {
        Request storage r = _requests[id];
        if (r.state != State.OPEN) revert BadState();
        if (termsHash != r.termsHash) revert WrongTerms();
        if (block.timestamp >= r.dueAt) revert TooLate();
        if (msg.sender == r.seller) revert BadAddress();
        if (r.buyer != address(0) && r.buyer != msg.sender) revert NotBuyer();

        uint256 worth = vault.convertToAssets(shares);
        if (worth * 100 < r.amount * COVER_PERCENT) revert NotCovered();
        // The vault must be able to pay these shares out right now.
        if (vault.maxRedeem(msg.sender) < shares) revert NotCashable();

        uint256 before = vault.balanceOf(address(this));
        if (!_pull(address(vault), msg.sender, shares)) revert TransferFailed();
        if (vault.balanceOf(address(this)) - before != shares) revert TransferFailed();

        r.buyer = msg.sender;
        r.shares = shares;
        r.state = State.PLEDGED;
        emit Pledged(id, msg.sender, shares, worth);
    }

    /// @notice Pay all or part of what is owed through the contract. Anyone may pay. USDC goes to
    /// the seller. If the seller cannot receive it, it is credited to them to collect later and
    /// the payment still counts. When nothing is owed, all shares go back to the buyer.
    function pay(uint256 id, uint256 amount) external nonReentrant {
        Request storage r = _requests[id];
        if (r.state != State.PLEDGED) revert BadState();
        uint256 owedNow = r.amount - r.paid;
        if (amount == 0) revert BadAmount();
        if (amount > owedNow) amount = owedNow; // a smaller payment slipped in first cannot make this one fail

        uint256 before = usdc.balanceOf(address(this));
        if (!_pull(address(usdc), msg.sender, amount)) revert TransferFailed();
        if (usdc.balanceOf(address(this)) - before != amount) revert TransferFailed();

        r.paid += amount;
        uint256 left = r.amount - r.paid;
        uint256 back;
        if (left == 0) {
            back = r.shares;
            r.state = State.PAID;
            r.shares = 0;
        }
        bool wasCredited;
        if (!_send(address(usdc), r.seller, amount)) {
            credited[r.seller] += amount;
            wasCredited = true;
        }
        emit Paid(id, msg.sender, amount, left, wasCredited);

        if (left == 0) {
            _sendShares(r.buyer, back);
            emit Released(id, back);
        }
    }

    /// @notice If the seller has done nothing 30 days after the claim opens, the buyer takes the
    /// pledge back.
    function reclaim(uint256 id) external nonReentrant {
        Request storage r = _requests[id];
        if (r.buyer != msg.sender) revert NotBuyer();
        if (r.state != State.PLEDGED) revert BadState();
        if (block.timestamp < uint256(r.dueAt) + GRACE + RECLAIM_AFTER) revert TooEarly();
        uint256 back = r.shares;
        r.state = State.RECLAIMED;
        r.shares = 0;
        _sendShares(msg.sender, back);
        emit Reclaimed(id, back);
    }

    // ----------------------------------------------------------------- views

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    /// @notice USDC still owed on a request.
    function owed(uint256 id) external view returns (uint256) {
        Request storage r = _requests[id];
        return r.amount - r.paid;
    }

    /// @notice When the seller may first claim.
    function claimOpensAt(uint256 id) external view returns (uint256) {
        return uint256(_requests[id].dueAt) + GRACE;
    }

    /// @notice Smallest number of shares that satisfies the 105% cover for an amount.
    function sharesNeededFor(uint256 amount) external view returns (uint256) {
        return _sharesFor((amount * COVER_PERCENT + 99) / 100);
    }

    function termsHashOf(uint256 id) external view returns (bytes32) {
        return _requests[id].termsHash;
    }

    // -------------------------------------------------------------- internals

    function _termsHash(uint256 id, address seller, address buyer, uint256 amount, uint64 dueAt)
        private
        view
        returns (bytes32)
    {
        return keccak256(abi.encode(block.chainid, address(this), id, seller, buyer, amount, dueAt));
    }

    /// @dev Shares worth at least `assets`, rounded up.
    function _sharesFor(uint256 assets) private view returns (uint256 s) {
        s = vault.convertToShares(assets);
        if (vault.convertToAssets(s) < assets) s += 1;
    }

    function _sendShares(address to, uint256 amount) private {
        if (amount == 0) return;
        if (!_send(address(vault), to, amount)) revert TransferFailed();
    }

    function _send(address token, address to, uint256 amount) private returns (bool) {
        (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(IERC20.transfer.selector, to, amount));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }

    function _pull(address token, address from, uint256 amount) private returns (bool) {
        (bool ok, bytes memory ret) =
            token.call(abi.encodeWithSelector(IERC20.transferFrom.selector, from, address(this), amount));
        return ok && (ret.length == 0 || abi.decode(ret, (bool)));
    }
}
