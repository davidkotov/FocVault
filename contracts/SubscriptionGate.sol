// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

contract SubscriptionGate {
    IERC20Minimal public immutable paymentToken;
    address public immutable treasury;
    uint256 public pricePerMonth;
    uint256 public constant PERIOD = 30 days;
    uint256 public constant MAX_MONTHS = 12;
    uint256 public constant MAX_CID_LENGTH = 64;

    mapping(address => uint256) public expiresAt;
    mapping(address => string) public syncIndex;

    event Subscribed(address indexed subscriber, uint256 months, uint256 amount, uint256 newExpiry);
    event PriceChanged(uint256 oldPrice, uint256 newPrice);
    event SyncUpdated(address indexed user, string cid);

    error NotTreasury();
    error BadMonths();
    error BadCid();

    constructor(address token, address treasury_, uint256 pricePerMonth_) {
        paymentToken = IERC20Minimal(token);
        treasury = treasury_;
        pricePerMonth = pricePerMonth_;
    }

    function subscribe(uint256 months) external {
        if (months == 0 || months > MAX_MONTHS) revert BadMonths();
        uint256 amount = pricePerMonth * months;
        bool ok = paymentToken.transferFrom(msg.sender, treasury, amount);
        require(ok, "transfer failed");
        uint256 base = expiresAt[msg.sender] > block.timestamp ? expiresAt[msg.sender] : block.timestamp;
        uint256 newExpiry = base + PERIOD * months;
        expiresAt[msg.sender] = newExpiry;
        emit Subscribed(msg.sender, months, amount, newExpiry);
    }

    function isSubscribed(address user) external view returns (bool) {
        return expiresAt[user] > block.timestamp;
    }

    function setSyncIndex(string calldata cid) external {
        if (bytes(cid).length == 0 || bytes(cid).length > MAX_CID_LENGTH) revert BadCid();
        syncIndex[msg.sender] = cid;
        emit SyncUpdated(msg.sender, cid);
    }

    function setPrice(uint256 newPrice) external {
        if (msg.sender != treasury) revert NotTreasury();
        emit PriceChanged(pricePerMonth, newPrice);
        pricePerMonth = newPrice;
    }
}
