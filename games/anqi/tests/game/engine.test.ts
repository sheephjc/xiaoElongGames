import { describe, expect, it } from 'vitest'
import {
  applyMove,
  createGame,
  createSeededRng,
  effectiveIdentity,
  getGameStatus,
  getLegalMoves,
  getPublicLegalMoves,
  getMoveIssue,
  isInCheck,
  positionHash,
  projectPublicState,
  undoMove,
  type Camp,
  type GameState,
  type PieceIdentity,
  type PieceKind,
  type PieceState,
  type Position,
} from '../../src/game'

let nextId = 0

function revealed(camp: Camp, kind: PieceKind, position: Position, id?: string): PieceState {
  return {
    id: id ?? `fixture-${nextId++}`,
    position,
    revealed: true,
    actual: { camp, kind },
  }
}

function hidden(
  cover: PieceIdentity,
  actual: PieceIdentity,
  position: Position,
  id?: string,
): PieceState {
  return {
    id: id ?? `fixture-${nextId++}`,
    position,
    revealed: false,
    cover,
    actual,
  }
}

function makeState(pieces: PieceState[], turn: Camp = 'red'): GameState {
  return {
    pieces,
    captured: [],
    turn,
    status: { phase: 'playing', checkedCamps: [] },
    moveNumber: 0,
    repetitions: {},
    history: [],
  }
}

function withGenerals(extra: PieceState[], turn: Camp = 'red'): GameState {
  return makeState([
    revealed('red', 'general', { x: 4, y: 9 }, 'red-general'),
    revealed('black', 'general', { x: 3, y: 0 }, 'black-general'),
    ...extra,
  ], turn)
}

function includes(moves: Position[], target: Position): boolean {
  return moves.some((move) => move.x === target.x && move.y === target.y)
}

describe('createGame', () => {
  it('creates the fixed generals, 30 hidden pieces and gives red the first turn', () => {
    const state = createGame(createSeededRng(7))
    expect(state.pieces).toHaveLength(32)
    expect(state.pieces.filter((piece) => !piece.revealed)).toHaveLength(30)
    expect(state.turn).toBe('red')
    expect(state.pieces).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'red-general',
        revealed: true,
        position: { x: 4, y: 9 },
        actual: { camp: 'red', kind: 'general' },
      }),
      expect.objectContaining({
        id: 'black-general',
        revealed: true,
        position: { x: 4, y: 0 },
        actual: { camp: 'black', kind: 'general' },
      }),
    ]))
  })

  it('globally shuffles the complete non-general pool deterministically', () => {
    const first = createGame(createSeededRng(2026))
    const second = createGame(createSeededRng(2026))
    const third = createGame(createSeededRng(2027))
    const identities = (state: GameState) => state.pieces
      .filter((piece) => !piece.revealed)
      .map((piece) => `${piece.actual.camp}:${piece.actual.kind}`)

    expect(identities(first)).toEqual(identities(second))
    expect(identities(first)).not.toEqual(identities(third))
    expect(identities(first).filter((identity) => identity.startsWith('red:'))).toHaveLength(15)
    expect(identities(first).filter((identity) => identity.startsWith('black:'))).toHaveLength(15)
  })

  it('masks hidden actual identities from the public state', () => {
    const state = createGame(createSeededRng(9))
    const secret = state.pieces.find((piece) => !piece.revealed)!
    const publicPiece = projectPublicState(state).pieces.find((piece) => piece.id === secret.id)!
    expect(publicPiece.identity).toBeUndefined()
    expect(publicPiece.cover).toEqual(secret.cover)
    expect(Object.hasOwn(publicPiece, 'actual')).toBe(false)
    expect(secret.id).toMatch(/^piece-\d{2}$/)
  })
})

describe('public legal moves', () => {
  it('matches server legal moves without exposing hidden identities', () => {
    const first = createGame(createSeededRng(41))
    const second = createGame(createSeededRng(99))
    const position = { x: 0, y: 9 }
    const publicFirst = projectPublicState(first)
    const publicSecond = projectPublicState(second)
    expect(getPublicLegalMoves(publicFirst, position)).toEqual(getLegalMoves(first, position))
    expect(getPublicLegalMoves(publicSecond, position)).toEqual(getLegalMoves(second, position))
    expect(getPublicLegalMoves(publicFirst, position)).toEqual(getPublicLegalMoves(publicSecond, position))
  })
})

