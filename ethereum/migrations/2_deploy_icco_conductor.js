const TokenSaleConductor = artifacts.require("TokenSaleConductor");
const ConductorImplementation = artifacts.require("ConductorImplementation");
const ConductorSetup = artifacts.require("ConductorSetup");
const ICCOStructs = artifacts.require("ICCOStructs");
const ErrorCodes = artifacts.require("ICCOErrorCodes");

const ethereumRootPath = `${__dirname}/..`;
const DeploymentConfig = require(`${ethereumRootPath}/icco_deployment_config.js`);

const fs = require("fs");
const path = require("path");

module.exports = async function(deployer, network) {
  const config = DeploymentConfig[network];
  if (!config) {
    throw Error("deployment config undefined");
  }

  // deploy the ICCO Error codes contract
  await deployer.deploy(ErrorCodes);

  // deploy ICCOStructs library
  await deployer.deploy(ICCOStructs);
  await deployer.link(ICCOStructs, ConductorImplementation);

  // deploy conductor implementation
  await deployer.deploy(ConductorImplementation);

  if (!config.deployImplementationOnly) {
    // deploy conductor setup
    await deployer.deploy(ConductorSetup);

    // encode initialisation data
    const conductorSetup = new web3.eth.Contract(
      ConductorSetup.abi,
      ConductorSetup.address
    );
    const conductorInitData = conductorSetup.methods
      .setup(
        ConductorImplementation.address,
        config.conductorChainId,
        config.wormhole,
        config.tokenBridge,
        config.consistencyLevel
      )
      .encodeABI();

    // deploy conductor proxy
    await deployer.deploy(
      TokenSaleConductor,
      ConductorSetup.address,
      conductorInitData
    );
  }

  // cache address depending on whether contract
  // has been deployed to mainnet, testnet or devnet
  // NB: there should only be one conductor living
  // among all the icco contracts. So there should only
  // be three network conditionals, one for each
  // mainnet, testnet and devnet

  // saves in all cases fresh deployments
  if (!config.deployImplementationOnly) {
    const fp = path.join(__dirname, "deployedAddresses.json");
    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : { conductor: {}, contributor: [] };
    const conductor = {
      conductorNetwork: network,
      conductorChain: parseInt(config.conductorChainId),
      conductorAddress: TokenSaleConductor.address,
      conductorContracts: {
        ICCOErrorCodes: ErrorCodes.address,
        ICCOStructs: ICCOStructs.address,
        ConductorImplementation: ConductorImplementation.address,
        ConductorSetup: ConductorSetup.address,
        TokenSaleConductor: TokenSaleConductor.address,
      },
      verificationString: {
        ICCOErrorCodes: `truffle run verify ICCOErrorCodes@${ErrorCodes.address} --network=${network}`,
        ICCOStructs: `truffle run verify ICCOStructs@${ICCOStructs.address} --network=${network}`,
        ConductorImplementation: `truffle run verify ConductorImplementation@${ConductorImplementation.address} --network=${network}`,
        ConductorSetup: `truffle run verify ConductorSetup@${ConductorSetup.address} --network=${network}`,
        TokenSaleConductor: `truffle run verify TokenSaleConductor@${TokenSaleConductor.address} --network=${network}`,
      },
    };
    contents.conductor = conductor;

    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }

  // devnet
  if (network == "eth_devnet") {
    const fp = `${ethereumRootPath}/../tilt.json`;

    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : {};
    contents.conductorAddress = TokenSaleConductor.address;
    contents.conductorChain = parseInt(config.conductorChainId);
    contents.errorCodesAddress = ErrorCodes.address;
    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }

  // testnet deployments
  if (network == "goerli" || network == "fuji") {
    const fp = `${ethereumRootPath}/../testnet.json`;

    const contents = fs.existsSync(fp)
      ? JSON.parse(fs.readFileSync(fp, "utf8"))
      : {};
    // add the ErrorCodes contract address to the testnet.json file
    contents.errorCodesAddress = ErrorCodes.address;
    if (!config.deployImplementationOnly) {
      contents.conductorAddress = TokenSaleConductor.address;
      contents.conductorChain = parseInt(config.conductorChainId);
    } else {
      const implementationString = network.concat("ConductorImplementation");
      contents[implementationString] = ConductorImplementation.address;
    }

    fs.writeFileSync(fp, JSON.stringify(contents, null, 2), "utf8");
  }
};
