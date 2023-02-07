# Contract verification

The various EVM explorer sites (etherscan, bscscan, etc.) support contract
verification. This essentially entails uploading the source code to the site,
and they verify that the uploaded source code compiles to the same bytecode
that's actually deployed. This enables the explorer to properly parse the
transaction payloads according to the contract ABI.

This document outlines the process of verification. In general, you will need an
API key for the relevant explorer (this can be obtained by creating an account),
and also know which address the contract code lives. The API key is expected to
be set in the `ETHERSCAN_KEY` environment variable for all APIs (not just
etherscan, bit of a misnomer).

Our contracts are structured as a separate proxy and an implementation. Both of
these components need to be verified, but the proxy contract only needs this
once, since it's not going to change. The implementation contract needs to be
verified each time it's upgraded.

## Verifying the proxy contract (first time)

The proxy contract is called `TokenBridge`. To verify it on e.g. avalanche, at contract address `0x0e082F06FF657D94310cB8cE8B0D9a04541d8052`, run

```
ETHERSCAN_KEY=... npm run verify --module=TokenBridge --contract_address=0x0e082F06FF657D94310cB8cE8B0D9a04541d8052 --network=avalanche
```

(Note: the network name comes from the `truffle-config.json`).
(Note: In this case, the `ETHERSCAN_KEY` is your snowtrace API key).


## Verifying the implementation contract (on each upgrade)

To verify the actual implementation, at address `0xa321448d90d4e5b0a732867c18ea198e75cac48e`, run

```sh
ETHERSCAN_KEY=... npm run verify --module=BridgeImplementation --contract_address=0xa321448d90d4e5b0a732867c18ea198e75cac48e --network=avalanche
```

As a final step, when first registering the proxy contract, we need to verify
that it's a proxy that points to the implementation we just verified. This can
be done on avalanche at
https://snowtrace.io/proxyContractChecker?a=0x0e082F06FF657D94310cB8cE8B0D9a04541d8052

(other evm scanner sites have an identical page).


# Note
The `npm run verify` script uses the `truffle-plugin-verify` plugin under the
hood.  The version of `truffle-plugin-verify` pinned in the repo (`^0.5.11` at
the time of writing) doesn't support the avalanche RPC. In later versions of the
plugin, support was added, but other stuff has changed as well in the transitive
dependencies, so it fails to parse the `HDWallet` arguments in our
`truffle-config.json`. As a quick workaround, we backport the patch to `0.5.11`
by applying the `truffle-verify-constants.patch` file, which the `npm run
verify` script does transparently. Once the toolchain has been upgraded and the
errors fixed, this patch can be removed.


# Example Scripts to Verify

npm run verify --module=ICCOErrorCodes --contract_address="0x2871641EF7839c03Eb0060e1b337607Ca886E354" --network=fuji &&
npm run verify --module=ICCOStructs --contract_address="0xE1e409f5A01681880D2EDa12d289C68DCaD76f39" --network=fuji &&
npm run verify --module=ConductorImplementation --contract_address="0xB58b14623aa834735D7bC1661E302A135256b5f7" --network=fuji &&
npm run verify --module=ConductorSetup --contract_address="0xcB9335E9F166dF92649EC591394F8cc4E9b0F009" --network=fuji &&
npm run verify --module=TokenSaleConductor --contract_address="0x9e5478fcE151326c34A51991D6Ba73A07903a7F8" --network=fuji

npm run verify --module=ICCOStructs --contract_address="0x8B87bC3B133072841c8C7bC222753487f2ed617f" --network=fuji &&
npm run verify --module=ContributorImplementation --contract_address="0x33CF4abb72c3cD3E1Ea1cB904Ba92DFC454d687F" --network=fuji &&
npm run verify --module=ContributorSetup --contract_address="0x51a3bFd7682Ed38FEE1940406c7cD743bd283122" --network=fuji &&
npm run verify --module=TokenSaleContributor --contract_address="0x3Dd418b3272026A3b8fb9C04E71CEf4c4130a02b" --network=fuji

npm run verify --module=ICCOStructs --contract_address="0x10B95334F9955EF60b017Ac96Bf72c6019F521Aa" --network=mumbai &&
npm run verify --module=ContributorImplementation --contract_address="0xF28747F3Ea43fc2899e5aA0b2354958b7EF54139" --network=mumbai &&
npm run verify --module=ContributorSetup --contract_address="0xa682c012DDf36D9Ee35C116080270350772150A1" --network=mumbai &&
npm run verify --module=TokenSaleContributor --contract_address="0x286fAf64b1a2Cb32d32d89449AB3abf7c89f2ea3" --network=mumbai

npm run verify --module=ICCOStructs --contract_address="0xC9e7627990B4ECD659545b5b8A1907C96435d87f" --network=fantom_testnet &&
npm run verify --module=ContributorImplementation --contract_address="0xa660A20C6F1CbbF6A618126eA5DEf33dCDB2581c" --network=fantom_testnet &&
npm run verify --module=ContributorSetup --contract_address="0x0Dee3fdE95226DAB4b49c0623E619D90e2AEfb3e" --network=fantom_testnet &&
npm run verify --module=TokenSaleContributor --contract_address="0xB0bE7A1FD72f73188c592524aeD216838148C69A" --network=fantom_testnet

npm run verify --module=ICCOStructs --contract_address="0xC9e7627990B4ECD659545b5b8A1907C96435d87f" --network=binance_testnet &&
npm run verify --module=ContributorImplementation --contract_address="0xa660A20C6F1CbbF6A618126eA5DEf33dCDB2581c" --network=binance_testnet &&
npm run verify --module=ContributorSetup --contract_address="0x0Dee3fdE95226DAB4b49c0623E619D90e2AEfb3e" --network=binance_testnet &&
npm run verify --module=TokenSaleContributor --contract_address="0xB0bE7A1FD72f73188c592524aeD216838148C69A" --network=binance_testnet