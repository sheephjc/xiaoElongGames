import { useEffect, useMemo, useRef, useState } from 'react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AnqiHostContext } from './HostContext';
import './styles.css';
import { AppHeader } from './components/AppHeader';
import { Board } from './components/Board';
import {
  CaptureRevealAnimation,
  captureRevealDuration,
  reducedCaptureRevealDuration,
  type CaptureRevealState,
} from './components/CaptureRevealAnimation';
import { CapturedTray } from './components/CapturedTray';
import { RulesModal } from './components/RulesModal';
import { SidebarInfoStack } from './components/SidebarInfoStack';
import { OnlineProvider } from './online/OnlineProvider';
import { HomePage } from './pages/HomePage';
import { OnlineLobbyPage } from './pages/OnlineLobbyPage';
import { OnlineRoomPage } from './pages/OnlineRoomPage';
import { effectDurations, resolveBoardEffect, type BoardEffect } from './effectPresentation';
import {
  applyMove,
  createGame,
  createSeededRng,
  effectiveIdentity,
  getLegalMoves,
  getMoveIssue,
  projectPublicState,
  samePosition,
  type Camp,
  type GameEndReason,
  type GameState,
  type Position,
} from './game';

function campName(camp: Camp): string {
  return camp === 'red' ? '红方' : '黑方';
}

function buildInitialGame(): GameState {
  if (import.meta.env.DEV) {
    const seed = new URLSearchParams(window.location.search).get('seed');
    if (seed !== null && Number.isFinite(Number(seed))) {
      return createGame(createSeededRng(Number(seed)));
    }
  }
  return createGame();
}

function buildInitialEffect(): BoardEffect | undefined {
  if (!import.meta.env.DEV) return undefined;
  const effect = new URLSearchParams(window.location.search).get('effect');
  return effect === 'check' || effect === 'checkmate' || effect === 'capture' ? effect : undefined;
}

const reasonLabels: Record<GameEndReason, string> = {
  'general-captured': '将帅被取',
  checkmate: '将死',
  stalemate: '困毙',
  threefold: '三次重复',
};

