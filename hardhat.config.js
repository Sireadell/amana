require('@nomicfoundation/hardhat-toolbox');

const config = {
  solidity: { version: '0.8.24', settings: { evmVersion: 'paris', optimizer: { enabled: true, runs: 200 } } },
};

// Dry run against a copy of Arc mainnet: FORK=1 npx hardhat run scripts/forkDryRun.js
if (process.env.FORK) {
  config.networks = { hardhat: { chainId: 5042, forking: { url: 'https://rpc.mainnet.arc.io' } } };
}

module.exports = config;
