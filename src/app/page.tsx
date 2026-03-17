'use client';

import Navbar from '@/components/Navbar';
import { useAccount, useReadContract } from 'wagmi';
import Link from 'next/link';
import { CHESS_CONTRACT_ADDRESS, CHESS_ABI } from '@/lib/contracts';

export default function Home() {
  const { isConnected, address } = useAccount();

  const { data: activeGame } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'getActiveGame',
    args: address ? [address] : undefined,
  });

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-7xl mx-auto px-6 py-12">
        <div className="text-center mb-16">
          <h1 className="text-5xl font-bold mb-4">♟ Chess on Base</h1>
          <p className="text-xl text-slate-400 mb-8">
            Play chess against AI or other players. Stake ETH. Win rewards.
          </p>
          {!isConnected && (
            <p className="text-slate-500">Connect your wallet to get started</p>
          )}
        </div>

        {isConnected && activeGame && activeGame[0] && (
          <div className="mb-8">
            <Link href={Number(activeGame[1]) === 1 ? '/ai' : '/pvp'} className="block card border-yellow-500 hover:border-yellow-400 transition-colors cursor-pointer text-center">
              <p className="text-2xl font-bold mb-2">🎮 You have an active game!</p>
              <p className="text-slate-400">
                {Number(activeGame[1]) === 1 ? 'AI' : 'PvP'} Game #{activeGame[2]?.toString()}
              </p>
              <p className="text-yellow-400 font-semibold mt-2">Click to return to game →</p>
            </Link>
          </div>
        )}

        {isConnected && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <Link href="/ai" className="card hover:border-primary transition-colors cursor-pointer">
              <h2 className="text-2xl font-bold mb-3">🤖 Play vs AI</h2>
              <p className="text-slate-400">
                Challenge AI at 10 difficulty levels. Use energy for free games or stake ETH for paid games.
                Complete levels to earn bonuses!
              </p>
            </Link>

            <Link href="/pvp" className="card hover:border-primary transition-colors cursor-pointer">
              <h2 className="text-2xl font-bold mb-3">⚔️ Play PvP</h2>
              <p className="text-slate-400">
                Challenge other players. Create open games or invite by nickname.
                Stake ETH or play with energy.
              </p>
            </Link>

            <Link href="/wallet" className="card hover:border-primary transition-colors cursor-pointer">
              <h2 className="text-2xl font-bold mb-3">💰 Wallet</h2>
              <p className="text-slate-400">
                Claim your winnings, withdraw internal balance, and manage your ETH.
              </p>
            </Link>
          </div>
        )}

        <div className="mt-16 card">
          <h2 className="text-2xl font-bold mb-4">How It Works</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-slate-400">
            <div>
              <h3 className="text-white font-semibold mb-2">⚡ Energy System</h3>
              <p>You get 6 energy. Each game costs 1 energy. Energy refills 1 unit every 4 hours. Play free games with energy!</p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-2">💵 Paid Games</h3>
              <p>AI: Stake level × 0.001 ETH. PvP: Stake 0.0001–50 ETH. 2% commission on wins.</p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-2">🏆 AI Levels</h3>
              <p>10 difficulty levels. Complete each for the first time to earn bonus = level × 0.001 ETH to your internal balance.</p>
            </div>
            <div>
              <h3 className="text-white font-semibold mb-2">🔗 On-Chain</h3>
              <p>All games are verified on Base network. Results are signed by the oracle and submitted on-chain.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
