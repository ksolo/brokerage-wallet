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

    /** Contract administrator */
    address public admin;

    /** balance registry */
    /** tokenAddress => investorAddress => balance */
    mapping(address => mapping(address => uint256)) public ledger;

    /** Approver has ability to approve withdraw requests */
    address public approver;
    event LogApproverChanged(address _from, address _to);

    /** logging deposit or their failure */
    event LogDeposit(address indexed _token, address indexed _investor, uint _amount);

    // ~~~~~~~~~~~~~~ //
    // Access control //
    // ~~~~~~~~~~~~~~ //

    modifier onlyApprover {
        require(msg.sender == approver, "This action is only for approvers");
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
        uint balance = ledger[_token][msg.sender];
        ledger[_token][msg.sender] = balance.add(_amount);

        emit LogDeposit(_token, msg.sender, _amount);

        ERC20(_token).transferFrom(msg.sender, address(this), _amount);
    }

    // function offerTokens(address token, uint256 amount);
    // function transfer(address token, address src, address dst, uint256 amount) onlyOwner;

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
            _index >= buffer.being && _index <= buffer.end, 
            "Withdrawal must be in range of current buffer"
        );

        processWithdrawalRequest(_index, WithdrawalStatus.Denied);
    }

    function approveWithdrawalRequest(uint256 _index) public onlyApprover {
        processWithdrawalRequest(_index, WithdrawalStatus.Approved);
    }

    function processWithdrawalRequest(uint256 _index, WithdrawalStatus _status) 
        internal 
        onlyApprover 
    {
        WithdrawalRequest storage request = withdrawalRequests[_index];
        request.status = _status;
    }

    /**
    * @dev approveBatch advances the queue to the next range of items
    * all requests are considered approved unless they have been explicitly
    * denied using the `denyWithdrawalRequest` function
    */
    function approveBatch() public onlyApprover {
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
    * @dev set the approver
    *
    * @param _approver the approvers address
    */
    function setApprover(address _approver) public onlyOwner {
        emit LogApproverChanged(approver, _approver);
        approver = _approver;
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
