// Shared helpers for the Arc mainnet scripts. The key is read from the sentinel miner wallet's
// .env file at run time. It is never printed and never copied into this repo.
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const RPC = 'https://rpc.mainnet.arc.io';
const USDC = '0x3600000000000000000000000000000000000000';
const VAULT = '0x42EAB64310E1D1c66b4d8aF7C9C4ce253885eB83';
const ENV_FILE = 'C:/Users/DELL/telegraph-sentinel/.env';
const STATE = path.join(__dirname, 'state.json');

const provider = new ethers.JsonRpcProvider(RPC, 5042, { staticNetwork: true });

function minerWallet() {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^\s*MINER_PRIVATE_KEY\s*=\s*"?'?(0x)?([0-9a-fA-F]{64})/m);
  if (!m) throw new Error('MINER_PRIVATE_KEY not found');
  return new ethers.Wallet('0x' + m[2], provider);
}

const BUYER_FILE = path.join(__dirname, '.demo-buyer.json');
function buyerWallet(create = false) {
  if (!fs.existsSync(BUYER_FILE)) {
    if (!create) throw new Error('no demo buyer yet');
    fs.writeFileSync(BUYER_FILE, JSON.stringify({ key: ethers.Wallet.createRandom().privateKey }));
  }
  return new ethers.Wallet(JSON.parse(fs.readFileSync(BUYER_FILE, 'utf8')).key, provider);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, tries = 40) {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      const msg = String(e.message || e);
      if (i >= tries - 1 || !/32014|timeout|ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|503|502|429|SERVER_ERROR|network/i.test(msg)) throw e;
      await sleep(1500 * (i + 1));
    }
  }
}

const loadState = () => (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {});
const saveState = (patch) => { const s = { ...loadState(), ...patch }; fs.writeFileSync(STATE, JSON.stringify(s, null, 2)); return s; };
const artifact = () => require('../artifacts/contracts/Holdfast.sol/Holdfast.json');
const explorer = (h) => `https://explorer.arc.io/tx/${h}`;

module.exports = { ethers, provider, RPC, USDC, VAULT, minerWallet, buyerWallet, sleep, retry, loadState, saveState, artifact, explorer };
