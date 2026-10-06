// Run 3: after the claim window opens, the seller claims request A and cashes the Morpho shares out to USDC.
const { ethers, provider, USDC, VAULTS, DEMO_VAULT_IDX, minerWallet, retry, sleep, loadState2, saveState2, artifact2, explorer } = require('./common2');
const erc = ['function balanceOf(address) view returns(uint256)'];
const vaultAbi = [...erc, 'function redeem(uint256,address,address) returns(uint256)', 'function convertToAssets(uint256) view returns(uint256)'];

(async () => {
  const s = loadState2();
  if (!s.stage1) throw new Error('run stage 1 first');
  if (s.stage2) { console.log('stage 2 already done'); return; }
  const seller = minerWallet(), vAddr = VAULTS[DEMO_VAULT_IDX].address;
  const hf = new ethers.Contract(s.amana, artifact2().abi, seller), vault = new ethers.Contract(vAddr, vaultAbi, seller);
  const usdc = new ethers.Contract(USDC, erc, provider), vp = new ethers.Contract(vAddr, erc, provider);
  for (;;) {
    const t = (await retry(() => provider.getBlock('latest'))).timestamp;
    if (t >= s.claimOpens + 15) break;
    console.log('waiting', s.claimOpens + 15 - t, 'seconds');
    await sleep(Math.min(300, s.claimOpens + 15 - t) * 1000);
  }
  const buyerBefore = await retry(() => vp.balanceOf(s.buyer)), sellerBefore = await retry(() => vault.balanceOf(seller.address));
  const t = await retry(() => hf.claim(s.idA)), rc = await retry(() => t.wait());
  console.log('run 3: claim', explorer(rc.hash));
  const sellerShares = (await retry(() => vault.balanceOf(seller.address))) - sellerBefore;
  const buyerBack = (await retry(() => vp.balanceOf(s.buyer))) - buyerBefore;
  const worth = await retry(() => vault.convertToAssets(sellerShares));
  console.log('seller received shares', sellerShares.toString(), 'worth', worth.toString(), 'USDC units (owed 1000000) | buyer got back shares', buyerBack.toString());
  const u0 = await retry(() => usdc.balanceOf(seller.address));
  const r = await retry(() => vault.redeem(sellerShares, seller.address, seller.address)), rrc = await retry(() => r.wait());
  const u1 = await retry(() => usdc.balanceOf(seller.address));
  console.log('seller cashed out the shares', explorer(rrc.hash), 'USDC units received', (u1 - u0).toString());
  console.log('request A state', (await hf.getRequest(s.idA)).state.toString(), '(4 = CLAIMED) | contract shares left', (await vp.balanceOf(s.amana)).toString());
  saveState2({ stage2: true, txs2: { claimA: rc.hash, redeem: rrc.hash }, claimResult: { sellerShares: sellerShares.toString(), worth: worth.toString(), buyerBack: buyerBack.toString() } });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
