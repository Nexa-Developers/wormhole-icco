const Vesting = require("../build/contracts/VestingWallet.json");
const ConductorImplementation = require("../build/contracts/ConductorImplementation.json");
const TokenImplementation = require("../build/contracts/TokenImplementation.json");
const ethereumRootPath = `${__dirname}/..`;
const DeploymentConfig = require(`${ethereumRootPath}/icco_deployment_config.js`);
const ethers = require("ethers");

const {
  hexToUint8Array,
  uint8ArrayToHex,
} = require("@certusone/wormhole-sdk");
const { zeroPad } = require("@ethersproject/bytes");

const { NodeHttpTransport } = require("@improbable-eng/grpc-web-node-http-transport");

const {
  parseSequencesFromLogEth,
  getSignedVAAWithRetry,
  getSignedVAA,
  getEmitterAddressEth,
  uint8ArrayToHex
} = require("@certusone/wormhole-sdk");

const fs = require("fs");
const path = require("path");

async function main() {
  let nowTime = new Date().getTime() / 1000;
  nowTime = parseInt(Math.floor(nowTime));

  const vestingDetails = {
    _cliffStartTimeInSeconds: nowTime.toString(),
    _cliffPercentage: "50",
    _linearStartTimeInSeconds: (nowTime + 60).toString(),
    _linearEndTimeInSeconds: (nowTime + 3600).toString()
  };
  const projectTokenAddress = "0x065fA01fB472ba2FaF8dcf66F3bE89Fd7667D9C0";
  const fujiUSDT = "0x17dC1446ff1fDb6b2093B9E9b057A772fBb07F95";
  const bscUSDT = "0xA9c64Bdbeb7918C4c3F1cc8B83E044D8F5e3203f";
  const tokenAmount = "100000000000000000000"; // 100 tokens 18 decimals

  let file = fs.readFileSync(path.join(__dirname, "deployedAddresses.json"));
  file = JSON.parse(file);

  ////////////////// DEPLOY VESTING CONTRACTS /////////////////////////

  for (const contributor of file.contributor) {

    if(contributor.contributorChain == 6 || contributor.contributorChain == 4){}
    else{
        continue;
    }

    const config = DeploymentConfig[contributor.contributorNetwork];
    const privateKey = config.mnemonic;
    const rpc = config.rpc;
    const provider = new ethers.providers.JsonRpcProvider(rpc);
    const wallet = new ethers.Wallet(privateKey, provider);

    const vestingContract = new ethers.ContractFactory(
      Vesting.abi,
      Vesting.bytecode,
      wallet
    );
    const vestingDeployed = await vestingContract.deploy(
      vestingDetails,
      contributor.contributorAddress
    );

    await vestingDeployed.deployed();

    console.log("vestingDeployed on chainId: ",contributor.contributorChain);

    const fp = path.join(__dirname, "vestingAddresses.json");
    let contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : { Vesting: [] };

    const VestingDetails = {
      network: contributor.contributorNetwork,
      chain: parseInt(config.contributorChainId),
      contractAddress: vestingDeployed.address,
      vestingParameters: vestingDetails,
      creationEPOCH: nowTime,
      verificationScript: `truffle run verify VestingWallet@${vestingDeployed.address} --network=${contributor.contributorNetwork}`,
    };

    let index = contents.Vesting.findIndex((item) => item.network == contributor.contributorNetwork);
    if (index == -1) {
      contents.Vesting.push(VestingDetails);
    } else {
      contents.Vesting[index] = VestingDetails;
    }

    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }

  //////////////////// CREATE SALE USING VESTING CONTRACTS //////////////////////////////

  let vestingFile = fs.readFileSync(path.join(__dirname, "vestingAddresses.json"));
  vestingFile = JSON.parse(vestingFile);

  let vestingFuji;
  let vestingBsc;
  let vestingMumbai;
  let vestingFantom;

  for (const elem of vestingFile.Vesting) {
    if(elem.chain == 6){
      vestingFuji = elem.contractAddress;
    }
    else if(elem.chain == 4){
      vestingBsc = elem.contractAddress;
    }
    else if(elem.chain == 5){
      vestingMumbai = elem.contractAddress;
    }
    else if(elem.chain == 10){
      vestingFantom = elem.contractAddress;
    }
  }

  const createSaleData = {
    Raise: {
      isFixedPrice: true,
      isVested: true,
      token: `0x${uint8ArrayToHex(
        zeroPad(hexToUint8Array(projectTokenAddress.slice(2)), 32)
      )}`,
      tokenChain: 6,
      tokenAmount: tokenAmount,
      minRaise: 1,
      maxRaise: 100,
      saleStart: Math.floor(new Date().getTime() / 1000 + 300),
      saleEnd: Math.floor(new Date().getTime() / 1000 + 900),
      unlockTimestamp: Math.floor(new Date().getTime() / 1000 + 1000),
      recipient: "0x55558c0DA51F1941ce3261e55D2125F6CD7f4630",
      refundRecipient: "0x55558c0DA51F1941ce3261e55D2125F6CD7f4630",
      authority: "0xEB15d7699592E1d8Ddab0073499B17C515AD0630",
    },
    Token: [
      {
        tokenChain: 6,
        tokenAddress: `0x${uint8ArrayToHex(
          zeroPad(hexToUint8Array(fujiUSDT.slice(2)), 32)
        )}`,
        conversionRate: "1",
      },
      {
        tokenChain: 4,
        tokenAddress: `0x${uint8ArrayToHex(
          zeroPad(hexToUint8Array(bscUSDT.slice(2)), 32)
        )}`,
        conversionRate: "1",
      },
    ],
    Vesting: [
      {
        vestingContractAddress: `0x${uint8ArrayToHex(
          zeroPad(hexToUint8Array(vestingFuji.slice(2)), 32)
        )}`,
        vestingContractChain: 6,
      },
      {
        vestingContractAddress: `0x${uint8ArrayToHex(
          zeroPad(hexToUint8Array(vestingBsc.slice(2)), 32)
        )}`,
        vestingContractChain: 4,
      },
    ],
  };

  console.log("Created Sale Data: ",createSaleData);

  const conductor = file.conductor;

  const config = DeploymentConfig[conductor.conductorNetwork];
  const privateKey = config.mnemonic;
  const rpc = config.rpc;
  const provider = new ethers.providers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(privateKey, provider);

  const conductorContract = new ethers.Contract(
    conductor.conductorAddress,
    ConductorImplementation.abi,
    wallet
  )
  const erc20Contract = new ethers.Contract(
    projectTokenAddress,
    TokenImplementation.abi,
    wallet
  )

  let allowance = await erc20Contract.allowance(
    wallet.address,
    conductor.conductorAddress
  );
  allowance = parseInt(BigInt(allowance).toString());
  if (allowance < tokenAmount) {
    const approve = await erc20Contract.approve(
      conductor.conductorAddress,
      tokenAmount
    );

    await approve.wait();
    console.log("token approved...");
  }

  const tx = await conductorContract.createSale(
    createSaleData.Raise,
    createSaleData.Token,
    createSaleData.Vesting
  );

  await tx.wait();
  console.log("sale created: ", tx);

  //////////////////// FIND VAA OF CREATED SALE //////////////////////////////



}

main();
