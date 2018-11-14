const truffleAssert = require('truffle-assertions');
const BrokerageWalletContract = artifacts.require("BrokerageWallet");
const ERC20Mock = artifacts.require('ERC20Mock');

contract("BrokerageWallet", (accounts) => {
  beforeEach(async function() {
    this.owner = accounts[0];
    this.platformAdmin = accounts[1];
    this.investor = accounts[2];
    this.approver = accounts[3]

    this.brokerageWalletContract = await BrokerageWalletContract.deployed();
    this.erc20Token = await ERC20Mock.new(this.owner, 1000);
    this.erc20TokenAddress = this.erc20Token.address;

    this.erc20Token.transfer(this.investor, 1000);

    await this.brokerageWalletContract.setPlatformAdmin(this.platformAdmin);
    await this.brokerageWalletContract.setApprover(this.approver);
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
        // Cleanup the token offer
        await this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
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

    context("the investor does not have a sufficient balance", async function() {
      it("reverts and does not change offered balance", async function() {
        const initialInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[0].toNumber(), 0);
        assert.equal(initialInvestorLedger[1].toNumber(), 0);

        await truffleAssert.fails(
          this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, 100, { from: this.investor }),
        );

        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[1] - investorLedger[1], 0);
      });
    });

    context("the investor is already offering too many tokens", async function() {
      beforeEach(async function() {
        this.depositAmount = 100;
        this.offeredAmount = this.depositAmount;

        await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
        await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.offeredAmount, { from: this.investor });
      });

      it("reverts and does not change offered balance", async function() {
        const initialInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[0].toNumber(), this.depositAmount);
        assert.equal(initialInvestorLedger[1].toNumber(), this.offeredAmount);

        await truffleAssert.fails(
          this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, 100, { from: this.investor }),
        );

        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[1] - investorLedger[1], 0);
      });
    });
  });

  describe("cancelOffer(address _token, uint256 _amount)", () => {
    beforeEach(async function() {
      this.depositAmount = 100;

      await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
    });

    context("succesfully cancels token offer", async function() {
      beforeEach(async function() {
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      });

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

    context("the amount being canceled is greater than the amount offered by the investor", async function() {
      it("reverts and does not change offered balance", async function() {
        const initialInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[1].toNumber(), 0);

        await truffleAssert.fails(
          this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor }),
        );

        const investorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        assert.equal(initialInvestorLedger[1] - investorLedger[1], 0);
      });
    });
  });

  describe("clearTokens(address _token, address _src, address _dst, uint256 _amount)", () => {
    beforeEach(async function() {
      this.depositAmount = 100;
      this.transferAmount = this.depositAmount;
      this.investor2 = accounts[3];

      await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
    });

    context("succesfully clears token offer", async function() {
      beforeEach(async function() {
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      });

      it("debits the seller and credits the buyer", async function() {
        const initialSrcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const initialDstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1], this.transferAmount);
        assert.equal(initialDstInvestorLedger[0], 0);

        await this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.platformAdmin });

        const srcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const dstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1] - srcInvestorLedger[1], this.transferAmount);
        assert.equal(dstInvestorLedger[0] - initialDstInvestorLedger[0], this.transferAmount);
      });

      it("emits an even logging the clearing", async function() {
        await this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.platformAdmin }).then(async (result) => {
          truffleAssert.eventEmitted(result, 'LogTokenOfferCleared', (ev) => {
            return ev._token === this.erc20TokenAddress && ev._src === this.investor && ev._dst === this.investor2 && ev._amount.toNumber() === this.depositAmount;
          });
        });
      });
    });

    context("called from non-platform-admin", async function() {
      beforeEach(async function() {
        await this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
      });

      it("reverts and does not change token balances", async function() {
        const initialSrcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const initialDstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1], this.transferAmount);
        assert.equal(initialDstInvestorLedger[0], 0);

        await truffleAssert.fails(
          this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.owner }),
        );

        const srcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const dstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1] - srcInvestorLedger[1], 0);
        assert.equal(dstInvestorLedger[0] - initialDstInvestorLedger[0], 0);
      });
    });

    context("the amount being cleared is more than the src investor is offering", async function() {
      it("reverts and does not change token balances", async function() {
        const initialSrcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const initialDstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1], 0);
        assert.equal(initialDstInvestorLedger[0], 0);

        await truffleAssert.fails(
          this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.platformAdmin }),
        );

        const srcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const dstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1] - srcInvestorLedger[1], 0);
        assert.equal(dstInvestorLedger[0] - initialDstInvestorLedger[0], 0);
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

  describe("withdraw(address _token, uint256 _amount)", function() {});
  
  describe("setApprover(address _approver)", function() {
    context("owner", function(){
      beforeEach(async function(){
        this.newApproverAddress = accounts[9];
        this.transaction = await this.brokerageWalletContract.setApprover(this.newApproverAddress);
      });
      this.afterEach(async function() {
        this.brokerageWalletContract.setApprover(this.approver);
      });

      it("updates the address of the approver", async function() {
        assert.equal(
          await this.brokerageWalletContract.approver(), 
          this.newApproverAddress,
          "approver address was updated"
        );
      });
      it("emits LogApproverChanged event", async function() {
        truffleAssert.eventEmitted(this.transaction, "LogApproverChanged", (event) => {
          return event._from === this.approver && event._to === this.newApproverAddress;
        });
      });
    });
    context("non-owner", function(){
      it("does not change the approver address", async function() {
        truffleAssert.fails(
          this.brokerageWalletContract.setApprover(accounts[9], { from: accounts[9] })
        );
        assert.equal(
          await this.brokerageWalletContract.approver(),
          this.approver,
          "approver was not changed"
        );
      });
    });
  });

  describe("denyWithdrawalRequest(uint256 _index)", function() {});

  describe("approveBatch()", function() {});
});
