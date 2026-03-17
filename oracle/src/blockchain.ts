import { ethers } from 'ethers';
import { signAIGameResult, signPvPGameResult } from './signer';

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

let provider: ethers.JsonRpcProvider;
let contract: ethers.Contract;
let oracleWallet: ethers.Wallet;

export function initBlockchain(rpcUrl: string, privateKey: string, contractAddress: string) {
  provider = new ethers.JsonRpcProvider(rpcUrl);
  oracleWallet = new ethers.Wallet(privateKey, provider);
  contract = new ethers.Contract(contractAddress, CONTRACT_ABI, oracleWallet);
  console.log(`Blockchain initialized. Oracle: ${oracleWallet.address}`);
}

export async function submitAIGameResult(gameId: number, result: number): Promise<string> {
  const signature = await signAIGameResult(gameId, result);
  const tx = await contract.finishAIGame(gameId, result, signature);
  const receipt = await tx.wait();
  console.log(`AI game ${gameId} finished with result ${result}. TX: ${receipt.hash}`);
  return receipt.hash;
}

export async function submitPvPGameResult(gameId: number, result: number): Promise<string> {
  const signature = await signPvPGameResult(gameId, result);
  const tx = await contract.finishPvPGame(gameId, result, signature);
  const receipt = await tx.wait();
  console.log(`PvP game ${gameId} finished with result ${result}. TX: ${receipt.hash}`);
  return receipt.hash;
}

export async function getAIGame(gameId: number) {
  const g = await contract.aiGames(gameId);
  return { player: g[0], level: Number(g[1]), result: Number(g[2]), finished: g[3], paidAmount: g[4].toString(), startTime: Number(g[5]) };
}

export async function getPvPGame(gameId: number) {
  const g = await contract.pvpGames(gameId);
  return { playerWhite: g[0], isEnergy: g[1], status: Number(g[2]), playerBlack: g[3], winner: g[4], stake: g[5].toString(), startTime: Number(g[6]) };
}

export async function getPlayerInfo(address: string) {
  const p = await contract.players(address);
  return { nickname: p[0], internalBalance: p[1].toString(), lastEnergyRefill: Number(p[2]), aiLevelsCompleted: Number(p[3]), energy: Number(p[4]), registered: p[5] };
}

export async function getActiveGame(address: string) {
  const g = await contract.getActiveGame(address);
  return { hasActive: g[0], gameType: Number(g[1]), gameId: Number(g[2]) };
}

export async function getEnergyView(address: string): Promise<number> {
  return Number(await contract.getEnergyView(address));
}

export async function getTotalPrizePool(): Promise<string> {
  return (await contract.totalPrizePool()).toString();
}

export async function getPendingWithdrawals(address: string): Promise<string> {
  return (await contract.pendingWithdrawals(address)).toString();
}

export { contract, provider };
