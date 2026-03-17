'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useBalance } from 'wagmi';
import { CHESS_CONTRACT_ADDRESS, CHESS_ABI, ORACLE_API, LEVEL_PRICE_UNIT } from '@/lib/contracts';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import toast from 'react-hot-toast';

export default function AIPage() {
  const { address } = useAccount();
  const [game, setGame] = useState(new Chess());
  const [gameId, setGameId] = useState<number | null>(null);
  const [selectedLevel, setSelectedLevel] = useState(1);
  const [useEnergy, setUseEnergy] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [gameResult, setGameResult] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: energy } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'getEnergyView',
    args: address ? [address] : undefined,
  });

  const { data: playerData } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'players',
    args: address ? [address] : undefined,
  });

  const { data: activeGameData } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'getActiveGame',
    args: address ? [address] : undefined,
  });

  // Read on-chain AI game data (for level info)
  const activeGameId = activeGameData?.[0] && Number(activeGameData[1]) === 1 ? Number(activeGameData[2]) : null;
  const { data: aiGameOnChain } = useReadContract({
    address: CHESS_CONTRACT_ADDRESS,
    abi: CHESS_ABI,
    functionName: 'aiGames',
    args: activeGameId ? [BigInt(activeGameId)] : undefined,
  });

  const isRegistered = playerData?.[5];
  const levelsCompleted = Number(playerData?.[3] || 0);
  const restoredRef = useRef(false);

  // Auto-restore game state on page load / refresh
  useEffect(() => {
    if (restoredRef.current) return;
    if (!activeGameData) return;
    const hasActive = activeGameData[0];
    const gameType = Number(activeGameData[1]);
    const gId = Number(activeGameData[2]);
    if (hasActive && gameType === 1 && gId > 0) {
      // Wait for on-chain game data to load before restoring
      if (!aiGameOnChain) return;
      restoredRef.current = true;
      const onChainLevel = Number(aiGameOnChain[1]) || 1;
      (async () => {
        try {
          // Try to get state from oracle
          const res = await fetch(`${ORACLE_API}/api/ai/state/${gId}`);
          const data = await res.json();
          if (data.ok && data.fen) {
            setGameId(gId);
            setGame(new Chess(data.fen));
            setSelectedLevel(data.level || onChainLevel);
            setIsPlaying(true);
            setGameResult(null);
          } else {
            // Oracle doesn't have the game, register it and start fresh
            await fetch(`${ORACLE_API}/api/ai/register`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ gameId: gId, player: address, level: onChainLevel }),
            });
            setGameId(gId);
            setGame(new Chess());
            setSelectedLevel(onChainLevel);
            setIsPlaying(true);
            setGameResult(null);
          }
        } catch (e) {
          console.error('Failed to restore game state:', e);
          // Fallback: if oracle is unreachable, use on-chain data
          setGameId(gId);
          setGame(new Chess());
          setSelectedLevel(onChainLevel);
          setIsPlaying(true);
          setGameResult(null);
        } finally {
          setIsRestoring(false);
        }
      })();
    } else {
      restoredRef.current = true;
      setIsRestoring(false);
    }
  }, [activeGameData, aiGameOnChain]);

  const isLevelAvailable = (level: number) => {
    if (level === 1) return true;
    return (levelsCompleted & (1 << (level - 2))) !== 0;
  };

  const costWei = BigInt(selectedLevel) * LEVEL_PRICE_UNIT;
  const costDisplay = (selectedLevel * 0.001).toFixed(3);

  const startGame = () => {
    writeContract({
      address: CHESS_CONTRACT_ADDRESS,
      abi: CHESS_ABI,
      functionName: 'startAIGame',
      args: [selectedLevel, useEnergy],
      value: useEnergy ? BigInt(0) : costWei,
    }, {
      onSuccess: async (hash) => {
        toast.success('Game started on-chain!');
        setTimeout(async () => {
          try {
            const res = await fetch(`${ORACLE_API}/api/player/${address}`);
            const data = await res.json();
            if (data.activeGame?.hasActive && data.activeGame.gameType === 1) {
              const gId = data.activeGame.gameId;
              setGameId(gId);
              await fetch(`${ORACLE_API}/api/ai/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ gameId: gId, player: address, level: selectedLevel }),
              });
              setIsPlaying(true);
              setGame(new Chess());
              setGameResult(null);
            }
          } catch (e) {
            console.error('Failed to register game with oracle:', e);
          }
        }, 5000);
      },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  const onDrop = useCallback((sourceSquare: string, targetSquare: string): boolean => {
    if (!isPlaying || isThinking || !gameId) return false;

    const move = { from: sourceSquare, to: targetSquare, promotion: 'q' };
    const gameCopy = new Chess(game.fen());
    try { gameCopy.move(move); } catch { return false; }

    setGame(gameCopy);
    setIsThinking(true);

    (async () => {
      try {
        const res = await fetch(`${ORACLE_API}/api/ai/move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gameId, move, player: address }),
        });
        const data = await res.json();

        if (!data.ok) {
          toast.error(data.error || 'Invalid move');
          setGame(new Chess(game.fen()));
          setIsThinking(false);
          return;
        }

        const newGame = new Chess(data.fen || gameCopy.fen());
        setGame(newGame);

        if (data.gameOver) {
          setIsPlaying(false);
          const results: Record<number, string> = { 0: 'Draw!', 1: 'You Win! 🎉', 2: 'AI Wins 🤖' };
          setGameResult(results[data.result] || 'Game Over');
          toast.success(results[data.result] || 'Game Over');
        }
      } catch (err) {
        toast.error('Failed to communicate with oracle');
      }
      setIsThinking(false);
    })();

    return true;
  }, [game, gameId, isPlaying, isThinking, address]);

  const handleResign = () => {
    if (!gameId) return;
    writeContract({
      address: CHESS_CONTRACT_ADDRESS,
      abi: CHESS_ABI,
      functionName: 'resignAIGame',
      args: [BigInt(gameId)],
    }, {
      onSuccess: () => { toast.success('Resigned'); setIsPlaying(false); setGameResult('You resigned'); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  const handleClaimTimeout = () => {
    if (!gameId) return;
    writeContract({
      address: CHESS_CONTRACT_ADDRESS,
      abi: CHESS_ABI,
      functionName: 'claimTimeoutAIGame',
      args: [BigInt(gameId)],
    }, {
      onSuccess: () => { toast.success('Timeout claimed!'); setIsPlaying(false); setGameResult('Timeout claimed'); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  if (!address) return (
    <div className="min-h-screen"><Navbar /><main className="max-w-4xl mx-auto px-6 py-12"><p className="text-center text-slate-400">Connect wallet</p></main></div>
  );

  if (!isRegistered) return (
    <div className="min-h-screen"><Navbar /><main className="max-w-4xl mx-auto px-6 py-12"><p className="text-center text-slate-400">Please register first in Profile</p></main></div>
  );

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">Play vs AI</h1>

        {isRestoring && (
          <div className="card max-w-lg"><p className="text-slate-400 animate-pulse">Loading game state...</p></div>
        )}

        {!isRestoring && !isPlaying && !gameResult && (
          <div className="card max-w-lg">
            <h2 className="text-xl font-bold mb-4">Start New Game</h2>

            <div className="mb-4">
              <label className="text-slate-400 text-sm block mb-2">Select Level (1-10)</label>
              <div className="flex gap-2 flex-wrap">
                {Array.from({ length: 10 }).map((_, i) => {
                  const lvl = i + 1;
                  const available = isLevelAvailable(lvl);
                  return (
                    <button
                      key={lvl}
                      className={`w-10 h-10 rounded-lg font-bold ${selectedLevel === lvl ? 'bg-primary text-white' : available ? 'bg-slate-700 hover:bg-slate-600' : 'bg-slate-800 text-slate-600 cursor-not-allowed'}`}
                      onClick={() => available && setSelectedLevel(lvl)}
                      disabled={!available}
                    >
                      {lvl}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="mb-6">
              <label className="text-slate-400 text-sm block mb-2">Game Type</label>
              <div className="flex gap-4">
                <button
                  className={`px-4 py-2 rounded-lg ${useEnergy ? 'bg-yellow-600' : 'bg-slate-700'}`}
                  onClick={() => setUseEnergy(true)}
                >
                  ⚡ Energy ({energy?.toString() || 0}/6)
                </button>
                <button
                  className={`px-4 py-2 rounded-lg ${!useEnergy ? 'bg-green-600' : 'bg-slate-700'}`}
                  onClick={() => setUseEnergy(false)}
                >
                  💵 Paid ({costDisplay} ETH)
                </button>
              </div>
            </div>

            <div className="flex gap-4">
              <button
                className="btn-primary flex-1"
                onClick={startGame}
                disabled={isPending || isConfirming || (activeGameData?.[0] === true)}
              >
                {isPending || isConfirming ? 'Processing...' : activeGameData?.[0] ? 'You have an active game' : `Start Level ${selectedLevel}`}
              </button>
              {activeGameData?.[0] && Number(activeGameData[1]) === 1 && (
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    const gId = Number(activeGameData[2]);
                    const onChainLevel = aiGameOnChain ? Number(aiGameOnChain[1]) : 1;
                    setGameId(gId);
                    try {
                      const res = await fetch(`${ORACLE_API}/api/ai/state/${gId}`);
                      const data = await res.json();
                      if (data.ok && data.fen) {
                        setGame(new Chess(data.fen));
                        setSelectedLevel(data.level || onChainLevel);
                      } else {
                        // Register with oracle and start fresh
                        await fetch(`${ORACLE_API}/api/ai/register`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ gameId: gId, player: address, level: onChainLevel }),
                        });
                        setGame(new Chess());
                        setSelectedLevel(onChainLevel);
                      }
                    } catch {
                      setGame(new Chess());
                      setSelectedLevel(onChainLevel);
                    }
                    setIsPlaying(true);
                    setGameResult(null);
                  }}
                >
                  🎮 Return to Game
                </button>
              )}
            </div>
          </div>
        )}

        {(isPlaying || gameResult) && (
          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-shrink-0">
              <Chessboard
                position={game.fen()}
                onPieceDrop={onDrop}
                boardWidth={480}
                arePiecesDraggable={isPlaying && !isThinking}
              />
            </div>
            <div className="flex-1 space-y-4">
              <div className="card">
                <p className="text-slate-400">Level: <span className="text-white font-bold">{selectedLevel}</span></p>
                <p className="text-slate-400">Game ID: <span className="text-white font-bold">{gameId}</span></p>
                <p className="text-slate-400">Turn: <span className="text-white font-bold">{game.turn() === 'w' ? 'White (You)' : 'Black (AI)'}</span></p>
                {isThinking && <p className="text-yellow-400 animate-pulse">🤔 AI is thinking...</p>}
                {gameResult && <p className="text-2xl font-bold mt-4">{gameResult}</p>}
              </div>

              {isPlaying && (
                <div className="flex gap-4">
                  <button className="btn-danger" onClick={handleResign} disabled={isPending}>Resign</button>
                  <button className="btn-secondary" onClick={handleClaimTimeout} disabled={isPending}>Claim Timeout (48h)</button>
                </div>
              )}

              {gameResult && (
                <button className="btn-primary" onClick={() => { setGameResult(null); setGameId(null); }}>
                  New Game
                </button>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
