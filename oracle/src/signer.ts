import { ethers } from 'ethers';

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

let wallet: ethers.Wallet;
let domain: ethers.TypedDataDomain;

export function initSigner(privateKey: string) {
  wallet = new ethers.Wallet(privateKey);

  // Build domain after env is loaded
  domain = {
    name: 'ChessGameWithAI',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: process.env.CONTRACT_ADDRESS!,
  };

  console.log(`Oracle signer initialized: ${wallet.address}`);
}

export async function signAIGameResult(gameId: number, result: number): Promise<string> {
  if (!wallet) throw new Error('Signer not initialized');
  const value = { gameId, result };
  return wallet.signTypedData(domain, AI_GAME_RESULT_TYPES, value);
}

export async function signPvPGameResult(gameId: number, result: number): Promise<string> {
  if (!wallet) throw new Error('Signer not initialized');
  const value = { gameId, result };
  return wallet.signTypedData(domain, PVP_GAME_RESULT_TYPES, value);
}

export function getOracleAddress(): string {
  if (!wallet) throw new Error('Signer not initialized');
  return wallet.address;
}
