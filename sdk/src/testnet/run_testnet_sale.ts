import { expect } from "chai";
import {
  initiatorWallet,
  buildAcceptedTokens,
  createSaleOnEthConductor,
  initializeSaleOnEthContributors,
  waitForSaleToStart,
  prepareAndExecuteContribution,
  waitForSaleToEnd,
  sealOrAbortSaleOnEth,
  sealSaleAtEthContributors,
  redeemCrossChainAllocations,
  claimContributorAllocationOnEth,
  redeemCrossChainContributions,
  testProvider,
  collectContributionsOnConductor,
  attestContributionsOnContributor,
  getSaleTokenBalancesOnContributors,
  findUniqueContributions,
  excessContributionsExistForSale,
  claimContributorExcessContributionOnEth,
  getContributedTokenBalancesOnContributors,
  getTokenDecimals,
} from "./utils";
import {
  SALE_CONFIG,
  TESTNET_ADDRESSES,
  CONDUCTOR_NETWORK,
  CONTRIBUTOR_INFO,
  CONTRIBUTOR_NETWORKS,
  WORMHOLE_ADDRESSES,
  CONDUCTOR_CHAIN_ID,
} from "./consts";
import { Contribution, SaleParams, SealSaleResult } from "./structs";
import { setDefaultWasm, ChainId, tryUint8ArrayToNative } from "@certusone/wormhole-sdk";
import { MockSale } from "./testCalculator";
import { getErc20Balance } from "../";
import { ethers } from "ethers";

setDefaultWasm("node");