describe('piece movement and revealing', () => {
  it('moves a hidden piece by its cover then reveals and changes its controller', () => {
    const disguised = hidden(
      { camp: 'red', kind: 'chariot' },
      { camp: 'black', kind: 'soldier' },
      { x: 0, y: 9 },
      'mystery',
    )
    const state = withGenerals([disguised])
    expect(includes(getLegalMoves(state, disguised.position), { x: 0, y: 8 })).toBe(true)

    const { state: moved, result } = applyMove(state, {
      from: { x: 0, y: 9 },
      to: { x: 0, y: 8 },
    })
    const piece = moved.pieces.find((candidate) => candidate.id === 'mystery')!
    expect(piece.revealed).toBe(true)
    expect(effectiveIdentity(piece)).toEqual({ camp: 'black', kind: 'soldier' })
    expect(moved.turn).toBe('black')
    expect(result.move.revealed).toEqual({ camp: 'black', kind: 'soldier' })
  })

  it('keeps a hidden advisor in the palace but frees it after revealing', () => {
    const dark = hidden(
      { camp: 'red', kind: 'advisor' },
      { camp: 'red', kind: 'advisor' },
      { x: 3, y: 9 },
    )
    const darkState = withGenerals([dark])
    const darkMoves = getLegalMoves(darkState, dark.position)
    expect(includes(darkMoves, { x: 4, y: 8 })).toBe(true)
    expect(includes(darkMoves, { x: 2, y: 8 })).toBe(false)

    const light = revealed('red', 'advisor', { x: 4, y: 5 })
    const lightState = withGenerals([light])
    expect(includes(getLegalMoves(lightState, light.position), { x: 3, y: 4 })).toBe(true)
  })

  it('allows only a revealed elephant to cross and always enforces the elephant eye', () => {
    const dark = hidden(
      { camp: 'red', kind: 'elephant' },
      { camp: 'red', kind: 'elephant' },
      { x: 4, y: 5 },
    )
    expect(includes(getLegalMoves(withGenerals([dark]), dark.position), { x: 2, y: 3 })).toBe(false)

    const light = revealed('red', 'elephant', { x: 4, y: 5 })
    expect(includes(getLegalMoves(withGenerals([light]), light.position), { x: 2, y: 3 })).toBe(true)

    const eye = revealed('red', 'soldier', { x: 3, y: 4 })
    expect(includes(getLegalMoves(withGenerals([light, eye]), light.position), { x: 2, y: 3 })).toBe(false)
  })

  it('blocks a horse at the horse leg', () => {
    const horse = revealed('red', 'horse', { x: 4, y: 5 })
    const leg = revealed('red', 'soldier', { x: 5, y: 5 })
    const moves = getLegalMoves(withGenerals([horse, leg]), horse.position)
    expect(includes(moves, { x: 6, y: 6 })).toBe(false)
    expect(includes(moves, { x: 3, y: 3 })).toBe(true)
  })

  it('requires exactly one cannon screen for a capture', () => {
    const cannon = revealed('red', 'cannon', { x: 0, y: 9 })
    const screen = hidden(
      { camp: 'red', kind: 'soldier' },
      { camp: 'black', kind: 'horse' },
      { x: 0, y: 7 },
    )
    const target = revealed('black', 'chariot', { x: 0, y: 5 })
    const moves = getLegalMoves(withGenerals([cannon, screen, target]), cannon.position)
    expect(includes(moves, screen.position)).toBe(false)
    expect(includes(moves, target.position)).toBe(true)
    expect(includes(moves, { x: 0, y: 6 })).toBe(false)
  })

  it('keeps an un-crossed soldier forward-only and unlocks sideways after crossing', () => {
    const before = revealed('red', 'soldier', { x: 4, y: 6 })
    const beforeMoves = getLegalMoves(withGenerals([before]), before.position)
    expect(includes(beforeMoves, { x: 4, y: 5 })).toBe(true)
    expect(includes(beforeMoves, { x: 3, y: 6 })).toBe(false)

    const after = revealed('red', 'soldier', { x: 4, y: 4 })
    const afterMoves = getLegalMoves(withGenerals([after]), after.position)
    expect(includes(afterMoves, { x: 3, y: 4 })).toBe(true)
    expect(includes(afterMoves, { x: 5, y: 4 })).toBe(true)
    expect(includes(afterMoves, { x: 4, y: 5 })).toBe(false)
  })
})

