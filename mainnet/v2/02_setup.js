// Funds a throwaway demo buyer and buys real Steakhouse Prime USDC vault shares for the demo requests.
const { ethers, provider, USDC, VAULTS, DEMO_VAULT_IDX, minerWallet, buyerWallet2, retry, loadState2, saveState2, explorer } = require('./common2');
const usdcAbi = ['function approve(address,uint256) returns(bool)', 'function balanceOf(address) view returns(uint256)'];
const vaultAbi = ['function deposit(uint256,address) returns(uint256)', 'function balanceOf(address) view returns(uint256)', 'function convertToAssets(uint256) view returns(uint256)'];

(async () => {
  const s = loadState2();
  if (s.setupDone) { console.log('setup already done, buyer', s.buyer); return; }
  const miner = minerWallet(), buyer = buyerWallet2(true);
  const vAddr = VAULTS[DEMO_VAULT_IDX].address;
  console.log('seller (miner wallet)', miner.address, '\ndemo buyer', buyer.address, '\nvault', VAULTS[DEMO_VAULT_IDX].name);
  if ((await retry(() => provider.getBalance(buyer.address))) < ethers.parseEther('3')) {
    const t = await retry(() => miner.sendTransaction({ to: buyer.address, value: ethers.parseEther('3.4') }));
    const rc = await retry(() => t.wait());
    console.log('funded buyer with 3.4 USDC', explorer(rc.hash));
    saveState2({ fundTx: rc.hash });
  }
  const usdc = new ethers.Contract(USDC, usdcAbi, buyer), vault = new ethers.Contract(vAddr, vaultAbi, buyer);
  const amt = 2_150_000n;
  await retry(async () => { const a = await usdc.approve(vAddr, amt); await a.wait(); });
  console.log('simulated shares for 2.15 USDC', (await retry(() => vault.deposit.staticCall(amt, buyer.address))).toString());
  const d = await retry(() => vault.deposit(amt, buyer.address));
  const rc = await retry(() => d.wait());
  const shares = await retry(() => vault.balanceOf(buyer.address));
  console.log('deposited', explorer(rc.hash), '| buyer shares', shares.toString(), 'worth', (await retry(() => vault.convertToAssets(shares))).toString());
  saveState2({ buyer: buyer.address, depositTx: rc.hash, setupDone: true });
})().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
