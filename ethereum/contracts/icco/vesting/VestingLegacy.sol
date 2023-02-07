// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts (last updated v4.8.0) (finance/VestingWallet.sol)
pragma solidity ^0.8.17;

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
contract VestingContract is Context, ReentrancyGuard {

    event EventClaimAllocation (
        uint256 saleId,
        uint256 tokenIndex,
        uint256 amount,
        uint256 vestingIteration
    );

    mapping( address => mapping(uint256 => mapping(uint256 => bool)) ) public alreadyClaimed;     // tracks the vesting of each userAddress => tokenIndex => vestingIteration => claimedStatus

    uint256 public numberOfVestings;        // Number of vestings in the IDO
    uint256[] public vestingPercentages;    // Vesting Percentages in the IDO
    uint256[] public vestingUnlockTimes;     // Vesting StartTimes in the IDO

    struct Vesting {
        uint256 _cliffStartTimeInSeconds;
        uint256 _cliffPercentage;
        uint256 _linearStartTimeInSeconds;
        uint256 _linearEndTimeInSeconds;
        uint256 _linearReleasePeriodInSeconds;
    }

    Vesting public _vestingInformation;
    IContributor public _contributor;
    uint256 public _saleId;

    constructor(Vesting memory vestingDetails, address contributor) {
        
        _vestingInformation = vestingDetails;
        _contributor = IContributor(contributor);

        uint256 index = 0;

        if(vestingDetails._cliffStartTimeInSeconds > 0){
            vestingUnlockTimes.push(vestingDetails._cliffStartTimeInSeconds);
            vestingPercentages.push(vestingDetails._cliffPercentage);

            numberOfVestings++;
            index++;
        }

        numberOfVestings += (vestingDetails._linearEndTimeInSeconds - vestingDetails._linearStartTimeInSeconds) / (vestingDetails._linearReleasePeriodInSeconds) ;

        for ( uint256 i = index; i < numberOfVestings; i++) {
            uint256 vestingTime = vestingDetails._linearStartTimeInSeconds + (vestingDetails._linearReleasePeriodInSeconds * i);
            vestingUnlockTimes.push(vestingTime);
            uint256 vestingPercentage;
            if(vestingDetails._cliffStartTimeInSeconds > 0){
                vestingPercentage = (100 - vestingDetails._cliffPercentage) / (numberOfVestings - 1);
            }
            else{
                vestingPercentage = (100) / (numberOfVestings);
            }
            vestingPercentages.push(vestingPercentage);
        }

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

    function claimAllocation(uint256 saleId, uint256 tokenIndex) public nonReentrant {
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

        // Here unlocking tokens according to vesting requirements provided at the start
        require(
            alreadyClaimed[msg.sender][tokenIndex][numberOfVestings-1] == false, 
                "All Vestings Claimed Already"
            );
        
        bool claimedIterations;
        for (uint256 i = 0; i < numberOfVestings; i++) {
                if (block.timestamp >= vestingUnlockTimes[i]){
                    if(alreadyClaimed[msg.sender][tokenIndex][i] != true){
                        //success case
                        uint256 toSend = thisAllocation
                             * vestingPercentages[i] /
                            100; 

                        claimedIterations = true;
                        alreadyClaimed[msg.sender][tokenIndex][i] = true;
                        SafeERC20.safeTransfer(IERC20(tokenAddress), msg.sender, toSend); 
                        /// emit EventClaimAllocation event.
                        emit EventClaimAllocation(saleId, tokenIndex, toSend, i);    
                    }
                }
            }
        require(claimedIterations, "Your claimable vestings are not unlocked yet");
    }

}