 pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
/**
 * Sometimes it is useful for a contract to own tokens on behalf of users.
 */
contract BrokerageWallet is Ownable {
    using SafeMath for uint;

    /**
    * @dev Withdrawal Requests are processed by an approver, the initial state is
    * pending, and will eventually resolve to approved or denied
    */
    enum WithdrawalStatus { Pending, Approved, Denied }

    struct WithdrawalRequest {
        address investor;
        address token;
        uint256 amount;
        WithdrawalStatus status;
    }

    /** Queue of requests to process */
    WithdrawalRequest[] public withdrawalRequests;

    /** Tracking what part of the queue is ready for processing */
    struct WithdrawalRequestBuffer {
        uint256 begin;
        uint256 end;
    }

    /** initialize tracking */
    WithdrawalRequestBuffer private buffer = WithdrawalRequestBuffer({begin: 0, end: 0});
    uint256 constant bufferLimit = 10;

    /** Contract administrator */
    address public admin;

    /** balance registry */
    /** tokenAddress => investorAddress => balance */
    mapping(address => mapping(address => uint256)) public ledger;

    /** Approver has ability to approve withdraw requests */
    address public approver;

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

        ERC20 token = ERC20(_token);
        token.transferFrom(msg.sender, address(this), _amount);

        emit LogDeposit(_token, msg.sender, _amount);
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
        uint256 approvalCountIndex = requestApprovalCounts.push(0) - 1;

        for (uint i = 0; i < approverAddresses.length; i++) {
            address approverAddress = approverAddresses[i];
            WithdrawalRequest memory request = WithdrawalRequest(msg.sender, _token, _amount, false, approvalCountIndex);
            approverRequests[approverAddress].push(request);
        }
    }

    // ~~~~~~~~~~~~~~ //
    // Administration //
    // ~~~~~~~~~~~~~~ //

    /**
    * @dev Approves a list of withdrawal requests, if threshold is met, also transfers tokens
    *
    * @param _begin the starting index of requests to approve
    * @param _end the ending index of requests to approve
    */
    function approveWithdrawals(uint256 _begin, uint256 _end) public onlyApprover {
        for (uint i = _begin; i < _end; i++) {
            approveWithdraw(i);
        }
    }

    function approveWithdraw(uint256 _index) public onlyApprover {
        WithdrawalRequest storage request = approverRequests[msg.sender][_index];
        // TODO: skip if already approved by this approver
        requestApprovalCounts[request.approvalCountIndex] += 1;
        request.approved = true;

        if (requestApprovalCounts[request.approvalCountIndex] > APPROVAL_THRESHOLD) {
            // TODO: Transfer tokens to investor
            // TODO: Remove entry from requestApprovalCounts
        }
    }
    /**
    * @dev add approver address to the list
    *
    * @param _approver the approvers address
    */
    function addApprover(address _approver) public onlyOwner {
        if (approvers[_approver]) return;

        uint currentLength = approverAddresses.length;
        approverAddresses.length = currentLength + 1;
        
        approverAddresses[currentLength] = _approver;
        approvers[_approver] = true;

        emit LogApproverAdded(_approver);
    }

    /**
    * @dev remove approver address from the list
    *
    * @param _approver the approver address to remove
    */
    function removeApprover(address _approver) public onlyOwner {
        if (!approvers[_approver]) return; 

        for (uint256 i = 0; i < approverAddresses.length; i++) {
            if (approverAddresses[i] == _approver) {
                uint256 newLength = approverAddresses.length - 1;
                approverAddresses[i] = approverAddresses[newLength];
                approvers[_approver] = false;
            
                approverAddresses.length = newLength;

                emit LogApproverRemoved(_approver);
                break;
            }
        }
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
