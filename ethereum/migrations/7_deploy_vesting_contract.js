const Vesting = artifacts.require("VestingWallet");
const ethereumRootPath = `${__dirname}/..`;
const DeploymentConfig = require(`${ethereumRootPath}/icco_deployment_config.js`);

const fs = require("fs");
const path = require("path");

module.exports = async function(deployer, network) {
  const config = DeploymentConfig[network];
  if (!config) {
    throw Error("deployment config undefined");
  }
  
  let nowTime = new Date().getTime() / 1000;
  nowTime = parseInt(Math.floor(nowTime));

  const vestingDetails = {
    _cliffStartTimeInSeconds: nowTime.toString(),
    _cliffPercentage: "50",
    _linearStartTimeInSeconds: (nowTime + 60).toString(),
    _linearEndTimeInSeconds: (nowTime + 3600).toString()
  }

  let file = fs.readFileSync(path.join(__dirname, "deployedAddresses.json"));
  file = JSON.parse(file);
  const selectedContributor = file.contributor.filter((element) => {
    return (element.contributorNetwork == network);
  })

  console.log("selectedContributor", selectedContributor[0].address);

  console.log("vestingDetails", vestingDetails);

  await deployer.deploy(Vesting, vestingDetails, selectedContributor[0].contributorAddress);

  const fp = path.join(__dirname, "vestingAddresses.json");
  let contents = fs.existsSync(fp)
        ? JSON.parse(fs.readFileSync(fp, "utf8"))
        : { Vesting: [] };

  const VestingDetails = {
    network: network,
    chain: parseInt(config.contributorChainId),
    contractAddress: Vesting.address,
    vestingParameters: vestingDetails,
    creationEPOCH: nowTime,
    verificationScript: `truffle run verify VestingWallet@${Vesting.address} --network=${network}`,
  }

  let index = contents.Vesting.findIndex(item => item.network == network);
  if(index == -1) {
    contents.Vesting.push(VestingDetails);
  }
  else{
    contents.Vesting[index] = VestingDetails;
  }

  fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");

};
