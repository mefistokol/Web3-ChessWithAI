"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvpGameStmts = exports.aiGameStmts = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const db = new better_sqlite3_1.default(path_1.default.join(__dirname, '..', 'chess_oracle.db'));
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_games (
    game_id INTEGER PRIMARY KEY,
    player TEXT NOT NULL,
    level INTEGER NOT NULL,
    fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active',
    result INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );

  CREATE TABLE IF NOT EXISTS pvp_games (
    game_id INTEGER PRIMARY KEY,
    player_white TEXT NOT NULL,
    player_black TEXT,
    fen TEXT NOT NULL DEFAULT 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
    moves TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'waiting',
    result INTEGER,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
  );
`);
exports.aiGameStmts = {
    insert: db.prepare(`INSERT INTO ai_games (game_id, player, level) VALUES (?, ?, ?)`),
    get: db.prepare(`SELECT * FROM ai_games WHERE game_id = ?`),
    updateFen: db.prepare(`UPDATE ai_games SET fen = ?, moves = ? WHERE game_id = ?`),
    finish: db.prepare(`UPDATE ai_games SET status = 'finished', result = ? WHERE game_id = ?`),
};
exports.pvpGameStmts = {
    insert: db.prepare(`INSERT INTO pvp_games (game_id, player_white, player_black, status) VALUES (?, ?, ?, ?)`),
    get: db.prepare(`SELECT * FROM pvp_games WHERE game_id = ?`),
    updateFen: db.prepare(`UPDATE pvp_games SET fen = ?, moves = ? WHERE game_id = ?`),
    join: db.prepare(`UPDATE pvp_games SET player_black = ?, status = 'active' WHERE game_id = ?`),
    finish: db.prepare(`UPDATE pvp_games SET status = 'finished', result = ? WHERE game_id = ?`),
};
exports.default = db;
