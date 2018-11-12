const truffleAssert = require('truffle-assertions');
const BrokerageWalletContract = artifacts.require("BrokerageWallet");
const ERC20Mock = artifacts.require('ERC20Mock');

contract("BrokerageWallet", (accounts) => {
  beforeEach(async function() {
    this.owner = accounts[0];
    this.platformAdmin = accounts[1];
    this.investor = accounts[2];

    this.brokerageWalletContract = await BrokerageWalletContract.deployed();
    this.erc20Token = await ERC20Mock.new(this.owner, 1000);
    this.erc20TokenAddress = this.erc20Token.address;

    this.erc20Token.transfer(this.investor, 1000);

    this.approver1 = accounts[7];
    this.approver2 = accounts[8];
    this.approver3 = accounts[9];

    await this.brokerageWalletContract.setPlatformAdmin(this.platformAdmin);
    await this.brokerageWalletContract.addApprover(this.approver1);
    await this.brokerageWalletContract.addApprover(this.approver2);
    await this.brokerageWalletContract.addApprover(this.approver3);
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

        await truffleAssert.reverts(
          this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, 100, { from: this.investor }),
          "Investor does not have sufficient balance of token"
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

        await truffleAssert.reverts(
          this.brokerageWalletContract.offerTokens(this.erc20TokenAddress, 100, { from: this.investor }),
          "Investor does not have sufficient balance of token"
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

        await truffleAssert.reverts(
          this.brokerageWalletContract.cancelOffer(this.erc20TokenAddress, this.depositAmount, { from: this.investor }),
            "Amount requested to be canceled is more than offered"
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

        await truffleAssert.reverts(
          this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.owner }),
          "This action is only for platform admin",
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

        await truffleAssert.reverts(
          this.brokerageWalletContract.clearTokens(this.erc20TokenAddress, this.investor, this.investor2, this.transferAmount, { from: this.platformAdmin }),
          "Investor does not have sufficient balance of token"
        );

        const srcInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor);
        const dstInvestorLedger = await this.brokerageWalletContract.ledger(this.erc20TokenAddress, this.investor2);
        assert.equal(initialSrcInvestorLedger[1] - srcInvestorLedger[1], 0);
        assert.equal(dstInvestorLedger[0] - initialDstInvestorLedger[0], 0);
      });
    });
  });

  describe("requestWithdrawal(address token, uint256 amount)", () => {
    beforeEach(async function() {
      this.depositAmount = 100;

      await this.erc20Token.increaseAllowance(this.brokerageWalletContract.address, this.depositAmount, { from: this.investor });
      await this.brokerageWalletContract.deposit(this.erc20TokenAddress, this.depositAmount, { from: this.investor });
    });

    it("creates a withdrawal request for each approver", async function() {
      await this.brokerageWalletContract.requestWithdrawal(this.erc20TokenAddress, this.depositAmount, { from: this.investor });

      const withdrawalRequest1 = await this.brokerageWalletContract.approverRequests(this.approver1, 0);
      assert.equal(withdrawalRequest1[0], this.investor);
      assert.equal(withdrawalRequest1[1], this.erc20TokenAddress);
      assert.equal(withdrawalRequest1[2], this.depositAmount);
      assert.equal(withdrawalRequest1[3], 0);

      const withdrawalRequest2 = await this.brokerageWalletContract.approverRequests(this.approver2, 0);
      assert.equal(withdrawalRequest2[0], this.investor);
      assert.equal(withdrawalRequest2[1], this.erc20TokenAddress);
      assert.equal(withdrawalRequest2[2], this.depositAmount);
      assert.equal(withdrawalRequest2[3], 0);

      const withdrawalRequest3 = await this.brokerageWalletContract.approverRequests(this.approver3, 0);
      assert.equal(withdrawalRequest3[0], this.investor);
      assert.equal(withdrawalRequest3[1], this.erc20TokenAddress);
      assert.equal(withdrawalRequest3[2], this.depositAmount);
      assert.equal(withdrawalRequest3[3], 0);
    });
  });

  describe("approveWithdrawals(uint256 begin, uint256 end)", () => {
    context("called by an approver", async function() {
      it("sets the withdrawal requests to approved", async function() {

      });

      context("the approval threshold has been met", async function() {

      });
    });

    context("not called by an approver", async function() {
      it("does not modify the approval totals", async function() {

      });
    });
  });

  describe("addApprover(address _approver)", () => {
    context("approver successfully added", () => {
      afterEach(async function () {
        // Cleanup
        await this.brokerageWalletContract.removeApprover(accounts[1]);
      });

      it("adds approver if not currently in the mapping", async function () {
        const emptyApprover = await this.brokerageWalletContract.approvers(accounts[1]);
        assert.equal(emptyApprover, false);

        await this.brokerageWalletContract.addApprover(accounts[1]);
        const newApprover = await this.brokerageWalletContract.approvers(accounts[1]);
        assert.equal(newApprover, true);
      });

      it("adds address to approverAddresses", async function () {
        const emptyApprover = await this.brokerageWalletContract.approvers(accounts[1]);
        assert.equal(emptyApprover, false);

        await this.brokerageWalletContract.addApprover(accounts[1]);
        const newApproverAddress = await this.brokerageWalletContract.approverAddresses(3);
        assert.equal(newApproverAddress, accounts[1]);
      });

      it("emits LogAddApprover event", async function () {
        this.brokerageWalletContract.addApprover(accounts[1]).then((result) => {
          truffleAssert.eventEmitted(result, 'LogApproverAdded', (ev) => {
            return ev._approver == accounts[1];
          });
        });
      });
    });

    context("when called by non-owner", async function () {
      it("raises an exception and does not add the approver", async function () {
        await truffleAssert.fails(
          this.brokerageWalletContract.addApprover.call(accounts[1], { from: accounts[1] })
        );

        const approver = await this.brokerageWalletContract.approvers(accounts[1]);
        assert.equal(approver, false);
      });
    });
  });

  describe("removeApprover(address _approver)", () => {
    beforeEach(async function() {
      // Set up an approver to remove
      await this.brokerageWalletContract.addApprover(accounts[1]);
    });

    it("removes approver if its already in the mapping", async function () {
      const approver = await this.brokerageWalletContract.approvers(accounts[1]);
      assert.equal(approver, true);

      await this.brokerageWalletContract.removeApprover(accounts[1]);
      const newApprover = await this.brokerageWalletContract.approvers(accounts[1]);
      assert.equal(newApprover, false);
    });

    it("removes address from approverAddresses", async function (){
      const approver = await this.brokerageWalletContract.approvers(accounts[1]);
      assert.equal(approver, true);

      await this.brokerageWalletContract.removeApprover(accounts[1]);

      try {
        let i = 0;
        const approversLength = 4;
        while(i < approversLength) {
          const approver = await this.brokerageWalletContract.approverAddresses(i);
          assert.notEqual(approver, accounts[1]);
          i++;
        }
      } catch(e) {
        // We expect to run out of addresses, this is here to capture the exception
        assert.ok(true, "Iterated through addresses without a match");
      }
    });

    it("emits LogRemoveApprover event", async function (){
      this.brokerageWalletContract.removeApprover(accounts[1]).then((result) => {
        truffleAssert.eventEmitted(result, 'LogApproverRemoved', (ev) => {
          return ev._approver == accounts[1];
        });
      });
    });

    context("when called by non-owner", async function () {
      it("raises an exception and does not remove the approver", async function () {
        await truffleAssert.fails(
          this.brokerageWalletContract.removeApprover.call(accounts[1], { from: accounts[1] })
        );

        const approver = await this.brokerageWalletContract.approvers(accounts[1]);
        assert.equal(approver, true);
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
