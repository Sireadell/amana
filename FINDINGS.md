# Review findings

Before deploying I had the contract reviewed by a separate reviewer whose job was to break it. It wrote 46 attack tests (`test/attacks.test.js`, with hostile mocks in `contracts/mocks/Attackers.sol`). This file says what came out of it.

| Severity | Count | Outcome |
|---|---|---|
| High | 0 | Nothing found that lets someone take a pledge they are not owed |
| Medium | 3 | About the vault, not the contract: a vault that misbehaves, a vault that halts withdrawals, a vault that is upgraded. Amana cannot fix these, so they are written up in the README under "Honest limits" |
| Low | several | The ones that could be fixed in code were fixed (for example a payment larger than what is owed is now clamped instead of reverting, and the request amount and due date have limits). The rest are in the README |

Two behaviours are kept on purpose and documented rather than "fixed":

| Behaviour | Why it stays |
|---|---|
| A request with no named buyer can be pledged to by anyone | It is how a seller opens a request to any buyer. Name the buyer if that matters |
| Tokens sent to the contract outside the normal calls cannot be recovered | Recovering them needs an admin, and Amana has none on purpose |

All 89 tests pass: `npm install && npx hardhat test`.
