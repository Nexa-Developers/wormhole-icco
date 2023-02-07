// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.8.0) (finance/VestingWallet.sol)
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

import "../contributor/ContributorStructs.sol";
import "../../interfaces/ITokenBridge.sol";
import "../../interfaces/IContributor.sol";

/**
 * @title VestingWallet
 * @dev This contract handles the vesting of Eth and ERC20 tokens for a given beneficiary. Custody of multiple tokens
 * can be given to this contract, which will release the token to the beneficiary following a given vesting schedule.
 * The vesting schedule is customizable through the {vestedAmount} function.
 *
 * Any token transferred to this contract will follow the vesting schedule as if they were locked from the beginning.
 * Consequently, if the vesting has already started, any amount of tokens sent to this contract will (at least partly)
 * be immediately releasable.
 */
contract VestingWallet is Context, ReentrancyGuard {

    event EventClaimAllocation (
        address indexed user,
        uint256 saleId,
        uint256 tokenIndex,
        uint256 amount
    );
    
    struct Vesting {
        uint256 _cliffStartTimeInSeconds;
        uint256 _cliffPercentage;
        uint256 _linearStartTimeInSeconds;
        uint256 _linearEndTimeInSeconds;
    }

    mapping( address => mapping(uint256 => bool) ) public claimedCliff;     // tracks the vesting cliff of each userAddress => tokenIndex => claimedStatus
    mapping( address => mapping(uint256 => uint256) ) public claimedAmount;     // tracks the vesting amount of each userAddress => tokenIndex => claimedAmount

    Vesting public _vestingInformation;
    IContributor public _contributor;
    uint256 public _saleId;

    /**
     * @dev Set the beneficiary, start timestamp and vesting duration of the vesting wallet.
     */
    constructor(Vesting memory vestingDetails, address contributor) {
        _vestingInformation = vestingDetails;
        _contributor = IContributor(contributor);
    }

    /**
     * @dev The contract should be able to receive Eth.
     */
    receive() external payable virtual {}
    fallback() external payable virtual {}

    function setSaleId(uint256 saleId) public returns(bool) {
        require(_msgSender() == address(_contributor), "Only Contributor Can set SaleId");
        require(_saleId == 0, "Cannot Set SaleId if once set");
        _saleId = saleId;
        return true;
    }

    /**
     * @dev Amount of token already released
     */
    function released(address user, uint256 tokenIndex) public view virtual returns (uint256) {
        return claimedAmount[user][tokenIndex];
    }

    function vestedLinearDuration() public view returns (uint256) {
        return (_vestingInformation._linearEndTimeInSeconds - _vestingInformation._linearStartTimeInSeconds);
    }

    function vestedLinearTimePassed() public view returns (uint256) {
        return (block.timestamp - _vestingInformation._linearStartTimeInSeconds);
    }

    function vestedTotalCliffAmount(uint256 totalAllocation) public view returns (uint256){
        if(_vestingInformation._cliffPercentage > 0){
            uint256 amount = totalAllocation * _vestingInformation._cliffPercentage;
            amount = amount / 100;
            return amount;
        }
        else{
            return 0;
        }
    }

    function vestedTotalLinearAmount(uint256 totalAllocation) public view returns (uint256){
        
        uint256 linearAllocation;
        if(_vestingInformation._cliffPercentage > 0){
            linearAllocation = totalAllocation - vestedTotalCliffAmount(totalAllocation);
        }
        else{
            linearAllocation = totalAllocation;
        }

        return linearAllocation;
    }
    
    function vestedLinearUnlocked(uint256 totalAllocation) public view returns (uint256) {
        uint256 linearAllocation = vestedTotalLinearAmount(totalAllocation);
        if(block.timestamp < _vestingInformation._linearStartTimeInSeconds){
            return 0;
        }
        else if(block.timestamp > _vestingInformation._linearEndTimeInSeconds){
            return linearAllocation;
        }
        else {
            uint256 unlocked = (linearAllocation * vestedLinearTimePassed()) / vestedLinearDuration(); 
            return unlocked;
        }
    }

    function vestedLinearClaimable(uint256 totalAllocation, uint256 alreadyClaimedAmount) public view returns(uint256) {
        uint256 linearClaimable; 
        if(_vestingInformation._cliffStartTimeInSeconds > 0){
            linearClaimable = vestedTotalCliffAmount(totalAllocation) + vestedLinearUnlocked(totalAllocation);
        }
        else{
            linearClaimable = vestedLinearUnlocked(totalAllocation);
        }

        if( (linearClaimable - alreadyClaimedAmount) > 0 ){
            linearClaimable = linearClaimable - alreadyClaimedAmount;
        }
        else{
            linearClaimable = 0;
        }

        return linearClaimable;
    }


    function release(uint256 saleId, uint256 tokenIndex) public nonReentrant {

        require(_saleId != 0, "Sale Id needs to be set on vesting contract by the contributor");
        require(_contributor.saleExists(saleId), "sale not initiated");

        /// make sure the sale is sealed and not aborted
        (bool isSealed, bool isAborted) = _contributor.getSaleStatus(saleId);

        require(!isAborted, "token sale is aborted");
        require(isSealed, "token sale is not yet sealed");

        /// cache to save on gas
        uint16 thisChainId = _contributor.chainId();

        /// make sure the contributor is claiming on the right chain
        (uint16 contributedTokenChainId, , ) = _contributor.getSaleAcceptedTokenInfo(saleId, tokenIndex);

        require(contributedTokenChainId == thisChainId, "allocation needs to be claimed on a different chain");

        ContributorStructs.Sale memory sale = _contributor.sales(saleId); 

        /**
         * @dev Cache contribution variables since they're used to calculate
         * the allocation and excess contribution.
         */
        uint256 thisContribution = _contributor.getSaleContribution(saleId, tokenIndex, msg.sender);
        uint256 totalContribution = _contributor.getSaleTotalContribution(saleId, tokenIndex);

        /// calculate the allocation and send to the contributor
        uint256 thisAllocation = (_contributor.getSaleAllocation(saleId, tokenIndex) * thisContribution) / totalContribution;
        require(thisAllocation > 0, "The user has not participated for this tokenIndex and saleId");

        address tokenAddress;
        if (sale.tokenChain == thisChainId) {
            /// normal token transfer on same chain
            tokenAddress = address(uint160(uint256(sale.tokenAddress)));
        } else {
            /// identify wormhole token bridge wrapper
            tokenAddress = _contributor.tokenBridge().wrappedAsset(sale.tokenChain, sale.tokenAddress);
        }

        // handle cliff release
        if(_vestingInformation._cliffStartTimeInSeconds > 0){
            if(claimedCliff[msg.sender][tokenIndex] == false){
                if( block.timestamp >= _vestingInformation._cliffStartTimeInSeconds){
                    uint256 toSend = vestedTotalCliffAmount(thisAllocation);
                    claimedCliff[msg.sender][tokenIndex] = true;
                    claimedAmount[msg.sender][tokenIndex] += toSend;
                    SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, toSend);
                    emit EventClaimAllocation(msg.sender, saleId, tokenIndex, toSend);
                }
            }
        }

        // handle linear release
        if(block.timestamp >= _vestingInformation._linearStartTimeInSeconds){
            uint256 toSend = vestedLinearClaimable(thisAllocation, claimedAmount[msg.sender][tokenIndex]);
            require(toSend > 0, "No Claims Available at the moment");
            claimedAmount[msg.sender][tokenIndex] += toSend;
            SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, toSend);
            emit EventClaimAllocation(msg.sender, saleId, tokenIndex, toSend);
        }

    }
}