# Amana

I have a shop. Some of my customers keep their money in Aave or Morpho, where it earns yield. Yield means their savings can grow while they leave it there.

Sometimes they need to buy something from my shop, but they do not want to remove those savings or cash them out. I also cannot just trust that they will bring the money later on their own.

So Amana lets them make a promise I can rely on. They pledge savings they already have in a vault, worth at least 105% of what they owe me. We agree on the due date together. If they pay before that date, they get every bit of their pledge back and it kept earning while it was pledged. If they do not pay, I can claim only what I am owed, and the rest goes back to them.

Amana is a due-date guarantee on Arc, a payments blockchain from Circle, where a buyer backs a payment promise with vault shares they already hold. A vault is a pool where savings earn yield. Shares are the receipt for your part of it.

Live on Arc mainnet: [`0x9AbcF46919C3778FD33F3Bd56ac33dFcb015138a`](https://explorer.arc.io/address/0x9AbcF46919C3778FD33F3Bd56ac33dFcb015138a). The source is verified.

Repo: https://github.com/Sireadell/amana

Live page: https://sireadell.github.io/amana/

## Simple example

A customer takes 200 USDC of goods and agrees to pay in 30 days.

They pledge 210 USDC worth of vault shares. These are savings they already have. Nothing is cashed out, so the savings keep earning.

If they pay on time, I receive 200 USDC and they get all 210 USDC worth of shares back, plus any yield earned while the pledge was held.

If they miss the date, I can claim shares worth exactly 200 USDC. The other 10 USDC worth of shares, plus its yield, goes back to the buyer in the same step.

## How it works

| Step | Who | What happens |
|---|---|---|
| 1 | Seller | I make a request with the USDC amount, the due date, and the vaults I accept. I can also name the buyer's wallet address. A wallet address is like the account name for a crypto wallet |
| 2 | Buyer | The buyer pledges vault shares worth at least 105% of what they owe, from one of the vaults I accept. Vault shares are receipts for savings kept in a vault |
| 3 | While waiting | The seller cannot claim early. Nothing can be claimed until the due date plus 1 hour |
| 4 | Buyer pays on time | The buyer pays through Amana, all at once or in parts. I get USDC. Once everything is paid, the buyer gets every pledged share back, including the yield |
| 5 | Buyer misses the date | I can claim only shares worth exactly what is still owed. The rest goes back to the buyer in the same step |
| 6 | Other ways out | I can release the pledge any time, for example if I was paid in cash. If I do nothing, the buyer takes everything back 30 days after my claim opens |

If a seller is blocklisted by USDC, the payment is credited inside Amana and the seller can withdraw later. Blocklisted means USDC will not send directly to that address.

There is no owner, no fee, no pause, and no upgrade. Nobody can change the Amana contract after deployment. The vaults it accepts are fixed when it is deployed. The vaults themselves can still be changed by whoever runs them.

## Which savings can be pledged

Amana holds a fixed list of 7 USDC vaults on Arc. When I make a request, I choose which of them I accept. The page only switches on the vaults I have tested. The others say "Coming soon".

| Vault | Holds | In the page | Why |
|---|---|---|---|
| Aave USDC vault | about $4,400 | Open | Proven on mainnet |
| Steakhouse Prime USDC (Morpho) | about $5.1M | Open | Proven on mainnet with a real pledge, claim and cash-out |
| Bitwise Premium RWA USDC (Morpho) | about $0.39M | Open | A real holder's full balance cashed out in a simulation on the live chain |
| Steakhouse Prime USDC, second vault | about $30K | Coming soon | No real holder found to test with |
| Keyrock Prime USDC | about $75M | Coming soon | Most of the money is lent out, so a cash-out may have to wait |
| Galaxy USDC | about $89.7M | Coming soon | Most of the money is lent out, and no real balance was found to test |
| Gauntlet USDC Prime | about $95K | Coming soon | A test cash-out failed because the vault has almost no idle cash |

## Proof it works

These are real Arc mainnet transactions with real USDC and the real vaults.

Current contract, pledging a real Morpho share (Steakhouse Prime USDC):

| Run | What it proves | Link |
|---|---|---|
| Deploy | The contract with 7 vaults was deployed on Arc mainnet | [tx](https://explorer.arc.io/tx/0x2f25db4ecaa0e43476908d3a118131e12dd5791232f60b46a3d28819bc22cc74) |
| 1 | The seller tried to claim early and Amana refused it | [tx](https://explorer.arc.io/tx/0xb91a4e0a8298a5c50c59c5717f355cfbabde56362428bd69a998b1495dd5f73e) |
| 2 | The buyer paid on time. The seller got USDC and the buyer got the shares back | [tx](https://explorer.arc.io/tx/0x25f9204998b1fa447f44956a3ede952072de8a5d2c0ec31cb5c7665967b70171) |
| 3 | The buyer missed the date. The seller claimed shares worth exactly what was owed, and the rest went back to the buyer | [tx](https://explorer.arc.io/tx/0x99f8e132f47866ecd42255cfd093068a72a003141f128f0ebdd7c0c99474419c) |
| Cash-out | The seller turned the claimed Steakhouse shares into 1.000000 USDC. The network fee of 0.0024 USDC is paid on top, in USDC, because USDC is Arc's gas coin | [tx](https://explorer.arc.io/tx/0xa2aa3f51b595c7ca0524a0eb273156cd5c1f5b005ce8ee78a040502abc97120e) |

The scripts are in `mainnet/v2/`.

My first contract, [`0x59769AbD5932BF60391e5D81A4DfFb16523eD24c`](https://explorer.arc.io/address/0x59769AbD5932BF60391e5D81A4DfFb16523eD24c), is still live. It accepts only the Aave vault, and the explorer labels it Holdfast, which was its first name. It had the same three runs:

| Run | What it proves | Link |
|---|---|---|
| Deploy | The first contract was deployed on Arc mainnet | [tx](https://explorer.arc.io/tx/0x59403b7d908b0dfc6b9fa0ea3a2f3965eb45d0dfe7819a2681ca7bb01901c6e9) |
| 1 | The seller tried to claim early and it was refused | [tx](https://explorer.arc.io/tx/0x95ffedf9b4167078dc179251ae98440f9fbc95fccf33b25e14fb8033d2d5cc84) |
| 2 | The buyer paid on time | [tx](https://explorer.arc.io/tx/0xa66543961a8b549a3b51beab75e5a322d2808b859d575a1393c483be4ccc48c7) |
| 3 | The buyer missed the date and the seller claimed exactly what was owed | [tx](https://explorer.arc.io/tx/0x1149f9fb1e41bc2035448c7199538ef3e1f0f3509643696316a1c2ae759aa2f2) |

The scripts are in `mainnet/`.

## On the page

| Feature | What it does |
|---|---|
| Choose your savings | I pick which vaults a request accepts. The buyer sees how much they hold in each and pledges from one |
| Naira next to USDC | Amounts also show in naira. The rate comes from the Chainlink NGN/USD price feed on Celo and refreshes every minute. If that fails, the page uses a website rate |
| Price in naira | I can type the amount in naira. The page converts it at the live rate and the request is made in USDC |
| Pay in parts | A buyer can pay part now and the rest later. The pledge comes back once everything is paid |
| Cash out in one click | After a claim, I can turn the claimed shares into USDC on the page. The page first checks that the vault has the cash |
| Buyer record | Each request shows how many times that buyer paid in full and how many times a seller had to claim |
| WhatsApp message | I can send the request, or a reminder, as a ready-written WhatsApp message |

## Honest limits

I would rather say these clearly than hide them.

| Limit | What it means |
|---|---|
| The vault list is fixed | Seven vaults are built in. Adding another would need a new version of the contract. Four of the seven are switched off in the page until I test a cash-out on them |
| A vault can run short of cash | Some vaults lend most of their money out. If I claim on a day the vault has no idle cash, I hold shares I cannot cash out yet. The page checks first and tells me to try again later. The shares stay safe |
| Amana cannot check that a vault will pay out | The Morpho vaults answer "0" when asked how much a person can cash out, so Amana cannot use that check. It relies on the fixed list and on my tests |
| Vaults can change | Amana cannot protect against Aave, Morpho or a vault manager changing or pausing a vault, or pricing its shares wrongly |
| Seller is paid in shares if they claim | If I claim after a missed date, I receive vault shares worth what is owed. I cash those out in the vault |
| Open requests can be taken by anyone | If I do not name a buyer, any wallet can pledge to the request. I should name the buyer if that matters |
| A stray token sent by mistake is stuck | There is no admin key, so nobody can rescue tokens sent outside the normal Amana actions |
| Paying outside Amana does not free the pledge by itself | If the buyer pays me in cash or another way, I still need to press release |
| The naira number is only a display | It comes from a price feed and moves all day. The deal itself is always in USDC |
| Amana is not a court | It enforces the pledge and the date. It cannot tell whether goods arrived |

I had the first contract reviewed before deployment by a separate reviewer whose job was to break it. The report is in [FINDINGS.md](FINDINGS.md). The issues it raised are either fixed or listed in this honest limits section.

## Tests

```bash
npm install
npx hardhat test
```

211 tests pass. 122 cover the current contract and 89 cover the first one. They cover the normal flows and attack cases, including a vault that lies, a vault that halts, a vault that answers "0" to the cash-out question, a blocklisted seller, front-running payments, rounding, vaults with different decimals, and the vault list rules.

## Repo layout

| Path | What it is |
|---|---|
| `contracts/Amana.sol` | The current contract, with the fixed list of vaults |
| `contracts/Holdfast.sol` | The first contract, Aave only. It keeps its first name so it matches the verified code on the explorer |
| `contracts/mocks/` | Fake tokens and vaults used only for tests |
| `test/` | The test files |
| `mainnet/v2/` | Deploy script and mainnet proof runs for the current contract |
| `mainnet/` | Deploy script and mainnet proof runs for the first contract |
| `public/index.html` | The seller and buyer page |
| `RULES.md` | The rules in plain words |
| `DRYRUN.md` | Dry run against a local copy of mainnet |
| `FINDINGS.md` | Review findings |

MIT licence.
