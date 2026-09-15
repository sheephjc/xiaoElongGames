// @vitest-environment node
import type { AddressInfo } from 'node:net'
import { io as createClient, type Socket } from 'socket.io-client'
import { afterEach, describe, expect, it } from 'vitest'
import { createRealtimeServer } from '../../server/createServer'
import { RoomManager } from '../../server/roomManager'
import type {
  Ack,
  ClientToServerEvents,
  EnterRoomResult,
  GameUpdate,
  RoomSnapshot,
  ServerToClientEvents,
} from '../../src/online/protocol'

type TestClient = Socket<ServerToClientEvents, ClientToServerEvents>

const openServers: ReturnType<typeof createRealtimeServer>[] = []
const openClients: TestClient[] = []

afterEach(async () => {
  for (const client of openClients.splice(0)) client.disconnect()
  for (const server of openServers.splice(0)) await server.close()
})

async function startServer(manager: RoomManager): Promise<string> {
  const server = createRealtimeServer({ roomManager: manager })
  openServers.push(server)
  await new Promise<void>((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve))
  const address = server.httpServer.address() as AddressInfo
  return `http://127.0.0.1:${address.port}`
}

async function connect(url: string): Promise<TestClient> {
  const client: TestClient = createClient(url, { transports: ['websocket'] })
  openClients.push(client)
  await new Promise<void>((resolve) => client.once('connect', () => resolve()))
  return client
}

function createRoom(client: TestClient, nickname: string): Promise<Ack<EnterRoomResult>> {
  return new Promise((resolve) => client.emit('room:create', { nickname }, resolve))
}

function joinRoom(
  client: TestClient,
  nickname: string,
  roomCode: string,
): Promise<Ack<EnterRoomResult>> {
  return new Promise((resolve) => client.emit('room:join', { nickname, roomCode }, resolve))
}

function waitForSnapshot(client: TestClient, phase: RoomSnapshot['phase']): Promise<RoomSnapshot> {
  return new Promise((resolve) => {
    const listener = (snapshot: RoomSnapshot) => {
      if (snapshot.phase !== phase) return
      client.off('room:snapshot', listener)
      resolve(snapshot)
    }
    client.on('room:snapshot', listener)
  })
}

describe('Socket.IO room protocol', () => {
  it('creates, joins and synchronizes a server-authoritative move without exposing secrets', async () => {
    const manager = new RoomManager({
      codeFactory: () => '4321',
      random: () => 0,
      startDelayMs: 0,
    })
    const url = await startServer(manager)
    const host = await connect(url)
    const guest = await connect(url)

    const created = await createRoom(host, '房主')
    expect(created.ok).toBe(true)
    const hostPlaying = waitForSnapshot(host, 'playing')
    const guestPlaying = waitForSnapshot(guest, 'playing')
    const joined = await joinRoom(guest, '客人', '4321')
    expect(joined.ok).toBe(true)
    const [hostSnapshot, guestSnapshot] = await Promise.all([hostPlaying, guestPlaying])
    expect(hostSnapshot.self.camp).toBe('red')
    expect(guestSnapshot.self.camp).toBe('black')
    expect(JSON.stringify(hostSnapshot)).not.toContain('"actual"')
    expect(hostSnapshot.game?.pieces.filter((piece) => !piece.revealed)).toHaveLength(30)

    const denied = await new Promise<Ack<{ accepted: true }>>((resolve) => {
      guest.emit('game:move', { from: { x: 0, y: 9 }, to: { x: 0, y: 8 } }, resolve)
    })
    expect(denied).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'unauthorized' }),
    }))

    const guestUpdate = new Promise<GameUpdate>((resolve) => guest.once('game:update', resolve))
    const accepted = await new Promise<Ack<{ accepted: true }>>((resolve) => {
      host.emit('game:move', { from: { x: 0, y: 9 }, to: { x: 0, y: 8 } }, resolve)
    })
    expect(accepted.ok).toBe(true)
    const update = await guestUpdate
    expect(update.snapshot.game?.moveNumber).toBe(1)
    expect(update.snapshot.game?.pieces.filter((piece) => !piece.revealed)).toHaveLength(29)
  })

  it('reports validation failures through acknowledgements', async () => {
    const url = await startServer(new RoomManager())
    const client = await connect(url)
    const badNickname = await createRoom(client, '   ')
    expect(badNickname).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'invalid-nickname' }),
    }))
    const missing = await joinRoom(client, '棋友', '9999')
    expect(missing).toEqual(expect.objectContaining({
      ok: false,
      error: expect.objectContaining({ code: 'room-not-found' }),
    }))
  })
})