describe("Testnet ICCO Successful Sales", () => {
  it("Fixed-price With Lock Up", async () => {
    // sale parameters
    const raiseParams: SaleParams = SALE_CONFIG["raiseParams"];
    const contributions: Contribution[] = CONTRIBUTOR_INFO["contributions"];
    const acceptedTokens = await buildAcceptedTokens(SALE_CONFIG["acceptedTokens"]);

    // test calculator object
    const mockSale = new MockSale(
      CONDUCTOR_CHAIN_ID,
      SALE_CONFIG["denominationDecimals"],
      acceptedTokens,
      raiseParams,
      contributions
    );
    const mockSaleResults = await mockSale.getResults();

    console.log("Expected Sale Results");
    for (const result of mockSaleResults.allocations) {
      console.log(
        `Token: ${
          result.tokenIndex
        }, Allocation: ${result.allocation.toString()}, ExcessContribution: ${result.excessContribution.toString()}, TotalContribution: ${result.totalContribution.toString()}`
      );
    }

    // create and initialize the sale
    const saleInitArray = await createSaleOnEthConductor(
      initiatorWallet(CONDUCTOR_NETWORK),
      TESTNET_ADDRESSES.conductorAddress,
      raiseParams,
      acceptedTokens
    );

    // // initialize the sale on the contributors
    const saleInit = await initializeSaleOnEthContributors(saleInitArray[0]);
    console.log(saleInit);
    console.info("Sale", saleInit.saleId, "has been initialized on the EVM contributors.");

    // wait for the sale to start before contributing
    console.info("Waiting for the sale to start.");
    const extraTime: number = 5; // wait an extra 5 seconds
    await waitForSaleToStart(saleInit, extraTime);

    // loop through contributors and safe contribute one by one
    console.log("Making contributions to the sale.");
    for (const contribution of contributions) {
      let successful = false;
      // check if we're contributing a solana token
      successful = await prepareAndExecuteContribution(saleInit.saleId, raiseParams.token, contribution);
      expect(successful, "Contribution failed").to.be.true;
    }

    // wait for sale to end
    console.log("Waiting for the sale to end.");
    await waitForSaleToEnd(saleInit, raiseParams.lockUpDurationSeconds); // add the lock up duration

    // attest and collect contributions on EVM
    const attestVaas: Uint8Array[] = await attestContributionsOnContributor(saleInit);
    console.log("Successfully attested contributions on", attestVaas.length, "chains.");

    // collect contributions on the conductor
    const collectionResults = await collectContributionsOnConductor(attestVaas, saleInit.saleId);
    for (const result of collectionResults) {
      expect(result, "Failed to collect all contributions on the conductor.").to.be.true;
    }
    console.log("Successfully collected contributions on the conductor.");

    // seal the sale on the conductor
    // make sure tokenBridge transfers are redeemed
    // check contributor sale token balances before and after
    // check to see if the recipient received refund in fixed-price sale
    let saleResult: SealSaleResult;
    {
      const saleTokenBalancesBefore = await getSaleTokenBalancesOnContributors(
        raiseParams.token,
        raiseParams.tokenChain
      );

      const refundRecipientBalanceBefore = await getErc20Balance(
        testProvider(CONDUCTOR_NETWORK),
        raiseParams.localTokenAddress,
        raiseParams.refundRecipient
      );

      // seal the sale on the conductor contract
      saleResult = await sealOrAbortSaleOnEth(saleInit);
      expect(saleResult.sale.isSealed, "Sale was not sealed").to.be.true;

      // redeem the transfer VAAs on all chains
      await redeemCrossChainAllocations(saleResult);

      const saleTokenBalancesAfter = await getSaleTokenBalancesOnContributors(
        raiseParams.token,
        raiseParams.tokenChain
      );

      // confirm that the right amount of allocations were sent to the contributor contract
      for (let i = 0; i < CONTRIBUTOR_NETWORKS.length; i++) {
        const chainId = WORMHOLE_ADDRESSES[CONTRIBUTOR_NETWORKS[i]].chainId as ChainId;
        const balanceChange = saleTokenBalancesAfter[i].sub(saleTokenBalancesBefore[i]);
        const summedAllocation = mockSale.sumAllocationsByChain(mockSaleResults);
        expect(
          balanceChange.eq(summedAllocation.get(chainId)),
          `Incorrect token allocation sent to contributor, balance change: ${balanceChange}, expected change: ${summedAllocation.get(
            chainId
          )}`
        ).to.be.true;
      }

      // sum allocations by chain
      const refundRecipientBalanceAfter = await getErc20Balance(
        testProvider(CONDUCTOR_NETWORK),
        raiseParams.localTokenAddress,
        raiseParams.refundRecipient
      );

      // confirms that the refund recipient received the sale token refund (if applicable)
      expect(
        refundRecipientBalanceAfter.sub(refundRecipientBalanceBefore).eq(mockSaleResults.tokenRefund),
        "Incorrect sale token refund"
      ).to.be.true;
    }

    // seal the sale at the contributors
    let saleSealedResults;
    {
      // check the contributor balance before calling saleSealed
      const contributorBalancesBefore = await getContributedTokenBalancesOnContributors(acceptedTokens);

      // seal the sale on the Contributor contracts
      saleSealedResults = await sealSaleAtEthContributors(saleInit, saleResult);

      // redeem transfer VAAs for conductor
      for (let [chainId, receipt] of saleSealedResults[1]) {
        if (chainId != CONDUCTOR_CHAIN_ID) {
          await redeemCrossChainContributions(receipt, chainId);
        }
      }

      // check the balance after calling saleSealed
      const contributorBalancesAfter = await getContributedTokenBalancesOnContributors(acceptedTokens);

      // make sure the balance changes are what we expected
      for (let i = 0; i < acceptedTokens.length; i++) {
        let expectedBalanceChange = mockSaleResults.allocations[i].totalContribution.sub(
          mockSaleResults.allocations[i].excessContribution
        );
        if ((acceptedTokens[i].tokenChain as ChainId) != CONDUCTOR_CHAIN_ID) {
          const nativeAddress = await tryUint8ArrayToNative(
            acceptedTokens[i].tokenAddress as Uint8Array,
            acceptedTokens[i].tokenChain as ChainId
          );
          const contributedTokenDecimals = ethers.BigNumber.from(
            await getTokenDecimals(acceptedTokens[i].tokenChain as ChainId, nativeAddress)
          );

          // copy what the token bridge does by norm/denorm based on token decimals
          expectedBalanceChange = mockSale.denormalizeAmount(
            mockSale.normalizeAmount(expectedBalanceChange, contributedTokenDecimals),
            contributedTokenDecimals
          );
        }

        expect(
          contributorBalancesBefore[i].sub(contributorBalancesAfter[i]).eq(expectedBalanceChange),
          `Incorrect recipient balance change for acceptedToken=${i}`
        ).to.be.true;
      }
    }

    // claim allocations on contributors
    // find unique contributions to claim
    const uniqueContributors = findUniqueContributions(contributions, acceptedTokens);

    console.log("Claiming contributor allocations and excessContributions if applicable.");
    for (let i = 0; i < uniqueContributors.length; i++) {
      const successful = await claimContributorAllocationOnEth(saleSealedResults[0], uniqueContributors[i]);
      expect(successful, "Failed to claim allocation").to.be.true;

      // check to see if there are any excess contributions to claim
      if (await excessContributionsExistForSale(saleInit.saleId, uniqueContributors[i])) {
        const successful = await claimContributorExcessContributionOnEth(saleSealedResults[0], uniqueContributors[i]);
        expect(successful, "Failed to claim excessContribution").to.be.true;
      }
    }
  });
});
