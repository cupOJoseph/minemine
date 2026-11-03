// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @notice Prototype game currency. No admin, upgrades, taxes, or additional minting.
/// @dev Supply and naming are provisional. Deploy only to a local chain or Sepolia.
contract MineToken is ERC20, ERC20Burnable {
    uint256 public constant INITIAL_SUPPLY = 1_000_000 * 10 ** 18;

    constructor(address treasury) ERC20("MineMine Credit", "MINE") {
        require(treasury != address(0), "Treasury is zero");
        _mint(treasury, INITIAL_SUPPLY);
    }
}
