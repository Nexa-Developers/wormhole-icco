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

const Web3 = require("web3");

async function getVaa() {
  const createSaleTx =
  "0x64b4ca5593f66e85130ed6e32c20d0547b9168dccc0ef9adb244991f05818da7";

  let file = fs.readFileSync(path.join(__dirname, "deployedAddresses.json"));
  file = JSON.parse(file);

  let conductorAddress = file.conductor.conductorAddress;
  let web3 = new Web3("https://api.avax-test.network/ext/bc/C/rpc");
  let tx = await web3.eth.getTransactionReceipt(createSaleTx);

  const sequences = parseSequencesFromLogEth(
    tx,
    "0x7bbcE28e64B3F8b84d876Ab298393c38ad7aac4C"
  );

  console.log("sequences: ", sequences);
  console.log(getEmitterAddressEth(conductorAddress))

  for (const sequence of sequences) {
    try {
      const signedVAA = await getSignedVAA(
        "https://wormhole-v2-testnet-api.certus.one",
        6,
        getEmitterAddressEth(conductorAddress),
        sequence,
        {
          transport: NodeHttpTransport(),
        }
      );

      let vaa = uint8ArrayToHex(signedVAA.vaaBytes);
      console.log("VAA: ", `0x${vaa}`);
    } catch (error) {
      console.log(error);
    }
  }
}

getVaa();
