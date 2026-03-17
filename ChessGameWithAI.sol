// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title  ChessGameWithAI
/// @notice Contract for managing chess games with AI and PvP on the Base network.
///         Uses native ETH for bets and payments.
contract ChessGameWithAI is ReentrancyGuard, Ownable2Step, Pausable, EIP712 {
    using SafeERC20 for IERC20;

    // ══════════════════════════════════════════════════════════════════════════
    //  Custom errors
    // ══════════════════════════════════════════════════════════════════════════

    error ZeroAddress();
    error EmptyNickname();
    error NicknameTooLong();
    error NicknameTaken();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidLevel();
    error LevelNotAvailable();
    error NotEnoughEnergy();
    error StakeMustBeZero();
    error InvalidStake();
    error AlreadyFinished();
    error InvalidResult();
    error InvalidSignature();
    error GameNotAvailable();
    error NotIntendedOpponent();
    error CannotJoinOwnGame();
    error CannotPlaySelf();
    error GameNotActive();
    error NotAPlayer();
    error ZeroAmount();
    error InsufficientInternalBalance();
    error InsufficientPrizePool();
    error NicknameNotRegistered();
    error PlayerHasActiveGame();
    error NotOracle();
    error NotYourGame();
    error TooEarly();
    error NothingToClaim();
    error IncorrectETHAmount();
    error ETHTransferFailed();
    error RenounceDisabled();
    error OpponentNotRegistered();
    error OpponentHasActiveGame();

    // ══════════════════════════════════════════════════════════════════════════
    //  Constants
    // ══════════════════════════════════════════════════════════════════════════

    // EIP-712 type hashes for oracle signature verification
    bytes32 private constant _AI_GAME_RESULT_TYPEHASH =
        keccak256("AIGameResult(uint256 gameId,uint8 result)");
    bytes32 private constant _PVP_GAME_RESULT_TYPEHASH =
        keccak256("PvPGameResult(uint256 gameId,uint8 result)");

    uint256 public constant ENERGY_MAX             = 6;
    uint256 public constant ENERGY_REFILL_INTERVAL = 4 hours;
    uint256 public constant MIN_STAKE              = 1e14;        // 0.0001 ETH
    uint256 public constant MAX_STAKE              = 50e18;       // 50 ETH
    uint256 public constant LEVEL_PRICE_UNIT       = 1e15;        // 0.001 ETH per level
    uint256 public constant COMMISSION_PVP         = 2;           // 2%
    uint256 public constant COMMISSION_AI_WIN      = 2;           // 2% on player win
    uint256 public constant COMMISSION_AI_LOSS     = 50;          // 50% to developer on player loss
    uint256 public constant NICKNAME_MAX_LENGTH    = 32;
    uint256 public constant GAME_TIMEOUT           = 48 hours;
    uint256 public constant ORACLE_GRACE_PERIOD    = 24 hours;

    // ══════════════════════════════════════════════════════════════════════════
    //  State
    // ══════════════════════════════════════════════════════════════════════════

    address public oracle;
    address public previousOracle;       // previous oracle for grace period
    uint256 public oracleGraceDeadline;  // deadline for accepting old oracle signatures

    address public devWallet;            // developer address for receiving commissions

    uint256 public totalPrizePool;
    uint256 public aiGameCounter;
    uint256 public pvpGameCounter;

    // ══════════════════════════════════════════════════════════════════════════
    //  Structs
    // ══════════════════════════════════════════════════════════════════════════

    struct Player {
        string  nickname;
        uint256 internalBalance;     // internal balance (bonuses for first-time level completions)
        uint256 lastEnergyRefill;    // timestamp of the last energy refill
        uint16  aiLevelsCompleted;   // bitmask of completed AI levels (bits 0-9)
        uint8   energy;              // current energy amount (0-6)
        bool    registered;          // registration flag
    }

    struct AIGame {
        address player;
        uint8   level;       // AI difficulty level (1-10)
        uint8   result;      // 0 = draw, 1 = player wins, 2 = AI wins
        bool    finished;
        uint256 paidAmount;  // 0 if energy game, otherwise level * LEVEL_PRICE_UNIT ETH
        uint256 startTime;
    }

    struct PvPGame {
        address playerWhite;
        bool    isEnergy;    // true = energy game, false = paid game
        uint8   status;      // 0 = created, 1 = started, 2 = finished
        address playerBlack;
        address winner;
        uint256 stake;       // each player's stake in ETH
        uint256 startTime;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Mappings
    // ══════════════════════════════════════════════════════════════════════════

    mapping(address => Player)  public players;
    mapping(string  => address) public nicknameToAddress;
    mapping(uint256 => AIGame)  public aiGames;
    mapping(uint256 => PvPGame) public pvpGames;

    // Unified active game mapping: 0 = none, >0 = AI gameId, <0 = PvP gameId (abs)
    mapping(address => int256) public activeGame;

    // Pull-over-push: credited but not yet withdrawn funds
    mapping(address => uint256) public pendingWithdrawals;

    // ══════════════════════════════════════════════════════════════════════════
    //  Events
    // ══════════════════════════════════════════════════════════════════════════

    event PlayerRegistered(address indexed player, string nickname);
    event EnergyRefilled(address indexed player, uint8 newEnergy);
    event AIGameStarted(uint256 indexed gameId, address indexed player, uint8 level, bool isPaid);
    event AIGameFinished(uint256 indexed gameId, uint8 result, bool firstWinBonus);
    event PvPGameCreated(uint256 indexed gameId, address indexed creator, address indexed opponent, uint256 stake, bool isEnergy);
    event PvPGameJoined(uint256 indexed gameId, address indexed joiner);
    event PvPGameFinished(uint256 indexed gameId, address winner, uint256 amountWon);
    event AIGameResigned(uint256 indexed gameId, address indexed player, uint256 devPart, uint256 poolPart);
    event PvPGameResigned(uint256 indexed gameId, address loser);
    event PvPGameCancelled(uint256 indexed gameId, address creator);
    event InternalWithdrawn(address indexed player, uint256 amount);
    event OracleChanged(address indexed oldOracle, address indexed newOracle);
    event DevWalletChanged(address indexed oldWallet, address indexed newWallet);
    event TokensRescued(address indexed token, uint256 amount);
    event Claimed(address indexed account, uint256 amount);
    event AIGameTimeout(uint256 indexed gameId, address indexed player);
    event PvPGameTimeout(uint256 indexed gameId, address indexed player);

    // ══════════════════════════════════════════════════════════════════════════
    //  Modifiers
    // ══════════════════════════════════════════════════════════════════════════

    modifier onlyOracle() {
        if (msg.sender != oracle) revert NotOracle();
        _;
    }

    modifier onlyRegistered() {
        if (!players[msg.sender].registered) revert NotRegistered();
        _;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Deployment addresses
    // ══════════════════════════════════════════════════════════════════════════

    // Oracle wallet that signs game results via EIP-712
    address public constant ORACLE_ADDRESS    = 0xabF4130E3c790C62DeccDF36f9b4339Bd0702A77;
    // Developer wallet that receives commissions
    address public constant DEV_WALLET_ADDRESS = 0xBcf45B8Bb3f2E8ab9eDB37aE02BD1178e5C4e7bE;

    // ══════════════════════════════════════════════════════════════════════════
    //  Constructor
    // ══════════════════════════════════════════════════════════════════════════

    constructor()
        Ownable(msg.sender)
        EIP712("ChessGameWithAI", "1")
    {
        oracle    = ORACLE_ADDRESS;
        devWallet = DEV_WALLET_ADDRESS;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Receive ETH
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Allow contract to receive ETH directly.
    receive() external payable {}

    // ══════════════════════════════════════════════════════════════════════════
    //  Disable renounceOwnership
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Prevents ownership renunciation to keep the contract manageable.
    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Registration & energy
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Register a nickname. Must be unique and no longer than 32 bytes.
    function registerNickname(string calldata _nickname) external {
        Player storage p = players[msg.sender];

        uint256 len = bytes(_nickname).length;
        if (len == 0)                  revert EmptyNickname();
        if (len > NICKNAME_MAX_LENGTH) revert NicknameTooLong();
        if (nicknameToAddress[_nickname] != address(0)) revert NicknameTaken();
        if (p.registered)              revert AlreadyRegistered();

        p.nickname   = _nickname;
        p.registered = true;
        nicknameToAddress[_nickname] = msg.sender;

        // Initial energy allocation on registration
        if (p.lastEnergyRefill == 0) {
            p.energy           = uint8(ENERGY_MAX);
            p.lastEnergyRefill = block.timestamp;
        }

        emit PlayerRegistered(msg.sender, _nickname);
    }

    /// @notice Get address by nickname.
    function getAddressByNickname(string calldata _nickname) external view returns (address) {
        return nicknameToAddress[_nickname];
    }

    /// @dev Lazy energy refill: credits accumulated units based on elapsed time.
    function _refillEnergy(address playerAddr) internal {
        Player storage p = players[playerAddr];

        if (p.lastEnergyRefill == 0) {
            p.energy           = uint8(ENERGY_MAX);
            p.lastEnergyRefill = block.timestamp;
            return;
        }

        uint256 timePassed = block.timestamp - p.lastEnergyRefill;
        uint256 refills    = timePassed / ENERGY_REFILL_INTERVAL;

        if (refills != 0) {
            uint256 newEnergy = uint256(p.energy) + refills;
            p.energy = newEnergy > ENERGY_MAX ? uint8(ENERGY_MAX) : uint8(newEnergy);
            unchecked { p.lastEnergyRefill += refills * ENERGY_REFILL_INTERVAL; }
        }
    }

    /// @notice Force energy refill.
    function refillEnergy() external {
        _refillEnergy(msg.sender);
        emit EnergyRefilled(msg.sender, players[msg.sender].energy);
    }

    /// @notice Get current player energy (updates state).
    function getEnergy(address playerAddr) external returns (uint8) {
        _refillEnergy(playerAddr);
        return players[playerAddr].energy;
    }

    /// @notice Get energy without modifying state (view).
    function getEnergyView(address playerAddr) external view returns (uint8) {
        Player storage p = players[playerAddr];
        if (p.lastEnergyRefill == 0) return uint8(ENERGY_MAX);
        uint256 timePassed = block.timestamp - p.lastEnergyRefill;
        uint256 refills    = timePassed / ENERGY_REFILL_INTERVAL;
        uint256 newEnergy  = uint256(p.energy) + refills;
        return newEnergy > ENERGY_MAX ? uint8(ENERGY_MAX) : uint8(newEnergy);
    }

    /// @notice Check if a level is available for the player.
    function isLevelAvailable(address playerAddr, uint8 level) public view returns (bool) {
        if (level < 1 || level > 10) revert InvalidLevel();
        return _isLevelAvailable(playerAddr, level);
    }

    /// @dev Level 1 is always available; others require the previous level to be completed (bitmask check).
    function _isLevelAvailable(address playerAddr, uint8 level) internal view returns (bool) {
        if (level == 1) return true;
        return (players[playerAddr].aiLevelsCompleted & (1 << (level - 2))) != 0;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Oracle signature validation with grace period
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Accepts signatures from the current oracle or the previous one (within 24h after rotation).
    function _isValidOracleSignature(bytes32 digest, bytes calldata sig)
        internal view returns (bool)
    {
        address signer = ECDSA.recover(digest, sig);
        if (signer == oracle) return true;
        if (
            previousOracle != address(0) &&
            block.timestamp <= oracleGraceDeadline &&
            signer == previousOracle
        ) return true;
        return false;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Internal ETH transfer helper
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Safe ETH transfer.
    function _sendETH(address to, uint256 amount) internal {
        (bool success, ) = to.call{value: amount}("");
        if (!success) revert ETHTransferFailed();
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Pull-over-push: crediting and withdrawing funds
    // ══════════════════════════════════════════════════════════════════════════

    /// @dev Credits funds to pendingWithdrawals instead of transferring directly.
    function _credit(address account, uint256 amount) internal {
        if (amount != 0) {
            pendingWithdrawals[account] += amount;
        }
    }

    /// @notice Withdraw all credited funds (commissions, winnings, refunds) as ETH.
    function claim() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingWithdrawals[msg.sender] = 0;
        _sendETH(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  AI games
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Start a game against AI.
    /// @param  level     Difficulty level (1-10)
    /// @param  useEnergy true — energy game, false — paid game (send ETH via msg.value)
    /// @return gameId    ID of the created game
    function startAIGame(uint8 level, bool useEnergy)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyRegistered
        returns (uint256 gameId)
    {
        if (level < 1 || level > 10) revert InvalidLevel();
        if (activeGame[msg.sender] != 0) revert PlayerHasActiveGame();

        _refillEnergy(msg.sender);
        if (!_isLevelAvailable(msg.sender, level)) revert LevelNotAvailable();

        Player storage p = players[msg.sender];
        uint256 paidAmount;

        if (useEnergy) {
            if (msg.value != 0) revert IncorrectETHAmount();
            if (p.energy < 1) revert NotEnoughEnergy();
            unchecked { p.energy -= 1; }
        } else {
            // Paid game cost = level * LEVEL_PRICE_UNIT ETH
            paidAmount = uint256(level) * LEVEL_PRICE_UNIT;
            if (msg.value != paidAmount) revert IncorrectETHAmount();
        }

        unchecked { gameId = ++aiGameCounter; }

        aiGames[gameId] = AIGame({
            player:     msg.sender,
            level:      level,
            result:     0,
            finished:   false,
            paidAmount: paidAmount,
            startTime:  block.timestamp
        });

        // Positive value = AI game
        activeGame[msg.sender] = int256(gameId);

        emit AIGameStarted(gameId, msg.sender, level, !useEnergy);
    }

    /// @notice Finish an AI game (called by oracle only).
    /// @param  gameId    Game ID
    /// @param  result    0 — draw, 1 — player wins, 2 — AI wins
    /// @param  signature Oracle's EIP-712 signature
    function finishAIGame(uint256 gameId, uint8 result, bytes calldata signature)
        external
        onlyOracle
        nonReentrant
    {
        AIGame storage game = aiGames[gameId];

        if (game.player == address(0)) revert GameNotAvailable();
        if (game.finished)             revert AlreadyFinished();
        if (result > 2)                revert InvalidResult();

        // Verify EIP-712 oracle signature
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(_AI_GAME_RESULT_TYPEHASH, gameId, result))
        );
        if (!_isValidOracleSignature(digest, signature)) revert InvalidSignature();

        game.finished = true;
        game.result   = result;

        address playerAddr = game.player;
        activeGame[playerAddr] = 0; // release active game lock

        Player storage p    = players[playerAddr];
        uint256        paid = game.paidAmount;

        if (paid == 0) {
            // ── Energy game ─────────────────────────────────────────────────
            if (result == 0) {
                // Draw: return 1 energy
                _refillEnergy(playerAddr);
                if (p.energy < ENERGY_MAX) { unchecked { p.energy += 1; } }
            } else if (result == 1) {
                // Win: if level completed for the first time — bonus = level * LEVEL_PRICE_UNIT ETH to internal balance
                uint16 levelBit = uint16(1 << (game.level - 1));
                if ((p.aiLevelsCompleted & levelBit) == 0) {
                    p.internalBalance += uint256(game.level) * LEVEL_PRICE_UNIT;
                    p.aiLevelsCompleted |= levelBit;
                    emit AIGameFinished(gameId, result, true);
                    return;
                }
            }
            emit AIGameFinished(gameId, result, false);
        } else {
            // ── Paid game ───────────────────────────────────────────────────
            address _dev = devWallet;

            if (result == 1) {
                // Player wins: 2% commission to devWallet, 98% refund to player
                uint256 devPart = (paid * COMMISSION_AI_WIN) / 100;
                uint256 refund  = paid - devPart;
                _credit(playerAddr, refund);
                _credit(_dev, devPart);

                // Bonus for first-time level completion
                uint16 levelBit = uint16(1 << (game.level - 1));
                if ((p.aiLevelsCompleted & levelBit) == 0) {
                    p.internalBalance += paid;
                    p.aiLevelsCompleted |= levelBit;
                    emit AIGameFinished(gameId, result, true);
                    return;
                }
                emit AIGameFinished(gameId, result, false);
            } else if (result == 2) {
                // Player loses: 50% to devWallet, 50% to prize pool
                uint256 devPart  = (paid * COMMISSION_AI_LOSS) / 100;
                uint256 poolPart = paid - devPart;
                _credit(_dev, devPart);
                totalPrizePool += poolPart;
                emit AIGameFinished(gameId, result, false);
            } else {
                // Draw: full stake refund + 1 energy
                _credit(playerAddr, paid);
                _refillEnergy(playerAddr);
                if (p.energy < ENERGY_MAX) { unchecked { p.energy += 1; } }
                emit AIGameFinished(gameId, result, false);
            }
        }
    }

    /// @notice Resign from an AI game (player only).
    ///         Energy game: game closes, energy is not returned.
    ///         Paid game: treated as a loss — 50% to devWallet, 50% to prize pool.
    function resignAIGame(uint256 gameId) external nonReentrant {
        AIGame storage game = aiGames[gameId];

        if (game.player == address(0)) revert GameNotAvailable();
        if (game.finished)             revert AlreadyFinished();
        if (game.player != msg.sender) revert NotYourGame();

        game.finished = true;
        game.result   = 2; // player loss

        activeGame[msg.sender] = 0;

        uint256 paid = game.paidAmount;

        if (paid == 0) {
            emit AIGameResigned(gameId, msg.sender, 0, 0);
        } else {
            // Distribute stake as a loss
            address _dev     = devWallet;
            uint256 devPart  = (paid * COMMISSION_AI_LOSS) / 100;
            uint256 poolPart = paid - devPart;
            _credit(_dev, devPart);
            totalPrizePool += poolPart;
            emit AIGameResigned(gameId, msg.sender, devPart, poolPart);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  AI game timeout
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Claim stake via timeout if the oracle hasn't finished the AI game within 48 hours.
    ///         Full stake refund. For energy games — 1 energy is returned.
    function claimTimeoutAIGame(uint256 gameId) external nonReentrant {
        AIGame storage game = aiGames[gameId];

        if (game.player != msg.sender) revert NotYourGame();
        if (game.finished)             revert AlreadyFinished();
        if (block.timestamp < game.startTime + GAME_TIMEOUT) revert TooEarly();

        game.finished = true;
        game.result   = 0; // draw by timeout

        activeGame[msg.sender] = 0;

        if (game.paidAmount != 0) {
            _credit(msg.sender, game.paidAmount);
        } else {
            // Energy game: return 1 energy
            _refillEnergy(msg.sender);
            if (players[msg.sender].energy < ENERGY_MAX) {
                unchecked { players[msg.sender].energy += 1; }
            }
        }

        emit AIGameTimeout(gameId, msg.sender);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PvP games
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Create a PvP game by opponent address. Send ETH as msg.value for paid games.
    /// @param  opponent  Opponent address (address(0) — open game)
    /// @param  stake     Stake in ETH (0 if energy game, must match msg.value for paid)
    /// @param  isEnergy  true — energy game
    function createPvPGameByAddress(address opponent, uint256 stake, bool isEnergy)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyRegistered
        returns (uint256 gameId)
    {
        // Validate opponent if specified (not open game)
        if (opponent != address(0)) {
            if (!players[opponent].registered) revert OpponentNotRegistered();
            if (activeGame[opponent] != 0) revert OpponentHasActiveGame();
        }
        return _createPvPGame(opponent, stake, isEnergy);
    }

    /// @notice Create a PvP game by opponent nickname. Send ETH as msg.value for paid games.
    function createPvPGameByNickname(string calldata opponentNickname, uint256 stake, bool isEnergy)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyRegistered
        returns (uint256 gameId)
    {
        address opponent = nicknameToAddress[opponentNickname];
        if (opponent == address(0)) revert NicknameNotRegistered();
        if (activeGame[opponent] != 0) revert OpponentHasActiveGame();
        return _createPvPGame(opponent, stake, isEnergy);
    }

    /// @dev Internal PvP game creation logic.
    function _createPvPGame(address opponent, uint256 stake, bool isEnergy)
        internal
        returns (uint256 gameId)
    {
        if (opponent == msg.sender) revert CannotPlaySelf();
        if (activeGame[msg.sender] != 0) revert PlayerHasActiveGame();

        _refillEnergy(msg.sender);

        if (isEnergy) {
            if (stake != 0)                     revert StakeMustBeZero();
            if (msg.value != 0)                 revert IncorrectETHAmount();
            if (players[msg.sender].energy < 1) revert NotEnoughEnergy();
            unchecked { players[msg.sender].energy -= 1; }
        } else {
            if (stake < MIN_STAKE || stake > MAX_STAKE) revert InvalidStake();
            if (msg.value != stake) revert IncorrectETHAmount();
        }

        unchecked { gameId = ++pvpGameCounter; }

        pvpGames[gameId] = PvPGame({
            playerWhite: msg.sender,
            isEnergy:    isEnergy,
            status:      0,
            playerBlack: opponent,
            winner:      address(0),
            stake:       stake,
            startTime:   block.timestamp
        });

        // Negative value = PvP game
        activeGame[msg.sender] = -int256(gameId);

        emit PvPGameCreated(gameId, msg.sender, opponent, stake, isEnergy);
    }

    /// @notice Join a PvP game. Send ETH as msg.value for paid games.
    function joinPvPGame(uint256 gameId)
        external
        payable
        nonReentrant
        whenNotPaused
        onlyRegistered
    {
        PvPGame storage game = pvpGames[gameId];

        if (game.status != 0)                                                    revert GameNotAvailable();
        if (game.playerBlack != address(0) && game.playerBlack != msg.sender)    revert NotIntendedOpponent();
        if (game.playerWhite == msg.sender)                                       revert CannotJoinOwnGame();
        if (activeGame[msg.sender] != 0) revert PlayerHasActiveGame();

        _refillEnergy(msg.sender);

        if (game.isEnergy) {
            if (msg.value != 0) revert IncorrectETHAmount();
            if (players[msg.sender].energy < 1) revert NotEnoughEnergy();
            unchecked { players[msg.sender].energy -= 1; }
        } else {
            if (msg.value != game.stake) revert IncorrectETHAmount();
        }

        game.playerBlack = msg.sender;
        game.status      = 1;
        game.startTime   = block.timestamp; // reset startTime for timeout calculation

        activeGame[msg.sender] = -int256(gameId);

        emit PvPGameJoined(gameId, msg.sender);
    }

    /// @notice Cancel a PvP game that hasn't started yet (status 0).
    ///         Only the creator (white). Stake is fully refunded, energy is NOT returned.
    function cancelPvPGame(uint256 gameId) external nonReentrant {
        PvPGame storage game = pvpGames[gameId];

        if (game.status != 0)               revert GameNotAvailable();
        if (game.playerWhite != msg.sender)  revert NotAPlayer();

        game.status = 2;
        activeGame[msg.sender] = 0;

        // Refund stake (for energy games — nothing is returned)
        if (!game.isEnergy) {
            _credit(msg.sender, game.stake);
        }

        emit PvPGameCancelled(gameId, msg.sender);
    }

    /// @notice Finish a PvP game (called by oracle only).
    /// @param  gameId    Game ID
    /// @param  result    1 — white wins, 2 — black wins, 0 — draw
    /// @param  signature Oracle's EIP-712 signature
    function finishPvPGame(uint256 gameId, uint8 result, bytes calldata signature)
        external
        onlyOracle
        nonReentrant
    {
        PvPGame storage game = pvpGames[gameId];

        if (game.status != 1) revert GameNotActive();
        if (result > 2)       revert InvalidResult();

        // Verify EIP-712 oracle signature
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(_PVP_GAME_RESULT_TYPEHASH, gameId, result))
        );
        if (!_isValidOracleSignature(digest, signature)) revert InvalidSignature();

        game.status = 2;

        address white = game.playerWhite;
        address black = game.playerBlack;

        // Release active game lock for both players
        activeGame[white] = 0;
        activeGame[black] = 0;

        if (game.isEnergy) {
            // Energy PvP: on draw — return energy to both
            if (result == 0) {
                _refillEnergy(white);
                if (players[white].energy < ENERGY_MAX) { unchecked { players[white].energy += 1; } }
                _refillEnergy(black);
                if (players[black].energy < ENERGY_MAX) { unchecked { players[black].energy += 1; } }
            } else {
                game.winner = result == 1 ? white : black;
            }
            emit PvPGameFinished(gameId, game.winner, 0);
        } else {
            // Paid PvP
            if (result == 0) {
                // Draw: refund stakes to both
                _credit(white, game.stake);
                _credit(black, game.stake);
                emit PvPGameFinished(gameId, address(0), 0);
            } else {
                // Win: 2% commission to devWallet, remainder to winner
                address _dev = devWallet;
                uint256 totalPool  = game.stake * 2;
                uint256 commission = (totalPool * COMMISSION_PVP) / 100;
                uint256 winnerAmt  = totalPool - commission;

                address winner = result == 1 ? white : black;
                game.winner = winner;

                _credit(_dev, commission);
                _credit(winner, winnerAmt);
                emit PvPGameFinished(gameId, winner, winnerAmt);
            }
        }
    }

    /// @notice Resign from a PvP game (participants only).
    function resignPvPGame(uint256 gameId) external nonReentrant {
        PvPGame storage game = pvpGames[gameId];

        if (game.status != 1)                                               revert GameNotActive();
        if (msg.sender != game.playerWhite && msg.sender != game.playerBlack) revert NotAPlayer();

        game.status = 2;

        address loser  = msg.sender;
        address winner = loser == game.playerWhite ? game.playerBlack : game.playerWhite;
        game.winner    = winner;

        activeGame[game.playerWhite] = 0;
        activeGame[game.playerBlack] = 0;

        if (game.isEnergy) {
            emit PvPGameResigned(gameId, loser);
            emit PvPGameFinished(gameId, winner, 0);
        } else {
            // Distribute as a win: 2% commission, remainder to winner
            address _dev = devWallet;
            uint256 totalPool  = game.stake * 2;
            uint256 commission = (totalPool * COMMISSION_PVP) / 100;
            uint256 winnerAmt  = totalPool - commission;

            _credit(_dev, commission);
            _credit(winner, winnerAmt);

            emit PvPGameResigned(gameId, loser);
            emit PvPGameFinished(gameId, winner, winnerAmt);
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  PvP game timeout
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Claim stakes via timeout if the oracle hasn't finished the PvP game within 48 hours.
    ///         Both stakes are returned. For energy games — energy is returned to both.
    function claimTimeoutPvPGame(uint256 gameId) external nonReentrant {
        PvPGame storage game = pvpGames[gameId];

        if (game.status != 1) revert GameNotActive();
        if (msg.sender != game.playerWhite && msg.sender != game.playerBlack) revert NotAPlayer();
        if (block.timestamp < game.startTime + GAME_TIMEOUT) revert TooEarly();

        game.status = 2;

        address white = game.playerWhite;
        address black = game.playerBlack;

        activeGame[white] = 0;
        activeGame[black] = 0;

        if (game.isEnergy) {
            // Return energy to both players
            _refillEnergy(white);
            if (players[white].energy < ENERGY_MAX) { unchecked { players[white].energy += 1; } }
            _refillEnergy(black);
            if (players[black].energy < ENERGY_MAX) { unchecked { players[black].energy += 1; } }
        } else {
            // Full stake refund to both
            _credit(white, game.stake);
            _credit(black, game.stake);
        }

        emit PvPGameTimeout(gameId, msg.sender);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Internal balance & withdrawal
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Withdraw internal balance as ETH from the prize pool.
    function withdrawInternalBalance(uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        if (amount == 0) revert ZeroAmount();

        Player storage p = players[msg.sender];
        if (p.internalBalance < amount) revert InsufficientInternalBalance();
        if (totalPrizePool     < amount) revert InsufficientPrizePool();

        unchecked {
            p.internalBalance -= amount;
            totalPrizePool    -= amount;
        }

        // Credit to pendingWithdrawals; player collects via claim()
        _credit(msg.sender, amount);

        emit InternalWithdrawn(msg.sender, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  Admin
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Change oracle address. Old oracle signatures are accepted for 24 more hours.
    function setOracle(address _newOracle) external onlyOwner {
        if (_newOracle == address(0)) revert ZeroAddress();
        emit OracleChanged(oracle, _newOracle);
        previousOracle      = oracle;
        oracleGraceDeadline = block.timestamp + ORACLE_GRACE_PERIOD;
        oracle = _newOracle;
    }

    /// @notice Change developer wallet address for receiving commissions.
    function setDevWallet(address _newDevWallet) external onlyOwner {
        if (_newDevWallet == address(0)) revert ZeroAddress();
        emit DevWalletChanged(devWallet, _newDevWallet);
        devWallet = _newDevWallet;
    }

    /// @notice Pause the contract.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Emergency rescue of mistakenly sent ERC-20 tokens.
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
        emit TokensRescued(token, amount);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  View helpers
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Check if a player has an active game.
    /// @return hasActive  true if there is an active game
    /// @return gameType   0 = none, 1 = AI, 2 = PvP
    /// @return gameId     Active game ID (0 if none)
    function getActiveGame(address playerAddr)
        external
        view
        returns (bool hasActive, uint8 gameType, uint256 gameId)
    {
        int256 val = activeGame[playerAddr];
        if (val > 0) {
            hasActive = true;
            gameType  = 1; // AI
            gameId    = uint256(val);
        } else if (val < 0) {
            hasActive = true;
            gameType  = 2; // PvP
            gameId    = uint256(-val);
        }
        // else: hasActive=false, gameType=0, gameId=0
    }
}
