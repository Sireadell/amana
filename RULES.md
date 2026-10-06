# Amana rules in plain words (v2, 2026-10-04, after the red-team review)

Amana lets a seller give a buyer time to pay, backed by savings the buyer
already holds that earn yield. It is secured credit, not escrow and not a loan.

## What is fixed in the contract
- One savings token only: Aave's USDC vault share on Arc (waCoreUSDC). One cash token: USDC.
- No owner, no pause, no upgrade, no fees. Nobody can change the rules after deploy.

## The steps
1. The seller makes a request: amount owed, due date, and optionally the buyer's
   address. The terms cannot be edited. The seller can cancel before any pledge.
2. The buyer pledges vault shares worth at least 105% of the amount. They pass the
   terms hash, so nothing can change between looking and pledging.
3. Before pledging, the page checks the vault can actually be cashed out right now.
4. The buyer can pay through the contract at any time. USDC goes to the seller. If
   the seller's address is blocked, the payment is credited to the seller to collect
   later and the buyer still counts as paid. Part payments reduce what is owed.
   When nothing is owed, all the shares go back to the buyer.
5. Nobody can take the pledge before the due date plus 1 hour.
6. After that the seller can claim only the shares worth what is still owed, paid
   in shares. The rest goes back to the buyer in the same transaction.
7. The seller can release the pledge at any time (for example after a payment made
   outside the contract). The buyer can reclaim 30 days after the claim opens if
   the seller has done nothing. Shares always go back as shares, never USDC.
8. The page shows a proof of any outside USDC payment (real USDC only, fake tokens
   do not count) so the seller can decide whether to press release. This is a
   helper, not a contract rule.

## Left out on purpose
Morpho vaults, health bar and top-up, Memo links, invoice numbers, oracles,
liquidation, any admin key, any fee.

## Honest limits (go in the README)
- Aave governance can halt or upgrade the vault. Circle can blocklist addresses or pause USDC.
- Only a payment through the contract frees the pledge automatically.
- No dispute process. The buyer's loss is capped at the amount owed.
- One vault, about 4.5k USDC total, so tiny amounts only.
- Anvil does something close on Ethereum. ShadowFloat on Arc uses a similar pattern
  for agent spending. Claim only "none found on Arc in 116 repos".
- Why it exists: the builder has a real shop and real buyers whose USDC is locked.

## Three runs on mainnet (the receipt)
1. Seller tries to claim early: it reverts.
2. Buyer pays on time: the pledge is released.
3. Buyer misses the date: the seller claims in shares and the buyer gets the rest back.
