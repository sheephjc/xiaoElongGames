// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { getGameStatus, positionHash, type GameState, type PieceState } from '../../src/game'
import { RoomManager, RoomServiceError } from '../../server/roomManager'

function finishedInOneMoveGame(): GameState {
  const pieces: PieceState[] = [
    {
      id: 'red-general',
      position: { x: 4, y: 9 },
      revealed: true,
      actual: { camp: 'red', kind: 'general' },
    },
    {
      id: 'black-general',
      position: { x: 4, y: 0 },
      revealed: true,
      actual: { camp: 'black', kind: 'general' },
    },
    {
      id: 'red-rook',
      position: { x: 4, y: 1 },
      revealed: true,
      actual: { camp: 'red', kind: 'chariot' },
    },
  ]
  const state: GameState = {
    pieces,
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

describe('RoomManager', () => {
  it('rejects reusing a bound socket without abandoning its existing room', () => {
    const manager = new RoomManager({ codeFactory: () => '4321' })
    manager.createRoom('host', '甲')
    expect(() => manager.createRoom('host', '乙')).toThrowError(/已经在房间/)
    expect(() => manager.joinRoom('host', '4321', '乙')).toThrowError(/已经在房间/)
    expect(manager.roomCount).toBe(1)
    expect(manager.snapshotForSocket('host')?.players).toHaveLength(1)
    manager.destroy()
  })
  it('creates a four-digit room, trims nicknames and allows duplicate nicknames', () => {
    const manager = new RoomManager({ codeFactory: () => '4321', startDelayMs: 60_000 })
    const host = manager.createRoom('host-socket', '  棋友  ')
    expect(host.session.roomCode).toBe('4321')
    expect(host.snapshot.players[0].nickname).toBe('棋友')
    const guest = manager.joinRoom('guest-socket', '4321', '棋友')
    expect(guest.snapshot.players.map((player) => player.nickname)).toEqual(['棋友', '棋友'])
    expect(new Set(guest.snapshot.players.map((player) => player.camp))).toEqual(new Set(['red', 'black']))
    manager.destroy()
  })

  it('rejects invalid nicknames, missing rooms and a third player', () => {
    const manager = new RoomManager({ codeFactory: () => '4321', startDelayMs: 60_000 })
    expect(() => manager.createRoom('bad', '   ')).toThrowError(RoomServiceError)
    expect(() => manager.joinRoom('missing', '9999', '玩家')).toThrowError(/不存在/)
    manager.createRoom('host', '甲')
    manager.joinRoom('guest', '4321', '乙')
    expect(() => manager.joinRoom('third', '4321', '丙')).toThrowError(/已满/)
    manager.destroy()
  })

  it('retries room-number collisions', () => {
    const codes = ['4321', '4321', '5678']
    const manager = new RoomManager({ codeFactory: () => codes.shift() ?? '9999' })
    expect(manager.createRoom('one', '甲').session.roomCode).toBe('4321')
    expect(manager.createRoom('two', '乙').session.roomCode).toBe('5678')
    manager.destroy()
  })

  it('keeps hidden identities out of room snapshots and blocks moves during the opening effect', () => {
    const manager = new RoomManager({ codeFactory: () => '4321', startDelayMs: 60_000 })
    manager.createRoom('host', '甲')
    const joined = manager.joinRoom('guest', '4321', '乙')
    expect(joined.snapshot.phase).toBe('starting')
    expect(joined.snapshot.game?.pieces.filter((piece) => !piece.revealed)).toHaveLength(30)
    expect(joined.snapshot.game?.pieces.every((piece) => piece.revealed || piece.identity === undefined)).toBe(true)
    expect(() => manager.move('host', { from: { x: 0, y: 9 }, to: { x: 0, y: 8 } })).toThrowError(/开战/)
    manager.destroy()
  })

  it('enforces turns, lets only the host start a finished round and swaps camps', async () => {
    const manager = new RoomManager({
      codeFactory: () => '4321',
      random: () => 0,
      startDelayMs: 0,
      gameFactory: finishedInOneMoveGame,
    })
    const host = manager.createRoom('host', '甲')
    const guest = manager.joinRoom('guest', '4321', '乙')
    expect(host.session.role).toBe('host')
    expect(guest.snapshot.self.camp).toBe('black')
    await vi.waitFor(() => expect(manager.snapshotForSocket('host')?.phase).toBe('playing'))
    expect(() => manager.move('guest', { from: { x: 4, y: 1 }, to: { x: 4, y: 0 } })).toThrowError(/轮到/)
    manager.move('host', { from: { x: 4, y: 1 }, to: { x: 4, y: 0 } })
    expect(manager.snapshotForSocket('host')?.phase).toBe('finished')
    expect(() => manager.startNextRound('guest')).toThrowError(/房主/)
    manager.startNextRound('host')
    const next = manager.snapshotForSocket('host')!
    expect(next.roundNumber).toBe(2)
    expect(next.self.camp).toBe('black')
    expect(next.phase).toBe('starting')
    manager.destroy()
  })

  it('restores a disconnected seat within the grace period and closes it after timeout', async () => {
    const closed = vi.fn()
    const manager = new RoomManager({
      codeFactory: () => '4321',
      disconnectGraceMs: 15,
      startDelayMs: 60_000,
      onRoomClosed: closed,
    })
    const host = manager.createRoom('host', '甲')
    manager.joinRoom('guest', '4321', '乙')
    manager.disconnectSocket('host')
    expect(manager.snapshotForSocket('guest')?.players.find((player) => player.role === 'host')?.connected).toBe(false)
    manager.resumeRoom('host-new', '4321', host.session.playerToken)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(manager.snapshotForSocket('host-new')).toBeDefined()
    expect(closed).not.toHaveBeenCalled()

    manager.disconnectSocket('host-new')
    await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
    expect(manager.snapshotForSocket('guest')).toBeUndefined()
    manager.destroy()
  })
})
