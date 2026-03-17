"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const ws_1 = require("ws");
const http_1 = __importDefault(require("http"));
const chess_js_1 = require("chess.js");
const signer_1 = require("./signer");
const blockchain_1 = require("./blockchain");
const engine_1 = require("./engine");
const db_1 = require("./db");
const PORT = parseInt(process.env.PORT || '3001');
const ORACLE_PRIVATE_KEY = process.env.ORACLE_PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const RPC_URL = process.env.RPC_URL;
const STOCKFISH_DEPTH = parseInt(process.env.STOCKFISH_DEPTH || '15');
// Validate required env vars
if (!ORACLE_PRIVATE_KEY || !CONTRACT_ADDRESS || !RPC_URL) {
    console.error('Missing required environment variables: ORACLE_PRIVATE_KEY, CONTRACT_ADDRESS, RPC_URL');
    process.exit(1);
}
// Initialize modules
(0, signer_1.initSigner)(ORACLE_PRIVATE_KEY);
(0, blockchain_1.initBlockchain)(RPC_URL, ORACLE_PRIVATE_KEY, CONTRACT_ADDRESS);
(0, engine_1.initEngine)(STOCKFISH_DEPTH);
const app = (0, express_1.default)();
// Security: limit JSON body size
app.use(express_1.default.json({ limit: '1mb' }));
// Security: CORS configuration
const allowedOrigins = (process.env.CORS_ORIGIN || '*').split(',').map(s => s.trim());
app.use((0, cors_1.default)({
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
    methods: ['GET', 'POST'],
}));
// Security: basic rate limiting (in-memory, per IP)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60_000; // 1 minute
const RATE_LIMIT_MAX = 60; // 60 requests per minute
function rateLimit(req, res, next) {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let entry = rateLimitMap.get(ip);
    if (!entry || now > entry.resetAt) {
        entry = { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
        rateLimitMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
}
app.use(rateLimit);
// Clean up rate limit map periodically
setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateLimitMap) {
        if (now > entry.resetAt)
            rateLimitMap.delete(ip);
    }
}, 60_000);
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server, path: '/ws' });
const wsClients = new Map();
wss.on('connection', (ws, req) => {
    let clientAddress = '';
    ws.on('message', (data) => {
        try {
            const raw = data.toString();
            if (raw.length > 1024)
                return; // Security: limit message size
            const msg = JSON.parse(raw);
            if (msg.type === 'auth' && typeof msg.address === 'string') {
                clientAddress = msg.address.toLowerCase();
                wsClients.set(clientAddress, { ws, address: clientAddress, gameId: msg.gameId });
            }
        }
        catch (e) {
            // ignore malformed messages
        }
    });
    ws.on('close', () => {
        if (clientAddress)
            wsClients.delete(clientAddress);
    });
    // Security: close idle connections after 5 minutes
    const timeout = setTimeout(() => {
        if (ws.readyState === ws_1.WebSocket.OPEN)
            ws.close();
    }, 5 * 60 * 1000);
    ws.on('close', () => clearTimeout(timeout));
});
function notifyPlayer(address, data) {
    const client = wsClients.get(address.toLowerCase());
    if (client && client.ws.readyState === ws_1.WebSocket.OPEN) {
        client.ws.send(JSON.stringify(data));
    }
}
// ═══════════════════════════════════════════════════════════════
// Input validation helpers
// ═══════════════════════════════════════════════════════════════
function isValidAddress(addr) {
    return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr);
}
function isValidGameId(id) {
    return typeof id === 'number' && Number.isInteger(id) && id > 0;
}
function sanitizeError(err) {
    // Don't leak internal error details to clients
    if (err?.code === 'CALL_EXCEPTION')
        return 'Contract call failed';
    if (err?.code === 'NETWORK_ERROR')
        return 'Network error';
    return 'Internal server error';
}
// ═══════════════════════════════════════════════════════════════
// AI Game Endpoints
// ═══════════════════════════════════════════════════════════════
app.get('/api/ai/state/:gameId', async (req, res) => {
    try {
        const gameId = Number(req.params.gameId);
        if (!isValidGameId(gameId)) {
            return res.status(400).json({ error: 'Invalid game ID' });
        }
        const game = db_1.aiGameStmts.get.get(gameId);
        if (!game)
            return res.status(404).json({ error: 'Game not found' });
        res.json({ ok: true, fen: game.fen, level: game.level, moves: game.moves, status: game.status });
    }
    catch (err) {
        console.error('AI state error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/ai/register', async (req, res) => {
    try {
        const { gameId, player, level } = req.body;
        if (!isValidGameId(gameId) || !isValidAddress(player) || typeof level !== 'number' || level < 1 || level > 10) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        // Verify game exists on-chain and matches
        const onChain = await (0, blockchain_1.getAIGame)(gameId);
        if (onChain.player.toLowerCase() !== player.toLowerCase()) {
            return res.status(400).json({ error: 'Game not found on-chain or player mismatch' });
        }
        if (onChain.finished) {
            return res.status(400).json({ error: 'Game already finished' });
        }
        const existing = db_1.aiGameStmts.get.get(gameId);
        if (!existing) {
            db_1.aiGameStmts.insert.run(gameId, player.toLowerCase(), level);
        }
        res.json({ ok: true, gameId });
    }
    catch (err) {
        console.error('AI register error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/ai/move', async (req, res) => {
    try {
        const { gameId, move, player } = req.body;
        if (!isValidGameId(gameId) || !move || typeof move !== 'object') {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const game = db_1.aiGameStmts.get.get(gameId);
        if (!game)
            return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'active')
            return res.status(400).json({ error: 'Game not active' });
        // Security: verify the caller is the game player
        if (player && isValidAddress(player)) {
            if (player.toLowerCase() !== game.player) {
                return res.status(403).json({ error: 'Not your game' });
            }
        }
        const chess = new chess_js_1.Chess(game.fen);
        // Validate that it's white's turn (player is always white in AI games)
        if (chess.turn() !== 'w') {
            return res.status(400).json({ error: 'Not your turn' });
        }
        // Validate player move
        let playerMove;
        try {
            playerMove = chess.move({
                from: String(move.from),
                to: String(move.to),
                promotion: move.promotion ? String(move.promotion) : undefined,
            });
        }
        catch (e) {
            return res.status(400).json({ error: 'Invalid move' });
        }
        const movesArr = game.moves ? game.moves.split(',') : [];
        movesArr.push(playerMove.san);
        // Check if game is over after player move
        if (chess.isGameOver()) {
            let result;
            if (chess.isCheckmate()) {
                result = 1; // Player wins
            }
            else {
                result = 0; // Draw
            }
            db_1.aiGameStmts.updateFen.run(chess.fen(), movesArr.join(','), gameId);
            db_1.aiGameStmts.finish.run(result, gameId);
            try {
                const txHash = await (0, blockchain_1.submitAIGameResult)(gameId, result);
                return res.json({ ok: true, gameOver: true, result, playerMove: playerMove.san, txHash });
            }
            catch (txErr) {
                console.error('Failed to submit AI result:', txErr);
                return res.json({ ok: true, gameOver: true, result, playerMove: playerMove.san, txError: 'Submission pending' });
            }
        }
        // Get AI move from Stockfish
        const bestMove = await (0, engine_1.getBestMove)(chess.fen(), game.level);
        const aiMoveObj = chess.move({
            from: bestMove.slice(0, 2),
            to: bestMove.slice(2, 4),
            promotion: bestMove[4] || undefined,
        });
        movesArr.push(aiMoveObj.san);
        // Check if game is over after AI move
        if (chess.isGameOver()) {
            let result;
            if (chess.isCheckmate()) {
                result = 2; // AI wins
            }
            else {
                result = 0; // Draw
            }
            db_1.aiGameStmts.updateFen.run(chess.fen(), movesArr.join(','), gameId);
            db_1.aiGameStmts.finish.run(result, gameId);
            try {
                const txHash = await (0, blockchain_1.submitAIGameResult)(gameId, result);
                return res.json({ ok: true, gameOver: true, result, playerMove: playerMove.san, aiMove: aiMoveObj.san, fen: chess.fen(), txHash });
            }
            catch (txErr) {
                console.error('Failed to submit AI result:', txErr);
                return res.json({ ok: true, gameOver: true, result, playerMove: playerMove.san, aiMove: aiMoveObj.san, fen: chess.fen(), txError: 'Submission pending' });
            }
        }
        db_1.aiGameStmts.updateFen.run(chess.fen(), movesArr.join(','), gameId);
        res.json({
            ok: true,
            gameOver: false,
            playerMove: playerMove.san,
            aiMove: aiMoveObj.san,
            fen: chess.fen(),
        });
    }
    catch (err) {
        console.error('AI move error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
// ═══════════════════════════════════════════════════════════════
// PvP Game Endpoints
// ═══════════════════════════════════════════════════════════════
app.post('/api/pvp/register', async (req, res) => {
    try {
        const { gameId, playerWhite, playerBlack } = req.body;
        if (!isValidGameId(gameId) || !isValidAddress(playerWhite)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const onChain = await (0, blockchain_1.getPvPGame)(gameId);
        if (onChain.playerWhite.toLowerCase() !== playerWhite.toLowerCase()) {
            return res.status(400).json({ error: 'Game not found on-chain or player mismatch' });
        }
        const existing = db_1.pvpGameStmts.get.get(gameId);
        if (!existing) {
            const status = playerBlack && isValidAddress(playerBlack) ? 'active' : 'waiting';
            db_1.pvpGameStmts.insert.run(gameId, playerWhite.toLowerCase(), playerBlack?.toLowerCase() || null, status);
        }
        res.json({ ok: true, gameId });
    }
    catch (err) {
        console.error('PvP register error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/pvp/join', async (req, res) => {
    try {
        const { gameId, playerBlack } = req.body;
        if (!isValidGameId(gameId) || !isValidAddress(playerBlack)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const game = db_1.pvpGameStmts.get.get(gameId);
        if (!game)
            return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'waiting')
            return res.status(400).json({ error: 'Game not available for joining' });
        // Verify on-chain that the join actually happened
        const onChain = await (0, blockchain_1.getPvPGame)(gameId);
        if (onChain.status < 1) {
            return res.status(400).json({ error: 'Join not confirmed on-chain yet' });
        }
        db_1.pvpGameStmts.join.run(playerBlack.toLowerCase(), gameId);
        notifyPlayer(game.player_white, { type: 'pvp_joined', gameId, playerBlack });
        res.json({ ok: true });
    }
    catch (err) {
        console.error('PvP join error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/pvp/move', async (req, res) => {
    try {
        const { gameId, move, player } = req.body;
        if (!isValidGameId(gameId) || !move || typeof move !== 'object' || !isValidAddress(player)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const game = db_1.pvpGameStmts.get.get(gameId);
        if (!game)
            return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'active')
            return res.status(400).json({ error: 'Game not active' });
        const chess = new chess_js_1.Chess(game.fen);
        const playerLower = player.toLowerCase();
        // Security: verify the player is a participant
        if (playerLower !== game.player_white && playerLower !== game.player_black) {
            return res.status(403).json({ error: 'Not a player in this game' });
        }
        // Verify it's the correct player's turn
        const isWhiteTurn = chess.turn() === 'w';
        if (isWhiteTurn && playerLower !== game.player_white) {
            return res.status(400).json({ error: 'Not your turn' });
        }
        if (!isWhiteTurn && playerLower !== game.player_black) {
            return res.status(400).json({ error: 'Not your turn' });
        }
        // Validate move
        let validMove;
        try {
            validMove = chess.move({
                from: String(move.from),
                to: String(move.to),
                promotion: move.promotion ? String(move.promotion) : undefined,
            });
        }
        catch (e) {
            return res.status(400).json({ error: 'Invalid move' });
        }
        const movesArr = game.moves ? game.moves.split(',') : [];
        movesArr.push(validMove.san);
        // Check if game is over
        if (chess.isGameOver()) {
            let result;
            if (chess.isCheckmate()) {
                result = isWhiteTurn ? 1 : 2;
            }
            else {
                result = 0;
            }
            db_1.pvpGameStmts.updateFen.run(chess.fen(), movesArr.join(','), gameId);
            db_1.pvpGameStmts.finish.run(result, gameId);
            const opponent = playerLower === game.player_white ? game.player_black : game.player_white;
            notifyPlayer(opponent, { type: 'pvp_move', gameId, move: validMove.san, fen: chess.fen(), gameOver: true, result });
            try {
                const txHash = await (0, blockchain_1.submitPvPGameResult)(gameId, result);
                return res.json({ ok: true, gameOver: true, result, move: validMove.san, fen: chess.fen(), txHash });
            }
            catch (txErr) {
                console.error('Failed to submit PvP result:', txErr);
                return res.json({ ok: true, gameOver: true, result, move: validMove.san, fen: chess.fen(), txError: 'Submission pending' });
            }
        }
        db_1.pvpGameStmts.updateFen.run(chess.fen(), movesArr.join(','), gameId);
        const opponent = playerLower === game.player_white ? game.player_black : game.player_white;
        notifyPlayer(opponent, { type: 'pvp_move', gameId, move: validMove.san, fen: chess.fen(), gameOver: false });
        res.json({ ok: true, gameOver: false, move: validMove.san, fen: chess.fen() });
    }
    catch (err) {
        console.error('PvP move error:', err);
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/pvp/draw', async (req, res) => {
    try {
        const { gameId, player } = req.body;
        if (!isValidGameId(gameId) || !isValidAddress(player)) {
            return res.status(400).json({ error: 'Invalid input' });
        }
        const game = db_1.pvpGameStmts.get.get(gameId);
        if (!game || game.status !== 'active')
            return res.status(400).json({ error: 'Game not active' });
        const playerLower = player.toLowerCase();
        // Security: verify the player is a participant
        if (playerLower !== game.player_white && playerLower !== game.player_black) {
            return res.status(403).json({ error: 'Not a player in this game' });
        }
        const opponent = playerLower === game.player_white ? game.player_black : game.player_white;
        notifyPlayer(opponent, { type: 'pvp_draw_offer', gameId, from: player });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.post('/api/pvp/accept-draw', async (req, res) => {
    try {
        const { gameId, player } = req.body;
        if (!isValidGameId(gameId))
            return res.status(400).json({ error: 'Invalid input' });
        const game = db_1.pvpGameStmts.get.get(gameId);
        if (!game || game.status !== 'active')
            return res.status(400).json({ error: 'Game not active' });
        // Security: verify the acceptor is a participant
        if (player && isValidAddress(player)) {
            const playerLower = player.toLowerCase();
            if (playerLower !== game.player_white && playerLower !== game.player_black) {
                return res.status(403).json({ error: 'Not a player in this game' });
            }
        }
        db_1.pvpGameStmts.finish.run(0, gameId);
        notifyPlayer(game.player_white, { type: 'pvp_draw_accepted', gameId });
        if (game.player_black) {
            notifyPlayer(game.player_black, { type: 'pvp_draw_accepted', gameId });
        }
        try {
            const txHash = await (0, blockchain_1.submitPvPGameResult)(gameId, 0);
            res.json({ ok: true, result: 0, txHash });
        }
        catch (txErr) {
            res.json({ ok: true, result: 0, txError: 'Submission pending' });
        }
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
// ═══════════════════════════════════════════════════════════════
// Game State Endpoints
// ═══════════════════════════════════════════════════════════════
app.get('/api/game/ai/:gameId', async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        if (!isValidGameId(gameId))
            return res.status(400).json({ error: 'Invalid game ID' });
        const local = db_1.aiGameStmts.get.get(gameId);
        const onChain = await (0, blockchain_1.getAIGame)(gameId);
        res.json({ local, onChain });
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.get('/api/game/pvp/:gameId', async (req, res) => {
    try {
        const gameId = parseInt(req.params.gameId);
        if (!isValidGameId(gameId))
            return res.status(400).json({ error: 'Invalid game ID' });
        const local = db_1.pvpGameStmts.get.get(gameId);
        const onChain = await (0, blockchain_1.getPvPGame)(gameId);
        res.json({ local, onChain });
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
// ═══════════════════════════════════════════════════════════════
// Blockchain Read Endpoints
// ═══════════════════════════════════════════════════════════════
app.get('/api/player/:address', async (req, res) => {
    try {
        if (!isValidAddress(req.params.address))
            return res.status(400).json({ error: 'Invalid address' });
        const info = await (0, blockchain_1.getPlayerInfo)(req.params.address);
        const energy = await (0, blockchain_1.getEnergyView)(req.params.address);
        const active = await (0, blockchain_1.getActiveGame)(req.params.address);
        const pending = await (0, blockchain_1.getPendingWithdrawals)(req.params.address);
        res.json({ ...info, currentEnergy: energy, activeGame: active, pendingWithdrawals: pending });
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.get('/api/prize-pool', async (req, res) => {
    try {
        const pool = await (0, blockchain_1.getTotalPrizePool)();
        res.json({ totalPrizePool: pool });
    }
    catch (err) {
        res.status(500).json({ error: sanitizeError(err) });
    }
});
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});
// ═══════════════════════════════════════════════════════════════
// Start Server
// ═══════════════════════════════════════════════════════════════
server.listen(PORT, () => {
    console.log(`Oracle server running on port ${PORT}`);
});
