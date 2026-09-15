import { GENERAL_SLOTS, HIDDEN_SLOTS, fisherYates, secureRandom } from './setup'
import type {
  ApplyMoveResult,
  Camp,
  CapturedPiece,
  GameSnapshot,
  GameState,
  GameStatus,
  LastMove,
  MoveCommand,
  MoveIssue,
  PieceIdentity,
  PieceState,
  Position,
  PublicGameState,
  RandomSource,
} from './types'

const BOARD_WIDTH = 9
const BOARD_HEIGHT = 10

export class IllegalMoveError extends Error {
  constructor(message = '这一步不符合规则') {
    super(message)
    this.name = 'IllegalMoveError'
  }
}

export function positionKey(position: Position): string {
  return `${position.x},${position.y}`
}

export function samePosition(a: Position, b: Position): boolean {
  return a.x === b.x && a.y === b.y
}

export function oppositeCamp(camp: Camp): Camp {
  return camp === 'red' ? 'black' : 'red'
}

export function effectiveIdentity(piece: PieceState): PieceIdentity {
  return piece.revealed ? piece.actual : (piece.cover ?? piece.actual)
}

function cloneIdentity(identity: PieceIdentity): PieceIdentity {
  return { ...identity }
}

function clonePiece(piece: PieceState): PieceState {
  return {
    ...piece,
    position: { ...piece.position },
    actual: cloneIdentity(piece.actual),
    cover: piece.cover ? cloneIdentity(piece.cover) : undefined,
  }
}

function cloneCaptured(piece: CapturedPiece): CapturedPiece {
  return { ...piece, identity: cloneIdentity(piece.identity) }
}

function cloneLastMove(move?: LastMove): LastMove | undefined {
  if (!move) return undefined
  return {
    ...move,
    from: { ...move.from },
    to: { ...move.to },
    revealed: move.revealed ? cloneIdentity(move.revealed) : undefined,
    captured: move.captured ? cloneIdentity(move.captured) : undefined,
  }
}

function cloneStatus(status: GameStatus): GameStatus {
  return { ...status, checkedCamps: [...status.checkedCamps] }
}

function makeSnapshot(state: GameState): GameSnapshot {
  return {
    pieces: state.pieces.map(clonePiece),
    captured: state.captured.map(cloneCaptured),
    turn: state.turn,
    status: cloneStatus(state.status),
    lastMove: cloneLastMove(state.lastMove),
    moveNumber: state.moveNumber,
    repetitions: { ...state.repetitions },
  }
}

export function createGame(rng: RandomSource = secureRandom): GameState {
  const realPool = HIDDEN_SLOTS.map((slot) => cloneIdentity(slot.cover))
  const shuffled = fisherYates(realPool, rng)

  const hiddenPieces: PieceState[] = HIDDEN_SLOTS.map((slot, index) => ({
    id: `piece-${String(index).padStart(2, '0')}`,
    position: { ...slot.position },
    revealed: false,
    actual: shuffled[index],
    cover: cloneIdentity(slot.cover),
  }))

  const generals: PieceState[] = GENERAL_SLOTS.map((slot) => ({
    id: `${slot.cover.camp}-general`,
    position: { ...slot.position },
    revealed: true,
    actual: cloneIdentity(slot.cover),
  }))

  const state: GameState = {
    pieces: [...hiddenPieces, ...generals],
    captured: [],
    turn: 'red',
    status: { phase: 'playing', checkedCamps: [] },
    moveNumber: 0,
    repetitions: {},
    history: [],
  }
  state.repetitions[positionHash(state)] = 1
  state.status = getGameStatus(state)
  return state
}

export function projectPublicState(state: GameState): PublicGameState {
  return {
    pieces: state.pieces.map((piece) => ({
      id: piece.id,
      position: { ...piece.position },
      revealed: piece.revealed,
      identity: piece.revealed ? cloneIdentity(piece.actual) : undefined,
      cover: piece.revealed || !piece.cover ? undefined : cloneIdentity(piece.cover),
    })),
    captured: state.captured.map(cloneCaptured),
    turn: state.turn,
    status: cloneStatus(state.status),
    lastMove: cloneLastMove(state.lastMove),
    moveNumber: state.moveNumber,
    canUndo: state.history.length > 0,
  }
}

function isInsideBoard(position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x < BOARD_WIDTH &&
    position.y >= 0 &&
    position.y < BOARD_HEIGHT
  )
}

