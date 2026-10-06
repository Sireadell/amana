// Dry run on a local copy of Arc mainnet. Uses the real USDC and the real Aave vault.
// Arc USDC calls a native system precompile that a local copy cannot run, so USDC moves (pay, redeem)
// cannot be simulated here. Share moves (pledge, claim) can, and are tested with the real vault.
// Nothing is sent to the real chain and no keys are used.
const { ethers, network } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const USDC = '0x3600000000000000000000000000000000000000';
const VAULT = '0x42EAB64310E1D1c66b4d8aF7C9C4ce253885eB83';
const SHARE_HOLDER = '0x0141012a263c7B88676F04D85D5F0e8dEE0bEb2c'; // plain wallet with ~9 shares
const USDC_WHALE = '0x08600aAD334ffed5f866A66080398f062576B7C5'; // plain wallet with lots of USDC
const u = (n) => BigInt(Math.round(n * 1e6));
const log = (...a) => console.log(...a);

async function act(addr) {
  await network.provider.request({ method: 'hardhat_impersonateAccount', params: [addr] });
  await network.provider.send('hardhat_setBalance', [addr, '0x56BC75E2D63100000']);
  return ethers.getSigner(addr);
}

async function main() {
  const erc = ['function balanceOf(address) view returns(uint256)', 'function transfer(address,uint256) returns(bool)', 'function approve(address,uint256) returns(bool)'];
  const usdc = new ethers.Contract(USDC, erc, ethers.provider);
  const vault = new ethers.Contract(VAULT, [...erc, 'function convertToAssets(uint256) view returns(uint256)', 'function maxRedeem(address) view returns(uint256)', 'function redeem(uint256,address,address) returns(uint256)'], ethers.provider);

  const buyer = await act(SHARE_HOLDER);
  const whale = await act(USDC_WHALE);
  const seller = (await ethers.getSigners())[0];
  await network.provider.send('hardhat_setBalance', [seller.address, '0x56BC75E2D63100000']);

  const hf = await (await ethers.getContractFactory('Holdfast')).deploy(USDC, VAULT);
  await hf.waitForDeployment();
  const hfa = await hf.getAddress();
  log('deployed against real USDC and vault at', hfa);

  const shareBal = await vault.balanceOf(SHARE_HOLDER);
  log('buyer shares', shareBal.toString(), 'maxRedeem', (await vault.maxRedeem(SHARE_HOLDER)).toString());

  const mk = async (amount, mins) => {
    const due = (await time.latest()) + mins * 60;
    await hf.connect(seller).createRequest(amount, due, ethers.ZeroAddress);
    const id = await hf.requestCount();
    return { id, due, hash: await hf.termsHashOf(id) };
  };
  const pledge = async (r, amount) => {
    const need = await hf.sharesNeededFor(amount);
    await vault.connect(buyer).approve(hfa, need);
    await hf.connect(buyer).pledge(r.id, r.hash, need);
    return need;
  };
  const expectRevert = async (p, label) => { try { await p; log('FAIL, did not revert:', label); process.exitCode = 1; } catch (e) { log('ok reverts:', label); } };

  // Run 1: early claim reverts
  const r1 = await mk(u(1), 10);
  const s1 = await pledge(r1, u(1));
  log('run 1 pledged', s1.toString(), 'shares');
  await expectRevert(hf.connect(seller).claim(r1.id), 'claim before due date');
  await time.increaseTo(r1.due + 1800);
  await expectRevert(hf.connect(seller).claim(r1.id), 'claim inside the grace hour');

  // Run 3: missed date, seller claims in shares, buyer gets the rest, seller cashes out
  const r3 = await mk(u(1), 10);
  const s3 = await pledge(r3, u(1));
  await time.increaseTo(r3.due + 3600 + 1);
  const buyerBefore3 = await vault.balanceOf(SHARE_HOLDER);
  await hf.connect(seller).claim(r3.id);
  const sellerShares = await vault.balanceOf(seller.address);
  const buyerGot = (await vault.balanceOf(SHARE_HOLDER)) - buyerBefore3;
  log('run 3 pledged', s3.toString(), '| seller got shares', sellerShares.toString(), 'worth', (await vault.convertToAssets(sellerShares)).toString(), 'USDC units (owed 1000000) | buyer got back', buyerGot.toString());
  log('contract holds shares:', (await vault.balanceOf(hfa)).toString(), '(run 1 pledge is still locked, expected', s1.toString() + ')');
}

main().catch((e) => { console.error(e); process.exit(1); });
