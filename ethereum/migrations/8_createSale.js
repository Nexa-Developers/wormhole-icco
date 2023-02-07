const ConductorImplementation = artifacts.require("ConductorImplementation");
const TokenImplementation = artifacts.require("TokenImplementation");
const {
  hexToUint8Array,
  uint8ArrayToHex,
} = require("@certusone/wormhole-sdk");
const { zeroPad } = require("@ethersproject/bytes");

const fs = require("fs");
const path = require("path");

module.exports = async function(deployer, network, accounts) {
  const projectTokenAddress = "0x065fA01fB472ba2FaF8dcf66F3bE89Fd7667D9C0";
  const fujiUSDT = "0x17dC1446ff1fDb6b2093B9E9b057A772fBb07F95";
  const bscUSDT = "0xA9c64Bdbeb7918C4c3F1cc8B83E044D8F5e3203f";
  const tokenAmount = "100000000000000000000"; // 100 tokens 18 decimals

  let file = fs.readFileSync(path.join(__dirname, "deployedAddresses.json"));
  file = JSON.parse(file);

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

  let conductorAddress = file.conductor.conductorAddress;
  const conductor = await ConductorImplementation.at(conductorAddress);
  let erc20 = await TokenImplementation.at(projectTokenAddress);

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

  console.log(createSaleData);

  let allowance = await erc20.allowance(
    accounts[0],
    file.conductor.conductorAddress
  );
  allowance = parseInt(BigInt(allowance).toString());
  if (allowance < tokenAmount) {
    const approve = await erc20.approve(
      file.conductor.conductorAddress,
      tokenAmount
    );
    console.log("token approved...");
  }
  const tx = await conductor.createSale(
    createSaleData.Raise,
    createSaleData.Token,
    createSaleData.Vesting
  );
  console.log("sale created: ", tx);

};
