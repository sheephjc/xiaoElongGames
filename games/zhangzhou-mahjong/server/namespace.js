import { randomBytes, randomUUID, randomInt } from 'node:crypto';
import { buildHumanSeat, normalizeSeatsForStart, createStartedGameState, defaultStateReducer } from '../client/src/room-reducer.js';
import { runBotTurns, syncSeatControlsToGameState, getSelfDrawHuInfo, hasMandatorySanJinHu } from '../client/src/online-game-engine.js';

const copy = value => structuredClone(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const nickname = value => String(typeof value === 'string' ? value : '').trim().slice(0, 8) || '你';
const codeOf = value => typeof value === 'string' && /^[A-Z0-9]{6}$/.test(value.toUpperCase()) ? value.toUpperCase() : '';
const seatOf = (room, uid) => Object.keys(room.seats).find(id => !room.seats[id].isBot && room.seats[id].reservedUid === uid) ?? null;
const activeClaimSeat = pending => (pending?.decisionOrder || Object.keys(pending?.optionsBySeat || {})).find(id => pending.optionsBySeat?.[id] && !pending.decisions?.[id]) ?? null;
const SESSION_TTL = 24 * 60 * 60 * 1000;
const EMPTY_ROOM_TTL = 15 * 60 * 1000;

/** Only the viewer's concealed tiles and decisions leave the server. */
export function projectRoom(room, uid) {
  const seatId = seatOf(room, uid);
  const state = room.game.state;
  let view = null;
  if (state) {
    const fields = ['phase', 'startedAt', 'endedAt', 'roundNo', 'roundCount', 'dealerSeat', 'dealerStreak', 'turnSeat', 'goldRevealed', 'goldRevealedAt', 'goldRevealedBy', 'scores', 'rivers', 'flowers', 'shows', 'lastDiscard', 'winner', 'outcome', 'instantScoreLog', 'chuiFeng', 'aiSpeedMode', 'seatControls'];
    view = Object.fromEntries(fields.filter(key => key in state).map(key => [key, copy(state[key])]));
    const ended = state.phase === 'ended';
    view.goldTile = state.goldRevealed ? state.goldTile : null;
    view.wallCount = state.wall.length;
    view.hands = Object.fromEntries(Object.entries(state.hands).map(([id, hand]) => [id, ended || id === seatId ? [...hand] : hand.map(() => null)]));
    view.currentDraw = state.currentDraw ? { ...copy(state.currentDraw), tile: ended || String(state.currentDraw.seatId) === seatId ? state.currentDraw.tile : null } : null;
    if (!ended) for (const [id, groups] of Object.entries(view.shows)) {
      if (id !== seatId) for (const group of groups) if (group.type === 'AN_GANG') group.tiles = group.tiles.map(() => null);
    }
    view.lastAction = state.lastAction ? { type: state.lastAction.type, seatId: state.lastAction.seatId, ts: state.lastAction.ts, payload: {} } : null;
    if (view.lastAction && (ended || String(state.lastAction.seatId) === seatId || ['DISCARD', 'CHI', 'PENG', 'GANG', 'BU_GANG', 'HU', 'OPEN_GOLD'].includes(state.lastAction.type))) {
      view.lastAction.payload = copy(state.lastAction.payload || {});
    }
    const pending = state.pendingClaim;
    view.pendingClaim = pending ? {
      kind: pending.kind, discard: copy(pending.discard || null), source: copy(pending.source || null),
      openedAt: pending.openedAt, expiresAt: pending.expiresAt, openedBy: pending.openedBy,
      activeSeatId: activeClaimSeat(pending),
      optionsBySeat: seatId !== null && pending.optionsBySeat?.[seatId] ? { [seatId]: copy(pending.optionsBySeat[seatId]) } : {},
      decisions: seatId !== null && pending.decisions?.[seatId] ? { [seatId]: copy(pending.decisions[seatId]) } : {},
    } : null;
  }
  return { meta: copy(room.meta), seats: copy(room.seats), presence: copy(room.presence), game: { version: room.game.version, state: view }, actions: {}, memberUids: Object.fromEntries([...room.members].map(id => [id, true])) };
}

function validateAction(room, session, input) {
  const state = room.game.state;
  const seatId = seatOf(room, session.uid);
  assert(state && seatId !== null, '请先入座并开始对局。');
  assert(input && typeof input === 'object' && !Array.isArray(input), '操作格式无效。');
  assert(input.seatId === Number(seatId), '不能操作其他玩家的座位。');
  assert(room.seats[seatId].control === 'human', '请先取消托管。');
  const type = input.type;
  const p = input.payload || {};
  const payload = {};
  if (type === 'SET_AI_SPEED') {
    assert(room.meta.hostUid === session.uid && ['normal', 'fast'].includes(p.mode), '只有房主可以调整 AI 速度。');
    payload.mode = p.mode;
  } else if (type === 'ROUND_START' || type === 'OPEN_GOLD') {
    assert(Number(seatId) === state.dealerSeat || (state.seatControls[String(state.dealerSeat)] === 'bot' && room.meta.hostUid === session.uid), '请等待庄家操作。');
    assert(type === 'ROUND_START' ? state.phase === 'ended' : state.phase === 'playing' && !state.goldRevealed, '当前不能执行此操作。');
  } else {
    assert(state.phase === 'playing' && state.goldRevealed, '请等待开金或下一局。');
    if (state.pendingClaim) {
      const pending = state.pendingClaim;
      const options = pending.optionsBySeat[seatId];
      assert(activeClaimSeat(pending) === seatId && options && !pending.decisions[seatId], '请等待轮到你响应。');
      assert(type === 'PASS' || ['HU', 'PENG', 'GANG', 'CHI'].includes(type) && options[type], '当前没有此响应选项。');
      if (type === 'CHI') {
        assert(Array.isArray(p.choice) && p.choice.length === 2 && options.CHI.some(choice => JSON.stringify(choice) === JSON.stringify(p.choice)), '吃牌组合无效。');
        payload.choice = [...p.choice];
      }
    } else {
      assert(state.turnSeat === Number(seatId), '还没有轮到你。');
      assert(['DISCARD', 'HU', 'AN_GANG', 'BU_GANG'].includes(type), '此操作由服务器自动处理或当前不可用。');
      assert(type === 'HU' || !hasMandatorySanJinHu(state, Number(seatId)), '三金倒，请胡牌。');
      const hand = state.hands[seatId];
      if (type === 'DISCARD') {
        assert(Number.isInteger(p.index) && p.index >= 0 && p.index < hand.length, '打牌位置无效。');
        assert(hand[p.index] !== state.goldTile, '金牌不能打出。');
        payload.index = p.index;
      } else if (type === 'HU') assert(getSelfDrawHuInfo(state, Number(seatId)).canHu, '当前不能胡牌。');
      else {
        const tile = p.char || p.tile;
        assert(typeof tile === 'string' && tile !== state.goldTile && hand.includes(tile), '杠牌无效。');
        assert(type === 'AN_GANG' ? hand.filter(t => t === tile).length === 4 : state.shows[seatId].some(group => group.type === 'PENG' && group.tiles[0] === tile), '当前不能杠这张牌。');
        payload.char = tile;
      }
    }
  }
  return { type, seatId: Number(seatId), payload, ts: Date.now() };
}

/** @param {import('socket.io').Namespace} io */
export function bindMahjongNamespace(io, { tickMs = 100, emptyRoomTtl = EMPTY_ROOM_TTL, ipOf = socket => socket.handshake.address } = {}) {
  const rooms = new Map();
  const sessions = new Map();
  const sessionsByUid = new Map();
  const connectionsByIp = new Map();
  const broadcast = room => {
    for (const uid of room.members) {
      const session = sessionsByUid.get(uid);
      const socket = session && io.sockets.get(session.socketId);
      if (socket) socket.emit('room:snapshot', projectRoom(room, uid));
    }
  };
  const update = room => { room.meta.updatedAt = Date.now(); room.meta.version++; broadcast(room); };
  const sessionOf = socket => {
    const session = sessionsByUid.get(socket.data.uid);
    assert(session && session.socketId === socket.id, '会话失效，请刷新重试。');
    session.lastSeen = Date.now();
    return session;
  };
  const roomOf = (session, code) => {
    const room = rooms.get(codeOf(code));
    assert(room && room.members.has(session.uid) && session.roomCode === room.meta.roomCode, '房间不存在或你尚未加入。');
    return room;
  };
  const syncControls = room => {
    if (room.game.state) room.game.state = syncSeatControlsToGameState(room.game.state, room.seats, Date.now());
  };
  const electHost = room => {
    if (room.presence[room.meta.hostUid]?.online && seatOf(room, room.meta.hostUid) !== null) return;
    const next = [...room.members].find(uid => room.presence[uid]?.online && seatOf(room, uid) !== null);
    if (next) room.meta.hostUid = next;
  };
  const memberResult = (room, session) => ({ uid: session.uid, roomCode: room.meta.roomCode, seatId: seatOf(room, session.uid), nickname: room.presence[session.uid].nickname, spectator: seatOf(room, session.uid) === null });
  const markOnline = (room, session) => {
    const presence = room.presence[session.uid];
    if (presence) presence.online = true;
    const seatId = seatOf(room, session.uid);
    if (seatId !== null) Object.assign(room.seats[seatId], { online: true, control: room.seats[seatId].trustee ? 'bot' : 'human', lastSeen: Date.now() });
    room.emptySince = null;
    syncControls(room); electHost(room); update(room);
  };
  const leave = (room, session) => {
    const seatId = seatOf(room, session.uid);
    if (seatId !== null) {
      if (room.meta.status === 'waiting') delete room.seats[seatId];
      else room.seats[seatId] = { ...room.seats[seatId], uid: `bot-${seatId}`, reservedUid: null, isBot: true, online: true, control: 'bot', trustee: false, nickname: `AI-${Number(seatId) + 1}` };
    }
    room.members.delete(session.uid); delete room.presence[session.uid]; session.roomCode = null;
    syncControls(room); electHost(room);
    if (!room.members.size) rooms.delete(room.meta.roomCode);
    else { if (![...room.members].some(uid => room.presence[uid]?.online)) room.emptySince ||= Date.now(); update(room); }
  };

  io.on('connection', socket => {
    const ip = ipOf(socket);
    const count = connectionsByIp.get(ip) || 0;
    if (count >= 16) { socket.disconnect(true); return; }
    connectionsByIp.set(ip, count + 1);
    let budget = { at: Date.now(), count: 0 };
    const handle = (event, fn) => socket.on(event, (input, ack) => {
      if (typeof ack !== 'function') return;
      try {
        if (Date.now() - budget.at > 1000) budget = { at: Date.now(), count: 0 };
        assert(++budget.count <= 30, '操作过于频繁，请稍后重试。');
        ack({ ok: true, data: fn(input || {}) });
      } catch (error) { ack({ ok: false, error: error.message || '操作失败。' }); }
    });
    handle('session:open', input => {
      assert(!socket.data.uid, '会话已经建立。');
      let session = typeof input.token === 'string' ? sessions.get(input.token) : null;
      if (!session) {
        assert(!input.token, '会话已过期，请重新进入房间。');
        assert(sessions.size < 1000, '服务器繁忙，请稍后再试。');
        session = { uid: randomUUID(), token: randomBytes(24).toString('hex'), socketId: socket.id, roomCode: null, lastSeen: Date.now() };
        sessions.set(session.token, session); sessionsByUid.set(session.uid, session);
      }
      const oldSocket = io.sockets.get(session.socketId);
      session.socketId = socket.id; session.lastSeen = Date.now(); socket.data.uid = session.uid;
      if (oldSocket && oldSocket !== socket) oldSocket.disconnect(true);
      const room = rooms.get(session.roomCode);
      if (room) markOnline(room, session);
      else session.roomCode = null;
      return { uid: session.uid, token: session.token };
    });
    handle('room:create', input => {
      const session = sessionOf(socket);
      assert(!session.roomCode, '请先离开当前房间。');
      assert(rooms.size < 200 && [...rooms.values()].filter(room => room.ownerIp === ip).length < 5, '房间数量已达上限。');
      let code;
      do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
      const now = Date.now();
      const name = nickname(input.nickname);
      const room = { meta: { roomCode: code, status: 'waiting', hostUid: session.uid, version: 0, createdAt: now, updatedAt: now }, seats: { '0': buildHumanSeat('0', session.uid, name) }, presence: { [session.uid]: { online: true, seatId: '0', nickname: name } }, game: { version: 0, state: null }, members: new Set([session.uid]), ownerIp: ip, emptySince: null, processed: new Map() };
      rooms.set(code, room); session.roomCode = code; update(room);
      return memberResult(room, session);
    });
    handle('room:join', input => {
      const session = sessionOf(socket);
      const room = rooms.get(codeOf(input.roomCode));
      assert(room, '房间不存在或已关闭。');
      assert(!session.roomCode || session.roomCode === room.meta.roomCode, '请先离开当前房间。');
      if (room.members.has(session.uid)) { markOnline(room, session); return memberResult(room, session); }
      assert(room.members.size < 9, '房间已满。');
      const seatId = ['0', '1', '2', '3'].find(id => !room.seats[id] || room.seats[id].isBot) ?? null;
      const name = nickname(input.nickname);
      if (seatId !== null) room.seats[seatId] = buildHumanSeat(seatId, session.uid, name);
      room.members.add(session.uid); room.presence[session.uid] = { online: true, seatId, nickname: name };
      session.roomCode = room.meta.roomCode; markOnline(room, session);
      return memberResult(room, session);
    });
    handle('room:get', input => { const session = sessionOf(socket); return projectRoom(roomOf(session, input.roomCode), session.uid); });
    handle('room:presence', input => { const session = sessionOf(socket); const room = roomOf(session, input.roomCode); markOnline(room, session); return memberResult(room, session); });
    handle('room:seat', input => {
      const session = sessionOf(socket); const room = roomOf(session, input.roomCode);
      assert(room.meta.status === 'waiting', '对局开始后不能换座。');
      const target = input.seatId === null ? null : String(input.seatId);
      assert(target === null || ['0', '1', '2', '3'].includes(target), '座位无效。');
      assert(target === null || !room.seats[target] || room.seats[target].isBot || room.seats[target].reservedUid === session.uid, '座位已被占用。');
      assert(target !== null || [...room.members].filter(uid => seatOf(room, uid) === null).length < 5, '观战席已满。');
      const previous = seatOf(room, session.uid);
      if (previous !== null) delete room.seats[previous];
      if (target !== null) room.seats[target] = buildHumanSeat(target, session.uid, room.presence[session.uid].nickname);
      room.presence[session.uid].seatId = target; electHost(room); update(room);
      return memberResult(room, session);
    });
    handle('room:start', input => {
      const session = sessionOf(socket); const room = roomOf(session, input.roomCode);
      assert(room.meta.hostUid === session.uid && seatOf(room, session.uid) !== null, '只有入座的房主可以开局。');
      assert(room.meta.status === 'waiting', '对局已经开始。');
      room.seats = normalizeSeatsForStart(room.seats); room.meta.status = 'playing';
      room.game.state = createStartedGameState(room.seats, Date.now(), 1, { hostUid: session.uid });
      room.game.version++; update(room); return null;
    });
    handle('room:control', input => {
      const session = sessionOf(socket); const room = roomOf(session, input.roomCode); const seatId = seatOf(room, session.uid);
      assert(seatId !== null && String(input.seatId) === seatId && ['human', 'bot'].includes(input.control), '只能切换自己的托管状态。');
      Object.assign(room.seats[seatId], { trustee: input.control === 'bot', control: input.control });
      syncControls(room); room.game.version++; update(room); return null;
    });
    handle('game:action', input => {
      const session = sessionOf(socket); const room = roomOf(session, input.roomCode);
      const id = input.action?.clientActionId;
      assert(typeof id === 'string' && id.length > 0 && id.length <= 128, '操作标识无效。');
      const key = `${session.uid}:${id}`;
      if (room.processed.has(key)) return null;
      assert(Number.isInteger(input.expectedVersion) && input.expectedVersion === room.game.version, '牌局已更新，请重新操作。');
      const action = validateAction(room, session, input.action);
      room.game.state = defaultStateReducer(room.game.state, action, Date.now(), { seats: room.seats, hostUid: room.meta.hostUid, actorUid: session.uid });
      room.game.version++; room.processed.set(key, true);
      if (room.processed.size > 200) room.processed.delete(room.processed.keys().next().value);
      update(room); return null;
    });
    handle('room:leave', input => { const session = sessionOf(socket); leave(roomOf(session, input.roomCode), session); return null; });
    socket.on('disconnect', () => {
      const remaining = (connectionsByIp.get(ip) || 1) - 1;
      if (remaining) connectionsByIp.set(ip, remaining); else connectionsByIp.delete(ip);
      const session = sessionsByUid.get(socket.data.uid);
      if (!session || session.socketId !== socket.id) return;
      session.socketId = null; session.lastSeen = Date.now();
      const room = rooms.get(session.roomCode);
      if (!room) return;
      room.presence[session.uid].online = false;
      const seatId = seatOf(room, session.uid);
      if (seatId !== null) Object.assign(room.seats[seatId], { online: false, control: 'bot', trustee: false });
      syncControls(room); electHost(room); room.game.version++;
      if (![...room.members].some(uid => room.presence[uid]?.online)) room.emptySince ||= Date.now();
      update(room);
    });
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.emptySince && now - room.emptySince > emptyRoomTtl) {
        for (const uid of room.members) { const session = sessionsByUid.get(uid); if (session) session.roomCode = null; }
        rooms.delete(room.meta.roomCode); continue;
      }
      if (!room.game.state || room.emptySince) continue;
      try {
        const before = JSON.stringify(projectRoom(room, null).game.state);
        const result = runBotTurns(room.game.state, room.seats, now, 1);
        room.game.state = result.state;
        if (before !== JSON.stringify(projectRoom(room, null).game.state)) { room.game.version++; update(room); }
      } catch (error) { console.error('[mahjong] tick failed', error); }
    }
    for (const [token, session] of sessions) if (!session.roomCode && !session.socketId && now - session.lastSeen > SESSION_TTL) { sessions.delete(token); sessionsByUid.delete(session.uid); }
  }, tickMs);
  timer.unref();
  return { get roomCount() { return rooms.size; }, dispose() { clearInterval(timer); rooms.clear(); sessions.clear(); sessionsByUid.clear(); } };
}
