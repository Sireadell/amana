// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only. Mimics a Morpho Vault V2 style share: 18 decimals, and maxRedeem is always 0.
/// priceE18 is USDC (1e18 scaled) worth of one whole share. Assets come back with 6 decimals.
contract MockVault18 {
    string public name = "Mock Vault18 Share";
    string public symbol = "mv18";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public priceE18 = 1_050_000_000_000_000_000;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function setPrice(uint256 p) external { priceE18 = p; }

    function convertToAssets(uint256 s) external view returns (uint256) { return s * priceE18 / 1e30; }
    function convertToShares(uint256 a) external view returns (uint256) { return a * 1e30 / priceE18; }
    function maxRedeem(address) external pure returns (uint256) { return 0; }

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
