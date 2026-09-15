import assert from 'node:assert/strict';
import http from 'node:http';
import { Server } from 'socket.io';
import { io as connect } from 'socket.io-client';
import { bindMahjongNamespace, projectRoom } from '../server/namespace.js';
import { createOnlineGameState } from '../client/src/online-game-engine.js';

const server = http.createServer();
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 });
const service = bindMahjongNamespace(io.of('/zhangzhou-mahjong'), { tickMs: 20 });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const clients = [];
const request = (client, event, data = {}) => new Promise((resolve, reject) => client.timeout(3000).emit(event, data, (error, result) => error ? reject(error) : resolve(result)));
const ok = async (client, event, data) => { const result = await request(client, event, data); assert.equal(result.ok, true, `${event}: ${result.error}`); return result.data; };
const denied = async (client, event, data) => { const result = await request(client, event, data); assert.equal(result.ok, false, `${event} must reject`); };
async function client(token = '') {
  const socket = connect(`${url}/zhangzhou-mahjong`, { transports: ['websocket'], forceNew: true });
  clients.push(socket);
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  socket.identity = await ok(socket, 'session:open', { token });
  return socket;
}
const waitFor = async (predicate, timeout = 60000) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail('Timed out waiting for server progression');
};
const action = async (socket, code, seatId, type, payload = {}, id = crypto.randomUUID()) => {
  const view = await ok(socket, 'room:get', { roomCode: code });
  return ok(socket, 'game:action', { roomCode: code, expectedVersion: view.game.version, action: { type, seatId, payload, clientActionId: id } });
};

