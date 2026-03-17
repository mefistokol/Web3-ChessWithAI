"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.provider = exports.contract = void 0;
exports.initBlockchain = initBlockchain;
exports.submitAIGameResult = submitAIGameResult;
exports.submitPvPGameResult = submitPvPGameResult;
exports.getAIGame = getAIGame;
exports.getPvPGame = getPvPGame;
exports.getPlayerInfo = getPlayerInfo;
exports.getActiveGame = getActiveGame;
exports.getEnergyView = getEnergyView;
exports.getTotalPrizePool = getTotalPrizePool;
exports.getPendingWithdrawals = getPendingWithdrawals;
const ethers_1 = require("ethers");
const signer_1 = require("./signer");
const CONTRACT_ABI = [
    'function finishAIGame(uint256 gameId, uint8 result, bytes signature) external',
    'function finishPvPGame(uint256 gameId, uint8 result, bytes signature) external',
    'function aiGames(uint256) view returns (address player, uint8 level, uint8 result, bool finished, uint256 paidAmount, uint256 startTime)',
    'function pvpGames(uint256) view returns (address playerWhite, bool isEnergy, uint8 status, address playerBlack, address winner, uint256 stake, uint256 startTime)',
    'function aiGameCounter() view returns (uint256)',
    'function pvpGameCounter() view returns (uint256)',
    'function players(address) view returns (string nickname, uint256 internalBalance, uint256 lastEnergyRefill, uint16 aiLevelsCompleted, uint8 energy, bool registered)',
    'function getActiveGame(address) view returns (bool hasActive, uint8 gameType, uint256 gameId)',
    'function getEnergyView(address) view returns (uint8)',
    'function totalPrizePool() view returns (uint256)',
    'function pendingWithdrawals(address) view returns (uint256)',
];
let provider;
let contract;
let oracleWallet;
function initBlockchain(rpcUrl, privateKey, contractAddress) {
    exports.provider = provider = new ethers_1.ethers.JsonRpcProvider(rpcUrl);
    oracleWallet = new ethers_1.ethers.Wallet(privateKey, provider);
    exports.contract = contract = new ethers_1.ethers.Contract(contractAddress, CONTRACT_ABI, oracleWallet);
    console.log(`Blockchain initialized. Oracle: ${oracleWallet.address}`);
}
async function submitAIGameResult(gameId, result) {
    const signature = await (0, signer_1.signAIGameResult)(gameId, result);
    const tx = await contract.finishAIGame(gameId, result, signature);
    const receipt = await tx.wait();
    console.log(`AI game ${gameId} finished with result ${result}. TX: ${receipt.hash}`);
    return receipt.hash;
}
async function submitPvPGameResult(gameId, result) {
    const signature = await (0, signer_1.signPvPGameResult)(gameId, result);
    const tx = await contract.finishPvPGame(gameId, result, signature);
    const receipt = await tx.wait();
    console.log(`PvP game ${gameId} finished with result ${result}. TX: ${receipt.hash}`);
    return receipt.hash;
}
async function getAIGame(gameId) {
    const g = await contract.aiGames(gameId);
    return { player: g[0], level: Number(g[1]), result: Number(g[2]), finished: g[3], paidAmount: g[4].toString(), startTime: Number(g[5]) };
}
async function getPvPGame(gameId) {
    const g = await contract.pvpGames(gameId);
    return { playerWhite: g[0], isEnergy: g[1], status: Number(g[2]), playerBlack: g[3], winner: g[4], stake: g[5].toString(), startTime: Number(g[6]) };
}
async function getPlayerInfo(address) {
    const p = await contract.players(address);
    return { nickname: p[0], internalBalance: p[1].toString(), lastEnergyRefill: Number(p[2]), aiLevelsCompleted: Number(p[3]), energy: Number(p[4]), registered: p[5] };
}
async function getActiveGame(address) {
    const g = await contract.getActiveGame(address);
    return { hasActive: g[0], gameType: Number(g[1]), gameId: Number(g[2]) };
}
async function getEnergyView(address) {
    return Number(await contract.getEnergyView(address));
}
async function getTotalPrizePool() {
    return (await contract.totalPrizePool()).toString();
}
async function getPendingWithdrawals(address) {
    return (await contract.pendingWithdrawals(address)).toString();
}
