const { expect } = require('chai');
const { ethers } = require('hardhat');
const { time } = require('@nomicfoundation/hardhat-network-helpers');

const USDC = (n) => BigInt(Math.round(n * 1e6));
const DAY = 86400;

describe('Holdfast attacks', () => {
  let usdc, vault, hf, seller, buyer, other, mallory;

  async function setup(usdcName = 'MockUSDC', vaultName = 'MockVault') {
    [seller, buyer, other, mallory] = await ethers.getSigners();
    usdc = await (await ethers.getContractFactory(usdcName)).deploy();
    vault = await (await ethers.getContractFactory(vaultName)).deploy();
    hf = await (await ethers.getContractFactory('Holdfast')).deploy(await usdc.getAddress(), await vault.getAddress());
    await vault.mint(buyer.address, USDC(1000));
    await vault.mint(mallory.address, USDC(1000));
    await usdc.mint(buyer.address, USDC(1000));
    await usdc.mint(other.address, USDC(1000));
    await usdc.mint(seller.address, USDC(1000));
  }
  const A = (c) => c.getAddress();

  async function newReq(amount = USDC(100), opts = {}) {
    const dueAt = opts.dueAt ?? (await time.latest()) + DAY;
    await hf.connect(opts.from ?? seller).createRequest(amount, dueAt, opts.buyer ?? ethers.ZeroAddress);
    const id = await hf.requestCount();
    return { id, dueAt: BigInt(dueAt), hash: await hf.termsHashOf(id) };
  }
  async function pledged(amount = USDC(100), shares = USDC(106), opts = {}) {
    const r = await newReq(amount, opts);
    const who = opts.pledger ?? buyer;
    await vault.connect(who).approve(await A(hf), shares);
    await hf.connect(who).pledge(r.id, r.hash, shares);
    return { ...r, shares };
  }
  const openClaim = (p) => time.increaseTo(p.dueAt + 3600n);

  // ---------------------------------------------------------------- 1 early taking
  describe('1. seller cannot take early or too much', () => {
    beforeEach(() => setup());

    it('claim fails one second before due+1h and works exactly at due+1h', async () => {
      const p = await pledged();
      await time.setNextBlockTimestamp(p.dueAt + 3599n);
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'TooEarly');
      await time.setNextBlockTimestamp(p.dueAt + 3600n);
      await hf.claim(p.id);
    });
    it('seller cannot get shares by release, cancel, withdrawCredit or any other route before the date', async () => {
      const p = await pledged();
      const before = await vault.balanceOf(seller.address);
      await expect(hf.cancel(p.id)).to.be.reverted;
      await expect(hf.withdrawCredit()).to.be.reverted;
      await expect(hf.reclaim(p.id)).to.be.reverted;
      await hf.release(p.id);
      expect(await vault.balanceOf(seller.address)).to.equal(before);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('claim pays only what is owed, rest to buyer, nothing left behind', async () => {
      const p = await pledged(USDC(100), USDC(110));
      await usdc.connect(buyer).approve(await A(hf), USDC(40));
      await hf.connect(buyer).pay(p.id, USDC(40));
      await openClaim(p);
      await hf.claim(p.id);
      const sellerShares = await vault.balanceOf(seller.address);
      const worth = await vault.convertToAssets(sellerShares);
      expect(worth).to.be.gte(USDC(60));
      expect(worth).to.be.lt(USDC(60) + 2n);
      expect(await vault.balanceOf(await A(hf))).to.equal(0n);
      expect(sellerShares + (await vault.balanceOf(buyer.address))).to.equal(USDC(1000));
    });
    it('price drop of 20 percent: seller takes the whole pledge but never more (bounded)', async () => {
      const p = await pledged(USDC(100), USDC(106));
      await vault.setPrice(800_000);
      await openClaim(p);
      await hf.claim(p.id);
      expect(await vault.balanceOf(seller.address)).to.equal(USDC(106));
      expect(await vault.balanceOf(await A(hf))).to.equal(0n);
    });
    it('price spike before claim gives the buyer more back, seller still gets exactly owed worth', async () => {
      const p = await pledged(USDC(100), USDC(106));
      await vault.setPrice(2_000_000);
      await openClaim(p);
      await hf.claim(p.id);
      expect(await vault.balanceOf(seller.address)).to.equal(USDC(50));
    });
    it('seller who pays themselves in full frees the pledge (their own money, not theft)', async () => {
      const p = await pledged();
      await usdc.connect(seller).approve(await A(hf), USDC(100));
      await hf.connect(seller).pay(p.id, USDC(100));
      expect((await hf.getRequest(p.id)).state).to.equal(3n);
    });
  });

  // ---------------------------------------------------------------- 2 locking
  describe('2. locking and stranding', () => {
    beforeEach(() => setup('MockUSDC', 'AttackVault'));

    it('FINDING: if the vault refuses to send shares to the buyer, claim, final pay, release and reclaim ALL revert and the shares are stranded', async () => {
      const p = await pledged();
      await vault.setBlocked(buyer.address, true);
      await openClaim(p);
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'TransferFailed');
      await expect(hf.release(p.id)).to.be.revertedWithCustomError(hf, 'TransferFailed');
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await expect(hf.connect(other).pay(p.id, USDC(100))).to.be.revertedWithCustomError(hf, 'TransferFailed');
      await time.increase(400 * DAY);
      await expect(hf.connect(buyer).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'TransferFailed');
      expect(await vault.balanceOf(await A(hf))).to.equal(p.shares);
      await hf.connect(other).pay(p.id, USDC(10)); // part payments still work but free nothing
    });
    it('a failed final pay reverts the whole transaction: payer keeps USDC', async () => {
      const p = await pledged();
      await vault.setBlocked(buyer.address, true);
      const before = await usdc.balanceOf(other.address);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await expect(hf.connect(other).pay(p.id, USDC(100))).to.be.reverted;
      expect(await usdc.balanceOf(other.address)).to.equal(before);
    });
    it('FINDING: if the vault refuses to send shares to the SELLER, seller cannot claim and buyer reclaims everything after 30 days unpaid', async () => {
      const p = await pledged();
      await vault.setBlocked(seller.address, true);
      await openClaim(p);
      await expect(hf.claim(p.id)).to.be.reverted;
      await time.increaseTo(p.dueAt + 3600n + 30n * BigInt(DAY));
      await hf.connect(buyer).reclaim(p.id);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('FINDING: if the vault view calls revert (halt), claim reverts but reclaim still works so the buyer walks away unpaid', async () => {
      const p = await pledged();
      await vault.setRevertViews(true);
      await openClaim(p);
      await expect(hf.claim(p.id)).to.be.reverted;
      await time.increase(31 * DAY);
      await hf.connect(buyer).reclaim(p.id);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('reclaim is not possible one second early', async () => {
      const p = await pledged();
      await time.setNextBlockTimestamp(p.dueAt + 3600n + 30n * BigInt(DAY) - 1n);
      await expect(hf.connect(buyer).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'TooEarly');
    });
    it('a seller contract cannot revert a plain share transfer', async () => {
      const R = await (await ethers.getContractFactory('Reenterer')).deploy(await A(hf));
      await R.create(USDC(100), (await time.latest()) + DAY, ethers.ZeroAddress);
      const id = await hf.requestCount();
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await hf.connect(buyer).pledge(id, await hf.termsHashOf(id), USDC(106));
      await time.increase(DAY + 3600);
      await R.doClaim();
      expect(await vault.balanceOf(await A(R))).to.be.gt(0n);
    });
    it('FIXED: a due date more than a year away is refused', async () => {
      const far = (await time.latest()) + 366 * DAY;
      await expect(hf.createRequest(USDC(100), far, ethers.ZeroAddress)).to.be.revertedWithCustomError(hf, 'BadDate');
      await hf.createRequest(USDC(100), (await time.latest()) + 364 * DAY, ethers.ZeroAddress);
    });
  });

  // ---------------------------------------------------------------- 3 rounding
  describe('3. rounding, overflow, price games', () => {
    beforeEach(() => setup());

    it('sharesNeededFor is exactly the minimum that passes the 105 percent cover', async () => {
      for (const price of [1_000_000, 1_000_250, 1_000_270, 999_999, 3_141_593, 1_000_000_001]) {
        await vault.setPrice(price);
        for (const amt of [USDC(1), 1_000_001n, USDC(7.77), USDC(100), 123_456_789n]) {
          const need = await hf.sharesNeededFor(amt);
          const ok = (await vault.convertToAssets(need)) * 100n >= amt * 105n;
          const lessOk = (await vault.convertToAssets(need - 1n)) * 100n >= amt * 105n;
          expect(ok, `price ${price} amt ${amt}`).to.equal(true);
          if (need > 1n) expect(lessOk, `price ${price} amt ${amt} minus one`).to.equal(false);
        }
      }
    });
    it('FIXED: an absurd amount is refused at creation', async () => {
      await expect(hf.createRequest(2n ** 255n, (await time.latest()) + DAY, ethers.ZeroAddress)).to.be.revertedWithCustomError(hf, 'BadAmount');
      await expect(hf.createRequest(USDC(1_000_000) + 1n, (await time.latest()) + DAY, ethers.ZeroAddress)).to.be.revertedWithCustomError(hf, 'BadAmount');
    });
    it('tiny owed (1 wei left) costs the buyer exactly 1 share, never zero', async () => {
      const p = await pledged(USDC(100), USDC(106));
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await hf.connect(other).pay(p.id, USDC(100) - 1n);
      await openClaim(p);
      await hf.claim(p.id);
      expect(await vault.balanceOf(seller.address)).to.equal(1n);
    });
    it('huge share price (1e12 assets per share): no overflow, seller gets at least one share', async () => {
      await vault.setPrice(10n ** 18n);
      const need = await hf.sharesNeededFor(USDC(100));
      await vault.mint(buyer.address, need);
      const p = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), need);
      await hf.connect(buyer).pledge(p.id, p.hash, need);
      await openClaim(p);
      await hf.claim(p.id);
      expect(await vault.balanceOf(seller.address)).to.be.gte(1n);
    });
    it('dust sweep: many prices and amounts, contract keeps no shares and seller never gets less than owed', async () => {
      for (const price of [999_000, 1_000_000, 1_000_270, 1_234_567, 7_777_777]) {
        for (const amt of [USDC(1), 1_000_003n, USDC(33.33), USDC(500)]) {
          await vault.setPrice(price);
          const need = await hf.sharesNeededFor(amt);
          await vault.mint(buyer.address, need);
          const sBefore = await vault.balanceOf(seller.address);
          const p = await newReq(amt);
          await vault.connect(buyer).approve(await A(hf), need);
          await hf.connect(buyer).pledge(p.id, p.hash, need);
          await vault.setPrice(price + 100);
          await time.increaseTo(p.dueAt + 3600n);
          await hf.claim(p.id);
          const got = (await vault.balanceOf(seller.address)) - sBefore;
          expect(await vault.convertToAssets(got)).to.be.gte(amt);
        }
      }
      expect(await vault.balanceOf(await A(hf))).to.equal(0n);
    });
    it('a price spike at pledge time that later reverses leaves the seller short (needs a vault that can lose value; documented price risk)', async () => {
      await vault.setPrice(10_000_000);
      const need = await hf.sharesNeededFor(USDC(100));
      await vault.mint(buyer.address, need);
      const p = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), need);
      await hf.connect(buyer).pledge(p.id, p.hash, need);
      await vault.setPrice(1_000_000);
      await openClaim(p);
      await hf.claim(p.id);
      const worth = await vault.convertToAssets(await vault.balanceOf(seller.address));
      expect(worth).to.be.lt(USDC(15));
    });
  });

  // ---------------------------------------------------------------- 4 reentrancy
  describe('4. reentrancy', () => {
    beforeEach(() => setup('AttackUSDC', 'AttackVault'));

    async function reenterer() {
      const R = await (await ethers.getContractFactory('Reenterer')).deploy(await A(hf));
      await R.create(USDC(100), (await time.latest()) + DAY, ethers.ZeroAddress);
      const id = await hf.requestCount();
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await hf.connect(buyer).pledge(id, await hf.termsHashOf(id), USDC(106));
      return { R, id };
    }

    it('seller contract re-entering from the USDC callback inside pay(): every guarded function is refused', async () => {
      const { R, id } = await reenterer();
      await usdc.setHook(await A(R));
      await R.arm(true);
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      await hf.connect(buyer).pay(id, USDC(100));
      expect(await R.calls()).to.equal(1n);
      const ok = await R.results();
      expect(Array.from(ok).slice(0, 7)).to.deep.equal([false, false, false, false, false, false, false]);
      expect(ok[7]).to.equal(true); // createRequest is unguarded and harmless
      expect((await hf.getRequest(id)).state).to.equal(3n);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('seller contract re-entering from the share callback inside claim(): refused, no double payout', async () => {
      const { R, id } = await reenterer();
      await vault.setHook(await A(R));
      await R.arm(true);
      await time.increase(DAY + 3600);
      await R.doClaim();
      const ok = await R.results();
      expect(Array.from(ok).slice(0, 7)).to.deep.equal([false, false, false, false, false, false, false]);
      expect(await vault.balanceOf(await A(hf))).to.equal(0n);
      expect((await hf.getRequest(id)).state).to.equal(4n);
    });
    it('withdrawCredit re-entry cannot double withdraw or touch other people money', async () => {
      const { R, id } = await reenterer();
      await usdc.setBlocked(await A(R), true);
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      await hf.connect(buyer).pay(id, USDC(100));
      expect(await hf.credited(await A(R))).to.equal(USDC(100));
      await usdc.setBlocked(await A(R), false);
      await usdc.setHook(await A(R));
      await usdc.mint(await A(hf), USDC(500));
      await R.arm(true);
      await R.doWithdraw();
      expect(await usdc.balanceOf(await A(R))).to.equal(USDC(100));
      expect(await usdc.balanceOf(await A(hf))).to.equal(USDC(500));
    });
  });

  // ---------------------------------------------------------------- 5 pay path
  describe('5. pay path', () => {
    beforeEach(() => setup('AttackUSDC', 'AttackVault'));

    it('USDC that returns false: pay reverts, nothing recorded', async () => {
      const p = await pledged();
      await usdc.setMode(1);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await expect(hf.connect(other).pay(p.id, USDC(100))).to.be.revertedWithCustomError(hf, 'TransferFailed');
      expect(await hf.owed(p.id)).to.equal(USDC(100));
    });
    it('USDC that returns no data works', async () => {
      const p = await pledged();
      await usdc.setMode(2);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await hf.connect(other).pay(p.id, USDC(100));
      expect((await hf.getRequest(p.id)).state).to.equal(3n);
    });
    it('fee on transfer USDC: pay reverts so a short payment can never count as full', async () => {
      const p = await pledged();
      await usdc.setMode(3);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await expect(hf.connect(other).pay(p.id, USDC(100))).to.be.revertedWithCustomError(hf, 'TransferFailed');
    });
    it('fee on transfer vault shares: pledge reverts', async () => {
      await vault.setFee(true);
      const r = await newReq();
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await expect(hf.connect(buyer).pledge(r.id, r.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'TransferFailed');
    });
    it('blocked seller: payments count, credit recorded once, contract holds exactly the credit, no double credit', async () => {
      const p = await pledged();
      await usdc.setBlocked(seller.address, true);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await hf.connect(other).pay(p.id, USDC(60));
      await hf.connect(other).pay(p.id, USDC(40));
      expect(await hf.credited(seller.address)).to.equal(USDC(100));
      expect(await usdc.balanceOf(await A(hf))).to.equal(USDC(100));
      await expect(hf.withdrawCredit()).to.be.revertedWithCustomError(hf, 'TransferFailed');
      expect(await hf.credited(seller.address)).to.equal(USDC(100));
      await usdc.setBlocked(seller.address, false);
      await hf.withdrawCredit();
      await expect(hf.withdrawCredit()).to.be.revertedWithCustomError(hf, 'NothingCredited');
      expect(await usdc.balanceOf(await A(hf))).to.equal(0n);
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('a third party cannot withdraw someone else credit', async () => {
      const p = await pledged();
      await usdc.setBlocked(seller.address, true);
      await usdc.connect(other).approve(await A(hf), USDC(100));
      await hf.connect(other).pay(p.id, USDC(100));
      await expect(hf.connect(other).withdrawCredit()).to.be.revertedWithCustomError(hf, 'NothingCredited');
    });
    it('gas griefing: a payer cannot force a credit instead of a direct payment by starving gas (sweep)', async () => {
      const p = await pledged(USDC(100), USDC(106));
      await usdc.connect(other).approve(await A(hf), USDC(100));
      let succeeded = 0;
      for (let g = 80_000; g <= 400_000; g += 5_000) {
        let ok = true;
        try { await hf.connect(other).pay(p.id, USDC(1), { gasLimit: g }); } catch (e) { ok = false; }
        if (ok) {
          succeeded++;
          expect(await hf.credited(seller.address), `gas ${g}`).to.equal(0n);
        }
      }
      expect(succeeded).to.be.gt(3);
    });
    it('FIXED: a 1 wei front-run no longer makes the buyer full payment revert; buyer pays only what is left', async () => {
      const p = await pledged();
      await usdc.connect(other).approve(await A(hf), 1);
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      const before = await usdc.balanceOf(buyer.address);
      const sellerBefore = await usdc.balanceOf(seller.address);
      await hf.connect(other).pay(p.id, 1);
      await hf.connect(buyer).pay(p.id, USDC(100));
      expect(before - (await usdc.balanceOf(buyer.address))).to.equal(USDC(100) - 1n);
      expect((await usdc.balanceOf(seller.address)) - sellerBefore).to.equal(USDC(100));
      expect((await hf.getRequest(p.id)).state).to.equal(3n);
    });
    it('paying after the date but before the claim still frees the pledge; claim after is refused', async () => {
      const p = await pledged();
      await openClaim(p);
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      await hf.connect(buyer).pay(p.id, USDC(100));
      await expect(hf.claim(p.id)).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('claim then pay: pay is refused, no USDC lost', async () => {
      const p = await pledged();
      await openClaim(p);
      await hf.claim(p.id);
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      const b = await usdc.balanceOf(buyer.address);
      await expect(hf.connect(buyer).pay(p.id, USDC(100))).to.be.revertedWithCustomError(hf, 'BadState');
      expect(await usdc.balanceOf(buyer.address)).to.equal(b);
    });
    it('pay with zero reverts, and more than owed is cut down to what is owed', async () => {
      const p = await pledged();
      await usdc.connect(buyer).approve(await A(hf), USDC(200));
      await expect(hf.connect(buyer).pay(p.id, 0)).to.be.revertedWithCustomError(hf, 'BadAmount');
      const before = await usdc.balanceOf(buyer.address);
      await hf.connect(buyer).pay(p.id, USDC(150));
      expect(before - (await usdc.balanceOf(buyer.address))).to.equal(USDC(100));
    });
  });

  // ---------------------------------------------------------------- 6 state machine
  describe('6. state machine and terms', () => {
    beforeEach(() => setup());

    it('every function by every actor on every finished or empty state: nothing succeeds, no balance moves', async () => {
      const ids = {};
      ids.NONE = 9999n;
      const open = await newReq(); ids.OPEN = open.id;
      const cancelled = await newReq(); ids.CANCELLED = cancelled.id; await hf.cancel(cancelled.id);
      const paid = await pledged(); ids.PAID = paid.id;
      const claimed = await pledged(); ids.CLAIMED = claimed.id;
      const released = await pledged(); ids.RELEASED = released.id;
      const reclaimed = await pledged(); ids.RECLAIMED = reclaimed.id;
      await usdc.connect(buyer).approve(await A(hf), USDC(100));
      await hf.connect(buyer).pay(paid.id, USDC(100));
      await hf.release(released.id);
      await time.increaseTo(claimed.dueAt + 3600n);
      await hf.claim(claimed.id);
      await time.increaseTo(reclaimed.dueAt + 3600n + 30n * BigInt(DAY));
      await hf.connect(buyer).reclaim(reclaimed.id);
      await time.increase(5 * DAY);
      await vault.connect(buyer).approve(await A(hf), USDC(1000));
      await usdc.connect(buyer).approve(await A(hf), USDC(1000));
      await usdc.connect(other).approve(await A(hf), USDC(1000));
      const snap = async () => [
        await vault.balanceOf(seller.address), await vault.balanceOf(buyer.address), await vault.balanceOf(other.address),
        await vault.balanceOf(await A(hf)), await usdc.balanceOf(await A(hf)), await usdc.balanceOf(seller.address), await usdc.balanceOf(buyer.address),
      ];
      const before = await snap();
      let attempts = 0;
      for (const [name, id] of Object.entries(ids)) {
        const hash = name === 'NONE' ? ethers.ZeroHash : await hf.termsHashOf(id);
        for (const who of [seller, buyer, other]) {
          const c = hf.connect(who);
          const calls = [
            () => c.pledge(id, hash, USDC(106)),
            () => c.pay(id, USDC(1)),
            () => c.claim(id),
            () => c.release(id),
            () => c.reclaim(id),
          ];
          if (name !== 'OPEN') calls.push(() => c.cancel(id));
          for (const call of calls) {
            attempts++;
            let succeeded = true;
            try { await call(); } catch (e) { succeeded = false; }
            expect(succeeded, `${name} by ${who.address}`).to.equal(false);
          }
        }
      }
      expect(attempts).to.be.gt(100);
      expect(await snap()).to.deep.equal(before);
    });
    it('PLEDGED: wrong actors are refused', async () => {
      const p = await pledged();
      await time.increase(40 * DAY);
      await expect(hf.connect(other).claim(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await expect(hf.connect(buyer).claim(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await expect(hf.connect(other).release(p.id)).to.be.revertedWithCustomError(hf, 'NotSeller');
      await expect(hf.connect(seller).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'NotBuyer');
      await expect(hf.connect(other).reclaim(p.id)).to.be.revertedWithCustomError(hf, 'NotBuyer');
      await expect(hf.connect(buyer).pledge(p.id, p.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('double pledge on one id is refused', async () => {
      const p = await pledged();
      await vault.connect(mallory).approve(await A(hf), USDC(200));
      await expect(hf.connect(mallory).pledge(p.id, p.hash, USDC(200))).to.be.revertedWithCustomError(hf, 'BadState');
    });
    it('terms hash differs per id even for identical terms, and a wrong hash is refused', async () => {
      const a = await newReq(USDC(100));
      const b = await newReq(USDC(100), { dueAt: Number(a.dueAt) });
      expect(a.hash).to.not.equal(b.hash);
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await expect(hf.connect(buyer).pledge(a.id, b.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'WrongTerms');
    });
    it('cancel then recreate with worse terms: old pledge fails, new id refuses old hash', async () => {
      const a = await newReq(USDC(100));
      await hf.cancel(a.id);
      const b = await newReq(USDC(500));
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await expect(hf.connect(buyer).pledge(a.id, a.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
      await expect(hf.connect(buyer).pledge(b.id, a.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'WrongTerms');
    });
    it('seller cancel front-run only makes the pledge revert; no shares leave the buyer', async () => {
      const a = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await hf.cancel(a.id);
      await expect(hf.connect(buyer).pledge(a.id, a.hash, USDC(106))).to.be.reverted;
      expect(await vault.balanceOf(buyer.address)).to.equal(USDC(1000));
    });
    it('seller == buyer is refused at create and at pledge', async () => {
      await expect(hf.createRequest(USDC(10), (await time.latest()) + DAY, seller.address)).to.be.revertedWithCustomError(hf, 'BadAddress');
      const a = await newReq(USDC(100));
      await vault.mint(seller.address, USDC(200));
      await vault.approve(await A(hf), USDC(200));
      await expect(hf.pledge(a.id, a.hash, USDC(200))).to.be.revertedWithCustomError(hf, 'BadAddress');
    });
    it('LOW: on an open request anyone can pledge first (named buyer prevents it)', async () => {
      const a = await newReq(USDC(100));
      await vault.connect(mallory).approve(await A(hf), USDC(106));
      await hf.connect(mallory).pledge(a.id, a.hash, USDC(106));
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await expect(hf.connect(buyer).pledge(a.id, a.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'BadState');
      const n = await newReq(USDC(100), { buyer: buyer.address });
      await vault.connect(mallory).approve(await A(hf), USDC(106));
      await expect(hf.connect(mallory).pledge(n.id, n.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'NotBuyer');
    });
    it('pledge at the due second is TooLate', async () => {
      const a = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await time.setNextBlockTimestamp(a.dueAt);
      await expect(hf.connect(buyer).pledge(a.id, a.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'TooLate');
    });
    it('pledge exactly at the 105 percent edge works, one share fewer fails', async () => {
      const need = await hf.sharesNeededFor(USDC(100));
      const a = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), need);
      await expect(hf.connect(buyer).pledge(a.id, a.hash, need - 1n)).to.be.revertedWithCustomError(hf, 'NotCovered');
      await hf.connect(buyer).pledge(a.id, a.hash, need);
    });
    it('vault that cannot cash out now: pledge refused (NotCashable)', async () => {
      await vault.setCapRedeem(true);
      const a = await newReq(USDC(100));
      await vault.connect(buyer).approve(await A(hf), USDC(106));
      await expect(hf.connect(buyer).pledge(a.id, a.hash, USDC(106))).to.be.revertedWithCustomError(hf, 'NotCashable');
    });
    it('FINDING (low): shares or USDC sent straight to the contract are stuck forever', async () => {
      await vault.mint(await A(hf), USDC(5));
      await usdc.mint(await A(hf), USDC(5));
      const p = await pledged();
      await openClaim(p);
      await hf.claim(p.id);
      expect(await vault.balanceOf(await A(hf))).to.equal(USDC(5));
      expect(await usdc.balanceOf(await A(hf))).to.equal(USDC(5));
    });
  });

  // ---------------------------------------------------------------- 8 arc
  describe('8. deploy check', () => {
    it('UNPROVEN on Arc: constructor refuses an address with no bytecode; if the native USDC ERC-20 address has none on Arc, deploy reverts', async () => {
      await setup();
      const F = await ethers.getContractFactory('Holdfast');
      await expect(F.deploy('0x3600000000000000000000000000000000000000', await A(vault))).to.be.revertedWithCustomError(F, 'BadAddress');
    });
  });
});
