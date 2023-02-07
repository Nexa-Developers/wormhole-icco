const ConductorImplementation = artifacts.require("ConductorImplementation");
const fs = require("fs");
const path = require("path");
module.exports = async function(deployer, network) {

  let file = fs.readFileSync(path.join(__dirname, "deployedAddresses.json"));
  file = JSON.parse(file);

  let conductorAddr = file.conductor.conductorAddress; 
  const conductor = await ConductorImplementation.at(conductorAddr);

  for (const contributor of file.contributor) {
    if(contributor.contributorChain == 1){
      // ignore solana contributors
    }
    else {
      try {
        const tx = await conductor.registerChain(
          contributor.contributorChain,
          `0x000000000000000000000000${contributor.contributorAddress.substring(2)}`
        );
        console.log(tx, "\n");
      } 
      catch(error){
        console.log("error: ", error);
        continue;
      }
    }
  }

};
