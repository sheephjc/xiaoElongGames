export type Camp = 'red' | 'black'

export type PieceKind =
  | 'general'
  | 'advisor'
  | 'elephant'
  | 'horse'
  | 'chariot'
  | 'cannon'
  | 'soldier'

export interface Position {
  x: number
  y: number
}

export interface PieceIdentity {
  camp: Camp
  kind: PieceKind
}

export interface PieceState {
  id: string
  position: Position
  revealed: boolean
  actual: PieceIdentity
  cover?: PieceIdentity
}

export interface CapturedPiece {
  pieceId: string
  identity: PieceIdentity
  capturedBy: Camp
  wasRevealed: boolean
}

export type GameEndReason =
  | 'general-captured'
  | 'checkmate'
  | 'stalemate'
  | 'threefold'

export interface GameStatus {
  phase: 'playing' | 'won' | 'draw'
  checkedCamps: Camp[]
  winner?: Camp
  reason?: GameEndReason
}

export interface MoveCommand {
  from: Position
  to: Position
}

export type MoveIssue = 'game-over' | 'not-your-piece' | 'movement' | 'self-check'

export interface LastMove extends MoveCommand {
  moverCamp: Camp
  pieceId: string
  revealed?: PieceIdentity
  captured?: PieceIdentity
}

export interface GameSnapshot {
  pieces: PieceState[]
  captured: CapturedPiece[]
  turn: Camp
  status: GameStatus
  lastMove?: LastMove
  moveNumber: number
  repetitions: Record<string, number>
}

export interface GameState extends GameSnapshot {
  history: GameSnapshot[]
}

export interface PublicPieceState {
  id: string
  position: Position
  revealed: boolean
  identity?: PieceIdentity
  cover?: PieceIdentity
}

export interface PublicGameState {
  pieces: PublicPieceState[]
  captured: CapturedPiece[]
  turn: Camp
  status: GameStatus
  lastMove?: LastMove
  moveNumber: number
  canUndo: boolean
}

export interface MoveResult {
  move: LastMove
  status: GameStatus
}

export interface ApplyMoveResult {
  state: GameState
  result: MoveResult
}

export type RandomSource = () => number
