const fs = require("fs");
const HDWalletProvider = require("@truffle/hdwallet-provider");

let DeploymentConfig;

function prepareConfig() {
  // expected config path
  const configPath = `${__dirname}/icco_deployment_config.js`;

  // create dummy object if deployment config doesn't exist
  // for compilation purposes
  if (fs.existsSync(configPath)) {
    DeploymentConfig = require(configPath);
  } else {
    DeploymentConfig = {};
  }
}
prepareConfig();

module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
    },
    // for tilt (eth-devnet)
    eth_devnet: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*",
    },
    // for tilt (eth-devnet2)
    eth_devnet2: {
      host: "127.0.0.1",
      port: 8546,
      network_id: "*",
    },
    mainnet: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["mainnet"].mnemonic,
          DeploymentConfig["mainnet"].rpc
        ),
      network_id: "1",
      networkCheckTimeout: 10000,
      timeoutBlocks: 2000,
      skipDryRun: false,
    },
    goerli: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["goerli"].mnemonic,
          DeploymentConfig["goerli"].rpc
        );
      },
      network_id: "5",
      networkCheckTimeout: 10000,
      timeoutBlocks: 2000,
    },
    binance: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["binance"].mnemonic,
          DeploymentConfig["binance"].rpc
        );
      },
      network_id: "56",
      networkCheckTimeout: 10000,
      timeoutBlocks: 2000,
    },
    binance_testnet: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["binance_testnet"].mnemonic,
          DeploymentConfig["binance_testnet"].rpc
        ),
      network_id: "97",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    polygon: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["polygon"].mnemonic,
          DeploymentConfig["polygon"].rpc
        );
      },
      network_id: "137",
      networkCheckTimeout: 10000,
      timeoutBlocks: 2000,
    },
    mumbai: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["mumbai"].mnemonic,
          DeploymentConfig["mumbai"].rpc
        );
      },
      network_id: "80001",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    avalanche: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["avalanche"].mnemonic,
          DeploymentConfig["avalanche"].rpc
        );
      },
      network_id: "43114",
      networkCheckTimeout: 10000,
      timeoutBlocks: 2000,
    },
    fuji: {
      provider: () =>
        new HDWalletProvider(
          DeploymentConfig["fuji"].mnemonic,
          DeploymentConfig["fuji"].rpc
        ),
      network_id: "43113",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    fantom: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["fantom"].mnemonic,
          DeploymentConfig["fantom"].rpc
        );
      },
      network_id: "250",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    fantom_testnet: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["fantom_testnet"].mnemonic,
          DeploymentConfig["fantom_testnet"].rpc
        );
      },
      network_id: 0xfa2,
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    arbitrum: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["arbitrum"].mnemonic,
          DeploymentConfig["arbitrum"].rpc
        );
      },
      network_id: "42161",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    arbitrum_testnet: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["arbitrum_testnet"].mnemonic,
          DeploymentConfig["arbitrum_testnet"].rpc
        );
      },
      network_id: "421613",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    optimism: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["optimism"].mnemonic,
          DeploymentConfig["optimism"].rpc
        );
      },
      network_id: "10",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
    optimism_testnet: {
      provider: () => {
        return new HDWalletProvider(
          DeploymentConfig["optimism_testnet"].mnemonic,
          DeploymentConfig["optimism_testnet"].rpc
        );
      },
      network_id: "420",
      networkCheckTimeout: 100000,
      timeoutBlocks: 20000,
    },
  },

  compilers: {
    solc: {
      version: "0.8.4",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
    solc: {
      version: "0.8.17",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200,
        },
      },
    },
  },

  plugins: [
    "@chainsafe/truffle-plugin-abigen",
    "truffle-plugin-verify",
    "truffle-contract-size",
  ],
  api_keys: {
    etherscan: "",
    snowtrace: "",
    polygonscan: "",
    bscscan: "",
    ftmscan: "",
    arbiscan: "",
    optimistic_etherscan: "",
  },
};
