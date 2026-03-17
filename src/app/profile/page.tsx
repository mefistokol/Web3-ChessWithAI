'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CHESS_CONTRACT_ADDRESS, CHESS_ABI } from '@/lib/contracts';
import toast from 'react-hot-toast';

export default function ProfilePage() {
  const { address } = useAccount();
  const [nickname, setNickname] = useState('');

  const { data: playerData, refetch: refetchPlayer } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'players',
    args: address ? [address] : undefined,
  });

  const { data: energy } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'getEnergyView',
    args: address ? [address] : undefined,
  });

  const { data: activeGame } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'getActiveGame',
    args: address ? [address] : undefined,
  });

  const { data: pending } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'pendingWithdrawals',
    args: address ? [address] : undefined,
  });

  const { writeContract, data: txHash, isPending } = useWriteContract();

  const { isLoading: isConfirming } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isRegistered = playerData?.[5];
  const playerNickname = playerData?.[0];
  const internalBalance = playerData?.[1];
  const levelsCompleted = playerData?.[3];

  const handleRegister = () => {
    if (!nickname.trim()) return toast.error('Enter a nickname');
    writeContract({
      address: CHESS_CONTRACT_ADDRESS,
      abi: CHESS_ABI,
      functionName: 'registerNickname',
      args: [nickname],
    }, {
      onSuccess: () => {
        toast.success('Registration submitted!');
        setTimeout(() => refetchPlayer(), 5000);
      },
      onError: (err) => toast.error(err.message.slice(0, 100)),
    });
  };


  const completedLevels: number[] = [];
  if (levelsCompleted) {
    for (let i = 0; i < 10; i++) {
      if ((Number(levelsCompleted) & (1 << i)) !== 0) completedLevels.push(i + 1);
    }
  }

  if (!address) return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <p className="text-center text-slate-400">Connect your wallet to view profile</p>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">Player Profile</h1>

        {!isRegistered ? (
          <div className="card">
            <h2 className="text-xl font-bold mb-4">Register</h2>
            <p className="text-slate-400 mb-4">Choose a unique nickname (max 32 characters)</p>
            <div className="flex gap-4">
              <input
                className="input flex-1"
                placeholder="Your nickname"
                maxLength={32}
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
              />
              <button className="btn-primary" onClick={handleRegister} disabled={isPending || isConfirming}>
                {isPending || isConfirming ? 'Registering...' : 'Register'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="card">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                <div>
                  <p className="text-slate-400 text-sm">Nickname</p>
                  <p className="text-xl font-bold">{playerNickname}</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Energy</p>
                  <p className="text-xl font-bold">⚡ {energy?.toString() || '0'} / 6</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Internal Balance</p>
                  <p className="text-xl font-bold">{internalBalance ? (Number(internalBalance) / 1e18).toFixed(6) : '0.000000'} ETH</p>
                </div>
                <div>
                  <p className="text-slate-400 text-sm">Pending Withdrawals</p>
                  <p className="text-xl font-bold">{pending ? (Number(pending) / 1e18).toFixed(6) : '0.000000'} ETH</p>
                </div>
              </div>
            </div>

            <div className="card">
              <h2 className="text-xl font-bold mb-4">Energy</h2>
              <div className="flex items-center gap-4">
                <div className="flex gap-1">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className={`w-8 h-8 rounded ${i < (Number(energy) || 0) ? 'bg-yellow-400' : 'bg-slate-700'}`} />
                  ))}
                </div>
              </div>
              <p className="text-slate-500 text-sm mt-2">Energy refills 1 unit every 4 hours automatically</p>
            </div>

            <div className="card">
              <h2 className="text-xl font-bold mb-4">AI Levels Completed</h2>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className={`w-12 h-12 rounded-lg flex items-center justify-center font-bold text-lg ${completedLevels.includes(i + 1) ? 'bg-green-600' : 'bg-slate-700'}`}>
                    {i + 1}
                  </div>
                ))}
              </div>
            </div>

            {activeGame && activeGame[0] && (
              <div className="card border-yellow-500">
                <h2 className="text-xl font-bold mb-2">Active Game</h2>
                <p>Type: {Number(activeGame[1]) === 1 ? 'AI' : 'PvP'} | Game ID: {activeGame[2]?.toString()}</p>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
