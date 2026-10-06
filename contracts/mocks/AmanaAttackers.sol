// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAHook { function onToken() external; }

/// @dev Test-only hostile USDC. Modes: 0 normal, 1 returns false, 2 returns no data, 3 takes a 1% fee.
contract AAttackUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    uint8 public mode;
    address public hookTarget;
    bool public hookOnTransferFrom;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setBlocked(address w, bool b) external { blocked[w] = b; }
    function setMode(uint8 m) external { mode = m; }
    function setHook(address t) external { hookTarget = t; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }

    function transfer(address to, uint256 a) external returns (bool) {
        if (mode == 1) return false;
        _move(msg.sender, to, a);
        if (to == hookTarget && to != address(0)) IAHook(to).onToken();
        if (mode == 2) { assembly { return(0, 0) } }
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        if (mode == 1) return false;
        require(allowance[f][msg.sender] >= a, "allowance");
        allowance[f][msg.sender] -= a;
        _move(f, to, a);
        if (mode == 2) { assembly { return(0, 0) } }
        return true;
    }

    function _move(address f, address to, uint256 a) internal {
        require(!blocked[f] && !blocked[to], "blocked");
        require(balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        uint256 got = mode == 3 ? a - a / 100 : a;
        balanceOf[to] += got;
    }
}

/// @dev Test-only hostile vault: per-address block list, view reverts, hook, fee, free price.
contract AAttackVault {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;
    uint256 public priceE6 = 1_000_250;
    bool public revertViews;
    bool public feeOnTransfer;
    address public hookTarget;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setPrice(uint256 p) external { priceE6 = p; }
    function setBlocked(address w, bool b) external { blocked[w] = b; }
    function setRevertViews(bool b) external { revertViews = b; }
    function setFee(bool b) external { feeOnTransfer = b; }
    function setHook(address t) external { hookTarget = t; }

    function convertToAssets(uint256 s) external view returns (uint256) { require(!revertViews, "halted"); return s * priceE6 / 1e6; }
    function convertToShares(uint256 a) external view returns (uint256) { require(!revertViews, "halted"); return a * 1e6 / priceE6; }
    function maxRedeem(address o) external view returns (uint256) { return balanceOf[o]; }

    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        _move(msg.sender, to, a);
        if (to == hookTarget && to != address(0)) IAHook(to).onToken();
        return true;
    }
    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance");
        allowance[f][msg.sender] -= a;
        _move(f, to, a);
        return true;
    }
    function _move(address f, address to, uint256 a) internal {
        require(!blocked[f] && !blocked[to], "vault blocked");
        require(balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        balanceOf[to] += feeOnTransfer ? a - a / 100 : a;
    }
}

interface IAmana {
    function createRequest(uint256 amount, uint64 dueAt, address buyer, uint8 acceptMask) external returns (uint256);
    function pledge(uint256 id, bytes32 h, uint8 vaultIdx, uint256 shares) external;
    function pay(uint256 id, uint256 amount) external;
    function claim(uint256 id) external;
    function release(uint256 id) external;
    function reclaim(uint256 id) external;
    function cancel(uint256 id) external;
    function withdrawCredit() external;
}

/// @dev A seller (or buyer) contract that tries every function from inside a token callback.
contract AReenterer is IAHook {
    IAmana public hf;
    uint256 public id;
    uint256 public calls;
    bool[8] public ok;      // pledge, pay, claim, release, reclaim, cancel, withdrawCredit, createRequest
    bool public armed;

    constructor(address hf_) { hf = IAmana(hf_); }

    function create(uint256 amount, uint64 dueAt, address buyer) external { id = hf.createRequest(amount, dueAt, buyer, 1); }
    function doClaim() external { hf.claim(id); }
    function doRelease() external { hf.release(id); }
    function doWithdraw() external { hf.withdrawCredit(); }
    function arm(bool a) external { armed = a; }

    function onToken() external override {
        if (!armed) return;
        armed = false;
        calls++;
        try hf.pledge(id, bytes32(0), 0, 1) { ok[0] = true; } catch {}
        try hf.pay(id, 1) { ok[1] = true; } catch {}
        try hf.claim(id) { ok[2] = true; } catch {}
        try hf.release(id) { ok[3] = true; } catch {}
        try hf.reclaim(id) { ok[4] = true; } catch {}
        try hf.cancel(id) { ok[5] = true; } catch {}
        try hf.withdrawCredit() { ok[6] = true; } catch {}
        try hf.createRequest(1e6, uint64(block.timestamp + 1 days), address(0), 1) { ok[7] = true; } catch {}
    }
    function results() external view returns (bool[8] memory) { return ok; }
}