export function LocalGamePage() {
  const [game, setGame] = useState<GameState>(buildInitialGame);
  const [selected, setSelected] = useState<Position>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [resultDismissed, setResultDismissed] = useState(false);
  const [resultReady, setResultReady] = useState(true);
  const [boardEffect, setBoardEffect] = useState<BoardEffect | undefined>(buildInitialEffect);
  const [moveWarning, setMoveWarning] = useState<string>();
  const [showMoveHints, setShowMoveHints] = useState(true);
  const [captureAnimation, setCaptureAnimation] = useState<CaptureRevealState>();
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const warningTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const publicGame = useMemo(() => projectPublicState(game), [game]);
  const legalMoves = useMemo(
    () => (selected ? getLegalMoves(game, selected) : []),
    [game, selected],
  );

  const clearEffects = () => {
    for (const timer of effectTimers.current) clearTimeout(timer);
    effectTimers.current = [];
    setBoardEffect(undefined);
    setResultReady(true);
  };

  const scheduleEffect = (callback: () => void, delay: number) => {
    const timer = setTimeout(callback, delay);
    effectTimers.current.push(timer);
  };

  const playStatusEffect = (nextGame: GameState, didCapture: boolean) => {
    clearEffects();
    const effect = resolveBoardEffect(nextGame.status, didCapture);
    if (!effect) return;

    const duration = effectDurations[effect];
    setBoardEffect(effect);
    if (effect === 'checkmate') {
      setResultReady(false);
    } else if (effect === 'capture' && nextGame.status.phase !== 'playing') {
      setResultReady(false);
    }
    scheduleEffect(() => setBoardEffect(undefined), duration);
    if (nextGame.status.phase !== 'playing') {
      scheduleEffect(() => setResultReady(true), duration + 50);
    }
  };

  const clearMoveWarning = () => {
    if (warningTimer.current) clearTimeout(warningTimer.current);
    warningTimer.current = undefined;
    setMoveWarning(undefined);
  };

  const showMoveWarning = () => {
    clearMoveWarning();
    setMoveWarning('移动将会送将');
    warningTimer.current = setTimeout(() => setMoveWarning(undefined), 2200);
  };

  const clearCaptureAnimation = () => {
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = undefined;
    setCaptureAnimation(undefined);
  };

  const playCaptureReveal = (capture: CaptureRevealState) => {
    clearCaptureAnimation();
    setCaptureAnimation(capture);
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? reducedCaptureRevealDuration
      : captureRevealDuration;
    captureTimer.current = setTimeout(() => {
      setCaptureAnimation(undefined);
      captureTimer.current = undefined;
    }, duration);
  };

  useEffect(
    () => () => {
      for (const timer of effectTimers.current) clearTimeout(timer);
      if (warningTimer.current) clearTimeout(warningTimer.current);
      if (captureTimer.current) clearTimeout(captureTimer.current);
    },
    [],
  );

  const handleCellClick = (position: Position) => {
    if (game.status.phase !== 'playing' || captureAnimation) return;
    if (selected) {
      const command = { from: selected, to: position };
      const issue = getMoveIssue(game, command);
      if (issue === 'self-check') {
        showMoveWarning();
        return;
      }
      if (!issue) {
        const { state, result } = applyMove(game, command);
        const captured = result.move.captured ? state.captured.at(-1) : undefined;
        clearMoveWarning();
        setGame(state);
        setSelected(undefined);
        setResultDismissed(false);
        playStatusEffect(state, Boolean(result.move.captured));
        if (captured) {
          playCaptureReveal({
            key: state.moveNumber,
            pieceId: captured.pieceId,
            position: { ...position },
            identity: { ...captured.identity },
            capturedBy: captured.capturedBy,
            wasRevealed: captured.wasRevealed,
          });
        }
        return;
      }
    }

    const piece = game.pieces.find((candidate) => samePosition(candidate.position, position));
    clearMoveWarning();
    if (piece && effectiveIdentity(piece).camp === game.turn) {
      setSelected({ ...position });
    } else {
      setSelected(undefined);
    }
  };

  const handlePieceDoubleClick = (position: Position) => {
    clearMoveWarning();
    setSelected((current) => (current && samePosition(current, position) ? undefined : current));
  };

  const startNewGame = (skipConfirm = false) => {
    if (
      !skipConfirm &&
      game.moveNumber > 0 &&
      !window.confirm('当前棋局尚未结束，确定开始新的一局吗？')
    ) {
      return;
    }
    clearEffects();
    clearMoveWarning();
    clearCaptureAnimation();
    setGame(createGame());
    setSelected(undefined);
    setResultDismissed(false);
  };

  const statusText =
    game.status.phase === 'playing'
      ? game.status.checkedCamps.includes(game.turn)
        ? `${campName(game.turn)}受将`
        : `${campName(game.turn)}行棋`
      : game.status.phase === 'draw'
        ? '本局和棋'
        : `${campName(game.status.winner!)}获胜`;
  const resultText = game.status.reason ? reasonLabels[game.status.reason] : '';

  return (
    <main className="app-shell">
      <AppHeader backTo="/" backLabel="首页" onRules={() => setRulesOpen(true)} />

      <section className="game-layout">
        <div className="board-column">
          <Board
            game={publicGame}
            selected={selected}
            legalMoves={legalMoves}
            effect={boardEffect}
            warning={moveWarning}
            showMoveHints={showMoveHints}
            onCellClick={handleCellClick}
            onPieceDoubleClick={handlePieceDoubleClick}
          />
        </div>

        <aside className="game-sidebar">
          <SidebarInfoStack>
            <section className="match-card info-card">
              <div className="match-number">第 {game.moveNumber + 1} 手</div>
              <h2>{statusText}</h2>
            </section>

            <CapturedTray
              camp="black"
              pieces={publicGame.captured}
              pendingPieceId={
                captureAnimation?.capturedBy === 'black' ? captureAnimation.pieceId : undefined
              }
            />
            <CapturedTray
              camp="red"
              pieces={publicGame.captured}
              pendingPieceId={
                captureAnimation?.capturedBy === 'red' ? captureAnimation.pieceId : undefined
              }
            />
          </SidebarInfoStack>

          <section className="controls-card">
            <button className="primary-button" type="button" onClick={() => startNewGame()}>
              <span aria-hidden="true">↻</span> 新的一局
            </button>
            <button
              className={`secondary-button hint-toggle${showMoveHints ? ' is-active' : ''}`}
              type="button"
              aria-pressed={showMoveHints}
              onClick={() => setShowMoveHints((visible) => !visible)}
            >
              <span aria-hidden="true">◎</span> 提示落点
            </button>
          </section>
        </aside>
      </section>

      {captureAnimation && <CaptureRevealAnimation capture={captureAnimation} />}

      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}

      {game.status.phase !== 'playing' && resultReady && !resultDismissed && (
        <div className="modal-backdrop result-backdrop" role="presentation">
          <section
            className="result-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
          >
            <p className="eyebrow">一局终了</p>
            <div className="result-emblem" aria-hidden="true">
              {game.status.phase === 'draw' ? '和' : game.status.winner === 'red' ? '帥' : '將'}
            </div>
            <h2 id="result-title">{statusText}</h2>
            <p>{resultText}</p>
            <div className="result-actions">
              <button className="primary-button" type="button" onClick={() => startNewGame(true)}>
                再来一局
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setResultDismissed(true)}
              >
                查看棋盘
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function App({
  nickname,
  onExit,
  initialPath = '/',
}: {
  nickname?: string;
  onExit?: () => void;
  initialPath?: string;
}) {
  return (
    <div className="anqi-game">
      <AnqiHostContext.Provider value={{ nickname, onExit }}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route index element={<HomePage />} />
            <Route path="local" element={<LocalGamePage />} />
            <Route path="online" element={<OnlineProvider />}>
              <Route index element={<OnlineLobbyPage />} />
              <Route path=":roomCode" element={<OnlineRoomPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </MemoryRouter>
      </AnqiHostContext.Provider>
    </div>
  );
}

export default App;