function pieceAt(pieces: readonly PieceState[], position: Position): PieceState | undefined {
  return pieces.find((piece) => samePosition(piece.position, position))
}

function isInPalace(position: Position, camp: Camp): boolean {
  if (position.x < 3 || position.x > 5) return false
  return camp === 'black'
    ? position.y >= 0 && position.y <= 2
    : position.y >= 7 && position.y <= 9
}

function crossedRiver(position: Position, camp: Camp): boolean {
  return camp === 'red' ? position.y <= 4 : position.y >= 5
}

function canCaptureTarget(
  target: PieceState | undefined,
  movingCamp: Camp,
): boolean {
  if (!target) return true
  if (!target.revealed) return true
  return target.actual.camp !== movingCamp
}

function rayMoves(
  state: GameState,
  piece: PieceState,
  directions: Position[],
  cannon: boolean,
): Position[] {
  const camp = effectiveIdentity(piece).camp
  const moves: Position[] = []

  for (const direction of directions) {
    let position = {
      x: piece.position.x + direction.x,
      y: piece.position.y + direction.y,
    }
    let screenFound = false

    while (isInsideBoard(position)) {
      const target = pieceAt(state.pieces, position)
      if (!cannon) {
        if (!target) {
          moves.push({ ...position })
        } else {
          if (canCaptureTarget(target, camp)) moves.push({ ...position })
          break
        }
      } else if (!screenFound) {
        if (!target) {
          moves.push({ ...position })
        } else {
          screenFound = true
        }
      } else if (target) {
        if (canCaptureTarget(target, camp)) moves.push({ ...position })
        break
      }

      position = {
        x: position.x + direction.x,
        y: position.y + direction.y,
      }
    }
  }
  return moves
}

