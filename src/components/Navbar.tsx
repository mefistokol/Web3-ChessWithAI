'use client';

import { ConnectButton } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useAccount } from 'wagmi';

export default function Navbar() {
  const { isConnected } = useAccount();

  return (
    <nav className="bg-slate-900 border-b border-slate-700 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-white flex items-center gap-2">
          ♟ Chess on Base
        </Link>
        <div className="flex items-center gap-6">
          {isConnected && (
            <>
              <Link href="/profile" className="text-slate-300 hover:text-white transition-colors">Profile</Link>
              <Link href="/ai" className="text-slate-300 hover:text-white transition-colors">vs AI</Link>
              <Link href="/pvp" className="text-slate-300 hover:text-white transition-colors">PvP</Link>
              <Link href="/wallet" className="text-slate-300 hover:text-white transition-colors">Wallet</Link>
            </>
          )}
          <ConnectButton />
        </div>
      </div>
    </nav>
  );
}
