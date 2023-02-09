import { postVaaSolanaWithRetry } from "@certusone/wormhole-sdk";
import { web3 } from "@project-serum/anchor";
import { IccoContributor } from "../tests/helpers/contributor";
import { connectToContributorProgram, readJson, readKeypair } from "./utils";

const CORE_BRIDGE_ADDRESS = new web3.PublicKey(
  "3u8hJUVTA4jH1wYAyUur7FFZVQ8H635K3tSHHF4ssjQ5"
);
const TOKEN_BRIDGE_ADDRESS = new web3.PublicKey(
  "DZnkkTmCiFWfYTfT41X3Rd1kDgozqzxWaHqsw6W4x2oe"
);

async function main() {
  const rpc = "https://api.devnet.solana.com";
  const contributorIdl = readJson(
    `${__dirname}/../target/idl/anchor_contributor.json`
  );

  const programId = readKeypair(
    `${__dirname}/../target/deploy/anchor_contributor-keypair.json`
  ).publicKey;
  const payer = readKeypair("/home/abdullah/.config/solana/keypair.json");

  console.log("wormhole", CORE_BRIDGE_ADDRESS.toString());
  console.log("token bridge", TOKEN_BRIDGE_ADDRESS.toString());
  console.log("program id", programId.toString());
  console.log("payer", payer.publicKey.toString());

  const program = connectToContributorProgram(
    rpc,
    contributorIdl,
    programId,
    payer
  );
  const connection = program.provider.connection;

  const contributor = new IccoContributor(
    program,
    CORE_BRIDGE_ADDRESS,
    TOKEN_BRIDGE_ADDRESS,
    postVaaSolanaWithRetry
  );

  try {
    const tx = await contributor.createCustodian(payer);
    console.log("tx", tx);
  } catch (e) {
    const custodianAccountInfo = await connection
      .getAccountInfo(contributor.deriveCustodianAccount())
      .catch((_) => null);
    if (custodianAccountInfo == null) {
      throw e;
    } else {
      console.log("custodian already created");
    }
  }

  const custodian = contributor.deriveCustodianAccount();
  console.log("custodian", custodian.toString());
}

main();
