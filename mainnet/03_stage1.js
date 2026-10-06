// Request A: the buyer misses the date (claim fails early, succeeds later).
// Request B: the buyer pays on time and the pledge is released.
const { ethers, provider, USDC, VAULT, minerWallet, buyerWallet, retry, loadState, saveState, artifact, explorer } = require('./common');

const erc = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];

(async () => {
  const s = loadState();
  if (!s.holdfast || !s.setupDone) throw new Error('deploy and setup first');
  if (s.stage1) { console.log('stage 1 already done'); return; }
  const seller = minerWallet(), buyer = buyerWallet();
  const hfS = new ethers.Contract(s.holdfast, artifact().abi, seller);
  const hfB = new ethers.Contract(s.holdfast, artifact().abi, buyer);
  const usdc = new ethers.Contract(USDC, erc, buyer);
  const vault = new ethers.Contract(VAULT, erc, buyer);
  const one = 1_000_000n;
  const out = {};
  const send = async (label, p) => { const t = await retry(() => p()); const rc = await retry(() => t.wait()); out[label] = rc.hash; console.log(label, explorer(rc.hash)); return rc; };

  const now = (await retry(() => provider.getBlock('latest'))).timestamp;
  const due = now + 600;
  console.log('due date', new Date(due * 1000).toISOString(), '(10 minutes from now). Demo requests, 1 USDC each.');

  await send('createA', () => hfS.createRequest(one, due, buyer.address));
  const idA = await retry(() => hfS.requestCount());
  await send('createB', () => hfS.createRequest(one, due, buyer.address));
  const idB = idA + 1n;
  const need = await retry(() => hfS.sharesNeededFor(one));
  console.log('shares needed per request', need.toString());
  const hashA = await hfS.termsHashOf(idA), hashB = await hfS.termsHashOf(idB);

  await send('approveA', () => vault.approve(s.holdfast, need));
  await send('pledgeA', () => hfB.pledge(idA, hashA, need));
  await send('approveB', () => vault.approve(s.holdfast, need));
  await send('pledgeB', () => hfB.pledge(idB, hashB, need));

  // Run 1: early claim by the seller. Forced gas limit so the failed transaction lands on chain.
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

  // Run 2: pay B on time.
  await send('approveUsdcB', () => usdc.approve(s.holdfast, one));
  const sellerUsdcBefore = await retry(() => new ethers.Contract(USDC, erc, provider).balanceOf(seller.address));
  await send('payB', () => hfB.pay(idB, one));
  const sellerUsdcAfter = await retry(() => new ethers.Contract(USDC, erc, provider).balanceOf(seller.address));
  console.log('run 2: seller USDC received', (sellerUsdcAfter - sellerUsdcBefore).toString(), '| request B state', (await hfS.getRequest(idB)).state.toString(), '(3 = PAID)');
  console.log('buyer shares now', (await vault.balanceOf(buyer.address)).toString(), '| contract shares', (await new ethers.Contract(VAULT, erc, provider).balanceOf(s.holdfast)).toString());

  saveState({ stage1: true, idA: idA.toString(), idB: idB.toString(), due, claimOpens: due + 3600, txs1: out, sharesPerRequest: need.toString() });
  console.log('Run 3 can happen after', new Date((due + 3600) * 1000).toISOString());
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
