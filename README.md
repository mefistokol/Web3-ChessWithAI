# Chess on Base - On-Chain Chess with AI & PvP, made with the help of AI.

You can try it - https://chess-with-ai-lac.vercel.app/

A decentralized chess platform on the **Base network** where players can compete against AI or other players, staking native ETH. Game results are verified via EIP-712 oracle signatures and settled on-chain.

**Smart Contract**: [`0xC078250788B59ee40E5A0d0E2A9d9410631ee6F4`](https://basescan.org/address/0xC078250788B59ee40E5A0d0E2A9d9410631ee6F4)

---

## Architecture Overview

```
┌─────────────┐     ┌──────────────┐     ┌────────────────────┐
│   Frontend   │────▶│ Oracle Server│────▶│  Smart Contract    │
│  (Next.js)   │◀────│  (Node.js)   │     │  (Base Network)    │
│  Vercel/Host │     │  Chess Engine│     │  ChessGameWithAI   │
└──────┬───────┘     └──────┬───────┘     └────────┬───────────┘
       │                    │                      │
       │  wallet tx         │  EIP-712 signed tx   │
       └────────────────────┼──────────────────────┘
                            │
                     Stockfish Engine
```

### Component Roles

| Component | Role |
|-----------|------|
| **Smart Contract** | Manages game lifecycle, stakes, payouts, energy system. All financial logic is on-chain. |
| **Oracle Server** | Runs the chess engine (Stockfish), validates moves, determines game results, signs results with EIP-712, and submits `finishAIGame`/`finishPvPGame` transactions. |
| **Frontend** | Next.js app with wallet connection (RainbowKit + wagmi). Players interact with the contract directly for starting/joining/resigning games, and with the oracle API for chess moves. |

---

## Smart Contract: ChessGameWithAI

**Solidity 0.8.34** | OpenZeppelin: ReentrancyGuard, Ownable2Step, Pausable, EIP712

### Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `ENERGY_MAX` | 6 | Maximum energy per player |
| `ENERGY_REFILL_INTERVAL` | 4 hours | Time to refill 1 energy unit |
| `MIN_STAKE` | 0.0001 ETH | Minimum PvP stake |
| `MAX_STAKE` | 50 ETH | Maximum PvP stake |
| `LEVEL_PRICE_UNIT` | 0.001 ETH | Cost per AI level (paid mode) |
| `COMMISSION_PVP` | 2% | Commission on PvP wins |
| `COMMISSION_AI_WIN` | 2% | Commission on AI wins (player wins) |
| `COMMISSION_AI_LOSS` | 50% | Developer share on AI losses |
| `GAME_TIMEOUT` | 48 hours | Timeout for claiming stuck games |
| `ORACLE_GRACE_PERIOD` | 24 hours | Grace period after oracle rotation |

---

### Player Registration & Energy

#### `registerNickname(string _nickname)`
- Registers a unique nickname (max 32 bytes)
- Grants initial 6 energy
- One-time only per address

#### `refillEnergy()`
- Triggers lazy energy refill based on elapsed time
- Energy refills 1 unit per 4 hours, up to max 6

#### `getEnergyView(address) → uint8` (view)
- Returns current energy without modifying state

#### `isLevelAvailable(address, uint8 level) → bool` (view)
- Level 1 always available
- Level N requires level N-1 completed (bitmask check)

---

### AI Games

Players play chess against Stockfish via the oracle server. The contract manages stakes and payouts.

#### `startAIGame(uint8 level, bool useEnergy) → uint256 gameId` (payable)
- **Energy mode**: costs 1 energy, no ETH required
- **Paid mode**: costs `level × 0.001 ETH` sent as `msg.value`
- Only 1 active game per player at a time
- Level must be available (sequential unlock)

#### `finishAIGame(uint256 gameId, uint8 result, bytes signature)` (oracle only)
- Called by oracle after game ends
- Result: `0` = draw, `1` = player wins, `2` = AI wins
- Requires valid EIP-712 signature from oracle

**Payout logic (paid games):**

| Result | Player | Developer | Prize Pool |
|--------|--------|-----------|------------|
| Player wins | 98% refund + first-win bonus | 2% commission | — |
| AI wins | — | 50% | 50% |
| Draw | 100% refund + 1 energy | — | — |

**First-win bonus**: When a player completes a level for the first time, they receive `level × 0.001 ETH` credited to their internal balance (both energy and paid modes).

#### `resignAIGame(uint256 gameId)`
- Player voluntarily resigns
- Energy game: no refund
- Paid game: treated as loss (50/50 split dev/pool)

#### `claimTimeoutAIGame(uint256 gameId)`
- If oracle hasn't finished game within 48 hours
- Full stake refund (paid) or energy return (energy)

---

### PvP Games

Two players compete against each other. The oracle relays moves via WebSocket and submits the final result on-chain.

#### `createPvPGameByAddress(address opponent, uint256 stake, bool isEnergy) → uint256 gameId` (payable)
- `opponent = address(0)` for open games (anyone can join)
- Energy mode: costs 1 energy, stake must be 0
- Paid mode: `msg.value` must equal `stake` (0.0001–50 ETH)

#### `createPvPGameByNickname(string opponentNickname, uint256 stake, bool isEnergy) → uint256 gameId` (payable)
- Same as above but resolves opponent by nickname

#### `joinPvPGame(uint256 gameId)` (payable)
- Joins an existing game (status must be 0 = created)
- For paid games: `msg.value` must equal the game's stake
- For energy games: costs 1 energy
- Sets game status to 1 (started)

#### `cancelPvPGame(uint256 gameId)`
- Creator cancels before opponent joins (status 0)
- Paid: stake refunded via `pendingWithdrawals`
- Energy: energy NOT returned

#### `finishPvPGame(uint256 gameId, uint8 result, bytes signature)` (oracle only)
- Result: `0` = draw, `1` = white wins, `2` = black wins
- Requires EIP-712 signature

**Payout logic (paid games):**

| Result | Winner | Developer |
|--------|--------|-----------|
| Win | 98% of total pool (2× stake) | 2% commission |
| Draw | Both get stake back | — |

#### `resignPvPGame(uint256 gameId)`
- Either player can resign during active game (status 1)
- Opponent wins; payout same as oracle-decided win

#### `claimTimeoutPvPGame(uint256 gameId)`
- After 48 hours without oracle resolution
- Both stakes refunded / energy returned

---

### Wallet & Withdrawals

The contract uses a **pull-over-push** pattern for security:

#### `pendingWithdrawals(address) → uint256` (view)
- Shows credited but unclaimed ETH (winnings, refunds, commissions)

#### `claim()`
- Withdraws all `pendingWithdrawals` as ETH to caller
- Protected by ReentrancyGuard

#### `withdrawInternalBalance(uint256 amount)`
- Converts internal balance (first-win bonuses) to `pendingWithdrawals`
- Deducts from `totalPrizePool` — requires sufficient pool funds
- Then use `claim()` to withdraw ETH

---

### Active Game Tracking

Each player can have at most 1 active game. The `activeGame` mapping uses signed integers:
- `> 0` → AI game (value = gameId)
- `< 0` → PvP game (absolute value = gameId)
- `= 0` → no active game

#### `getActiveGame(address) → (bool hasActive, uint8 gameType, uint256 gameId)` (view)
- `gameType`: 0 = none, 1 = AI, 2 = PvP

---

### Admin Functions (Owner Only)

| Function | Description |
|----------|-------------|
| `setOracle(address)` | Change oracle. Old oracle valid for 24h grace period |
| `setDevWallet(address)` | Change developer commission wallet |
| `pause()` / `unpause()` | Emergency pause (blocks new games & withdrawals) |
| `rescueTokens(address, uint256)` | Recover mistakenly sent ERC-20 tokens |

Ownership uses `Ownable2Step` (two-step transfer). `renounceOwnership()` is disabled.

---

## Oracle Server

Node.js server that bridges the frontend and smart contract.

### Responsibilities:
1. **Chess Engine**: Runs Stockfish to compute AI moves
2. **Move Validation**: Validates all moves (AI and PvP)
3. **Game State**: Maintains board state in memory/DB
4. **Result Signing**: Signs game results using EIP-712 with the oracle private key
5. **On-Chain Settlement**: Calls `finishAIGame()` / `finishPvPGame()` on the contract
6. **WebSocket**: Real-time move relay for PvP games

### API Endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/ai/register` | POST | Register new AI game with oracle |
| `/api/ai/move` | POST | Send player move, receive AI response |
| `/api/ai/state/:gameId` | GET | Get current board state |
| `/api/pvp/register` | POST | Register PvP game |
| `/api/pvp/join` | POST | Notify oracle of PvP join |
| `/api/pvp/move` | POST | Send PvP move |
| `/api/pvp/state/:gameId` | GET | Get PvP board state |
| `/api/pvp/game/:gameId` | GET | Get PvP game info (stake, etc.) |
| `/api/pvp/draw` | POST | Offer draw |
| `/api/pvp/accept-draw` | POST | Accept draw offer |
| `/api/player/:address` | GET | Get player info & active game |
| `/ws` | WebSocket | Real-time PvP move relay |

### EIP-712 Signature Flow:

```
1. Game ends (checkmate/stalemate/draw/timeout)
2. Oracle determines result (0/1/2)
3. Oracle signs EIP-712 typed data:
   - AI: AIGameResult(uint256 gameId, uint8 result)
   - PvP: PvPGameResult(uint256 gameId, uint8 result)
   Domain: { name: "ChessGameWithAI", version: "1", chainId: 8453, verifyingContract: <address> }
4. Oracle calls finishAIGame/finishPvPGame with signature
5. Contract verifies signature on-chain via ECDSA.recover
```

---

## Frontend

Next.js 14 app with:
- **RainbowKit** for wallet connection
- **wagmi** for contract interactions
- **react-chessboard** + **chess.js** for the chess UI
- **react-hot-toast** for notifications

### Pages:

| Route | Description |
|-------|-------------|
| `/` | Home — overview, active game banner |
| `/profile` | Register nickname, view energy, completed levels |
| `/ai` | Play vs AI — level selection, chessboard, resign/timeout |
| `/pvp` | PvP — create/join games, chessboard, resign/draw/timeout |
| `/wallet` | Claim winnings, withdraw internal balance |


## Security Features

- **ReentrancyGuard** on all state-changing functions
- **Pull-over-push** pattern for ETH payouts (`pendingWithdrawals` + `claim()`)
- **EIP-712 typed signatures** for oracle result verification
- **Oracle grace period** (24h) for smooth oracle key rotation
- **Game timeout** (48h) — players can reclaim stakes if oracle is unresponsive
- **Ownable2Step** — two-step ownership transfer, renounce disabled
- **Pausable** — emergency stop for new games
- **One active game per player** — prevents reentrancy via game state

---

## License

MIT
