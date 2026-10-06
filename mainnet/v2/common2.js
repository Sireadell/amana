// Shared helpers for the Amana (several vaults) mainnet scripts. Builds on ../common.js.
const fs = require('fs');
const path = require('path');
const base = require('../common');

// The fixed vault list, in the order the contract stores it. Index 0 to 2 are open for pledging on the page.
const VAULTS = [
  { name: 'Aave USDC vault (waCoreUSDC)', address: '0x42EAB64310E1D1c66b4d8aF7C9C4ce253885eB83', live: true },
  { name: 'Steakhouse Prime USDC', address: '0xbeef0016cb2Fd5C352ea7CA08a9f54739DFa7298', live: true },
  { name: 'Bitwise Premium RWA USDC', address: '0x7610094B846657dCF166D59e42973db52c7015F9', live: true },
  { name: 'Steakhouse Prime USDC (second)', address: '0xbeef0007d5A04246F5382957035Df34f7e82102e', live: false },
  { name: 'Keyrock Prime USDC', address: '0x5bEfAb92a5A3D60F578Cb51EEb4e4FD50a1e3123', live: false },
  { name: 'Galaxy USDC', address: '0x8E357432CC12ff425c36432F312968aEb16112AF', live: false },
  { name: 'Gauntlet USDC Prime', address: '0xdECcd53BE5453215821184824B519E04C7e00bC7', live: false }
];
const LIVE_MASK = VAULTS.reduce((m, v, i) => (v.live ? m | (1 << i) : m), 0); // 0b111 = 7
const DEMO_VAULT_IDX = 1; // Steakhouse Prime USDC, the demo run uses a real Morpho share

const STATE2 = path.join(__dirname, 'state2.json');
const BUYER2 = path.join(__dirname, '..', '.demo-buyer2.json');
const { ethers } = base;
const buyerWallet2 = (create = false) => {
  if (!fs.existsSync(BUYER2)) {
    if (!create) throw new Error('no demo buyer yet');
    fs.writeFileSync(BUYER2, JSON.stringify({ key: ethers.Wallet.createRandom().privateKey }));
  }
  return new ethers.Wallet(JSON.parse(fs.readFileSync(BUYER2, 'utf8')).key, base.provider);
};
const loadState2 = () => (fs.existsSync(STATE2) ? JSON.parse(fs.readFileSync(STATE2, 'utf8')) : {});
const saveState2 = (patch) => { const s = { ...loadState2(), ...patch }; fs.writeFileSync(STATE2, JSON.stringify(s, null, 2)); return s; };
const artifact2 = () => require('../../artifacts/contracts/Amana.sol/Amana.json');

module.exports = { ...base, VAULTS, LIVE_MASK, DEMO_VAULT_IDX, buyerWallet2, loadState2, saveState2, artifact2 };