describe('capture and hidden-information checks', () => {
  it('allows a revealed piece to capture a same-cover-camp hidden piece and publishes it', () => {
    const rook = revealed('red', 'chariot', { x: 0, y: 9 }, 'rook')
    const target = hidden(
      { camp: 'red', kind: 'soldier' },
      { camp: 'black', kind: 'horse' },
      { x: 0, y: 8 },
      'target',
    )
    const state = withGenerals([rook, target])
    expect(includes(getLegalMoves(state, rook.position), target.position)).toBe(true)
    const moved = applyMove(state, { from: rook.position, to: target.position }).state
    expect(moved.captured[0]).toEqual(expect.objectContaining({
      pieceId: 'target',
      identity: { camp: 'black', kind: 'horse' },
      capturedBy: 'red',
      wasRevealed: false,
    }))
    expect(projectPublicState(moved).captured[0].identity).toEqual({ camp: 'black', kind: 'horse' })
  })

  it('allows one hidden piece to capture another hidden piece before revealing', () => {
    const attacker = hidden(
      { camp: 'red', kind: 'chariot' },
      { camp: 'black', kind: 'advisor' },
      { x: 0, y: 9 },
      'dark-attacker',
    )
    const target = hidden(
      { camp: 'red', kind: 'soldier' },
      { camp: 'red', kind: 'horse' },
      { x: 0, y: 8 },
      'dark-target',
    )
    const moved = applyMove(withGenerals([attacker, target]), {
      from: attacker.position,
      to: target.position,
    }).state
    expect(moved.pieces.find((piece) => piece.id === 'dark-attacker')).toEqual(
      expect.objectContaining({ revealed: true, actual: { camp: 'black', kind: 'advisor' } }),
    )
    expect(moved.pieces.some((piece) => piece.id === 'dark-target')).toBe(false)
    expect(moved.captured[0].identity).toEqual({ camp: 'red', kind: 'horse' })
  })

  it('does not allow capturing an already revealed friendly piece', () => {
    const rook = revealed('red', 'chariot', { x: 0, y: 9 })
    const friend = revealed('red', 'soldier', { x: 0, y: 8 })
    expect(includes(getLegalMoves(withGenerals([rook, friend]), rook.position), friend.position)).toBe(false)
  })

  it('does not leak a hidden actual identity through legal move generation', () => {
    const make = (actual: PieceIdentity) => withGenerals([
      hidden({ camp: 'red', kind: 'chariot' }, actual, { x: 0, y: 8 }, 'secret'),
    ])
    const redActual = getLegalMoves(make({ camp: 'red', kind: 'advisor' }), { x: 0, y: 8 })
    const blackActual = getLegalMoves(make({ camp: 'black', kind: 'chariot' }), { x: 0, y: 8 })
    expect(redActual).toEqual(blackActual)
  })

  it('accepts a reveal that checks the mover, changes turns, then permits general capture', () => {
    const mystery = hidden(
      { camp: 'red', kind: 'chariot' },
      { camp: 'black', kind: 'chariot' },
      { x: 0, y: 8 },
      'secret-rook',
    )
    const state = withGenerals([mystery])
    const revealedState = applyMove(state, {
      from: { x: 0, y: 8 },
      to: { x: 4, y: 8 },
    }).state
    expect(revealedState.turn).toBe('black')
    expect(revealedState.status.checkedCamps).toContain('red')
    expect(includes(getLegalMoves(revealedState, { x: 4, y: 8 }), { x: 4, y: 9 })).toBe(true)

    const won = applyMove(revealedState, {
      from: { x: 4, y: 8 },
      to: { x: 4, y: 9 },
    }).state
    expect(won.status).toEqual(expect.objectContaining({
      phase: 'won',
      winner: 'black',
      reason: 'general-captured',
    }))
  })
})

