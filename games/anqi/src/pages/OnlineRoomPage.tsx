import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { Board } from '../components/Board'
import {
  CaptureRevealAnimation,
  captureRevealDuration,
  reducedCaptureRevealDuration,
  type CaptureRevealState,
} from '../components/CaptureRevealAnimation'
import { CapturedTray } from '../components/CapturedTray'
import { RulesModal } from '../components/RulesModal'
import { SidebarInfoStack } from '../components/SidebarInfoStack'
import { effectDurations, resolveBoardEffect, type BoardEffect } from '../effectPresentation'
import {
  getPublicLegalMoves,
  getPublicMoveIssue,
  samePosition,
  type Camp,
  type GameEndReason,
  type Position,
  type PublicPieceState,
} from '../game'
import { useOnline } from '../online/OnlineProvider'
import type { RoomPlayerView } from '../online/protocol'

const reasonLabels: Record<GameEndReason, string> = {
  'general-captured': '将帅被取',
  checkmate: '将死',
  stalemate: '困毙',
  threefold: '三次重复',
}

function campName(camp?: Camp): string {
  if (!camp) return '未定'
  return camp === 'red' ? '红方' : '黑方'
}

function visibleCamp(piece: PublicPieceState): Camp | undefined {
  return piece.identity?.camp ?? piece.cover?.camp
}

function PlayerSeat({ player, selfRole }: { player?: RoomPlayerView; selfRole: 'host' | 'guest' }) {
  if (!player) {
    return (
      <div className="player-seat is-empty">
        <span>客席</span>
        <strong>等待加入</strong>
      </div>
    )
  }
  return (
    <div className={`player-seat camp-${player.camp ?? 'waiting'}`}>
      <span>
        {player.role === 'host' ? '房主' : '玩家'}
        {player.role === selfRole ? ' · 你' : ''}
      </span>
      <strong>{player.nickname}</strong>
      <small>{player.camp ? campName(player.camp) : '等待分配阵营'} · {player.connected ? '在线' : '重连中'}</small>
    </div>
  )
}

