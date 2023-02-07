// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IVesting{

    function setSaleId(uint256 saleId) external returns(bool);
    function claimAllocation(uint256 saleId, uint256 tokenIndex) external;
}
