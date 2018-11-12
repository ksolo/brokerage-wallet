const BrokerageWalletContract = artifacts.require("BrokerageWallet");

module.exports = function(deployer) {
  deployer.deploy(BrokerageWalletContract);
}