export function OnlineRoomPage() {
  const { roomCode = '' } = useParams()
  const {
    connected,
    connectionEpoch,
    session,
    snapshot,
    lastUpdate,
    message,
    resumeRoom,
    submitMove,
    startNextRound,
    clearMessage,
  } = useOnline()
  const [rulesOpen, setRulesOpen] = useState(false)
  const [selected, setSelected] = useState<Position>()
  const [showMoveHints, setShowMoveHints] = useState(true)
  const [boardEffect, setBoardEffect] = useState<BoardEffect>()
  const [moveWarning, setMoveWarning] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [captureAnimation, setCaptureAnimation] = useState<CaptureRevealState>()
  const [resultReady, setResultReady] = useState(true)
  const [resultDismissed, setResultDismissed] = useState(false)
  const [copied, setCopied] = useState(false)
  const attemptedEpoch = useRef(0)
  const processedVersion = useRef(0)
  const roundNumber = useRef(0)
  const effectTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  const warningTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const captureTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const room = snapshot?.roomCode === roomCode ? snapshot : undefined
  const game = room?.game
  const selfCamp = room?.self.camp
  const opponent = room?.players.find((player) => player.role !== room.self.role)
  const host = room?.players.find((player) => player.role === 'host')
  const guest = room?.players.find((player) => player.role === 'guest')
  const opponentConnected = Boolean(opponent?.connected)

  useEffect(() => {
    if (!connected || !session || session.roomCode !== roomCode) return
    if (attemptedEpoch.current === connectionEpoch) return
    attemptedEpoch.current = connectionEpoch
    void resumeRoom()
  }, [connected, connectionEpoch, resumeRoom, roomCode, session])

  useEffect(() => () => {
    for (const timer of effectTimers.current) clearTimeout(timer)
    if (warningTimer.current) clearTimeout(warningTimer.current)
    if (captureTimer.current) clearTimeout(captureTimer.current)
  }, [])

  useEffect(() => {
    if (!room || room.roundNumber === roundNumber.current) return
    roundNumber.current = room.roundNumber
    setSelected(undefined)
    setBoardEffect(undefined)
    setCaptureAnimation(undefined)
    setResultReady(true)
    setResultDismissed(false)
  }, [room])

  useEffect(() => {
    if (!lastUpdate || lastUpdate.snapshot.roomCode !== roomCode) return
    if (lastUpdate.version <= processedVersion.current) return
    processedVersion.current = lastUpdate.version
    setSubmitting(false)
    setSelected(undefined)
    setResultDismissed(false)
    for (const timer of effectTimers.current) clearTimeout(timer)
    effectTimers.current = []

    const nextGame = lastUpdate.snapshot.game
    if (!nextGame) return
    const effect = resolveBoardEffect(nextGame.status, Boolean(lastUpdate.move.move.captured))
    // A server event is an external state transition; mirror its presentation state here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBoardEffect(effect)
    setResultReady(nextGame.status.phase === 'playing' || !effect)
    if (effect) {
      effectTimers.current.push(setTimeout(() => setBoardEffect(undefined), effectDurations[effect]))
      if (nextGame.status.phase !== 'playing') {
        effectTimers.current.push(setTimeout(() => setResultReady(true), effectDurations[effect] + 50))
      }
    }

    if (lastUpdate.captured) {
      const captured = lastUpdate.captured
      setCaptureAnimation({
        key: lastUpdate.version,
        pieceId: captured.pieceId,
        position: { ...lastUpdate.move.move.to },
        identity: { ...captured.identity },
        capturedBy: captured.capturedBy,
        wasRevealed: captured.wasRevealed,
      })
      if (captureTimer.current) clearTimeout(captureTimer.current)
      const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        ? reducedCaptureRevealDuration
        : captureRevealDuration
      captureTimer.current = setTimeout(() => setCaptureAnimation(undefined), duration)
    }
  }, [lastUpdate, roomCode])

  const legalMoves = useMemo(
    () => game && selected ? getPublicLegalMoves(game, selected) : [],
    [game, selected],
  )

  const canMove = Boolean(
    connected &&
    room?.phase === 'playing' &&
    game &&
    selfCamp === game.turn &&
    opponentConnected &&
    !submitting &&
    !captureAnimation,
  )

  const showWarning = (text: string) => {
    if (warningTimer.current) clearTimeout(warningTimer.current)
    setMoveWarning(text)
    warningTimer.current = setTimeout(() => setMoveWarning(undefined), 2200)
  }

  const handleCellClick = async (position: Position) => {
    if (!game || !canMove) return
    if (selected) {
      const command = { from: selected, to: position }
      const issue = getPublicMoveIssue(game, command)
      if (issue === 'self-check') {
        showWarning('移动将会送将')
        return
      }
      if (!issue) {
        setSubmitting(true)
        const response = await submitMove(command)
        if (!response.ok) {
          setSubmitting(false)
          showWarning(response.error.message)
        }
        return
      }
    }

    const piece = game.pieces.find((candidate) => samePosition(candidate.position, position))
    if (piece && visibleCamp(piece) === selfCamp && game.turn === selfCamp) {
      setSelected({ ...position })
    } else {
      setSelected(undefined)
    }
  }

  const handleNextRound = async () => {
    clearMessage()
    const response = await startNextRound()
    if (!response.ok) showWarning(response.error.message)
  }

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  if (!session || session.roomCode !== roomCode) {
    return (
      <main className="app-shell room-state-shell">
        <AppHeader backTo="/online" backLabel="大厅" />
        <section className="room-state-card">
          <p className="eyebrow">房间失效</p>
          <h2>{message ?? '没有找到可恢复的玩家座位'}</h2>
          <Link className="primary-button inline-action" to="/online">返回联机大厅</Link>
        </section>
      </main>
    )
  }

  if (!room) {
    return (
      <main className="app-shell room-state-shell">
        <AppHeader />
        <section className="room-state-card">
          <span className="connection-spinner" aria-hidden="true" />
          <h2>{connected ? '正在恢复房间…' : '正在重新连接…'}</h2>
          <p>房间号 {roomCode}</p>
        </section>
      </main>
    )
  }

  if (room.phase === 'waiting') {
    return (
      <main className="app-shell room-state-shell">
        <AppHeader />
        <section className="waiting-room-card">
          <h2>等待另一位玩家加入</h2>
          <button className="room-code-display" type="button" onClick={copyCode}>
            <span>房间号</span>
            <strong>{room.roomCode}</strong>
            <small>{copied ? '已复制' : '点击复制'}</small>
          </button>
          <div className="waiting-seats">
            <PlayerSeat player={host} selfRole={room.self.role} />
            <span className="seat-divider" aria-hidden="true">弈</span>
            <PlayerSeat player={guest} selfRole={room.self.role} />
          </div>
          <p className="waiting-tip">将四位房间号发送给棋友，对方加入后自动开战。</p>
        </section>
      </main>
    )
  }

  if (!game || !selfCamp) return null

  const statusText = room.phase === 'starting'
    ? '即将开战'
    : !opponentConnected
      ? '等待对方重连'
      : game.status.phase === 'playing'
        ? game.status.checkedCamps.includes(game.turn)
          ? `${campName(game.turn)}受将`
          : game.turn === selfCamp
            ? '轮到你行棋'
            : '等待对方行棋'
        : game.status.phase === 'draw'
          ? '本局和棋'
          : `${campName(game.status.winner)}获胜`
  const resultText = game.status.reason ? reasonLabels[game.status.reason] : ''
  const isHost = room.self.role === 'host'
  const mayStartNext = isHost && room.phase === 'finished' && opponentConnected
  const nextRoundLabel = !isHost && room.phase === 'finished'
    ? '等待房主开始下一局'
    : '新的一局'

  return (
    <main className="app-shell online-game-shell">
      <AppHeader onRules={() => setRulesOpen(true)} />
      <section className="game-layout">
        <div className="board-column">
          <Board
            key={`${room.roundNumber}-${selfCamp}`}
            game={game}
            selected={selected}
            legalMoves={legalMoves}
            effect={room.phase === 'starting' ? 'battle' : boardEffect}
            warning={moveWarning}
            showMoveHints={showMoveHints}
            perspective={selfCamp}
            onCellClick={(position) => void handleCellClick(position)}
            onPieceDoubleClick={(position) => {
              setSelected((current) => current && samePosition(current, position) ? undefined : current)
            }}
          />
          {(!connected || !opponentConnected) && (
            <div className="connection-overlay" role="status">
              <strong>{connected ? '等待对方重连' : '正在重新连接'}</strong>
              <span>断线后房间保留 60 秒</span>
            </div>
          )}
        </div>

        <aside className="game-sidebar">
          <section className="online-room-strip">
            <div><span>房间</span><strong>{room.roomCode}</strong></div>
            <div className="online-player-summary">
              {room.players.map((player) => (
                <span className={`summary-player camp-${player.camp}`} key={player.role}>
                  {player.nickname} · {campName(player.camp)}{player.role === 'host' ? ' · 房主' : ''}
                  {!player.connected ? ' · 重连中' : ''}
                </span>
              ))}
            </div>
            <span>第 {room.roundNumber} 局</span>
          </section>
          <SidebarInfoStack>
            <section className="match-card info-card">
              <div className="match-number">第 {game.moveNumber + 1} 手</div>
              <h2>{statusText}</h2>
              <small>你执{selfCamp === 'red' ? '红' : '黑'}</small>
            </section>
            <CapturedTray
              camp="black"
              pieces={game.captured}
              pendingPieceId={captureAnimation?.capturedBy === 'black' ? captureAnimation.pieceId : undefined}
            />
            <CapturedTray
              camp="red"
              pieces={game.captured}
              pendingPieceId={captureAnimation?.capturedBy === 'red' ? captureAnimation.pieceId : undefined}
            />
          </SidebarInfoStack>
          <section className="controls-card">
            <button
              className="primary-button"
              type="button"
              disabled={!mayStartNext}
              onClick={() => void handleNextRound()}
            >
              <span aria-hidden="true">↻</span> {nextRoundLabel}
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
          <section className="result-modal" role="dialog" aria-modal="true" aria-labelledby="online-result-title">
            <p className="eyebrow">第 {room.roundNumber} 局终了</p>
            <div className="result-emblem" aria-hidden="true">
              {game.status.phase === 'draw' ? '和' : game.status.winner === 'red' ? '帥' : '將'}
            </div>
            <h2 id="online-result-title">{statusText}</h2>
            <p>{resultText}</p>
            <div className="result-actions">
              <button
                className="primary-button"
                type="button"
                disabled={!mayStartNext}
                onClick={() => void handleNextRound()}
              >
                {isHost ? '新的一局' : '等待房主开始下一局'}
              </button>
              <button className="secondary-button" type="button" onClick={() => setResultDismissed(true)}>
                查看棋盘
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  )
}
