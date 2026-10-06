// Creates a throwaway demo buyer wallet, funds it from the miner wallet, and buys vault shares.
const { ethers, provider, USDC, VAULT, minerWallet, buyerWallet, retry, loadState, saveState, explorer } = require('./common');

const usdcAbi = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];
const vaultAbi = ['function deposit(uint256,address) returns(uint256)', 'function balanceOf(address) view returns(uint256)', 'function maxDeposit(address) view returns(uint256)', 'function maxRedeem(address) view returns(uint256)'];

(async () => {
  const s = loadState();
  if (s.setupDone) { console.log('setup already done, buyer', s.buyer); return; }
  const miner = minerWallet();
  const buyer = buyerWallet(true);
  console.log('seller (miner wallet)', miner.address, '\ndemo buyer', buyer.address);

  const bBal = await retry(() => provider.getBalance(buyer.address));
  if (bBal < ethers.parseEther('3')) {
    const tx = await retry(() => miner.sendTransaction({ to: buyer.address, value: ethers.parseEther('3.4') }));
    const rc = await retry(() => tx.wait());
    console.log('funded buyer with 3.4 USDC', explorer(rc.hash));
    saveState({ fundTx: rc.hash });
  }
  const usdc = new ethers.Contract(USDC, usdcAbi, buyer);
  const vault = new ethers.Contract(VAULT, vaultAbi, buyer);
  const amt = 2_150_000n;
  console.log('maxDeposit', (await retry(() => vault.maxDeposit(buyer.address))).toString());
  await retry(() => vault.deposit.staticCall(amt, buyer.address)).catch(async () => {
    // the vault pulls USDC, so approve first and simulate again
  });
  const a = await retry(() => usdc.approve(VAULT, amt));
  await retry(() => a.wait());
  console.log('simulated shares for 2.15 USDC', (await retry(() => vault.deposit.staticCall(amt, buyer.address))).toString());
  const d = await retry(() => vault.deposit(amt, buyer.address));
  const rc = await retry(() => d.wait());
  console.log('deposited', explorer(rc.hash));
  const shares = await retry(() => vault.balanceOf(buyer.address));
  console.log('buyer shares', shares.toString(), 'maxRedeem', (await retry(() => vault.maxRedeem(buyer.address))).toString());
  saveState({ buyer: buyer.address, depositTx: rc.hash, setupDone: true });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
