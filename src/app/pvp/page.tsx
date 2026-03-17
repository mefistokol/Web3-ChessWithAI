'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Navbar from '@/components/Navbar';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { CHESS_CONTRACT_ADDRESS, CHESS_ABI, ORACLE_API, parseETH } from '@/lib/contracts';
import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import toast from 'react-hot-toast';

type Tab = 'create' | 'play';

export default function PvPPage() {
  const { address } = useAccount();
  const [tab, setTab] = useState<Tab>('create');
  const [game, setGame] = useState(new Chess());
  const [gameId, setGameId] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gameResult, setGameResult] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<'white' | 'black'>('white');

  const [opponentType, setOpponentType] = useState<'open' | 'address' | 'nickname'>('open');
  const [opponent, setOpponent] = useState('');
  const [useEnergy, setUseEnergy] = useState(true);
  const [stake, setStake] = useState('0.001');

  const wsRef = useRef<WebSocket | null>(null);

  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const { data: playerData } = useReadContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'players', args: address ? [address] : undefined });
  const { data: activeGameData } = useReadContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'getActiveGame', args: address ? [address] : undefined });
  const { data: energy } = useReadContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'getEnergyView', args: address ? [address] : undefined });

  const isRegistered = playerData?.[5];
  const [isRestoring, setIsRestoring] = useState(true);
  const restoredRef = useRef(false);

  // Auto-restore PvP game state on page load / refresh
  useEffect(() => {
    if (restoredRef.current) return;
    if (!activeGameData) return;
    const hasActive = activeGameData[0];
    const gameType = Number(activeGameData[1]);
    const gId = Number(activeGameData[2]);
    if (hasActive && gameType === 2 && gId > 0) {
      restoredRef.current = true;
      (async () => {
        try {
          const res = await fetch(`${ORACLE_API}/api/pvp/state/${gId}`);
          const data = await res.json();
          setGameId(gId);
          if (data.ok && data.fen) {
            setGame(new Chess(data.fen));
            setPlayerColor(data.color || 'white');
          } else {
            setGame(new Chess());
          }
          if (data.status === 'active') {
            setIsPlaying(true);
          }
          setTab('play');
          setGameResult(null);
        } catch (e) {
          console.error('Failed to restore PvP game state:', e);
          setGameId(gId);
          setGame(new Chess());
        } finally {
          setIsRestoring(false);
        }
      })();
    } else {
      restoredRef.current = true;
      setIsRestoring(false);
    }
  }, [activeGameData, address]);

  useEffect(() => {
    if (!isPlaying || !gameId || !address) return;
    const ws = new WebSocket(`${ORACLE_API.replace('http', 'ws')}/ws`);
    wsRef.current = ws;
    ws.onopen = () => { ws.send(JSON.stringify({ type: 'auth', address, gameId })); };
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'pvp_move') {
        setGame(new Chess(data.fen));
        if (data.gameOver) { setIsPlaying(false); setGameResult({ 0: 'Draw!', 1: 'White Wins!', 2: 'Black Wins!' }[data.result as number] || 'Game Over'); }
      } else if (data.type === 'pvp_joined') { toast.success('Opponent joined!'); }
      else if (data.type === 'pvp_draw_offer') { if (confirm('Opponent offers a draw. Accept?')) { fetch(`${ORACLE_API}/api/pvp/accept-draw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId }) }); } }
      else if (data.type === 'pvp_draw_accepted') { setIsPlaying(false); setGameResult('Draw by agreement'); }
    };
    return () => { ws.close(); };
  }, [isPlaying, gameId, address]);

  const handleCreateGame = () => {
    if (!address) return;
    const stakeAmount = useEnergy ? BigInt(0) : parseETH(stake);

    if (opponentType === 'nickname' && opponent) {
      writeContract({
        address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI,
        functionName: 'createPvPGameByNickname',
        args: [opponent, stakeAmount, useEnergy],
        value: stakeAmount,
      }, {
        onSuccess: () => { toast.success('PvP game created!'); setPlayerColor('white'); pollActiveGame(); },
        onError: (err: any) => toast.error(err.message.slice(0, 100)),
      });
    } else {
      const opponentAddr = opponentType === 'address' && opponent ? opponent as `0x${string}` : '0x0000000000000000000000000000000000000000' as `0x${string}`;
      writeContract({
        address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI,
        functionName: 'createPvPGameByAddress',
        args: [opponentAddr, stakeAmount, useEnergy],
        value: stakeAmount,
      }, {
        onSuccess: () => { toast.success('PvP game created!'); setPlayerColor('white'); pollActiveGame(); },
        onError: (err: any) => toast.error(err.message.slice(0, 100)),
      });
    }
  };

  const pollActiveGame = () => {
    setTimeout(async () => {
      try {
        const res = await fetch(`${ORACLE_API}/api/player/${address}`);
        const data = await res.json();
        if (data.activeGame?.hasActive && data.activeGame.gameType === 2) {
          const gId = data.activeGame.gameId;
          setGameId(gId);
          await fetch(`${ORACLE_API}/api/pvp/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: gId, playerWhite: address }) });
          setTab('play');
        }
      } catch (e) { console.error(e); }
    }, 5000);
  };

  const handleJoinGame = async (joinId: string) => {
    if (!joinId) return;
    try {
      // Read game data to determine stake amount
      const res = await fetch(`${ORACLE_API}/api/pvp/game/${joinId}`);
      const gameData = await res.json();
      const stakeValue = gameData?.isEnergy ? BigInt(0) : BigInt(gameData?.stake || '0');

      writeContract({
        address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI,
        functionName: 'joinPvPGame',
        args: [BigInt(joinId)],
        value: stakeValue,
      }, {
        onSuccess: async () => {
          toast.success('Joined game!');
          setGameId(Number(joinId)); setPlayerColor('black'); setIsPlaying(true); setGame(new Chess()); setTab('play');
          await fetch(`${ORACLE_API}/api/pvp/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId: Number(joinId), playerBlack: address }) });
        },
        onError: (err: any) => toast.error(err.message.slice(0, 100)),
      });
    } catch (err) {
      toast.error('Failed to read game data. Try again.');
    }
  };

  const handleCancelGame = () => {
    if (!gameId) return;
    writeContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'cancelPvPGame', args: [BigInt(gameId)] }, {
      onSuccess: () => { toast.success('Game cancelled'); setGameId(null); setTab('create'); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  const onDrop = useCallback((sourceSquare: string, targetSquare: string): boolean => {
    if (!isPlaying || !gameId || !address) return false;
    const isMyTurn = (game.turn() === 'w' && playerColor === 'white') || (game.turn() === 'b' && playerColor === 'black');
    if (!isMyTurn) { toast.error('Not your turn'); return false; }
    const move = { from: sourceSquare, to: targetSquare, promotion: 'q' };
    const gameCopy = new Chess(game.fen());
    try { gameCopy.move(move); } catch { return false; }
    setGame(gameCopy);
    (async () => {
      try {
        const res = await fetch(`${ORACLE_API}/api/pvp/move`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId, move, player: address }) });
        const data = await res.json();
        if (!data.ok) { toast.error(data.error); setGame(new Chess(game.fen())); return; }
        setGame(new Chess(data.fen));
        if (data.gameOver) { setIsPlaying(false); setGameResult({ 0: 'Draw!', 1: 'White Wins!', 2: 'Black Wins!' }[data.result as number] || 'Game Over'); }
      } catch { toast.error('Failed to send move'); }
    })();
    return true;
  }, [game, gameId, isPlaying, playerColor, address]);

  const handleResign = () => {
    if (!gameId) return;
    writeContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'resignPvPGame', args: [BigInt(gameId)] }, {
      onSuccess: () => { setIsPlaying(false); setGameResult('You resigned'); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  const handleOfferDraw = async () => {
    if (!gameId) return;
    await fetch(`${ORACLE_API}/api/pvp/draw`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ gameId, player: address }) });
    toast.success('Draw offer sent');
  };

  const handleClaimTimeout = () => {
    if (!gameId) return;
    writeContract({ address: CHESS_CONTRACT_ADDRESS, abi: CHESS_ABI, functionName: 'claimTimeoutPvPGame', args: [BigInt(gameId)] }, {
      onSuccess: () => { setIsPlaying(false); setGameResult('Timeout claimed'); },
      onError: (err: any) => toast.error(err.message.slice(0, 100)),
    });
  };

  if (!address) return (<div className="min-h-screen"><Navbar /><main className="max-w-4xl mx-auto px-6 py-12"><p className="text-center text-slate-400">Connect wallet</p></main></div>);
  if (!isRegistered) return (<div className="min-h-screen"><Navbar /><main className="max-w-4xl mx-auto px-6 py-12"><p className="text-center text-slate-400">Please register first in Profile</p></main></div>);

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold mb-8">PvP Chess</h1>

        {isRestoring && (
          <div className="card max-w-lg"><p className="text-slate-400 animate-pulse">Loading game state...</p></div>
        )}

        {!isRestoring && !isPlaying && !gameResult && (
          <>

            {tab === 'create' && (
              <div className="card max-w-lg">
                <h2 className="text-xl font-bold mb-4">Create PvP Game</h2>
                <div className="mb-4">
                  <label className="text-slate-400 text-sm block mb-2">Opponent</label>
                  <div className="flex gap-2 mb-2">
                    <button className={`px-3 py-1 rounded ${opponentType === 'open' ? 'bg-primary' : 'bg-slate-700'}`} onClick={() => setOpponentType('open')}>Open</button>
                    <button className={`px-3 py-1 rounded ${opponentType === 'address' ? 'bg-primary' : 'bg-slate-700'}`} onClick={() => setOpponentType('address')}>By Address</button>
                    <button className={`px-3 py-1 rounded ${opponentType === 'nickname' ? 'bg-primary' : 'bg-slate-700'}`} onClick={() => setOpponentType('nickname')}>By Nickname</button>
                  </div>
                  {opponentType !== 'open' && (<input className="input w-full" placeholder={opponentType === 'address' ? '0x...' : 'Nickname'} value={opponent} onChange={(e) => setOpponent(e.target.value)} />)}
                </div>
                <div className="mb-4">
                  <label className="text-slate-400 text-sm block mb-2">Game Type</label>
                  <div className="flex gap-4">
                    <button className={`px-4 py-2 rounded-lg ${useEnergy ? 'bg-yellow-600' : 'bg-slate-700'}`} onClick={() => setUseEnergy(true)}>⚡ Energy ({energy?.toString() || 0}/6)</button>
                    <button className={`px-4 py-2 rounded-lg ${!useEnergy ? 'bg-green-600' : 'bg-slate-700'}`} onClick={() => setUseEnergy(false)}>💵 Paid</button>
                  </div>
                </div>
                {!useEnergy && (
                  <div className="mb-4">
                    <label className="text-slate-400 text-sm block mb-2">Stake (ETH, 0.0001–50)</label>
                    <input className="input w-full" type="number" min="0.0001" max="50" step="0.0001" value={stake} onChange={(e) => setStake(e.target.value)} />
                  </div>
                )}
                <div className="flex gap-4">
                  <button className="btn-primary flex-1" onClick={handleCreateGame} disabled={isPending || isConfirming || (activeGameData?.[0] === true)}>
                    {isPending || isConfirming ? 'Processing...' : activeGameData?.[0] ? 'Active game exists' : 'Create Game'}
                  </button>
                  {activeGameData?.[0] && Number(activeGameData[1]) === 2 && (
                    <button className="btn-secondary" onClick={async () => {
                      const gId = Number(activeGameData[2]);
                      setGameId(gId);
                      try {
                        const res = await fetch(`${ORACLE_API}/api/pvp/state/${gId}`);
                        const data = await res.json();
                        if (data.fen) setGame(new Chess(data.fen));
                        else setGame(new Chess());
                        setPlayerColor(data.color || 'white');
                      } catch { setGame(new Chess()); }
                      setIsPlaying(true); setGameResult(null); setTab('play');
                    }}>
                      🎮 Return to Game
                    </button>
                  )}
                </div>
              </div>
            )}


            {gameId && !isPlaying && (
              <div className="card mt-6 border-yellow-500">
                <p className="text-lg">Waiting for opponent to join Game #{gameId}...</p>
                <button className="btn-danger mt-4" onClick={handleCancelGame} disabled={isPending}>Cancel Game</button>
              </div>
            )}
          </>
        )}

        {(isPlaying || gameResult) && (
          <div className="flex flex-col md:flex-row gap-8">
            <div className="flex-shrink-0">
              <Chessboard position={game.fen()} onPieceDrop={onDrop} boardWidth={480} boardOrientation={playerColor} arePiecesDraggable={isPlaying} />
            </div>
            <div className="flex-1 space-y-4">
              <div className="card">
                <p className="text-slate-400">Game ID: <span className="text-white font-bold">{gameId}</span></p>
                <p className="text-slate-400">You play: <span className="text-white font-bold">{playerColor}</span></p>
                <p className="text-slate-400">Turn: <span className="text-white font-bold">{game.turn() === 'w' ? 'White' : 'Black'}</span></p>
                {gameResult && <p className="text-2xl font-bold mt-4">{gameResult}</p>}
              </div>
              {isPlaying && (
                <div className="flex gap-4 flex-wrap">
                  <button className="btn-danger" onClick={handleResign} disabled={isPending}>Resign</button>
                  <button className="btn-secondary" onClick={handleOfferDraw}>Offer Draw</button>
                  <button className="btn-secondary" onClick={handleClaimTimeout} disabled={isPending}>Claim Timeout</button>
                </div>
              )}
              {gameResult && (<button className="btn-primary" onClick={() => { setGameResult(null); setGameId(null); setIsPlaying(false); setTab('create'); }}>New Game</button>)}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