describe('general safety and endings', () => {
  it('filters a move that visibly exposes its own general', () => {
    const state = makeState([
      revealed('red', 'general', { x: 4, y: 9 }),
      revealed('black', 'general', { x: 3, y: 0 }),
      revealed('black', 'chariot', { x: 4, y: 0 }),
      revealed('red', 'chariot', { x: 4, y: 5 }, 'blocker'),
    ])
    expect(includes(getLegalMoves(state, { x: 4, y: 5 }), { x: 3, y: 5 })).toBe(false)
    expect(includes(getLegalMoves(state, { x: 4, y: 5 }), { x: 4, y: 4 })).toBe(true)
    expect(getMoveIssue(state, {
      from: { x: 4, y: 5 },
      to: { x: 3, y: 5 },
    })).toBe('self-check')
  })

  it('enforces the flying-general line', () => {
    const state = makeState([
      revealed('red', 'general', { x: 4, y: 9 }),
      revealed('black', 'general', { x: 4, y: 0 }),
    ])
    expect(isInCheck(state, 'red')).toBe(true)
    expect(isInCheck(state, 'black')).toBe(true)
  })

  it('detects checkmate and stalemate as wins for the opponent', () => {
    const checkmate = makeState([
      revealed('black', 'general', { x: 4, y: 0 }),
      revealed('red', 'general', { x: 4, y: 9 }),
      revealed('red', 'chariot', { x: 4, y: 1 }),
      revealed('red', 'chariot', { x: 0, y: 1 }),
      revealed('red', 'chariot', { x: 3, y: 2 }),
      revealed('red', 'chariot', { x: 5, y: 2 }),
    ], 'black')
    expect(getGameStatus(checkmate)).toEqual(expect.objectContaining({
      phase: 'won', winner: 'red', reason: 'checkmate',
    }))

    const stalemate = makeState([
      revealed('black', 'general', { x: 4, y: 0 }),
      revealed('red', 'general', { x: 4, y: 9 }),
      revealed('red', 'chariot', { x: 0, y: 1 }),
      revealed('red', 'chariot', { x: 3, y: 2 }),
      revealed('red', 'chariot', { x: 5, y: 2 }),
      revealed('red', 'advisor', { x: 4, y: 5 }),
    ], 'black')
    expect(getGameStatus(stalemate)).toEqual(expect.objectContaining({
      phase: 'won', winner: 'red', reason: 'stalemate',
    }))
  })

  it('draws on the third occurrence of a complete position', () => {
    const state = withGenerals([])
    state.repetitions[positionHash(state)] = 3
    expect(getGameStatus(state)).toEqual(expect.objectContaining({
      phase: 'draw', reason: 'threefold',
    }))
  })

  it('hashes the side to move and hidden actual identity', () => {
    const first = withGenerals([
      hidden({ camp: 'red', kind: 'soldier' }, { camp: 'red', kind: 'horse' }, { x: 0, y: 6 }),
    ])
    const otherIdentity = withGenerals([
      hidden({ camp: 'red', kind: 'soldier' }, { camp: 'black', kind: 'horse' }, { x: 0, y: 6 }),
    ])
    const otherTurn = { ...first, turn: 'black' as Camp }
    expect(positionHash(first)).not.toBe(positionHash(otherIdentity))
    expect(positionHash(first)).not.toBe(positionHash(otherTurn))
  })

  it('round-trips the authoritative state through JSON serialization', () => {
    const original = createGame(createSeededRng(88))
    const serialized = JSON.stringify(original)
    const restored = JSON.parse(serialized) as GameState
    expect(positionHash(restored)).toBe(positionHash(original))
    expect(projectPublicState(restored)).toEqual(projectPublicState(original))
  })

  it('undoes a complete ply including reveal, capture and repetition state', () => {
    const state = withGenerals([
      hidden(
        { camp: 'red', kind: 'chariot' },
        { camp: 'black', kind: 'soldier' },
        { x: 0, y: 9 },
        'mystery',
      ),
    ])
    state.repetitions[positionHash(state)] = 1
    const moved = applyMove(state, { from: { x: 0, y: 9 }, to: { x: 0, y: 8 } }).state
    const restored = undoMove(moved)
    expect(projectPublicState(restored)).toEqual(projectPublicState(state))
    expect(restored.repetitions).toEqual(state.repetitions)
    expect(restored.history).toHaveLength(0)
  })
})
