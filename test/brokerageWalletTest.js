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

      const tokenUserBalance = await this.brokerageWalletContract.ledger(
        this.erc20TokenAddress,
        this.investor
      );

      assert.equal(tokenUserBalance.toNumber(), this.depositAmount);
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
