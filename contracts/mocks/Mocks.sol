// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only. These never go to mainnet.
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => bool) public blocked;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setBlocked(address who, bool b) external { blocked[who] = b; }

    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }

    function transfer(address to, uint256 a) external returns (bool) { _move(msg.sender, to, a); return true; }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance");
        allowance[f][msg.sender] -= a;
        _move(f, to, a);
        return true;
    }

    function _move(address f, address to, uint256 a) internal {
        require(!blocked[f] && !blocked[to], "blocked");
        require(balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        balanceOf[to] += a;
    }
}

/// @dev Test-only vault. Price and redeem limit can be set by the test.
contract MockVault {
    string public name = "Mock Vault Share";
    string public symbol = "mvUSDC";
    uint8 public decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public priceE6 = 1_000_250; // assets per 1e6 shares
    bool public capRedeem;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setPrice(uint256 p) external { priceE6 = p; }
    function setCapRedeem(bool c) external { capRedeem = c; }

    function convertToAssets(uint256 s) external view returns (uint256) { return s * priceE6 / 1e6; }
    function convertToShares(uint256 a) external view returns (uint256) { return a * 1e6 / priceE6; }
    function maxRedeem(address o) external view returns (uint256) { return capRedeem ? 0 : balanceOf[o]; }

    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) { _move(msg.sender, to, a); return true; }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        require(allowance[f][msg.sender] >= a, "allowance");
        allowance[f][msg.sender] -= a;
        _move(f, to, a);
        return true;
    }

    function _move(address f, address to, uint256 a) internal {
        require(balanceOf[f] >= a, "balance");
        balanceOf[f] -= a;
        balanceOf[to] += a;
    }
}
