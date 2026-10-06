const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const USDC = (n) => BigInt(Math.round(n * 1e6));
const HOUR = 3600;
const DAY = 86400;

describe('Holdfast', () => {
  let usdc, vault, hf, seller, buyer, other;

  beforeEach(async () => {
    [seller, buyer, other] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory('MockUSDC')).deploy();
    vault = await (await ethers.getContractFactory('MockVault')).deploy();
    hf = await (await ethers.getContractFactory('Holdfast')).deploy(await usdc.getAddress(), await vault.getAddress());
    await vault.mint(buyer.address, USDC(1000));
    await usdc.mint(buyer.address, USDC(1000));
    await usdc.mint(other.address, USDC(1000));
  });

  const hfAddr = () => hf.getAddress();

  async function newRequest(amount = USDC(100), opts = {}) {
    const dueAt = opts.dueAt ?? (await time.latest()) + DAY;
    await hf.connect(seller).createRequest(amount, dueAt, opts.buyer ?? ethers.ZeroAddress);
    const id = await hf.requestCount();
    return { id, dueAt, hash: await hf.termsHashOf(id) };
  }

  async function pledged(amount = USDC(100), shares = USDC(106)) {
    const r = await newRequest(amount);
    await vault.connect(buyer).approve(await hfAddr(), shares);
    await hf.connect(buyer).pledge(r.id, r.hash, shares);
    return { ...r, shares };
  }

  describe('create and cancel', () => {
    it('rejects an amount under 1 USDC', async () => {
      await expect(hf.createRequest(USDC(0.5), (await time.latest()) + DAY, ethers.ZeroAddress)).to.be.revertedWithCustomError(hf, 'BadAmount');
    });
    it('rejects a due date in the past', async () => {
      await expect(hf.createRequest(USDC(10), (await time.latest()) - 1, ethers.ZeroAddress)).to.be.revertedWithCustomError(hf, 'BadDate');
    });
    it('rejects the seller naming themselves as buyer', async () => {
      await expect(hf.createRequest(USDC(10), (await time.latest()) + DAY, seller.address)).to.be.revertedWithCustomError(hf, 'BadAddress');
    });
    it('seller can cancel before a pledge, nobody else can, and a cancelled request cannot be pledged', async () => {
      const r = await newRequest();
      await expect(hf.connect(buyer).cancel(r.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await hf.cancel(r.id);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
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
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(104))).to.be.revertedWithCustomError(hf, 'NotCovered');
    });
    it('accepts a pledge just over 105 percent', async () => {
      const r = await newRequest(USDC(100));
      const need = await hf.sharesNeededFor(USDC(100));
      await vault.connect(buyer).approve(await hfAddr(), need);
      await hf.connect(buyer).pledge(r.id, r.hash, need);
    });
    it('rejects the wrong terms hash', async () => {
      const r = await newRequest();
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, ethers.id('nope'), USDC(106))).to.be.revertedWithCustomError(hf, 'WrongTerms');
    });
    it('rejects a different buyer when one is named', async () => {
      const r = await newRequest(USDC(100), { buyer: other.address });
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'NotBuyer');
    });
    it('rejects the seller pledging to themselves', async () => {
      const r = await newRequest();
      await vault.mint(seller.address, USDC(200));
      await vault.approve(await hfAddr(), USDC(106));
      await expect(hf.pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadAddress');
    });
    it('rejects a pledge when the vault cannot pay out right now', async () => {
      const r = await newRequest();
      await vault.setCapRedeem(true);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'NotCashable');
    });
    it('rejects a pledge after the due date', async () => {
      const r = await newRequest();
      await time.increaseTo(r.dueAt + 1);
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'TooLate');
    });
    it('rejects a second pledge on the same request', async () => {
      const p = await pledged();
      await vault.connect(buyer).approve(await hfAddr(), USDC(106));
      await expect(hf.connect(buyer).pledge(p.id, p.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('fails without an approval', async () => {
      const r = await newRequest();
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'TransferFailed');
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
      const needed = await hf.sharesNeededFor(USDC(100)); // 105 percent, not what we want here
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
      const f = await ethers.getContractFactory('Holdfast');
      await expect(f.deploy(other.address, await vault.getAddress())).to.be.revertedWithCustomError(f, 'BadAddress');
    });
    it('two requests do not interfere', async () => {
      const a = await pledged(USDC(100), USDC(106));
      const b = await newRequest(USDC(50));
      await vault.connect(buyer).approve(await hfAddr(), USDC(53));
      await hf.connect(buyer).pledge(b.id, b.hash, USDC(53));
      await usdc.connect(buyer).approve(await hfAddr(), USDC(50));
      await hf.connect(buyer).pay(b.id, USDC(50));
      expect((await hf.getRequest(a.id)).state).to.equal(2n);
      expect((await hf.getRequest(a.id)).shares).to.equal(USDC(106));
      expect((await hf.getRequest(b.id)).state).to.equal(3n);
    });
  });
});
