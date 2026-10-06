// Run 3: wait for the claim window, then the seller claims request A and cashes the shares out.
const { ethers, provider, USDC, VAULT, minerWallet, retry, sleep, loadState, saveState, artifact, explorer } = require('./common');
const erc = ['function balanceOf(address) view returns(uint256)'];
const vaultAbi = [...erc, 'function redeem(uint256,address,address) returns(uint256)', 'function convertToAssets(uint256) view returns(uint256)'];

(async () => {
  const s = loadState();
  if (!s.stage1) throw new Error('run stage 1 first');
  if (s.stage2) { console.log('stage 2 already done'); return; }
  const seller = minerWallet();
  const hf = new ethers.Contract(s.holdfast, artifact().abi, seller);
  const vault = new ethers.Contract(VAULT, vaultAbi, seller);
  const usdc = new ethers.Contract(USDC, erc, provider);

  for (;;) {
    const t = (await retry(() => provider.getBlock('latest'))).timestamp;
    if (t >= s.claimOpens + 15) break;
    console.log('waiting', s.claimOpens + 15 - t, 'seconds');
    await sleep(Math.min(300, s.claimOpens + 15 - t) * 1000);
  }
  const buyerSharesBefore = await retry(() => new ethers.Contract(VAULT, erc, provider).balanceOf(s.buyer));
  const sellerSharesBefore = await retry(() => vault.balanceOf(seller.address));
  const t = await retry(() => hf.claim(s.idA));
  const rc = await retry(() => t.wait());
  console.log('run 3: claim', explorer(rc.hash));
  const sellerShares = (await retry(() => vault.balanceOf(seller.address))) - sellerSharesBefore;
  const buyerBack = (await retry(() => new ethers.Contract(VAULT, erc, provider).balanceOf(s.buyer))) - buyerSharesBefore;
  const worth = await retry(() => vault.convertToAssets(sellerShares));
  console.log('seller received shares', sellerShares.toString(), 'worth', worth.toString(), 'USDC units (owed 1000000) | buyer got back shares', buyerBack.toString());
  const u0 = await retry(() => usdc.balanceOf(seller.address));
  const r = await retry(() => vault.redeem(sellerShares, seller.address, seller.address));
  const rrc = await retry(() => r.wait());
  const u1 = await retry(() => usdc.balanceOf(seller.address));
  console.log('seller cashed out the shares', explorer(rrc.hash), 'USDC units received', (u1 - u0).toString());
  console.log('request A state', (await hf.getRequest(s.idA)).state.toString(), '(4 = CLAIMED) | contract shares left', (await new ethers.Contract(VAULT, erc, provider).balanceOf(s.holdfast)).toString());
  saveState({ stage2: true, txs2: { claimA: rc.hash, redeem: rrc.hash }, claimResult: { sellerShares: sellerShares.toString(), worth: worth.toString(), buyerBack: buyerBack.toString() } });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
