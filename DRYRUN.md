# Dry run, 2026-10-05

Nothing was sent to Arc mainnet and no keys were used.

| Check | How | Result |
|---|---|---|
| Deploy against the real USDC and the real Aave vault | eth_estimateGas on the live RPC | Works. 1,596,050 gas, about 0.032 USDC. A wrong USDC address reverts as it should |
| Real vault: pledge, early claim, claim | Local copy of Arc mainnet (`FORK=1 npx hardhat run scripts/forkDryRun.js`), real vault shares from a real holder | 1.05 shares pledged for a 1 USDC request. Claim before the date and inside the grace hour revert. After the grace hour the seller gets 999,727 shares worth exactly 1,000,000 USDC units owed and the buyer gets 49,987 back |
| USDC moves (pay, cash-out) | Cannot be simulated locally, because Arc's USDC calls a native system hook | Not covered. Settled by run 2 on mainnet |

Output: DRYRUN_OUTPUT.txt
