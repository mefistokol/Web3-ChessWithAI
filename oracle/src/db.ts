import Database from 'better-sqlite3';
import path from 'path';

const db = new Database(path.join(__dirname, '..', 'chess_oracle.db'));

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

export interface AIGameRow {
  game_id: number;
  player: string;
  level: number;
  fen: string;
  moves: string;
  status: string;
  result: number | null;
  created_at: number;
}

export interface PvPGameRow {
  game_id: number;
  player_white: string;
  player_black: string | null;
  fen: string;
  moves: string;
  status: string;
  result: number | null;
  created_at: number;
}

export const aiGameStmts = {
  insert: db.prepare(`INSERT INTO ai_games (game_id, player, level) VALUES (?, ?, ?)`),
  get: db.prepare(`SELECT * FROM ai_games WHERE game_id = ?`),
  updateFen: db.prepare(`UPDATE ai_games SET fen = ?, moves = ? WHERE game_id = ?`),
  finish: db.prepare(`UPDATE ai_games SET status = 'finished', result = ? WHERE game_id = ?`),
};

export const pvpGameStmts = {
  insert: db.prepare(`INSERT INTO pvp_games (game_id, player_white, player_black, status) VALUES (?, ?, ?, ?)`),
  get: db.prepare(`SELECT * FROM pvp_games WHERE game_id = ?`),
  updateFen: db.prepare(`UPDATE pvp_games SET fen = ?, moves = ? WHERE game_id = ?`),
  join: db.prepare(`UPDATE pvp_games SET player_black = ?, status = 'active' WHERE game_id = ?`),
  finish: db.prepare(`UPDATE pvp_games SET status = 'finished', result = ? WHERE game_id = ?`),
};

export default db;
