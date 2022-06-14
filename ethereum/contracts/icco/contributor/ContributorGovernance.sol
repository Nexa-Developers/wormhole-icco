// contracts/Contributor.sol
// SPDX-License-Identifier: Apache 2

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Upgrade.sol";

import "../../libraries/external/BytesLib.sol";

import "./ContributorGetters.sol";
import "./ContributorSetters.sol";
import "./ContributorStructs.sol";

import "../../interfaces/IWormhole.sol";

contract ContributorGovernance is ContributorGetters, ContributorSetters, ERC1967Upgrade {
    event ContractUpgraded(address indexed oldContract, address indexed newContract);
    event ConsistencyLevelUpdated(uint8 indexed oldLevel, uint8 indexed newLevel);
    event OwnershipTransfered(address indexed oldOwner, address indexed newOwner);


    /// @dev upgrade serves to upgrade contract implementations 
    function upgrade(uint16 contributorChainId, address newImplementation) public onlyOwner {
        require(contributorChainId == chainId(), "wrong chain id");

        address currentImplementation = _getImplementation();

        _upgradeTo(newImplementation);

        /// call initialize function of the new implementation
        (bool success, bytes memory reason) = newImplementation.delegatecall(abi.encodeWithSignature("initialize()"));

        require(success, string(reason));

        emit ContractUpgraded(currentImplementation, newImplementation);
    } 

    /// @dev updateConsisencyLevel serves to change the wormhole messaging consistencyLevel
    function updateConsistencyLevel(uint16 contributorChainId, uint8 newConsistencyLevel) public onlyOwner {
        require(contributorChainId == chainId(), "wrong chain id");
        require(newConsistencyLevel > 0, "newConsistencyLevel must be > 0");

        uint8 currentConsistencyLevel = consistencyLevel();

        setConsistencyLevel(newConsistencyLevel);    

        emit ConsistencyLevelUpdated(currentConsistencyLevel, newConsistencyLevel);
    }

    /// @dev transferOwnership serves to change the ownership of the Contributor contract
    function transferOwnership(uint16 contributorChainId, address newOwner) public onlyOwner {
        require(contributorChainId == chainId(), "wrong chain id");
        require(newOwner != address(0), "new owner cannot be the zero address");

        address currentOwner = owner();

        setOwner(newOwner);

        emit OwnershipTransfered(currentOwner, newOwner);
    }

    modifier onlyOwner() {
        require(owner() == _msgSender(), "caller is not the owner");
        _;
    }
}
