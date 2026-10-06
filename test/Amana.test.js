const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const USDC = (n) => BigInt(Math.round(n * 1e6));
const HOUR = 3600;
const DAY = 86400;

describe('Amana', () => {
  let usdc, vault, hf, seller, buyer, other;

  beforeEach(async () => {
    [seller, buyer, other] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory('MockUSDC')).deploy();
    vault = await (await ethers.getContractFactory('MockVault')).deploy();
    hf = await (await ethers.getContractFactory('Amana')).deploy(await usdc.getAddress(), [await vault.getAddress()]);
    await vault.mint(buyer.address, USDC(1000));
    await usdc.mint(buyer.address, USDC(1000));
    await usdc.mint(other.address, USDC(1000));
  });

  const hfAddr = () => hf.getAddress();

  async function newRequest(amount = USDC(100), opts = {}) {
    const dueAt = opts.dueAt ?? (await time.latest()) + DAY;
    await hf.connect(seller).createRequest(amount, dueAt, opts.buyer ?? ethers.ZeroAddress, 1);
    const id = await hf.requestCount();
    return { id, dueAt, hash: await hf.termsHashOf(id) };
  }

  async function pledged(amount = USDC(100), shares = USDC(106)) {
    const r = await newRequest(amount);
    await vault.connect(buyer).approve(await hfAddr(), shares);
    await hf.connect(buyer).pledge(r.id, r.hash, 0, shares);
    return { ...r, shares };
  }

  describe('create and cancel', () => {
    it('rejects an amount under 1 USDC', async () => {
      await expect(hf.createRequest(USDC(0.5), (await time.latest()) + DAY, ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(hf, 'BadAmount');
    });
    it('rejects a due date in the past', async () => {
      await expect(hf.createRequest(USDC(10), (await time.latest()) - 1, ethers.ZeroAddress, 1)).to.be.revertedWithCustomError(hf, 'BadDate');
    });
    it('rejects the seller naming themselves as buyer', async () => {
      await expect(hf.createRequest(USDC(10), (await time.latest()) + DAY, seller.address, 1)).to.be.revertedWithCustomError(hf, 'BadAddress');
    });
    it('seller can cancel before a pledge, nobody else can, and a cancelled request cannot be pledged', async () => {
      const r = await newRequest();
      await expect(hf.connect(buyer).cancel(r.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await hf.cancel(r.id);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('cannot cancel once pledged', async () => {
      const p = await pledged();
      await expect(hf.cancel(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
  });

  describe('pledge', () => {
    it('takes the shares and records the buyer', async () => {
      const p = await pledged();
      expect(await vault.balanceOf(await hfAddr())).to.equal(p.shares);
      const req = await hf.getRequest(p.id);
      expect(req.buyer).to.equal(buyer.address);
      expect(req.state).to.equal(2n);
    });
    it('rejects a pledge worth under 105 percent', async () => {
      const r = await newRequest(USDC(100));
      // 104 shares at 1.00025 is 104.026 USDC, under 105
      await vault.connect(buyer).approve(await hfAddr(), USDC(104));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(104))).to.be.revertedWithCustomError(hf, 'NotCovered');
    });
    it('accepts a pledge just over 105 percent', async () => {
      const r = await newRequest(USDC(100));
      const need = await hf.sharesNeededFor(USDC(100), 0);
      await vault.connect(buyer).approve(await hfAddr(), need);
      await hf.connect(buyer).pledge(r.id, r.hash, 0, need);
    });
    it('rejects the wrong terms hash', async () => {
      const r = await newRequest();
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, ethers.id('nope'), 0, USDC(106))).to.be.revertedWithCustomError(hf, 'WrongTerms');
    });
    it('rejects a different buyer when one is named', async () => {
      const r = await newRequest(USDC(100), { buyer: other.address });
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'NotBuyer');
    });
    it('rejects the seller pledging to themselves', async () => {
      const r = await newRequest();
      await vault.mint(seller.address, USDC(200));
      await vault.approve(await hfAddr(), USDC(106));
      await expect(hf.pledge(r.id, r.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'BadAddress');
    });
    it('accepts a vault whose maxRedeem returns 0 for everyone (like Morpho)', async () => {
      const r = await newRequest();
      await vault.setCapRedeem(true);
      expect(await vault.maxRedeem(buyer.address)).to.equal(0n);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(106));
      expect((await hf.getRequest(r.id)).state).to.equal(2n);
    });
    it('rejects a pledge after the due date', async () => {
      const r = await newRequest();
      await time.increaseTo(r.dueAt + 1);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'TooLate');
    });
    it('rejects a second pledge on the same request', async () => {
      const p = await pledged();
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(p.id, p.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('fails without an approval', async () => {
      const r = await newRequest();
      await expect(hf.connect(buyer).pledge(r.id, r.hash, 0, USDC(106))).to.be.revertedWithCustomError(hf, 'TransferFailed');
    });
  });

  describe('run 1: claim too early reverts', () => {
    it('reverts before the due date', async () => {
      const p = await pledged();
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'TooEarly');
    });
    it('reverts after the due date but inside the grace hour', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR - 5);
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'TooEarly');
    });
    it('only the seller can claim', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 1);
      await expect(hf.connect(buyer).claim(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await expect(hf.connect(other).claim(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
    });
  });

  describe('run 2: paying on time releases the pledge', () => {
    it('full payment sends USDC to the seller and all shares back to the buyer', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await expect(hf.connect(buyer).pay(p.id, USDC(100))).to.emit(hf, 'Paid');
      expect(await usdc.balanceOf(seller.address)).to.equal(USDC(100));
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
      expect(await vault.balanceOf(await hfAddr())).to.equal(0n);
      expect((await hf.getRequest(p.id)).state).to.equal(3n);
    });
    it('after full payment the seller cannot claim', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await hf.connect(buyer).pay(p.id, USDC(100));
      await time.increaseTo(p.dueAt + HOUR + 1);
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('a third party can pay for the buyer, shares still go to the buyer', async () => {
      const p = await pledged();
      await usdc.connect(other).approve(await hfAddr(), USDC(100));
      await hf.connect(other).pay(p.id, USDC(100));
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
      expect(await vault.balanceOf(other.address)).to.equal(0n);
    });
    it('rejects paying zero, and takes only what is owed when asked for more', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(200));
      await expect(hf.connect(buyer).pay(p.id, 0)).to.be.revertedWithCustomError(hf, 'BadAmount');
      await hf.connect(buyer).pay(p.id, USDC(101));
      expect(await usdc.balanceOf(seller.address)).to.equal(USDC(100));
      expect(await usdc.balanceOf(buyer.address)).to.equal(USDC(900));
    });
    it('payment is still accepted after the due date until the seller claims', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 10);
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await hf.connect(buyer).pay(p.id, USDC(100));
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('cannot pay before a pledge exists', async () => {
      const r = await newRequest();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await expect(hf.connect(buyer).pay(r.id, USDC(100))).to.be.revertedWithCustomError(hf, 'BadState');
    });
  });

  describe('run 3: missed date, seller claims in shares and buyer gets the rest', () => {
    it('seller gets shares worth the amount owed, buyer gets the remainder', async () => {
      const p = await pledged(); // 106 shares pledged for 100 USDC owed
      await time.increaseTo(p.dueAt + HOUR + 1);
      const needed = await hf.sharesNeededFor(USDC(100), 0); // 105 percent, not what we want here
      expect(needed).to.be.gt(0n);
      const owedShares = USDC(100) * 1_000_000n / 1_000_250n + 1n; // rounded up
      await expect(hf.claim(p.id)).to.emit(hf, 'Claimed');
      const sellerShares = await vault.balanceOf(seller.address);
      const buyerShares = await vault.balanceOf(buyer.address);
      // seller shares are worth at least the amount owed, and not more than one share above it
      const worth = (sellerShares * 1_000_250n) / 1_000_000n;
      expect(worth).to.be.gte(USDC(100));
      expect(sellerShares).to.equal(owedShares);
      expect(sellerShares + buyerShares).to.equal(USDC(1000) - p.shares + p.shares); // nothing lost
      expect(await vault.balanceOf(await hfAddr())).to.equal(0n);
      expect((await hf.getRequest(p.id)).state).to.equal(4n);
    });
    it('cannot claim twice', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 1);
      await hf.claim(p.id);
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('after a claim the buyer cannot reclaim or pay', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 1);
      await hf.claim(p.id);
      await time.increase(31 * DAY);
      await expect(hf.connect(buyer).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await expect(hf.connect(buyer).pay(p.id, USDC(100))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('a part payment lowers what the seller can claim', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(60));
      await hf.connect(buyer).pay(p.id, USDC(60));
      expect(await hf.owed(p.id)).to.equal(USDC(40));
      await time.increaseTo(p.dueAt + HOUR + 1);
      await hf.claim(p.id);
      const sellerShares = await vault.balanceOf(seller.address);
      expect((sellerShares * 1_000_250n) / 1_000_000n).to.be.gte(USDC(40));
      expect(sellerShares).to.be.lt(USDC(41));
      expect(await usdc.balanceOf(seller.address)).to.equal(USDC(60));
    });
    it('if the share price falls, the seller takes the whole pledge and the buyer gets nothing back', async () => {
      const p = await pledged(USDC(100), USDC(106));
      await vault.setPrice(900_000); // each share now worth 0.90
      await time.increaseTo(p.dueAt + HOUR + 1);
      const buyerBefore = await vault.balanceOf(buyer.address);
      await hf.claim(p.id);
      expect(await vault.balanceOf(seller.address)).to.equal(USDC(106));
      expect(await vault.balanceOf(buyer.address)).to.equal(buyerBefore);
    });
    it('if the share price rises, the seller takes fewer shares', async () => {
      const p = await pledged();
      await vault.setPrice(1_100_000);
      await time.increaseTo(p.dueAt + HOUR + 1);
      await hf.claim(p.id);
      const s = await vault.balanceOf(seller.address);
      expect(s).to.be.lt(USDC(91));
      expect((s * 1_100_000n) / 1_000_000n).to.be.gte(USDC(100));
    });
  });

  describe('release and reclaim', () => {
    it('seller can release at any time and shares go back to the buyer', async () => {
      const p = await pledged();
      await hf.release(p.id);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
      expect((await hf.getRequest(p.id)).state).to.equal(5n);
    });
    it('only the seller can release', async () => {
      const p = await pledged();
      await expect(hf.connect(buyer).release(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
    });
    it('release before a pledge is not allowed', async () => {
      const r = await newRequest();
      await expect(hf.release(r.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('buyer cannot reclaim before 30 days after the claim opens', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 30 * DAY - 10);
      await expect(hf.connect(buyer).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'TooEarly');
    });
    it('buyer can reclaim after 30 days if the seller did nothing, and then the seller cannot claim', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 30 * DAY + 1);
      await hf.connect(buyer).reclaim(p.id);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('only the buyer can reclaim', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 30 * DAY + 1);
      await expect(hf.reclaim(p.id)).to.be.revertedWithCustomError(hf, 'NotBuyer');
    });
    it('the seller can still claim between day 0 and day 30 of the window', async () => {
      const p = await pledged();
      await time.increaseTo(p.dueAt + HOUR + 29 * DAY);
      await hf.claim(p.id);
    });
  });

  describe('blocked seller', () => {
    it('credits the payment to the seller and still frees the pledge', async () => {
      const p = await pledged();
      await usdc.setBlocked(seller.address, true);
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await expect(hf.connect(buyer).pay(p.id, USDC(100))).to.emit(hf, 'Paid').withArgs(p.id, buyer.address, USDC(100), 0, true);
      expect(await hf.credited(seller.address)).to.equal(USDC(100));
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('the seller cannot withdraw while blocked, and can once unblocked', async () => {
      const p = await pledged();
      await usdc.setBlocked(seller.address, true);
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await hf.connect(buyer).pay(p.id, USDC(100));
      await expect(hf.withdrawCredit()).to.be.revertedWithCustomError(hf, 'TransferFailed');
      expect(await hf.credited(seller.address)).to.equal(USDC(100));
      await usdc.setBlocked(seller.address, false);
      await hf.withdrawCredit();
      expect(await usdc.balanceOf(seller.address)).to.equal(USDC(100));
      expect(await hf.credited(seller.address)).to.equal(0n);
    });
    it('withdrawCredit with nothing credited reverts', async () => {
      await expect(hf.withdrawCredit()).to.be.revertedWithCustomError(hf, 'NothingCredited');
    });
  });

  describe('money safety', () => {
    it('the contract holds no USDC after a normal payment', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await hfAddr(), USDC(100));
      await hf.connect(buyer).pay(p.id, USDC(100));
      expect(await usdc.balanceOf(await hfAddr())).to.equal(0n);
    });
    it('rejects a deploy with a non-contract address', async () => {
      const f = await ethers.getContractFactory('Amana');
      await expect(f.deploy(other.address, [await vault.getAddress()])).to.be.revertedWithCustomError(f, 'BadAddress');
    });
    it('two requests do not interfere', async () => {
      const a = await pledged(USDC(100), USDC(106));
      const b = await newRequest(USDC(50));
      await vault.connect(buyer).approve(await hfAddr(), USDC(53));
      await hf.connect(buyer).pledge(b.id, b.hash, 0, USDC(53));
      await usdc.connect(buyer).approve(await hfAddr(), USDC(50));
      await hf.connect(buyer).pay(b.id, USDC(50));
      expect((await hf.getRequest(a.id)).state).to.equal(2n);
      expect((await hf.getRequest(a.id)).shares).to.equal(USDC(106));
      expect((await hf.getRequest(b.id)).state).to.equal(3n);
    });
  });
});


describe('several vaults', () => {
  const E18 = 10n ** 18n;
  let usdc, v0, v1, v2, am, seller, buyer, other, vaults, initial;

  async function deployVault(name) {
    return (await ethers.getContractFactory(name)).deploy();
  }

  beforeEach(async () => {
    [seller, buyer, other] = await ethers.getSigners();
    usdc = await deployVault('MockUSDC');
    v0 = await deployVault('MockVault'); // 6 decimals, price 1.00025
    v1 = await deployVault('MockVault18'); // 18 decimals, price 1.05
    v2 = await deployVault('MockVault'); // 6 decimals, price 1.2
    await v2.setPrice(1_200_000);
    vaults = [v0, v1, v2];
    am = await (await ethers.getContractFactory('Amana')).deploy(
      await usdc.getAddress(),
      await Promise.all(vaults.map((v) => v.getAddress())),
    );
    await v0.mint(buyer.address, USDC(1000));
    await v1.mint(buyer.address, 1000n * E18);
    await v2.mint(buyer.address, USDC(1000));
    await usdc.mint(buyer.address, USDC(1000));
    initial = [USDC(1000), 1000n * E18, USDC(1000)];
  });

  const amAddr = () => am.getAddress();

  async function newReq(amount, mask, opts = {}) {
    const dueAt = opts.dueAt ?? (await time.latest()) + DAY;
    await am.connect(seller).createRequest(amount, dueAt, ethers.ZeroAddress, mask);
    const id = await am.requestCount();
    return { id, dueAt, hash: await am.termsHashOf(id) };
  }
  async function pledgeOn(idx, amount = USDC(100), mask = 7) {
    const r = await newReq(amount, mask);
    const need = await am.sharesNeededFor(amount, idx);
    await vaults[idx].connect(buyer).approve(await amAddr(), need);
    await am.connect(buyer).pledge(r.id, r.hash, idx, need);
    return { ...r, need };
  }
  async function balances(who) {
    return Promise.all(vaults.map((v) => v.balanceOf(who)));
  }
  // every vault except idx is untouched everywhere; the contract holds contractHolds of vault idx
  async function onlyThisVaultMoved(idx, contractHolds) {
    const c = await balances(await amAddr());
    const b = await balances(buyer.address);
    const s = await balances(seller.address);
    for (let i = 0; i < 3; i++) {
      if (i === idx) continue;
      expect(c[i], `contract vault ${i}`).to.equal(0n);
      expect(b[i], `buyer vault ${i}`).to.equal(initial[i]);
      expect(s[i], `seller vault ${i}`).to.equal(0n);
    }
    expect(c[idx]).to.equal(contractHolds);
  }

  it('vaultCount and vaultAt are correct', async () => {
    expect(await am.vaultCount()).to.equal(3n);
    expect(await am.vaultAt(0)).to.equal(await v0.getAddress());
    expect(await am.vaultAt(1)).to.equal(await v1.getAddress());
    expect(await am.vaultAt(2)).to.equal(await v2.getAddress());
    await expect(am.vaultAt(3)).to.be.reverted;
  });

  it('sharesNeededFor differs per vault and an unknown index reverts', async () => {
    const n0 = await am.sharesNeededFor(USDC(100), 0);
    const n1 = await am.sharesNeededFor(USDC(100), 1);
    const n2 = await am.sharesNeededFor(USDC(100), 2);
    expect(n0).to.be.gt(USDC(104)).and.to.be.lt(USDC(105)); // 105 USDC at 1.00025
    expect(n1).to.equal(100n * E18); // 105 USDC at 1.05 per share
    expect(n2).to.equal(USDC(87.5)); // 105 USDC at 1.2 per share
    expect(new Set([n0, n1, n2]).size).to.equal(3);
    await expect(am.sharesNeededFor(USDC(100), 3)).to.be.revertedWithCustomError(am, 'BadVault');
  });

  it('records the mask and vault, and the events carry the new fields', async () => {
    const dueAt = (await time.latest()) + DAY;
    const tx = await am.createRequest(USDC(100), dueAt, ethers.ZeroAddress, 6);
    const hash = await am.termsHashOf(1);
    await expect(tx).to.emit(am, 'RequestCreated').withArgs(1n, seller.address, ethers.ZeroAddress, USDC(100), dueAt, 6, hash);
    const need = await am.sharesNeededFor(USDC(100), 1);
    await v1.connect(buyer).approve(await amAddr(), need);
    await expect(am.connect(buyer).pledge(1, hash, 1, need))
      .to.emit(am, 'Pledged')
      .withArgs(1n, buyer.address, 1, need, await v1.convertToAssets(need));
    const req = await am.getRequest(1);
    expect(req.acceptMask).to.equal(6n);
    expect(req.vaultIdx).to.equal(1n);
    expect(req.shares).to.equal(need);
  });

  describe('accepted list (mask)', () => {
    it('seller accepts only vault 1 (mask 2): a pledge from vault 0 reverts BadVault, vault 1 works', async () => {
      const r = await newReq(USDC(100), 2);
      const n0 = await am.sharesNeededFor(USDC(100), 0);
      await v0.connect(buyer).approve(await amAddr(), n0);
      await expect(am.connect(buyer).pledge(r.id, r.hash, 0, n0)).to.be.revertedWithCustomError(am, 'BadVault');
      const n1 = await am.sharesNeededFor(USDC(100), 1);
      await v1.connect(buyer).approve(await amAddr(), n1);
      await am.connect(buyer).pledge(r.id, r.hash, 1, n1);
      expect((await am.getRequest(r.id)).vaultIdx).to.equal(1n);
      await onlyThisVaultMoved(1, n1);
    });

    it('mask 3 accepts vault 0 and vault 1 but not vault 2', async () => {
      const a = await newReq(USDC(100), 3);
      const n0 = await am.sharesNeededFor(USDC(100), 0);
      await v0.connect(buyer).approve(await amAddr(), n0);
      await am.connect(buyer).pledge(a.id, a.hash, 0, n0);
      const b = await newReq(USDC(100), 3);
      const n1 = await am.sharesNeededFor(USDC(100), 1);
      await v1.connect(buyer).approve(await amAddr(), n1);
      await am.connect(buyer).pledge(b.id, b.hash, 1, n1);
      const c = await newReq(USDC(100), 3);
      const n2 = await am.sharesNeededFor(USDC(100), 2);
      await v2.connect(buyer).approve(await amAddr(), n2);
      await expect(am.connect(buyer).pledge(c.id, c.hash, 2, n2)).to.be.revertedWithCustomError(am, 'BadVault');
    });

    it('a vault index outside the list reverts BadVault', async () => {
      const r = await newReq(USDC(100), 7);
      await expect(am.connect(buyer).pledge(r.id, r.hash, 3, USDC(106))).to.be.revertedWithCustomError(am, 'BadVault');
      await expect(am.connect(buyer).pledge(r.id, r.hash, 255, USDC(106))).to.be.revertedWithCustomError(am, 'BadVault');
    });

    it('a vault that is listed but not accepted cannot be pledged even with the right hash', async () => {
      const r = await newReq(USDC(100), 4); // only vault 2
      expect(r.hash).to.equal(await am.termsHashOf(r.id));
      const n = await am.sharesNeededFor(USDC(100), 1);
      await v1.connect(buyer).approve(await amAddr(), n);
      await expect(am.connect(buyer).pledge(r.id, r.hash, 1, n)).to.be.revertedWithCustomError(am, 'BadVault');
      expect(await v1.balanceOf(buyer.address)).to.equal(initial[1]);
      expect((await am.getRequest(r.id)).state).to.equal(1n);
    });

    it('createRequest rejects mask 0 and a mask bit beyond the list', async () => {
      const due = (await time.latest()) + DAY;
      await expect(am.createRequest(USDC(10), due, ethers.ZeroAddress, 0)).to.be.revertedWithCustomError(am, 'BadVault');
      await expect(am.createRequest(USDC(10), due, ethers.ZeroAddress, 8)).to.be.revertedWithCustomError(am, 'BadVault');
      await expect(am.createRequest(USDC(10), due, ethers.ZeroAddress, 15)).to.be.revertedWithCustomError(am, 'BadVault');
      await expect(am.createRequest(USDC(10), due, ethers.ZeroAddress, 255)).to.be.revertedWithCustomError(am, 'BadVault');
      await am.createRequest(USDC(10), due, ethers.ZeroAddress, 7);
    });

    it('the terms hash changes when only the mask differs', async () => {
      const dueAt = (await time.latest()) + DAY;
      await am.createRequest(USDC(100), dueAt, ethers.ZeroAddress, 2);
      const chainId = (await ethers.provider.getNetwork()).chainId;
      const addr = await amAddr();
      const hashFor = (mask) =>
        ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'address', 'uint256', 'address', 'address', 'uint256', 'uint64', 'uint8'],
            [chainId, addr, 1n, seller.address, ethers.ZeroAddress, USDC(100), dueAt, mask],
          ),
        );
      expect(await am.termsHashOf(1)).to.equal(hashFor(2));
      expect(hashFor(2)).to.not.equal(hashFor(3));
      expect(await am.termsHashOf(1)).to.not.equal(hashFor(3));
      // a buyer who saw a mask 3 hash cannot pledge into the mask 2 request
      const n = await am.sharesNeededFor(USDC(100), 1);
      await v1.connect(buyer).approve(await amAddr(), n);
      await expect(am.connect(buyer).pledge(1, hashFor(3), 1, n)).to.be.revertedWithCustomError(am, 'WrongTerms');
      await am.connect(buyer).pledge(1, hashFor(2), 1, n);
    });
  });

  describe('each exit uses the right vault and leaves the others alone', () => {
    for (const idx of [0, 1, 2]) {
      describe(`vault ${idx}`, () => {
        it('pledge takes shares of that vault only', async () => {
          const p = await pledgeOn(idx);
          await onlyThisVaultMoved(idx, p.need);
          expect(await vaults[idx].balanceOf(buyer.address)).to.equal(initial[idx] - p.need);
        });
        it('paying in full returns that vault shares to the buyer', async () => {
          const p = await pledgeOn(idx);
          await usdc.connect(buyer).approve(await amAddr(), USDC(100));
          await am.connect(buyer).pay(p.id, USDC(100));
          await onlyThisVaultMoved(idx, 0n);
          expect(await vaults[idx].balanceOf(buyer.address)).to.equal(initial[idx]);
          expect((await am.getRequest(p.id)).state).to.equal(3n);
        });
        it('release returns that vault shares to the buyer', async () => {
          const p = await pledgeOn(idx);
          await am.release(p.id);
          await onlyThisVaultMoved(idx, 0n);
          expect(await vaults[idx].balanceOf(buyer.address)).to.equal(initial[idx]);
        });
        it('reclaim returns that vault shares to the buyer', async () => {
          const p = await pledgeOn(idx);
          await time.increaseTo(p.dueAt + HOUR + 30 * DAY + 1);
          await am.connect(buyer).reclaim(p.id);
          await onlyThisVaultMoved(idx, 0n);
          expect(await vaults[idx].balanceOf(buyer.address)).to.equal(initial[idx]);
        });
        it('claim pays the seller in that vault and returns the rest to the buyer', async () => {
          const p = await pledgeOn(idx);
          await time.increaseTo(p.dueAt + HOUR + 1);
          await am.claim(p.id);
          const sellerShares = await vaults[idx].balanceOf(seller.address);
          expect(await vaults[idx].convertToAssets(sellerShares)).to.be.gte(USDC(100));
          expect(await vaults[idx].convertToAssets(sellerShares - 1n)).to.be.lt(USDC(100));
          expect(sellerShares + (await vaults[idx].balanceOf(buyer.address))).to.equal(initial[idx]);
          expect(await vaults[idx].balanceOf(await amAddr())).to.equal(0n);
          for (let i = 0; i < 3; i++) {
            if (i === idx) continue;
            expect(await vaults[i].balanceOf(seller.address)).to.equal(0n);
            expect(await vaults[i].balanceOf(buyer.address)).to.equal(initial[i]);
            expect(await vaults[i].balanceOf(await amAddr())).to.equal(0n);
          }
        });
      });
    }

    it('claim after a missed date with the 18-decimals vault pays shares worth exactly what is owed and returns the rest', async () => {
      const r = await newReq(USDC(100), 2);
      const pledgeShares = 110n * E18; // worth 115.5 USDC at 1.05
      await v1.connect(buyer).approve(await amAddr(), pledgeShares);
      await am.connect(buyer).pledge(r.id, r.hash, 1, pledgeShares);
      await usdc.connect(buyer).approve(await amAddr(), USDC(40));
      await am.connect(buyer).pay(r.id, USDC(40)); // 60 USDC still owed
      await time.increaseTo(r.dueAt + HOUR + 1);
      await expect(am.claim(r.id)).to.emit(am, 'Claimed');
      const sellerShares = await v1.balanceOf(seller.address);
      // 60 USDC / 1.05 = 57142857142857142857.14 shares, rounded up
      expect(sellerShares).to.equal(57142857142857142858n);
      expect(await v1.convertToAssets(sellerShares)).to.be.gte(USDC(60));
      expect(await v1.convertToAssets(sellerShares - 1n)).to.be.lt(USDC(60));
      expect(await v1.balanceOf(buyer.address)).to.equal(initial[1] - sellerShares);
      expect(await v1.balanceOf(await amAddr())).to.equal(0n);
    });

    it('price drop on the 18-decimals vault: seller takes the whole pledge', async () => {
      const p = await pledgeOn(1);
      await v1.setPrice(800_000_000_000_000_000n); // 0.80 per share
      await time.increaseTo(p.dueAt + HOUR + 1);
      await am.claim(p.id);
      expect(await v1.balanceOf(seller.address)).to.equal(p.need);
    });
  });

  describe('constructor', () => {
    let F, usdcAddr, addrs;
    beforeEach(async () => {
      F = await ethers.getContractFactory('Amana');
      usdcAddr = await usdc.getAddress();
      addrs = await Promise.all(vaults.map((v) => v.getAddress()));
    });
    it('rejects an empty list', async () => {
      await expect(F.deploy(usdcAddr, [])).to.be.revertedWithCustomError(F, 'BadVault');
    });
    it('rejects 9 vaults and accepts 8', async () => {
      const many = [];
      for (let i = 0; i < 9; i++) many.push(await (await deployVault('MockVault')).getAddress());
      await expect(F.deploy(usdcAddr, many)).to.be.revertedWithCustomError(F, 'BadVault');
      const eight = await F.deploy(usdcAddr, many.slice(0, 8));
      expect(await eight.vaultCount()).to.equal(8n);
    });
    it('rejects a duplicate vault', async () => {
      await expect(F.deploy(usdcAddr, [addrs[0], addrs[1], addrs[0]])).to.be.revertedWithCustomError(F, 'BadVault');
    });
    it('rejects the zero address, a plain wallet, and usdc used as a vault', async () => {
      await expect(F.deploy(usdcAddr, [addrs[0], ethers.ZeroAddress])).to.be.revertedWithCustomError(F, 'BadAddress');
      await expect(F.deploy(usdcAddr, [other.address])).to.be.revertedWithCustomError(F, 'BadAddress');
      await expect(F.deploy(usdcAddr, [addrs[0], usdcAddr])).to.be.revertedWithCustomError(F, 'BadAddress');
    });
    it('rejects a wallet or zero as usdc', async () => {
      await expect(F.deploy(other.address, addrs)).to.be.revertedWithCustomError(F, 'BadAddress');
      await expect(F.deploy(ethers.ZeroAddress, addrs)).to.be.revertedWithCustomError(F, 'BadAddress');
    });
  });

  describe('a broken vault in the list', () => {
    it('a vault that reverts in convertToAssets blocks its own pledge but another vault still works', async () => {
      const bad = await deployVault('AAttackVault');
      const good = await deployVault('MockVault');
      const m = await (await ethers.getContractFactory('Amana')).deploy(
        await usdc.getAddress(),
        [await bad.getAddress(), await good.getAddress()],
      );
      const mAddr = await m.getAddress();
      await bad.mint(buyer.address, USDC(1000));
      await good.mint(buyer.address, USDC(1000));
      const dueAt = (await time.latest()) + DAY;
      await m.connect(seller).createRequest(USDC(100), dueAt, ethers.ZeroAddress, 1); // bad vault only
      await m.connect(seller).createRequest(USDC(100), dueAt, ethers.ZeroAddress, 2); // good vault only
      await bad.setRevertViews(true);
      await bad.connect(buyer).approve(mAddr, USDC(106));
      await expect(m.connect(buyer).pledge(1, await m.termsHashOf(1), 0, USDC(106))).to.be.reverted;
      await expect(m.sharesNeededFor(USDC(100), 0)).to.be.reverted;
      expect(await bad.balanceOf(buyer.address)).to.equal(USDC(1000));
      // the other request is untouched by the broken vault
      await good.connect(buyer).approve(mAddr, USDC(106));
      await m.connect(buyer).pledge(2, await m.termsHashOf(2), 1, USDC(106));
      await usdc.connect(buyer).approve(mAddr, USDC(100));
      await m.connect(buyer).pay(2, USDC(100));
      expect(await good.balanceOf(buyer.address)).to.equal(USDC(1000));
      expect((await m.getRequest(2)).state).to.equal(3n);
    });
  });

  describe('seven vaults', () => {
    it('seven vaults deployed at once all work', async () => {
      const list = [];
      for (let i = 0; i < 7; i++) {
        const v = await deployVault('MockVault');
        await v.setPrice(1_000_000 + i * 50_000);
        await v.mint(buyer.address, USDC(1000));
        list.push(v);
      }
      const m = await (await ethers.getContractFactory('Amana')).deploy(
        await usdc.getAddress(),
        await Promise.all(list.map((v) => v.getAddress())),
      );
      expect(await m.vaultCount()).to.equal(7n);
      const mAddr = await m.getAddress();
      await expect(m.createRequest(USDC(10), (await time.latest()) + DAY, ethers.ZeroAddress, 128)).to.be.revertedWithCustomError(m, 'BadVault');
      for (let i = 0; i < 7; i++) {
        expect(await m.vaultAt(i)).to.equal(await list[i].getAddress());
        await m.createRequest(USDC(100), (await time.latest()) + DAY, ethers.ZeroAddress, 1 << i);
        const id = await m.requestCount();
        const need = await m.sharesNeededFor(USDC(100), i);
        await list[i].connect(buyer).approve(mAddr, need);
        await m.connect(buyer).pledge(id, await m.termsHashOf(id), i, need);
        expect(await list[i].balanceOf(mAddr)).to.equal(need);
        for (let j = 0; j < 7; j++) {
          if (j !== i) expect(await list[j].balanceOf(mAddr)).to.equal(0n);
        }
        await m.release(id);
        expect(await list[i].balanceOf(buyer.address)).to.equal(USDC(1000));
      }
      // one request that accepts all seven
      await m.createRequest(USDC(100), (await time.latest()) + DAY, ethers.ZeroAddress, 127);
      const id = await m.requestCount();
      const need = await m.sharesNeededFor(USDC(100), 6);
      await list[6].connect(buyer).approve(mAddr, need);
      await m.connect(buyer).pledge(id, await m.termsHashOf(id), 6, need);
      expect((await m.getRequest(id)).vaultIdx).to.equal(6n);
    });
  });
});
