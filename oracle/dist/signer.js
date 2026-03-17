"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initSigner = initSigner;
exports.signAIGameResult = signAIGameResult;
exports.signPvPGameResult = signPvPGameResult;
exports.getOracleAddress = getOracleAddress;
const ethers_1 = require("ethers");
const CHAIN_ID = 8453; // Base mainnet
const AI_GAME_RESULT_TYPES = {
    AIGameResult: [
        { name: 'gameId', type: 'uint256' },
        { name: 'result', type: 'uint8' },
    ],
};
const PVP_GAME_RESULT_TYPES = {
    PvPGameResult: [
        { name: 'gameId', type: 'uint256' },
        { name: 'result', type: 'uint8' },
    ],
};
let wallet;
let domain;
function initSigner(privateKey) {
    wallet = new ethers_1.ethers.Wallet(privateKey);
    // Build domain after env is loaded
    domain = {
        name: 'ChessGameWithAI',
        version: '1',
        chainId: CHAIN_ID,
        verifyingContract: process.env.CONTRACT_ADDRESS,
    };
    console.log(`Oracle signer initialized: ${wallet.address}`);
}
async function signAIGameResult(gameId, result) {
    if (!wallet)
        throw new Error('Signer not initialized');
    const value = { gameId, result };
    return wallet.signTypedData(domain, AI_GAME_RESULT_TYPES, value);
}
async function signPvPGameResult(gameId, result) {
    if (!wallet)
        throw new Error('Signer not initialized');
    const value = { gameId, result };
    return wallet.signTypedData(domain, PVP_GAME_RESULT_TYPES, value);
}
function getOracleAddress() {
    if (!wallet)
        throw new Error('Signer not initialized');
    return wallet.address;
}
