"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initEngine = initEngine;
exports.getBestMove = getBestMove;
const child_process_1 = require("child_process");
let stockfishProcess = null;
let depth = 15;
// Map AI level (1-10) to Stockfish skill level (0-20) and depth
function levelToConfig(level) {
    // Level 1 = very easy, Level 10 = maximum
    const configs = {
        1: { skill: 0, searchDepth: 5 },
        2: { skill: 2, searchDepth: 6 },
        3: { skill: 4, searchDepth: 8 },
        4: { skill: 6, searchDepth: 10 },
        5: { skill: 8, searchDepth: 12 },
        6: { skill: 10, searchDepth: 14 },
        7: { skill: 12, searchDepth: 16 },
        8: { skill: 15, searchDepth: 18 },
        9: { skill: 18, searchDepth: 20 },
        10: { skill: 20, searchDepth: 22 },
    };
    return configs[level] || configs[5];
}
function initEngine(configDepth) {
    if (configDepth)
        depth = configDepth;
}
function getBestMove(fen, level) {
    return new Promise((resolve, reject) => {
        const config = levelToConfig(level);
        const stockfishPath = process.env.STOCKFISH_PATH || (process.platform === 'win32' ? 'stockfish.exe' : 'stockfish');
        const sf = (0, child_process_1.spawn)(stockfishPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
        let output = '';
        let resolved = false;
        sf.stdout.on('data', (data) => {
            output += data.toString();
            const lines = output.split('\n');
            for (const line of lines) {
                if (line.startsWith('bestmove')) {
                    const parts = line.split(' ');
                    if (!resolved) {
                        resolved = true;
                        sf.kill();
                        resolve(parts[1]);
                    }
                    return;
                }
            }
        });
        sf.stderr.on('data', (data) => {
            console.error('Stockfish stderr:', data.toString());
        });
        sf.on('error', (err) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Stockfish process error: ${err.message}`));
            }
        });
        sf.on('close', (code) => {
            if (!resolved) {
                resolved = true;
                reject(new Error(`Stockfish exited with code ${code}`));
            }
        });
        // Send UCI commands
        sf.stdin.write('uci\n');
        sf.stdin.write(`setoption name Skill Level value ${config.skill}\n`);
        sf.stdin.write('isready\n');
        sf.stdin.write(`position fen ${fen}\n`);
        sf.stdin.write(`go depth ${config.searchDepth}\n`);
        // Timeout after 30 seconds
        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                sf.kill();
                reject(new Error('Stockfish timeout'));
            }
        }, 30000);
    });
}
