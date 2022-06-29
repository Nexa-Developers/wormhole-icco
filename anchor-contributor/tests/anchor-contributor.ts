import { AnchorProvider, workspace, web3, Program, setProvider, BN } from "@project-serum/anchor";
import { AnchorContributor } from "../target/types/anchor_contributor";
import { expect } from "chai";
import { readFileSync } from "fs";
import {
  CHAIN_ID_SOLANA,
  setDefaultWasm,
  tryNativeToHexString,
  getOriginalAssetSol,
  uint8ArrayToHex,
  CHAIN_ID_ETH,
  createWrappedOnSolana,
  getForeignAssetSolana,
  redeemOnSolana,
} from "@certusone/wormhole-sdk";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  Account as AssociatedTokenAccount,
  getMint,
  createMint,
} from "@solana/spl-token";

import { DummyConductor } from "./helpers/conductor";
import { IccoContributor } from "./helpers/contributor";
import { deriveAddress, getBlockTime, getPdaSplBalance, getSplBalance, hexToPublicKey, wait } from "./helpers/utils";
import { BigNumber } from "ethers";
import { KycAuthority } from "./helpers/kyc";
import {
  CONDUCTOR_ADDRESS,
  CONDUCTOR_CHAIN,
  CORE_BRIDGE_ADDRESS,
  KYC_PRIVATE,
  TOKEN_BRIDGE_ADDRESS,
} from "./helpers/consts";
import { encodeAttestMeta, encodeTokenTransfer } from "./helpers/token-bridge";
import { signAndEncodeVaa } from "./helpers/wormhole";

// be careful where you import this
import { postVaaSolanaWithRetry } from "@certusone/wormhole-sdk";

setDefaultWasm("node");

