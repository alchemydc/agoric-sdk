// Agoric Dapp contract deployment script
import fs from 'fs';

const DAPP_NAME = "@DIR@";

export default async function deployContract(homeP, { bundleSource, pathResolve }) {
  // Create a source bundle for the Zoe automaticRefeund contract.
  const { source, moduleFormat } = await bundleSource(`./automaticRefund.js`);

  const contractHandle = homeP~.zoe~.install(source, moduleFormat);
  const contractID = await homeP~.registrar~.register(DAPP_NAME, contractHandle);

  // Save the contractID somewhere where the UI can find it.
  const cjfile = pathResolve(`../ui/src/utils/contractID.js`);
  console.log('writing', cjfile);
  await fs.promises.writeFile(cjfile, `export default ${JSON.stringify(contractID)};`);
}
