// Request A: the buyer misses the date. Request B: the buyer pays on time. Both pledge real Morpho vault shares.
const { ethers, provider, USDC, VAULTS, LIVE_MASK, DEMO_VAULT_IDX, minerWallet, buyerWallet2, retry, loadState2, saveState2, artifact2, explorer } = require('./common2');
const erc = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];

(async () => {
  const s = loadState2();
  if (!s.amana || !s.setupDone) throw new Error('deploy and setup first');
  if (s.stage1) { console.log('stage 1 already done'); return; }
  const seller = minerWallet(), buyer = buyerWallet2();
  const vAddr = VAULTS[DEMO_VAULT_IDX].address;
  const hfS = new ethers.Contract(s.amana, artifact2().abi, seller), hfB = new ethers.Contract(s.amana, artifact2().abi, buyer);
  const usdc = new ethers.Contract(USDC, erc, buyer), vault = new ethers.Contract(vAddr, erc, buyer);
  const one = 1_000_000n, out = {};
  const send = async (label, p) => { const t = await retry(() => p()); const rc = await retry(() => t.wait()); out[label] = rc.hash; console.log(label, explorer(rc.hash)); return rc; };
  const due = (await retry(() => provider.getBlock('latest'))).timestamp + 600;
  console.log('due date', new Date(due * 1000).toISOString(), '(10 minutes from now). Demo requests, 1 USDC each, accepted vault mask', LIVE_MASK);

  await send('createA', () => hfS.createRequest(one, due, buyer.address, LIVE_MASK));
  const idA = await retry(() => hfS.requestCount());
  await send('createB', () => hfS.createRequest(one, due, buyer.address, LIVE_MASK));
  const idB = idA + 1n;
  const need = await retry(() => hfS.sharesNeededFor(one, DEMO_VAULT_IDX));
  console.log('shares needed per request', need.toString());
  const hashA = await hfS.termsHashOf(idA), hashB = await hfS.termsHashOf(idB);
  await send('approveA', () => vault.approve(s.amana, need));
  await send('pledgeA', () => hfB.pledge(idA, hashA, DEMO_VAULT_IDX, need));
  await send('approveB', () => vault.approve(s.amana, need));
  await send('pledgeB', () => hfB.pledge(idB, hashB, DEMO_VAULT_IDX, need));

  try {
    const t = await hfS.claim(idA, { gasLimit: 400000 });
    await t.wait();
    console.log('!!! EARLY CLAIM SUCCEEDED, THIS IS A BUG');
    out.earlyClaim = 'SUCCEEDED';
  } catch (e) {
    const h = e.receipt ? e.receipt.hash : (e.transaction && e.transaction.hash) || 'unknown';
    out.earlyClaimFailed = h;
    console.log('run 1: early claim failed on chain, as it should', explorer(h));
  }

  await send('approveUsdcB', () => usdc.approve(s.amana, one));
  const u = new ethers.Contract(USDC, erc, provider);
  const before = await retry(() => u.balanceOf(seller.address));
  await send('payB', () => hfB.pay(idB, one));
  const after = await retry(() => u.balanceOf(seller.address));
  console.log('run 2: seller USDC received', (after - before).toString(), '| request B state', (await hfS.getRequest(idB)).state.toString(), '(3 = PAID)');
  console.log('buyer shares now', (await vault.balanceOf(buyer.address)).toString(), '| contract shares', (await new ethers.Contract(vAddr, erc, provider).balanceOf(s.amana)).toString());
  saveState2({ stage1: true, idA: idA.toString(), idB: idB.toString(), due, claimOpens: due + 3600, txs1: out, sharesPerRequest: need.toString() });
  console.log('Run 3 can happen after', new Date((due + 3600) * 1000).toISOString());
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