describe("anchor-contributor", () => {
  // Configure the client to use the local cluster.
  setProvider(AnchorProvider.env());

  const program = workspace.AnchorContributor as Program<AnchorContributor>;
  const connection = program.provider.connection;

  const orchestrator = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./tests/test_orchestrator_keypair.json").toString()))
  );
  const buyer = web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync("./tests/test_buyer_keypair.json").toString()))
  );

  // dummy conductor to generate vaas
  const dummyConductor = new DummyConductor(CONDUCTOR_CHAIN, CONDUCTOR_ADDRESS);

  // our contributor
  const contributor = new IccoContributor(program, CORE_BRIDGE_ADDRESS, TOKEN_BRIDGE_ADDRESS, postVaaSolanaWithRetry);

  // kyc for signing contributions
  const kyc = new KycAuthority(KYC_PRIVATE, CONDUCTOR_ADDRESS, contributor);

  before("Airdrop SOL", async () => {
    await connection.requestAirdrop(buyer.publicKey, 8000000000); // 8,000,000,000 lamports

    // do we need to wait for the airdrop to hit a wallet?
    await wait(5);
  });

  describe("Test Preparation", () => {
    it("Create Dummy Sale Token", async () => {
      // we need to simulate attesting the sale token on Solana.
      // this allows us to "redeem" the sale token prior to sealing the sale
      // (which in the case of this test means minting it on the contributor program's ATA)
      await dummyConductor.attestSaleToken(connection, orchestrator);
    });

    it("Attest Accepted Token from Ethereum", async () => {
      // we have two token bridge actions: create wrapped and bridge
      let emitterSequence = 0;

      // fabricate token address
      const tokenAddress = Buffer.alloc(32);
      tokenAddress.fill(105, 12);

      const ethTokenBridge = Buffer.from(
        tryNativeToHexString("0x0290FB167208Af455bB137780163b7B7a9a10C16", CHAIN_ID_ETH),
        "hex"
      );

      const attestMetaSignedVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++emitterSequence,
        encodeAttestMeta(tokenAddress, CHAIN_ID_ETH, 9, "WORTH", "Definitely Worth Something")
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        attestMetaSignedVaa,
        10
      );

      {
        const response = await createWrappedOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          orchestrator.publicKey.toString(),
          Uint8Array.from(attestMetaSignedVaa)
        )
          .then((transaction) => {
            transaction.partialSign(orchestrator);
            return connection.sendRawTransaction(transaction.serialize());
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      const mint = new web3.PublicKey(
        await getForeignAssetSolana(connection, TOKEN_BRIDGE_ADDRESS.toString(), CHAIN_ID_ETH, tokenAddress)
      );
      const tokenIndex = 2;
      dummyConductor.addAcceptedToken(tokenIndex, mint);

      // create ata for buyer
      const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);

      // now mint to buyer for testing
      let amount = new BN("200000000000");
      const tokenTransferSignedVaa = signAndEncodeVaa(
        0,
        0,
        CHAIN_ID_ETH as number,
        ethTokenBridge,
        ++emitterSequence,
        encodeTokenTransfer(amount.toString(), tokenAddress, CHAIN_ID_ETH, tokenAccount.address)
      );

      await postVaaSolanaWithRetry(
        connection,
        async (tx) => {
          tx.partialSign(orchestrator);
          return tx;
        },
        CORE_BRIDGE_ADDRESS.toString(),
        orchestrator.publicKey.toString(),
        tokenTransferSignedVaa,
        10
      );
      {
        const response = await redeemOnSolana(
          connection,
          CORE_BRIDGE_ADDRESS.toString(),
          TOKEN_BRIDGE_ADDRESS.toString(),
          buyer.publicKey.toString(),
          Uint8Array.from(tokenTransferSignedVaa)
        )
          .then((transaction) => {
            transaction.partialSign(buyer);
            return connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
          })
          .then((tx) => connection.confirmTransaction(tx));
      }

      const balance = await getSplBalance(connection, mint, buyer.publicKey);
      expect(balance.toString()).to.equal(amount.toString());
    });

    it("Mint Accepted SPL Tokens to Buyer", async () => {
      // remaining token indices
      const tokenIndices = [3, 5, 8, 13, 21, 34, 55];

      for (let i = 0; i < tokenIndices.length; ++i) {
        const mint = await createMint(connection, orchestrator, orchestrator.publicKey, orchestrator.publicKey, 9);
        dummyConductor.addAcceptedToken(tokenIndices.at(i), mint);

        // create ata for buyer
        const tokenAccount = await getOrCreateAssociatedTokenAccount(connection, buyer, mint, buyer.publicKey);

        // now mint to buyer for testing
        let amount = new BN("200000000000");
        await mintTo(
          connection,
          orchestrator,
          mint,
          tokenAccount.address,
          orchestrator,
          BigInt(amount.toString()) // 20,000,000,000 lamports
        );

        const balance = await getSplBalance(connection, mint, buyer.publicKey);
        expect(balance.toString()).to.equal(amount.toString());
      }
    });
  });

  describe("Custodian Setup", () => {
    it("Create Custodian", async () => {
      const tx = await contributor.createCustodian(orchestrator);

      // nothing to verify
    });
  });

  describe("Conduct Successful Sale", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      const allowOwnerOffCurve = true;
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        contributor.custodian,
        allowOwnerOffCurve
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address, lockPeriod);
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        expect(saleState.saleTokenMint.toString()).to.equal(dummyConductor.saleTokenOnSolana);
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");

        // check totals
        const assetTotals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(assetTotals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const total = assetTotals.at(i);
          const acceptedToken = dummyConductor.acceptedTokens.at(i);

          expect(total.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(total.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(total.contributions.toString()).to.equal("0");
          expect(total.allocations.toString()).to.equal("0");
          expect(total.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("Orchestrator Cannot Initialize Sale Again with Signed VAA", async () => {
      let caughtError = false;
      try {
        const tx = await contributor.initSale(orchestrator, dummyConductor.initSaleVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        // pda init should fail
        caughtError = "programErrorStack" in e;
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Cannot Contribute Too Early", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "ContributionTooEarly");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Cannot Contribute With Bad Signature", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        // generate bad signature w/ amount that disagrees w/ instruction input
        const badSignature = await kyc.signContribution(saleId, tokenIndex, new BN("42069"), buyer.publicKey);
        const tx = await contributor.contribute(buyer, saleId, tokenIndex, amount, badSignature);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InvalidKycSignature");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Contributes to Sale", async () => {
      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [acceptedTokens.at(0).index, acceptedTokens.at(3).index];
      contributions.set(contributedTokenIndices.at(0), ["1200000000", "3400000000"]);
      contributions.set(contributedTokenIndices.at(1), ["5600000000", "7800000000"]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      const acceptedMints = acceptedTokens.map((token) => hexToPublicKey(token.address));

      const startingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian);
        })
      );

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions.get(tokenIndex).map((value) => new BN(value))) {
          const tx = await contributor.contribute(
            buyer,
            saleId,
            tokenIndex,
            amount,
            await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
          );
        }
      }

      const endingBalanceBuyer = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getSplBalance(connection, mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        acceptedMints.map(async (mint) => {
          return getPdaSplBalance(connection, mint, contributor.custodian);
        })
      );

      const expectedContributedAmounts = [
        totalContributions.at(0),
        new BN(0),
        new BN(0),
        totalContributions.at(1),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // check buyer state
      {
        const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
        const buyerTotals = buyerState.contributions as any[];
        expect(buyerTotals.length).to.equal(numExpected);

        // check balance changes and state
        for (let i = 0; i < numExpected; ++i) {
          let contribution = expectedContributedAmounts.at(i);
          expect(startingBalanceBuyer.at(i).sub(contribution).toString()).to.equal(endingBalanceBuyer.at(i).toString());
          expect(startingBalanceCustodian.at(i).add(contribution).toString()).to.equal(
            endingBalanceCustodian.at(i).toString()
          );

          let buyerTotal = buyerTotals.at(i);
          const expectedState = contribution.eq(new BN("0")) ? "inactive" : "active";
          expect(buyerTotal.status).has.key(expectedState);
          expect(buyerTotal.amount.toString()).to.equal(contribution.toString());
          expect(buyerTotal.excess.toString()).to.equal("0");
        }
      }

      // check sale state
      {
        const saleState = await contributor.getSale(saleId);
        const assetTotals = saleState.totals as any[];
        expect(assetTotals.length).to.equal(numExpected);

        for (let i = 0; i < numExpected; ++i) {
          const assetTotal = assetTotals.at(i);
          expect(assetTotal.contributions.toString()).to.equal(expectedContributedAmounts.at(i).toString());
          expect(assetTotal.allocations.toString()).to.equal("0");
          expect(assetTotal.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("Orchestrator Cannot Attest Contributions Too Early", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.attestContributions(orchestrator, saleId);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleNotAttestable");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Attests Contributions", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait for sale to end here
      const saleEnd = dummyConductor.saleEnd;
      await waitUntilBlock(connection, saleEnd);
      const tx = await contributor.attestContributions(orchestrator, saleId, { commitment: "confirmed" });

      const expectedContributedAmounts = [
        totalContributions.at(0),
        new BN(0),
        new BN(0),
        totalContributions.at(1),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedContributedAmounts.length;

      // now go about your business. read VAA back.
      const payload = await connection
        .getAccountInfo(contributor.deriveAttestContributionsMessageAccount(saleId))
        .then((info) => info.data.subarray(95) /* 95 is where the payload starts */);

      const headerLength = 33;
      const contributionLength = 33;
      expect(payload.length).to.equal(headerLength + 3 + contributionLength * numExpected);

      const payloadId = 2;
      expect(payload.readUint8(0)).to.equal(payloadId);
      expect(payload.subarray(1, 33).toString("hex")).to.equal(saleId.toString("hex"));
      expect(payload.readUint16BE(33)).to.equal(CHAIN_ID_SOLANA as number);
      expect(payload.readUint8(35)).to.equal(numExpected);

      const contributionsStart = headerLength + 3;
      for (let i = 0; i < dummyConductor.acceptedTokens.length; ++i) {
        const start = contributionsStart + contributionLength * i;

        const tokenIndex = payload.readUint8(start);
        expect(tokenIndex).to.equal(dummyConductor.acceptedTokens.at(i).index);

        const amount = new BN(payload.subarray(start + 1, start + 33));
        expect(amount.toString()).to.equal(expectedContributedAmounts.at(i).toString());
      }
    });

    it("User Cannot Contribute After Sale Ended", async () => {
      const saleId = dummyConductor.getSaleId();
      const tokenIndex = 2;
      const amount = new BN("1000000000"); // 1,000,000,000 lamports

      let caughtError = false;
      try {
        const tx = await contributor.contribute(
          buyer,
          saleId,
          tokenIndex,
          amount,
          await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
        );
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Cannot Seal Sale Without Allocation Bridge Transfers Redeemed", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "InsufficientFunds");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Cannot Bridge Before SaleSealed VAA Processed", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assetTotals = sale.totals as any[];

      let caughtError = false;
      try {
        const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, assetTotals.at(0).mint);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleNotSealed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Seals Sale with Signed VAA", async () => {
      // all we're doing here is minting spl tokens to replicate token bridge's mechanism
      // of unlocking or minting tokens to someone's associated token account
      await dummyConductor.redeemAllocationsOnSolana(connection, orchestrator, contributor.custodian);

      // now go about your business
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);
      const allocations = dummyConductor.allocations;

      const tx = await contributor.sealSale(orchestrator, saleSealedVaa);

      {
        // get the first sale state
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(saleState.status).has.key("sealed");

        const assetTotals = saleState.totals as any[];
        expect(assetTotals.length).to.equal(allocations.length);

        const allocationDivisor = dummyConductor.getAllocationMultiplier();
        for (let i = 0; i < assetTotals.length; ++i) {
          const assetTotal = assetTotals.at(i);
          const expected = allocations.at(i);

          const adjustedAllocation = BigNumber.from(expected.allocation).div(allocationDivisor).toString();
          expect(assetTotal.allocations.toString()).to.equal(adjustedAllocation);
          expect(assetTotal.excessContributions.toString()).to.equal(expected.excessContribution);

          if (expected.allocation == "0") {
            expect(assetTotal.status).has.key("nothingToTransfer");
          } else {
            expect(assetTotal.status).has.key("readyForTransfer");
          }
        }
      }
    });

    it("Orchestrator Cannot Seal Sale Again with Signed VAA", async () => {
      const saleSealedVaa = dummyConductor.sealSale(await getBlockTime(connection), contributions);

      let caughtError = false;
      try {
        const tx = await contributor.sealSale(orchestrator, saleSealedVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("Orchestrator Bridges Contributions to Conductor", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assetTotals = sale.totals as any[];

      const expectedContributedAmounts = [
        totalContributions.at(0),
        new BN(0),
        new BN(0),
        totalContributions.at(1),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const expectedSealedAmounts = dummyConductor.allocations.map((item, i) =>
        expectedContributedAmounts.at(i).sub(new BN(item.excessContribution))
      );
      const numExpected = expectedSealedAmounts.length;

      // token bridge truncates to 8 decimals
      const tokenBridgeDecimals = 8;

      for (let i = 0; i < numExpected; ++i) {
        const assetTotal = assetTotals.at(i);
        if (assetTotal.status.readyForTransfer) {
          const mint = assetTotal.mint;
          const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, mint, {
            commitment: "confirmed",
          });

          // now go about your business. read VAA back.
          const payload = await connection
            .getAccountInfo(contributor.deriveSealedTransferMessageAccount(saleId, mint))
            .then((info) => info.data.subarray(95) /* 95 is where the payload starts */);
          expect(payload.length).to.equal(133); // 1 + 32 + 32 + 2 + 32 + 2 + 32
          expect(payload.at(0)).to.equal(1); // payload 1 is token transfer

          const parsedAmount = new BN(payload.subarray(1, 33));
          const mintInfo = await getMint(connection, mint);

          const divisor = (() => {
            const decimals = mintInfo.decimals;
            if (decimals > tokenBridgeDecimals) {
              return new BN("10").pow(new BN(decimals - tokenBridgeDecimals));
            } else {
              return new BN("1");
            }
          })();
          expect(parsedAmount.toString()).to.equal(expectedSealedAmounts.at(i).div(divisor).toString());

          const parsedTokenAddress = payload.subarray(33, 65);
          const parsedTokenChain = payload.readUint16BE(65);

          const tokenMintSigner = deriveAddress([Buffer.from("mint_signer")], TOKEN_BRIDGE_ADDRESS);
          if (mintInfo.mintAuthority.equals(tokenMintSigner)) {
            // wrapped, so get native info
            const nativeInfo = await getOriginalAssetSol(connection, TOKEN_BRIDGE_ADDRESS.toString(), mint.toString());
            expect(uint8ArrayToHex(nativeInfo.assetAddress)).to.equal(parsedTokenAddress.toString("hex"));
            expect(parsedTokenChain).to.equal(nativeInfo.chainId as number);
          } else {
            // native, so use pubkeys
            expect(new web3.PublicKey(parsedTokenAddress).toString()).to.equal(mint.toString());
            expect(parsedTokenChain).to.equal(CHAIN_ID_SOLANA as number);
          }

          const parsedTo = payload.subarray(67, 99);
          expect(parsedTo.toString("hex")).to.equal(dummyConductor.recipient);

          const parsedToChain = payload.readUint16BE(99);
          expect(parsedToChain).to.equal(CONDUCTOR_CHAIN);

          const parsedFee = payload.subarray(101, 133);
          expect(new BN(parsedFee).toString()).to.equal("0");
        } else {
          let caughtError = false;
          try {
            const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, assetTotal.mint);
            throw Error(`should not happen: ${tx}`);
          } catch (e) {
            caughtError = verifyErrorMsg(e, "TransferNotAllowed");
          }

          if (!caughtError) {
            throw Error("did not catch expected error");
          }
        }
      }
    });

    it("Orchestrator Cannot Bridge Contribution Again", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assetTotals = sale.totals as any[];

      let caughtError = false;
      try {
        const tx = await contributor.bridgeSealedContribution(orchestrator, saleId, assetTotals.at(0).mint);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "TransferNotAllowed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Claims Contribution Excess From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assetTotals = sale.totals as any[];

      const startingBalanceBuyer = await Promise.all(
        assetTotals.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        assetTotals.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const tx = await contributor.claimExcesses(buyer, saleId);

      const endingBalanceBuyer = await Promise.all(
        assetTotals.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        assetTotals.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      // verify excesses
      const expectedExcessAmounts = dummyConductor.allocations.map((item) => new BN(item.excessContribution));
      const numExpected = expectedExcessAmounts.length;

      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const buyerTotals = buyerState.contributions as any[];
      expect(buyerTotals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let excess = expectedExcessAmounts.at(i);

        expect(startingBalanceBuyer.at(i).add(excess).toString()).to.equal(endingBalanceBuyer.at(i).toString());
        expect(startingBalanceCustodian.at(i).sub(excess).toString()).to.equal(endingBalanceCustodian.at(i).toString());

        const buyerTotal = buyerTotals.at(i);
        expect(buyerTotal.status).has.key("excessClaimed");
        expect(buyerTotal.excess.toString()).to.equal(excess.toString());
      }
    });

    it("User Cannot Claim Excess Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimExcesses(buyer, saleId);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Cannot Claim Allocations Before Sale Unlock", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimAllocation(buyer, saleId);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AllocationsLocked");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Claims Allocations From Sale", async () => {
      const saleId = dummyConductor.getSaleId();

      // wait until unlock
      const saleUnlock = dummyConductor.saleUnlock;
      await waitUntilBlock(connection, saleUnlock);

      const tx = await contributor.claimAllocation(buyer, saleId);

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      expect(buyerState.allocation.claimed).to.be.true;

      const allocationDivisor = new BN(dummyConductor.getAllocationMultiplier());
      const expectedAllocation = dummyConductor.allocations
        .map((item) => new BN(item.allocation))
        .reduce((prev, curr) => prev.add(curr))
        .div(allocationDivisor);
      expect(buyerState.allocation.amount.toString()).to.equal(expectedAllocation.toString());
    });

    it("User Cannot Claim Allocations Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimAllocation(buyer, saleId);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });
  });

  describe("Conduct Aborted Sale", () => {
    // global contributions for test
    const contributions = new Map<number, string[]>();
    const totalContributions: BN[] = [];

    // squirrel away associated sale token account
    let saleTokenAccount: AssociatedTokenAccount;

    it("Create ATA for Sale Token if Non-Existent", async () => {
      const allowOwnerOffCurve = true;
      saleTokenAccount = await getOrCreateAssociatedTokenAccount(
        connection,
        orchestrator,
        dummyConductor.getSaleTokenOnSolana(),
        contributor.custodian,
        allowOwnerOffCurve
      );
    });

    it("Orchestrator Initialize Sale with Signed VAA", async () => {
      const startTime = 8 + (await getBlockTime(connection));
      const duration = 8; // seconds after sale starts
      const lockPeriod = 12; // seconds after sale ended
      const initSaleVaa = dummyConductor.createSale(startTime, duration, saleTokenAccount.address, lockPeriod);
      const tx = await contributor.initSale(orchestrator, initSaleVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);

        // verify
        expect(Uint8Array.from(saleState.id)).to.deep.equal(saleId);
        expect(saleState.saleTokenMint.toString()).to.equal(dummyConductor.saleTokenOnSolana);
        expect(saleState.tokenChain).to.equal(dummyConductor.tokenChain);
        expect(saleState.tokenDecimals).to.equal(dummyConductor.tokenDecimals);
        expect(saleState.nativeTokenDecimals).to.equal(dummyConductor.nativeTokenDecimals);
        expect(saleState.times.start.toString()).to.equal(dummyConductor.saleStart.toString());
        expect(saleState.times.end.toString()).to.equal(dummyConductor.saleEnd.toString());
        expect(saleState.times.unlockAllocation.toString()).to.equal(dummyConductor.saleUnlock.toString());
        expect(Uint8Array.from(saleState.recipient)).to.deep.equal(Buffer.from(dummyConductor.recipient, "hex"));
        expect(Uint8Array.from(saleState.kycAuthority)).to.deep.equal(Buffer.from(dummyConductor.kycAuthority, "hex"));
        expect(saleState.status).has.key("active");

        // check totals
        const assetTotals = saleState.totals as any[];
        const numAccepted = dummyConductor.acceptedTokens.length;
        expect(assetTotals.length).to.equal(numAccepted);

        for (let i = 0; i < numAccepted; ++i) {
          const assetTotal = assetTotals.at(i);
          const acceptedToken = dummyConductor.acceptedTokens.at(i);

          expect(assetTotal.tokenIndex).to.equal(acceptedToken.index);
          expect(tryNativeToHexString(assetTotal.mint.toString(), CHAIN_ID_SOLANA)).to.equal(acceptedToken.address);
          expect(assetTotal.contributions.toString()).to.equal("0");
          expect(assetTotal.allocations.toString()).to.equal("0");
          expect(assetTotal.excessContributions.toString()).to.equal("0");
        }
      }
    });

    it("User Contributes to Sale", async () => {
      // wait for sale to start here
      const saleStart = dummyConductor.saleStart;
      await waitUntilBlock(connection, saleStart);

      // prep contributions info
      const acceptedTokens = dummyConductor.acceptedTokens;
      const contributedTokenIndices = [acceptedTokens.at(0).index, acceptedTokens.at(3).index];
      contributions.set(contributedTokenIndices.at(0), ["1200000000", "3400000000"]);
      contributions.set(contributedTokenIndices.at(1), ["5600000000", "7800000000"]);

      contributedTokenIndices.forEach((tokenIndex) => {
        const amounts = contributions.get(tokenIndex);
        totalContributions.push(amounts.map((x) => new BN(x)).reduce((prev, curr) => prev.add(curr)));
      });

      // now go about your business
      // contribute multiple times
      const saleId = dummyConductor.getSaleId();
      for (const tokenIndex of contributedTokenIndices) {
        for (const amount of contributions.get(tokenIndex).map((value) => new BN(value))) {
          const tx = await contributor.contribute(
            buyer,
            saleId,
            tokenIndex,
            amount,
            await kyc.signContribution(saleId, tokenIndex, amount, buyer.publicKey)
          );
        }
      }
    });

    it("Orchestrator Aborts Sale with Signed VAA", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(await getBlockTime(connection));
      const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);

      {
        const saleId = dummyConductor.getSaleId();
        const saleState = await contributor.getSale(saleId);
        expect(saleState.status).has.key("aborted");
      }
    });

    it("Orchestrator Cannot Abort Sale Again", async () => {
      const saleAbortedVaa = dummyConductor.abortSale(await getBlockTime(connection));
      // cannot abort the sale again

      let caughtError = false;
      try {
        const tx = await contributor.abortSale(orchestrator, saleAbortedVaa);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "SaleEnded");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });

    it("User Claims Refund From Sale", async () => {
      const saleId = dummyConductor.getSaleId();
      const sale = await contributor.getSale(saleId);
      const assetTotals = sale.totals as any[];

      const startingBalanceBuyer = await Promise.all(
        assetTotals.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const startingBalanceCustodian = await Promise.all(
        assetTotals.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const tx = await contributor.claimRefunds(buyer, saleId);

      const endingBalanceBuyer = await Promise.all(
        assetTotals.map(async (asset) => {
          return getSplBalance(connection, asset.mint, buyer.publicKey);
        })
      );
      const endingBalanceCustodian = await Promise.all(
        assetTotals.map(async (asset) => {
          return getPdaSplBalance(connection, asset.mint, contributor.custodian);
        })
      );

      const expectedRefundAmounts = [
        totalContributions.at(0),
        new BN(0),
        new BN(0),
        totalContributions.at(1),
        new BN(0),
        new BN(0),
        new BN(0),
        new BN(0),
      ];
      const numExpected = expectedRefundAmounts.length;

      // get state
      const buyerState = await contributor.getBuyer(saleId, buyer.publicKey);
      const buyerTotals = buyerState.contributions as any[];
      expect(buyerTotals.length).to.equal(numExpected);

      // check balance changes and state
      for (let i = 0; i < numExpected; ++i) {
        let refund = expectedRefundAmounts.at(i);

        expect(startingBalanceBuyer.at(i).add(refund).toString()).to.equal(endingBalanceBuyer.at(i).toString());
        expect(startingBalanceCustodian.at(i).sub(refund).toString()).to.equal(endingBalanceCustodian.at(i).toString());

        const buyerTotal = buyerTotals.at(i);
        expect(buyerTotal.status).has.key("refundClaimed");
        expect(buyerTotal.excess.toString()).to.equal(refund.toString());
      }
    });

    it("User Cannot Claim Refund Again", async () => {
      const saleId = dummyConductor.getSaleId();

      let caughtError = false;
      try {
        const tx = await contributor.claimRefunds(buyer, saleId);
        throw Error(`should not happen: ${tx}`);
      } catch (e) {
        caughtError = verifyErrorMsg(e, "AlreadyClaimed");
      }

      if (!caughtError) {
        throw Error("did not catch expected error");
      }
    });
  });
});

async function waitUntilBlock(connection: web3.Connection, expiration: number) {
  let blockTime = await getBlockTime(connection);
  while (blockTime <= expiration) {
    await wait(1);
    blockTime = await getBlockTime(connection);
  }
}

function verifyErrorMsg(e: any, msg: string): boolean {
  if (e.msg) {
    const result = e.msg == msg;
    if (!result) {
      console.error(e);
    }
    return result;
  } else if (e.error) {
    const result = e.error.errorMessage == msg;
    if (!result) {
      console.error(e);
    }
    return result;
  }

  console.error(e);
  throw Error("unknown error");
}
