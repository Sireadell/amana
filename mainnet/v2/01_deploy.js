const { ethers, provider, USDC, VAULTS, minerWallet, retry, loadState2, saveState2, artifact2 } = require('./common2');

(async () => {
  const s = loadState2();
  if (s.amana) { console.log('already deployed at', s.amana); return; }
  const w = minerWallet();
  console.log('deployer', w.address, 'balance', ethers.formatEther(await retry(() => provider.getBalance(w.address))));
  const a = artifact2();
  const f = new ethers.ContractFactory(a.abi, a.bytecode, w);
  const c = await retry(() => f.deploy(USDC, VAULTS.map((v) => v.address)));
  const rc = await retry(() => c.deploymentTransaction().wait());
  const addr = await c.getAddress();
  console.log('deployed', addr, 'tx', rc.hash, 'block', rc.blockNumber, 'gas', rc.gasUsed.toString());
  console.log('vault count', (await c.vaultCount()).toString());
  saveState2({ amana: addr, deployTx: rc.hash, deployBlock: rc.blockNumber, deployer: w.address });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
