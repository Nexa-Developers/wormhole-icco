// SPDX-License-Identifier: Apache 2
pragma solidity ^0.8.0;

import "../icco/contributor/ContributorStructs.sol";
import "../interfaces/ITokenBridge.sol";


interface IContributor {
    function chainId() external view returns (uint16);
    function conductorChainId() external view returns (uint16);
    function conductorContract() external view returns (bytes32);
    function sales(uint256 saleId_) external view returns (ContributorStructs.Sale memory sale);
    function getSaleAcceptedTokenInfo(uint256 saleId_, uint256 tokenIndex) external view returns (uint16 tokenChainId, bytes32 tokenAddress, uint128 conversionRate);
    function getSaleTimeframe(uint256 saleId_) external view returns (uint256 start, uint256 end, uint256 unlockTimestamp);
    function getSaleStatus(uint256 saleId_) external view returns (bool isSealed, bool isAborted);
    function getSaleTokenAddress(uint256 saleId_) external view returns (bytes32 tokenAddress);
    function getSaleAllocation(uint256 saleId, uint256 tokenIndex) external view returns (uint256 allocation);
    function getSaleExcessContribution(uint256 saleId, uint256 tokenIndex) external view returns (uint256 allocation);
    function getSaleTotalContribution(uint256 saleId, uint256 tokenIndex) external view returns (uint256 contributed);
    function getSaleContribution(uint256 saleId, uint256 tokenIndex, address contributor) external view returns (uint256 contributed);
    function tokenBridge() external view returns (ITokenBridge);
    function saleExists(uint256 saleId) external view returns (bool exists);
}