function getPseudoMoves(state: GameState, piece: PieceState): Position[] {
  const identity = effectiveIdentity(piece)
  const { camp, kind } = identity
  const { x, y } = piece.position
  const moves: Position[] = []
  const addIfAvailable = (position: Position) => {
    if (!isInsideBoard(position)) return
    const target = pieceAt(state.pieces, position)
    if (canCaptureTarget(target, camp)) moves.push(position)
  }

  if (kind === 'chariot' || kind === 'cannon') {
    return rayMoves(
      state,
      piece,
      [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ],
      kind === 'cannon',
    )
  }

  if (kind === 'horse') {
    const jumps = [
      { dx: 2, dy: 1, lx: 1, ly: 0 },
      { dx: 2, dy: -1, lx: 1, ly: 0 },
      { dx: -2, dy: 1, lx: -1, ly: 0 },
      { dx: -2, dy: -1, lx: -1, ly: 0 },
      { dx: 1, dy: 2, lx: 0, ly: 1 },
      { dx: -1, dy: 2, lx: 0, ly: 1 },
      { dx: 1, dy: -2, lx: 0, ly: -1 },
      { dx: -1, dy: -2, lx: 0, ly: -1 },
    ]
    for (const jump of jumps) {
      if (!pieceAt(state.pieces, { x: x + jump.lx, y: y + jump.ly })) {
        addIfAvailable({ x: x + jump.dx, y: y + jump.dy })
      }
    }
    return moves
  }

  if (kind === 'elephant') {
    for (const delta of [
      { x: 2, y: 2 },
      { x: 2, y: -2 },
      { x: -2, y: 2 },
      { x: -2, y: -2 },
    ]) {
      const destination = { x: x + delta.x, y: y + delta.y }
      const eye = { x: x + delta.x / 2, y: y + delta.y / 2 }
      if (!isInsideBoard(destination) || pieceAt(state.pieces, eye)) continue
      if (!piece.revealed && crossedRiver(destination, camp)) continue
      addIfAvailable(destination)
    }
    return moves
  }

  if (kind === 'advisor') {
    for (const delta of [
      { x: 1, y: 1 },
      { x: 1, y: -1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ]) {
      const destination = { x: x + delta.x, y: y + delta.y }
      if (!piece.revealed && !isInPalace(destination, camp)) continue
      addIfAvailable(destination)
    }
    return moves
  }

  if (kind === 'soldier') {
    addIfAvailable({ x, y: y + (camp === 'red' ? -1 : 1) })
    if (crossedRiver(piece.position, camp)) {
      addIfAvailable({ x: x - 1, y })
      addIfAvailable({ x: x + 1, y })
    }
    return moves
  }

  if (kind === 'general') {
    for (const delta of [
      { x: 1, y: 0 },
      { x: -1, y: 0 },
      { x: 0, y: 1 },
      { x: 0, y: -1 },
    ]) {
      const destination = { x: x + delta.x, y: y + delta.y }
      if (isInPalace(destination, camp)) addIfAvailable(destination)
    }

    const enemyGeneral = state.pieces.find(
      (candidate) =>
        candidate.revealed &&
        candidate.actual.kind === 'general' &&
        candidate.actual.camp !== camp &&
        candidate.position.x === x,
    )
    if (enemyGeneral) {
      const minY = Math.min(y, enemyGeneral.position.y)
      const maxY = Math.max(y, enemyGeneral.position.y)
      const blocked = state.pieces.some(
        (candidate) =>
          candidate.position.x === x &&
          candidate.position.y > minY &&
          candidate.position.y < maxY,
      )
      if (!blocked) moves.push({ ...enemyGeneral.position })
    }
  }

  return moves
}

function simulateVisibleMove(
  state: GameState,
  piece: PieceState,
  destination: Position,
): GameState {
  const target = pieceAt(state.pieces, destination)
  const pieces = state.pieces
    .filter((candidate) => candidate.id !== target?.id)
    .map((candidate) => {
      if (candidate.id !== piece.id) return clonePiece(candidate)
      return { ...clonePiece(candidate), position: { ...destination } }
    })
  return { ...state, pieces }
}

export function isInCheck(state: GameState, camp: Camp): boolean {
  const general = state.pieces.find(
    (piece) =>
      piece.revealed &&
      piece.actual.camp === camp &&
      piece.actual.kind === 'general',
  )
  if (!general) return false
  const enemy = oppositeCamp(camp)
  return state.pieces.some(
    (piece) =>
      effectiveIdentity(piece).camp === enemy &&
      getPseudoMoves(state, piece).some((move) => samePosition(move, general.position)),
  )
}

function getLegalMovesInternal(state: GameState, from: Position): Position[] {
  const piece = pieceAt(state.pieces, from)
  if (!piece || effectiveIdentity(piece).camp !== state.turn) return []
  return getPseudoMoves(state, piece).filter((destination) => {
    const simulated = simulateVisibleMove(state, piece, destination)
    return !isInCheck(simulated, state.turn)
  })
}

export function getLegalMoves(state: GameState, from: Position): Position[] {
  if (state.status.phase !== 'playing') return []
  return getLegalMovesInternal(state, from)
}

function inflatePublicState(state: PublicGameState): GameState | undefined {
  const pieces: PieceState[] = []
  for (const piece of state.pieces) {
    const identity = piece.identity ?? piece.cover
    if (!identity) return undefined
    pieces.push({
      id: piece.id,
      position: { ...piece.position },
      revealed: piece.revealed,
      actual: cloneIdentity(identity),
      cover: piece.cover ? cloneIdentity(piece.cover) : undefined,
    })
  }
  return {
    pieces,
    captured: state.captured.map(cloneCaptured),
    turn: state.turn,
    status: cloneStatus(state.status),
    lastMove: cloneLastMove(state.lastMove),
    moveNumber: state.moveNumber,
    repetitions: {},
    history: [],
  }
}

export function getPublicLegalMoves(state: PublicGameState, from: Position): Position[] {
  const visibleState = inflatePublicState(state)
  return visibleState ? getLegalMoves(visibleState, from) : []
}

export function getPublicMoveIssue(
  state: PublicGameState,
  command: MoveCommand,
): MoveIssue | undefined {
  const visibleState = inflatePublicState(state)
  return visibleState ? getMoveIssue(visibleState, command) : 'movement'
}

export function getMoveIssue(state: GameState, command: MoveCommand): MoveIssue | undefined {
  if (state.status.phase !== 'playing') return 'game-over'
  const piece = pieceAt(state.pieces, command.from)
  if (!piece || effectiveIdentity(piece).camp !== state.turn) return 'not-your-piece'
  const pseudoMoves = getPseudoMoves(state, piece)
  if (!pseudoMoves.some((move) => samePosition(move, command.to))) return 'movement'
  const simulated = simulateVisibleMove(state, piece, command.to)
  return isInCheck(simulated, state.turn) ? 'self-check' : undefined
}

export function positionHash(state: GameState): string {
  const pieces = state.pieces
    .map((piece) => ({
      position: positionKey(piece.position),
      revealed: piece.revealed,
      actual: `${piece.actual.camp}:${piece.actual.kind}`,
      cover: piece.cover ? `${piece.cover.camp}:${piece.cover.kind}` : null,
    }))
    .sort((a, b) => a.position.localeCompare(b.position) || a.actual.localeCompare(b.actual))
  return JSON.stringify({ turn: state.turn, pieces })
}

export function getGameStatus(state: GameState): GameStatus {
  const redGeneral = state.pieces.some(
    (piece) => piece.revealed && piece.actual.camp === 'red' && piece.actual.kind === 'general',
  )
  const blackGeneral = state.pieces.some(
    (piece) => piece.revealed && piece.actual.camp === 'black' && piece.actual.kind === 'general',
  )
  if (!redGeneral || !blackGeneral) {
    return {
      phase: 'won',
      winner: redGeneral ? 'red' : 'black',
      reason: 'general-captured',
      checkedCamps: [],
    }
  }

  const checkedCamps = (['red', 'black'] as Camp[]).filter((camp) => isInCheck(state, camp))
  const hasLegalMove = state.pieces
    .filter((piece) => effectiveIdentity(piece).camp === state.turn)
    .some((piece) => getLegalMovesInternal(state, piece.position).length > 0)

  if (!hasLegalMove) {
    return {
      phase: 'won',
      winner: oppositeCamp(state.turn),
      reason: checkedCamps.includes(state.turn) ? 'checkmate' : 'stalemate',
      checkedCamps,
    }
  }

  if ((state.repetitions[positionHash(state)] ?? 0) >= 3) {
    return { phase: 'draw', reason: 'threefold', checkedCamps }
  }

  return { phase: 'playing', checkedCamps }
}

export function applyMove(state: GameState, command: MoveCommand): ApplyMoveResult {
  const issue = getMoveIssue(state, command)
  if (issue === 'game-over') throw new IllegalMoveError('棋局已经结束')
  if (issue === 'not-your-piece') {
    throw new IllegalMoveError('请选择当前行棋方的棋子')
  }
  if (issue === 'self-check') throw new IllegalMoveError('移动将会送将，将不会实施该移动')
  if (issue === 'movement') throw new IllegalMoveError()

  const piece = pieceAt(state.pieces, command.from)!
  const snapshot = makeSnapshot(state)
  const movingCamp = state.turn
  const wasHidden = !piece.revealed
  const target = pieceAt(state.pieces, command.to)
  const pieces = state.pieces
    .filter((candidate) => candidate.id !== target?.id)
    .map((candidate) => {
      if (candidate.id !== piece.id) return clonePiece(candidate)
      return {
        ...clonePiece(candidate),
        position: { ...command.to },
        revealed: true,
      }
    })

  const captured = [...state.captured]
  if (target) {
    captured.push({
      pieceId: target.id,
      identity: cloneIdentity(target.actual),
      capturedBy: movingCamp,
      wasRevealed: target.revealed,
    })
  }

  const lastMove: LastMove = {
    from: { ...command.from },
    to: { ...command.to },
    moverCamp: movingCamp,
    pieceId: piece.id,
    revealed: wasHidden ? cloneIdentity(piece.actual) : undefined,
    captured: target ? cloneIdentity(target.actual) : undefined,
  }

  const nextState: GameState = {
    pieces,
    captured,
    turn: oppositeCamp(state.turn),
    status: { phase: 'playing', checkedCamps: [] },
    lastMove,
    moveNumber: state.moveNumber + 1,
    repetitions: { ...state.repetitions },
    history: [...state.history, snapshot],
  }
  const hash = positionHash(nextState)
  nextState.repetitions[hash] = (nextState.repetitions[hash] ?? 0) + 1
  nextState.status = getGameStatus(nextState)

  return {
    state: nextState,
    result: { move: cloneLastMove(lastMove)!, status: cloneStatus(nextState.status) },
  }
}

export function undoMove(state: GameState): GameState {
  const snapshot = state.history.at(-1)
  if (!snapshot) return state
  return {
    pieces: snapshot.pieces.map(clonePiece),
    captured: snapshot.captured.map(cloneCaptured),
    turn: snapshot.turn,
    status: cloneStatus(snapshot.status),
    lastMove: cloneLastMove(snapshot.lastMove),
    moveNumber: snapshot.moveNumber,
    repetitions: { ...snapshot.repetitions },
    history: state.history.slice(0, -1),
  }
}
