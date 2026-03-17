'use client';

import { useState } from 'react';
import Navbar from '@/components/Navbar';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { CHESS_CONTRACT_ADDRESS, CHESS_ABI, formatETH, parseETH } from '@/lib/contracts';
import toast from 'react-hot-toast';

export default function WalletPage() {
  const { address } = useAccount();
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: playerData, refetch: refetchPlayer } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'players', args: address ? [address] : undefined,
  });

  const { data: pending, refetch: refetchPending } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'pendingWithdrawals', args: address ? [address] : undefined,
  });

  const { data: ethBalance } = useBalance({ address });

  const { data: prizePool } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'totalPrizePool',
  });

  const internalBalance = playerData?.[1];
  const pendingAmount = pending;

  const handleClaim = () => {
    writeContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'claim' }, {
      onSuccess: () => { toast.success('Claim submitted!'); setTimeout(() => { refetchPending(); }, 5000); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  const handleWithdrawInternal = () => {
    const amount = parseETH(withdrawAmount);
    if (amount <= BigInt(0)) return toast.error('Enter valid amount');
    writeContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'withdrawInternalBalance', args: [amount] }, {
      onSuccess: () => { toast.success('Withdrawal submitted!'); setWithdrawAmount(''); setTimeout(() => { refetchPlayer(); refetchPending(); }, 5000); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  if (!address) return (<div className="min-h-screen"><Navbar /><main className="max-w-4xl mx-auto px-6 py-12"><p className="text-center text-slate-400">Connect wallet</p></main></div>);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">💰 Wallet</h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="card">
            <p className="text-slate-400 text-sm">ETH Balance</p>
            <p className="text-2xl font-bold">{ethBalance ? parseFloat(ethBalance.formatted).toFixed(6) : '0.000000'} ETH</p>
          </div>
          <div className="card">
            <p className="text-slate-400 text-sm">Total Prize Pool</p>
            <p className="text-2xl font-bold">{formatETH(prizePool as bigint | undefined)} ETH</p>
          </div>
        </div>

        <div className="card mb-6">
          <h2 className="text-xl font-bold mb-4">Pending Withdrawals</h2>
          <p className="text-slate-400 mb-2">Winnings, refunds, and commissions credited to you</p>
          <p className="text-3xl font-bold mb-4">{formatETH(pendingAmount as bigint | undefined)} ETH</p>
          <button className="btn-primary" onClick={handleClaim} disabled={isPending || isConfirming || !pendingAmount || Number(pendingAmount) === 0}>
            {isPending || isConfirming ? 'Processing...' : 'Claim ETH'}
          </button>
        </div>

        <div className="card">
          <h2 className="text-xl font-bold mb-4">Internal Balance</h2>
          <p className="text-slate-400 mb-2">Bonuses earned from first-time AI level completions. Withdraw from prize pool.</p>
          <p className="text-3xl font-bold mb-4">{formatETH(internalBalance as bigint | undefined)} ETH</p>
          <div className="flex gap-4">
            <input className="input flex-1" type="number" step="0.000001" placeholder="Amount in ETH" value={withdrawAmount} onChange={(e) => setWithdrawAmount(e.target.value)} />
            <button className="btn-secondary" onClick={handleWithdrawInternal} disabled={isPending || isConfirming || !withdrawAmount}>
              {isPending || isConfirming ? 'Processing...' : 'Withdraw'}
            </button>
          </div>
          <p className="text-slate-500 text-sm mt-2">Withdrawn amount is credited to pending withdrawals. Use Claim to receive ETH.</p>
        </div>
      </main>
    </div>
  );
}