try {
  let host = await client();
  const room = await ok(host, 'room:create', { nickname: 'Host' });
  const friends = await Promise.all([client(), client(), client()]);
  for (const [index, friend] of friends.entries()) {
    const joined = await ok(friend, 'room:join', { roomCode: room.roomCode, nickname: `P${index + 1}` });
    assert.equal(joined.seatId, String(index + 1));
  }
  const spectator = await client();
  const observed = await ok(spectator, 'room:join', { roomCode: room.roomCode, nickname: 'Viewer' });
  assert.equal(observed.seatId, null);
  const outsider = await client();
  await denied(outsider, 'room:get', { roomCode: room.roomCode });
  await denied(friends[0], 'room:start', { roomCode: room.roomCode });
  await denied(host, 'room:seat', { roomCode: room.roomCode, seatId: '1' });
  await ok(host, 'room:start', { roomCode: room.roomCode, forcedHostGoldCount: 3 });
  let view = await ok(host, 'room:get', { roomCode: room.roomCode });
  assert.equal(view.game.state.hands['0'].length, 17);
  assert(view.game.state.hands['0'].every(tile => typeof tile === 'string'));
  for (const id of ['1', '2', '3']) assert(view.game.state.hands[id].every(tile => tile === null));
  assert(!('wall' in view.game.state));
  assert(!('actionLog' in view.game.state));
  const spectatorView = await ok(spectator, 'room:get', { roomCode: room.roomCode });
  assert(Object.values(spectatorView.game.state.hands).flat().every(tile => tile === null));
  await denied(host, 'room:seat', { roomCode: room.roomCode, seatId: '0' });
  await action(host, room.roomCode, 0, 'OPEN_GOLD');
  view = await ok(host, 'room:get', { roomCode: room.roomCode });
  for (const forged of [
    { type: 'DRAW', seatId: 0 },
    { type: 'DRAW', seatId: 1 },
    { type: 'DISCARD', seatId: 0, payload: { index: -1 } },
    { type: 'ROUND_START', seatId: 0, payload: { forcedHostGoldCount: 3 } },
  ]) await denied(host, 'game:action', { roomCode: room.roomCode, expectedVersion: view.game.version, action: { ...forged, clientActionId: crypto.randomUUID() } });
  const index = view.game.state.hands['0'].findIndex(tile => tile !== view.game.state.goldTile);
  const moveId = crypto.randomUUID();
  await action(host, room.roomCode, 0, 'DISCARD', { index }, moveId);
  const after = await ok(host, 'room:get', { roomCode: room.roomCode });
  assert.equal(after.game.state.hands['0'].length, 16);
  assert.equal(after.game.state.rivers['0'].length, 1);
  await ok(host, 'game:action', { roomCode: room.roomCode, expectedVersion: -1, action: { type: 'DISCARD', seatId: 0, payload: { index }, clientActionId: moveId } });
  assert.equal((await ok(host, 'room:get', { roomCode: room.roomCode })).game.state.rivers['0'].length, 1);
  await denied(host, 'game:action', { roomCode: room.roomCode, expectedVersion: -1, action: { type: 'DISCARD', seatId: 0, payload: { index }, clientActionId: crypto.randomUUID() } });

  const token = host.identity.token;
  host.disconnect();
  await waitFor(async () => (await ok(friends[0], 'room:get', { roomCode: room.roomCode })).seats['0'].control === 'bot');
  host = await client(token);
  view = await ok(host, 'room:get', { roomCode: room.roomCode });
  assert.equal(view.seats['0'].control, 'human');
  assert.equal(view.seats['0'].reservedUid, host.identity.uid);
  const all = [host, ...friends];
  const currentHost = all.find(socket => socket.identity.uid === view.meta.hostUid);
  await action(currentHost, room.roomCode, Number(Object.keys(view.seats).find(id => view.seats[id].uid === currentHost.identity.uid)), 'SET_AI_SPEED', { mode: 'fast' });
  for (const [id, player] of all.entries()) await ok(player, 'room:control', { roomCode: room.roomCode, seatId: String(id), control: 'bot' });
  const ended = await waitFor(async () => { const roomView = await ok(spectator, 'room:get', { roomCode: room.roomCode }); return roomView.game.state.phase === 'ended' ? roomView : null; });
  assert.equal(ended.game.state.scores.reduce((a, b) => a + b, 0), 0);
  assert(Object.values(ended.game.state.hands).flat().every(tile => typeof tile === 'string'));
  const hostSeat = Object.keys(ended.seats).find(id => ended.seats[id].uid === currentHost.identity.uid);
  await ok(currentHost, 'room:control', { roomCode: room.roomCode, seatId: hostSeat, control: 'human' });
  await action(currentHost, room.roomCode, Number(hostSeat), 'ROUND_START');
  const next = await ok(currentHost, 'room:get', { roomCode: room.roomCode });
  assert.equal(next.game.state.roundNo, 2);
  assert.deepEqual(next.game.state.scores, ended.game.state.scores);
  for (const player of [...all, spectator]) await ok(player, 'room:leave', { roomCode: room.roomCode });
  assert.equal(service.roomCount, 0);

  // One human can start a real four-seat table; empty seats become server AI.
  const solo = await ok(outsider, 'room:create', { nickname: 'Solo' });
  await ok(outsider, 'room:start', { roomCode: solo.roomCode });
  const soloView = await ok(outsider, 'room:get', { roomCode: solo.roomCode });
  assert.equal(Object.values(soloView.seats).filter(seat => seat.isBot).length, 3);
  await ok(outsider, 'room:leave', { roomCode: solo.roomCode });

  // Projection fixtures catch information leaks that random online play may miss.
  const state = createOnlineGameState();
  state.goldRevealed = true; state.goldTile = 'W1';
  state.currentDraw = { seatId: 1, tile: 'T9', ts: 10 };
  state.shows['1'] = [{ type: 'AN_GANG', tiles: ['S9', 'S9', 'S9', 'S9'] }];
  state.pendingClaim = { kind: 'DISCARD_CLAIM', discard: { seatId: 2, tile: 'W5' }, optionsBySeat: { '0': { PENG: true }, '1': { HU: true, huTypes: ['地胡'] } }, decisionOrder: ['1', '0'], decisions: {}, expiresAt: 100 };
  const fixture = { meta: {}, seats: { '0': { isBot: false, reservedUid: 'self' } }, presence: {}, members: new Set(['self']), game: { version: 1, state } };
  const projected = projectRoom(fixture, 'self').game.state;
  assert.equal(projected.currentDraw.tile, null);
  assert(projected.shows['1'][0].tiles.every(tile => tile === null));
  assert.deepEqual(Object.keys(projected.pendingClaim.optionsBySeat), ['0']);
  assert.equal(projected.pendingClaim.activeSeatId, '1');
  console.log('Mahjong multiplayer: rooms, 4 players, spectator privacy, authority, duplicate/stale actions, reconnect, AI complete round and next round passed');
} finally {
  clients.forEach(client => client.disconnect());
  service.dispose();
  await new Promise(resolve => io.close(resolve));
}
