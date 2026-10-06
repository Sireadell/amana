# Amana

I have a shop. Some of my customers keep their money in Aave, where it earns yield. Yield means their savings can grow while they leave it there.

Sometimes they need to buy something from my shop, but they do not want to remove those savings or cash them out. I also cannot just trust that they will bring the money later on their own.

So Amana lets them make a promise I can rely on. They pledge savings they already have in Aave, worth at least 105% of what they owe me. We agree on the due date together. If they pay before that date, they get every bit of their pledge back and it kept earning while it was pledged. If they do not pay, I can claim only what I am owed, and the rest goes back to them.

Amana is a due-date guarantee on Arc, a payments blockchain from Circle, where a buyer backs a payment promise with Aave USDC vault shares they already hold.

Live on Arc mainnet: [`0x59769AbD5932BF60391e5D81A4DfFb16523eD24c`](https://explorer.arc.io/address/0x59769AbD5932BF60391e5D81A4DfFb16523eD24c). The source is verified. The explorer still labels it Holdfast, which was the first name.

Repo: https://github.com/Sireadell/amana

Live page: https://sireadell.github.io/amana/

## Simple example

A customer takes 200 USDC of goods and agrees to pay in 30 days.

They pledge 210 USDC worth of Aave USDC vault shares. These are savings they already have. Nothing is cashed out, so the savings keep earning.

If they pay on time, I receive 200 USDC and they get all 210 USDC worth of shares back, plus any yield earned while the pledge was held.

If they miss the date, I can claim shares worth exactly 200 USDC. The other 10 USDC worth of shares, plus its yield, goes back to the buyer in the same step.

## How it works

| Step | Who | What happens |
|---|---|---|
| 1 | Seller | I make a request with the USDC amount, the due date, and optionally the buyer's wallet address. A wallet address is like the account name for a crypto wallet |
| 2 | Buyer | The buyer pledges Aave USDC vault shares worth at least 105% of what they owe. Vault shares are receipts for savings kept in Aave |
| 3 | While waiting | The seller cannot claim early. Nothing can be claimed until the due date plus 1 hour |
| 4 | Buyer pays on time | The buyer pays through Amana. I get USDC, and the buyer gets every pledged share back, including the yield |
| 5 | Buyer misses the date | I can claim only shares worth exactly what is still owed. The rest goes back to the buyer in the same step |
| 6 | Other ways out | I can release the pledge any time, for example if I was paid in cash. If I do nothing, the buyer takes everything back 30 days after my claim opens |

If a seller is blocklisted by USDC, the payment is credited inside Amana and the seller can withdraw later. Blocklisted means USDC will not send directly to that address.

There is no owner, no fee, no pause, and no upgrade. Nobody can change the Amana contract after deployment. The Aave vault it points to can still be changed by Aave.

## Proof it works

These are real Arc mainnet transactions with real USDC and the real Aave vault.

| Run | What it proves | Link |
|---|---|---|
| Deploy | The contract was deployed on Arc mainnet | [tx](https://explorer.arc.io/tx/0x59403b7d908b0dfc6b9fa0ea3a2f3965eb45d0dfe7819a2681ca7bb01901c6e9) |
| 1 | The seller tried to claim early and Amana refused it | [tx](https://explorer.arc.io/tx/0x95ffedf9b4167078dc179251ae98440f9fbc95fccf33b25e14fb8033d2d5cc84) |
| 2 | The buyer paid on time. The seller got USDC and the buyer got the shares back | [tx](https://explorer.arc.io/tx/0xa66543961a8b549a3b51beab75e5a322d2808b859d575a1393c483be4ccc48c7) |
| 3 | The buyer missed the date. The seller claimed shares worth exactly what was owed, and the rest went back to the buyer | [tx](https://explorer.arc.io/tx/0x1149f9fb1e41bc2035448c7199538ef3e1f0f3509643696316a1c2ae759aa2f2) |

The scripts for these runs are in `mainnet/`.

## On the page

| Feature | What it does |
|---|---|
| Naira next to USDC | Amounts show in naira as well. The rate is read from the Chainlink NGN/USD price feed on Celo, refreshed every minute. If that feed cannot be read, the page falls back to a website rate. The amount itself stays fixed in USDC, so its naira value moves with the rate |
| Price in naira | A seller can type the amount in naira. The page converts it at the live rate, and the request is made in USDC |
| Pay in parts | A buyer can pay part now and the rest later. The pledge comes back once everything is paid |
| Cash out in one click | After a claim, the seller can turn the claimed shares into USDC without leaving the page |
| Buyer record | Each request shows how many times that buyer paid in full and how many times a seller had to claim, counted from the contract |
| WhatsApp message | The seller can send the request, or a reminder, as a ready-written WhatsApp message |

## Honest limits

I would rather say these clearly than hide them.

| Limit | What it means |
|---|---|
| One Aave vault only, for now | Amana accepts only the Aave USDC vault share token, called waCoreUSDC. I plan to reach out to other vaults, like Morpho, to see if they can work with Amana. This contract cannot change, so supporting another vault would mean a new version |
| Aave can halt or upgrade the vault | Amana cannot protect against Aave changing or pausing the vault |
| Seller is paid in shares if they claim | If I claim after a missed date, I receive vault shares worth what is owed. I cash those out in Aave |
| Open requests can be taken by anyone | If I do not name a buyer, any wallet can pledge to the request. I should name the buyer if that matters |
| A stray token sent by mistake is stuck | There is no admin key, so nobody can rescue tokens sent outside the normal Amana actions |
| Paying outside Amana does not free the pledge by itself | If the buyer pays me in cash or another way, I still need to press release |
| Amana is not a court | It enforces the pledge and the date. It cannot tell whether goods arrived |

I had the contract reviewed before deployment by a separate reviewer whose job was to break it. The report is in [FINDINGS.md](FINDINGS.md). The issues it raised are either fixed or listed in this honest limits section.

## Tests

```bash
npm install
npx hardhat test
```

89 tests pass. They cover the normal flows and attack cases, including a vault that lies, a vault that halts, a blocklisted seller, front-running payments, and rounding.

## Repo layout

| Path | What it is |
|---|---|
| `contracts/Holdfast.sol` | The contract (it keeps its first name so it matches the verified code on the explorer) |
| `contracts/mocks/` | Fake tokens and vaults used only for tests |
| `test/` | The test files |
| `mainnet/` | Deploy script and mainnet proof runs |
| `public/index.html` | The seller and buyer page |
| `RULES.md` | The rules in plain words |
| `DRYRUN.md` | Dry run against a local copy of mainnet |
| `FINDINGS.md` | Review findings |

MIT licence.
