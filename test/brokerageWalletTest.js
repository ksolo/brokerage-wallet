const truffleAssert = require('truffle-assertions');
const BrokerageWalletContract = artifacts.require("BrokerageWallet");
const ERC20Mock = artifacts.require('ERC20Mock');

contract("BrokerageWallet", (accounts) => {
  beforeEach(async function() {
    this.owner = accounts[0];
    this.investor = accounts[1];

    this.brokerageWalletContract = await BrokerageWalletContract.deployed();
    this.erc20Token = await ERC20Mock.new(this.owner, 1000);
    this.erc20TokenAddress = this.erc20Token.address;

    this.erc20Token.transfer(this.investor, 1000);
  });

  describe("deposit(address _token, uint256 _amount)", ()=>{
    beforeEach(async function() {
      this.depositAmount = 100;

      // Set up token allowance for brokerage contract
     await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
    });

    it("credit the investors balance for the token", async function () {
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

      const investorLedger = await this.brokerageWalletContract.ledger(
        this.erc20TokenAddress,
        this.investor
      );

      assert.equal(investorLedger[0].toNumber(), this.depositAmount);
    });

    it("transfers tokens from the investor to the brokerage wallet", async function() {
      const initialInvestorERC20Balance  = await this.erc20Token.balanceOf(this.investor);
      const initialWalletERC20Balance  = await this.erc20Token.balanceOf(this.brokerageWalletContract.address);

      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

      const investorERC20Balance  = await this.erc20Token.balanceOf(this.investor);
      const walletERC20Balance  = await this.erc20Token.balanceOf(this.brokerageWalletContract.address);

      assert.equal(initialInvestorERC20Balance - investorERC20Balance, this.depositAmount);
      assert.equal(walletERC20Balance - initialWalletERC20Balance, this.depositAmount);
    });

    it("emits a LogDeposit event", async function () {
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor }).then(async (result) => {
        truffleAssert.eventEmitted(result, 'LogDeposit', (ev) => {
          return ev._token === this.erc20TokenAddress && ev._investor === this.investor && ev._amount.toNumber() === this.depositAmount;
        });
      });
    });

    context("transfer is unsuccessful", async function() {
      beforeEach(async function() {
        // This should fail because there is only 100 tokens allowed to be transferred
        this.depositAmount = 150;
      });

      it("reverts and resets the internal balance", async function () {
        const initialInvestorERC20Balance  = await this.erc20Token.balanceOf(this.investor);
        const initialWalletERC20Balance  = await this.erc20Token.balanceOf(this.brokerageWalletContract.address);

        await truffleAssert.fails(
          this.brokerageWalletContract.deposit.call(this.erc20TokenAddress, this.depositAmount, { from: this.investor })
        );

        const investorERC20Balance  = await this.erc20Token.balanceOf(this.investor);
        const walletERC20Balance  = await this.erc20Token.balanceOf(this.brokerageWalletContract.address);

        assert.equal(initialInvestorERC20Balance.toNumber(), investorERC20Balance.toNumber());
        assert.equal(walletERC20Balance.toNumber(), initialWalletERC20Balance.toNumber());
      });
    });

  });

  describe("offerTokens(address _token, uint256 _amount)", () => {
    context("succesfully offers tokens", async function() {
      beforeEach(async function() {
        this.depositAmount = 100;

        await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
        await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      });

      afterEach(async function() {
        await this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

        // Cleanup the token offer
        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
      });

      it("adds the amount of tokens to a user's offeredTokens ledger", async function() {
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(investorLedger[1].toNumber(), this.depositAmount);
      });

      it("emits an even logging the offer details", async function() {
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor }).then(async (result) => {
          truffleAssert.eventEmitted(result, 'LogTokensOffered', (ev) => {
            return ev._token === this.erc20TokenAddress && ev._investor === this.investor && ev._amount.toNumber() === this.depositAmount;
          });
        });
      });
    });
  });

  describe("cancelOffer(address _token, uint256 _amount)", () => {
    beforeEach(async function() {
      this.depositAmount = 100;

      await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
    });

    context("succesfully cancels token offer", async function() {
      it("removes the amount of tokens from a user's offeredTokens ledger", async function() {
        const initialInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[1], this.depositAmount);

        await this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(investorLedger[1].toNumber(), 0);
      });

      it("emits an even logging the cancelation", async function() {
        await this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor }).then(async (result) => {
          truffleAssert.eventEmitted(result, 'LogTokenOfferCanceled', (ev) => {
            return ev._token === this.erc20TokenAddress && ev._investor === this.investor && ev._amount.toNumber() === this.depositAmount;
          });
        });
      });
    });
  });

  describe("clearTokens(address _token, address _src, address _dst, uint256 _amount)", () => {
    beforeEach(async function() {
      this.depositAmount = 100;
      this.transferAmount = this.depositAmount;
      this.investor2 = accounts[2];

      await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
    });

    context("succesfully clears token offer", async function() {
      it("debits the seller and credits the buyer", async function() {
        const initialSrcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const initialDstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1], this.transferAmount);
        assert.equal(initialDstInvestorLedger[0], 0);

        await this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.owner });

        const srcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const dstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1] - srcInvestorLedger[1], this.transferAmount);
        assert.equal(dstInvestorLedger[0] - initialDstInvestorLedger[0], this.transferAmount);
      });

      it("emits an even logging the clearing", async function() {
        await this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.owner }).then(async (result) => {
          truffleAssert.eventEmitted(result, 'LogTokenOfferCleared', (ev) => {
            return ev._token === this.erc20TokenAddress && ev._src === this.investor && ev._dst === this.investor2 && ev._amount.toNumber() === this.depositAmount;
          });
        });
      });
    });
  });

  describe("transferOwnership(address newOwner)", () => {
    afterEach(async function() {
      const currentOwner = await this.brokerageWalletContract.owner();

      if (currentOwner == accounts[1]) {
        await this.brokerageWalletContract.transferOwnership(accounts[0], { from: accounts[1] });
      }
    });

    it("updates the owner address", async function () {
      const currentOwner = await this.brokerageWalletContract.owner();
      await this.brokerageWalletContract.transferOwnership(accounts[1]);
      const newOwner =  await this.brokerageWalletContract.owner();

      assert.notEqual(currentOwner, newOwner);
    });

    it("emits an event", async function () {
      const currentOwner = await this.brokerageWalletContract.owner();
      await this.brokerageWalletContract.transferOwnership(accounts[1]).then(async (result) => {
        truffleAssert.eventEmitted(result, 'OwnershipTransferred', (ev) => {
          return ev.previousOwner === accounts[0] && ev.newOwner === accounts[1];
        });
      });
    });

    context("when called by non-owner", async function () {
      it("raises an exception and does not update the address", async function () {
        await truffleAssert.fails(
          this.brokerageWalletContract.transferOwnership.call(accounts[1], { from: accounts[1] })
        );
      });
    });
  })
});
