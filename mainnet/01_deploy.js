const { ethers, provider, USDC, VAULT, minerWallet, retry, loadState, saveState, artifact } = require('./common');

(async () => {
  const s = loadState();
  if (s.holdfast) { console.log('already deployed at', s.holdfast); return; }
  const w = minerWallet();
  const bal = await retry(() => provider.getBalance(w.address));
  console.log('deployer', w.address, 'balance', ethers.formatEther(bal));
  const a = artifact();
  const f = new ethers.ContractFactory(a.abi, a.bytecode, w);
  const c = await retry(() => f.deploy(USDC, VAULT));
  const rc = await retry(() => c.deploymentTransaction().wait());
  const addr = await c.getAddress();
  const code = await retry(() => provider.getCode(addr));
  console.log('deployed', addr, 'tx', rc.hash, 'block', rc.blockNumber, 'gas used', rc.gasUsed.toString(), 'code bytes', (code.length - 2) / 2);
  console.log('onchain usdc/vault', await c.usdc(), await c.vault());
  saveState({ holdfast: addr, deployTx: rc.hash, deployBlock: rc.blockNumber, deployer: w.address });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
