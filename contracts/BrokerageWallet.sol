 pragma solidity ^0.4.24;

import "openzeppelin-solidity/contracts/math/SafeMath.sol";
import "openzeppelin-solidity/contracts/ownership/Ownable.sol";
import "openzeppelin-solidity/contracts/token/ERC20/ERC20.sol";
/**
 * Sometimes it is useful for a contract to own tokens on behalf of users.
 */
contract BrokerageWallet is Ownable {
    using SafeMath for uint;

    uint8 constant public APPROVAL_THRESHOLD = 3;

    struct WithdrawalRequest {
        address investor;
        address token;
        uint256 amount;
        bool approved;
        uint256 approvalCountIndex;
    }

    struct InvestorLedger {
        uint256 balance;
        uint256 offeredBalance;
    }

    /** Platform administrator */
    address public platformAdmin;

    /** The active signers */
    mapping(address => bool) public approvers;
    address[] public approverAddresses;

    /** balance registry */
    /** tokenAddress => investorAddress => balance */
    mapping(address => mapping(address => InvestorLedger)) public ledger;

    /** approverAddress => withdrawalRequests */
    mapping(address => WithdrawalRequest[]) public approverRequests;
    uint[] public requestApprovalCounts;
    event LogApproverAdded(address indexed _approver);
    event LogApproverRemoved(address indexed _approver);

    /** logging deposit or their failure */
    event LogDeposit(address indexed _token, address indexed _investor, uint _amount);
    event LogDepositFail(address indexed _token, address indexed _investor, uint _amount);

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
        require(approvers[msg.sender], "This action is only for approvers");
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

        ERC20 token = ERC20(_token);
        token.transferFrom(msg.sender, address(this), _amount);

        emit LogDeposit(_token, msg.sender, _amount);
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
