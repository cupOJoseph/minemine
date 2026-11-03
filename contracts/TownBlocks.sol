// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Testnet prototype: one MINE payment buys one protected world column.
/// @dev World claims remain authoritative in Luanti; this contract records the
///      cumulative number of columns a wallet has paid for. No refund or admin.
contract TownBlocks {
    using SafeERC20 for IERC20;

    uint256 public constant MAX_BLOCKS_PER_WALLET = 1_000_000;
    uint256 public constant MAX_BLOCKS_PER_PURCHASE = 4_096;
    IERC20 public immutable token;
    address public immutable treasury;
    uint256 public immutable pricePerBlock;
    mapping(address => uint256) public purchased;

    event BlocksPurchased(address indexed buyer, uint256 blocks, uint256 amount);

    constructor(IERC20 token_, address treasury_, uint256 pricePerBlock_) {
        require(address(token_).code.length > 0, "Token is not a contract");
        require(treasury_ != address(0), "Treasury is zero");
        require(pricePerBlock_ > 0, "Price is zero");
        token = token_;
        treasury = treasury_;
        pricePerBlock = pricePerBlock_;
    }

    function buyBlocks(uint256 blocks_) external {
        require(blocks_ > 0 && blocks_ <= MAX_BLOCKS_PER_PURCHASE, "Invalid block count");
        require(purchased[msg.sender] + blocks_ <= MAX_BLOCKS_PER_WALLET, "Wallet limit reached");
        uint256 amount = blocks_ * pricePerBlock;
        purchased[msg.sender] += blocks_;
        token.safeTransferFrom(msg.sender, treasury, amount);
        emit BlocksPurchased(msg.sender, blocks_, amount);
    }
}
