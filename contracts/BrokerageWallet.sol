 pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
/**
 * Sometimes it is useful for a contract to own tokens on behalf of users.
 */
contract BrokerageWallet is Ownable {
    using SafeMath for uint;

    enum WithdrawalStatus { Approved, Denied }

    struct WithdrawalRequest {
        address investor;
        address token;
        uint256 amount;
        WithdrawalStatus status;
    }

    /** Queue of requests to process */
    WithdrawalRequest[] public withdrawalRequests;

    event LogWithdrawalRequestCreated(
        address indexed _investor,
        address indexed _token
    );

    /** Tracking what part of the queue is ready for processing */
    uint256 queueBegin = 0;
    uint256 queueEnd = 0;
    uint256 constant batchLimit = 10;

    /** Platform administrator */
    address public platformAdmin;

    /** balance registry */
    /** tokenAddress => investorAddress => ledger */
    struct InvestorLedger {
        uint256 balance;
        uint256 offeredBalance;
        uint256 availableWithdrawBalance;
    }
    mapping(address => mapping(address => InvestorLedger)) public ledger;

    /** Approver has ability to approve withdraw requests */
    address public approver;
    event LogApproverChanged(address _from, address _to);

    /** logging deposit or their failure */
    event LogDeposit(address indexed _token, address indexed _investor, uint _amount);

    /** trading logging */
    event LogTokensOffered(address indexed _token, address indexed _investor, uint _amount);
    event LogTokenOfferCanceled(address indexed _token, address indexed _investor, uint _amount);
    event LogTokenOfferCleared(address indexed _token, address indexed _src, address indexed _dst, uint _amount);

    /** platform admin logging */
    event LogPlatformAdminChanged(address indexed _previousPlatformAdmin, address indexed _newPlatformAdmin);

    // ~~~~~~~~~~~~~~ //
    // Access control //
    // ~~~~~~~~~~~~~~ //

    modifier onlyApprover {
        require(msg.sender == approver, "This action is only for approvers");
        _;
    }

    modifier onlyPlatformAdmin {
        require(platformAdmin == msg.sender, "This action is only for platform admin");
        _;
    }

    // ~~~~~~~~~~~~ //
    // End user API //
    // ~~~~~~~~~~~~ //

    /**
    * @dev Deposits a certain amount of ERC20 token into the brokerage wallet
    *
    * @param _token the ERC20 token address
    * @param _amount the amount of ERC20 to deposit
    */
    function deposit(address _token, uint256 _amount) public {
        InvestorLedger storage investorLedger = ledger[_token][msg.sender];
        investorLedger.balance = investorLedger.balance.add(_amount);

        emit LogDeposit(_token, msg.sender, _amount);

        ERC20(_token).transferFrom(msg.sender, address(this), _amount);
    }

    function withdraw(address _token, uint256 _amount) public {
        require(
            ledger[_token][msg.sender].availableWithdrawBalance >= _amount,
            "Insufficient funds"
        );

        ERC20(_token).transfer(msg.sender, _amount);
    }

    /**
    * @dev Offers tokens to be traded by an investor
    *
    * @param _token the ERC20 token address
    * @param _amount the desired amount of ERC20 to offer for trade
    */
    function offerTokens(address _token, uint256 _amount) public {
        InvestorLedger storage investorLedger = ledger[_token][msg.sender];
        require(
            investorLedger.balance.sub(investorLedger.offeredBalance) >= _amount,
            "Investor does not have sufficient balance of token"
        );

        investorLedger.offeredBalance = investorLedger.offeredBalance.add(_amount);
        emit LogTokensOffered(_token, msg.sender, _amount);
    }

    /**
    * @dev Cancels an amount of tokens offered for trade by an investor
    *
    * @param _token the ERC20 token address
    * @param _amount the desired amount of ERC20 to cancel offering
    */
    function cancelOffer(address _token, uint256 _amount) public {
        InvestorLedger storage investorLedger = ledger[_token][msg.sender];
        require(
            investorLedger.offeredBalance >= _amount,
            "Amount requested to be canceled is more than offered"
        );

        investorLedger.offeredBalance = investorLedger.offeredBalance.sub(_amount);
        emit LogTokenOfferCanceled(_token, msg.sender, _amount);
    }

    /**
    * @dev Clears a trade by the platform for two investors
    *
    * @param _token the ERC20 token address
    * @param _src the seller's address
    * @param _dst the buyer's address
    * @param _amount the desired amount of ERC20 to cancel offering
    */
    function clearTokens(address _token, address _src, address _dst, uint256 _amount) public onlyPlatformAdmin {
        InvestorLedger storage srcInvestorLedger = ledger[_token][_src];
        InvestorLedger storage dstInvestorLedger = ledger[_token][_dst];

        require(
            srcInvestorLedger.offeredBalance >= _amount,
            "Investor does not have sufficient balance of token"
        );

        srcInvestorLedger.offeredBalance = srcInvestorLedger.offeredBalance.sub(_amount);
        dstInvestorLedger.balance = dstInvestorLedger.balance.add(_amount);

        emit LogTokenOfferCleared(_token, _src, _dst, _amount);
    }

    /**
    * @dev Requests a withdrawal of a certain amount of an ERC20 token for a particular investor
    *
    * @param _token the ERC20 token address
    * @param _amount the desired amount of ERC20 to withdraw
    */
    function requestWithdrawal(address _token, uint256 _amount) public {
        WithdrawalRequest memory request = WithdrawalRequest({
            investor: msg.sender,
            token: _token,
            amount: _amount,
            status: WithdrawalStatus.Approved
        });
        withdrawalRequests.push(request);

        emit LogWithdrawalRequestCreated(msg.sender, _token);

        // The processing queue was empty, adding a new request will make a
        // queue of 1 item
        if (queueBegin == queueEnd) queueEnd++;
    }

    // ~~~~~~~~~~~~~~ //
    // Administration //
    // ~~~~~~~~~~~~~~ //

    /**
    * @dev mark a withdraw request as denied
    */
    function denyWithrawalRequest(uint256 _index) public onlyApprover {
        require(
            _index >= queueBegin && _index <= queueEnd,
            "Withdrawal must be in range of current buffer"
        );

        WithdrawalRequest storage request = withdrawalRequests[_index];
        request.status = WithdrawalStatus.Denied;
    }

    /**
    * @dev approveBatch advances the queue to the next range of items
    * all requests are considered approved unless they have been explicitly
    * denied using the `denyWithdrawalRequest` function
    */
    function approveBatch() public onlyApprover {
        processCurrentBatch(queueBegin, queueEnd);
        // Advance queue begin to start of next range
        queueBegin = queueEnd;
        // Advance queue end
        uint256 length = withdrawalRequests.length;
        if (queueEnd + batchLimit <= length) {
            queueEnd += batchLimit;
        } else {
            // End would exceed the length of the withdrawalRequests array
            queueEnd = length;
        }
    }

    /**
    * @dev For approved requests, moves tokens from the ledger balance to
    * a funds available balance for faster withdraw
    *
    * @param _begin where to begin processing queue
    * @param _end where to stop processing (exclusive)
    */
    function processCurrentBatch(uint256 _begin, uint256 _end) private onlyApprover {
        for (uint256 i = _begin; i < _end; i++) {
            WithdrawalRequest storage request = withdrawalRequests[i];
            if (request.status == WithdrawalStatus.Denied) continue;

            // easier references
            address token = request.token;
            address investor = request.investor;
            uint256 amount = request.amount;

            // TODO: discuss what if this fails? (insufficient funds?) 
            // currently it would kill the whole batch

            // remove funds from ledger balance
            uint256 ledgerCurrentBalance = ledger[token][investor].balance;
            ledger[token][investor].balance = ledgerCurrentBalance.sub(amount);
            // add funds to available balance
            uint256 availableFunds = ledger[token][investor].availableWithdrawBalance;
            ledger[token][investor].availableWithdrawBalance = availableFunds.add(amount);
        }
    }

    /**
    * @dev set the approver
    *
    * @param _approver the approvers address
    */
    function setApprover(address _approver) public onlyOwner {
        emit LogApproverChanged(approver, _approver);
        approver = _approver;
    }

    /**
    * @dev set the platform admin
    *
    * @param _platformAdmin the platform admin's address
    */
    function setPlatformAdmin(address _platformAdmin) public onlyOwner {
        emit LogPlatformAdminChanged(platformAdmin, _platformAdmin);
        platformAdmin = _platformAdmin;
    }
}

// Questions 
// ----
// 
// There are two obvious approval models: (1) each approver can approve any
// withdrawal request, or (2) each approver can only approve withdrawal
// requests for its own particular subset of tokens.  Which of these (or both)
// should we implement?

// Payment channels
// ----
// 
// A future version of this contract should support payment channels, in a hub
// and spoke topology.
