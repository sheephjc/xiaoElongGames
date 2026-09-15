/**
 * 《鳄龙咆哮》realtime 联机端到端冒烟：
 * 创建 realtime 房间（+2 bot）→ 加入 → 开始 → 选英雄 → 输入/快照 →
 * 非法输入被安全拒绝 → 断线 AI 接管 → 重连恢复 → 对局自然结束。
 * 用法：先启动服务端(8787)，`pnpm --filter @tm/server exec node scripts/smoke-realtime.mjs`
 */
import { io } from 'socket.io-client';

const URL = process.argv[2] ?? process.env.TM_SERVER ?? 'http://127.0.0.1:8787';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => {
  console.error(`❌ ${msg}`);
  process.exit(1);
};
const waitEvent = (socket, event, timeoutMs = 10_000, accept = () => true) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, on);
      reject(new Error(`等待 ${event} 超时`));
    }, timeoutMs);
    const on = (payload) => {
      if (!accept(payload)) return;
      clearTimeout(t);
      socket.off(event, on);
      resolve(payload);
    };
    socket.on(event, on);
  });

const a = io(URL, { transports: ['websocket'] });
const b = io(URL, { transports: ['websocket'] });
await Promise.all([new Promise((r) => a.on('connect', r)), new Promise((r) => b.on('connect', r))]);
console.log('✅ 两个客户端已连接');

const created = await new Promise((resolve) =>
  a.emit(
    'createRoom',
    {
      name: '鳄龙A',
      botCount: 3,
      gameId: 'corcodragon-fight',
      config: { mode: 'ffa', scoreLimit: 2, heroSelectMs: 8000, aiLevel: 'hard', tickHz: 60 },
    },
    resolve,
  ),
);
if (!created.ok) fail(`建房失败：${created.error}`);
console.log(`✅ 房间已创建 ${created.code}`);

// 先订阅再加入，避免 ack 返回前已收到的一次性大厅广播丢失。
const lobbyPromise = waitEvent(a, 'lobby', 10_000, (lobby) => lobby.players.length === 5);
const joined = await new Promise((resolve) =>
  b.emit('joinRoom', { code: created.code, name: '鳄龙B' }, resolve),
);
if (!joined.ok) fail(`加入失败：${joined.error}`);
console.log(`✅ B 已加入（playerId=${joined.playerId}）`);

const lobby1 = await lobbyPromise;
if (lobby1.gameId !== 'corcodragon-fight' || lobby1.players.length !== 5) {
  fail(`lobby 异常：${JSON.stringify(lobby1)}`);
}
console.log(`✅ lobby 正常（gameId=${lobby1.gameId}，5 座位）`);

const firstSnapshot = waitEvent(a, 'rtSnapshot');
a.emit('startGame');
const snapA1 = await firstSnapshot;
if (snapA1.phase !== 'heroSelect') fail(`期望 heroSelect，得到 ${snapA1.phase}`);
console.log('✅ 服务端开始 tick，收到 heroSelect 快照');

a.emit('rtInput', { input: { type: 'selectHero', hero: 'yanren' } });
b.emit('rtInput', { input: { type: 'selectHero', hero: 'lingyin' } });

let playing = null;
for (let i = 0; i < 200 && !playing; i++) {
  await sleep(100);
  const s = await waitEvent(a, 'rtSnapshot', 500).catch(() => null);
  if (s && s.phase === 'playing') playing = s;
}
if (!playing) fail('未进入 playing 阶段');
console.log(`✅ 进入 playing（t=${playing.t}ms，seq=${playing.seq}）`);

a.emit('rtInput', { input: { type: 'move', x: 0, z: 1 } });
a.emit('rtInput', { input: { type: 'look', yaw: 0.5, pitch: 0.1 } });

// 输入序号回执：seq=42 送达后，本人快照 lastInputSeq 应 >= 42
a.emit('rtInput', { input: { type: 'move', x: 0.4, z: 0.2 }, seq: 42 });
let acked = false;
for (let i = 0; i < 100 && !acked; i++) {
  await sleep(50);
  const s = await waitEvent(a, 'rtSnapshot', 500).catch(() => null);
  const me = s?.players.find((p) => p.id === s.youId);
  if (me && me.lastInputSeq >= 42) acked = true;
}
if (!acked) fail('输入序号未收到服务端回执');
console.log('✅ 输入 seq=42 已回执');

// 延迟探测：rtPing ack
const sentAt = Date.now();
const pong = await new Promise((resolve) => a.emit('rtPing', { sentAt }, resolve));
const rtt = Date.now() - sentAt;
if (!pong || typeof pong.serverNow !== 'number') fail('rtPing 返回异常');
console.log(`✅ 延迟探测：RTT=${rtt}ms（估算单程 ${Math.round(rtt / 2)}ms）`);

// 非法输入必须被服务端安全拒绝（1s 节流内首个错误会下发）
const errorPromise = waitEvent(a, 'error', 2000).catch(() => null);
a.emit('rtInput', { input: { type: 'hackThePlanet' } });
const err = await errorPromise;
if (!err) fail('非法输入未返回错误');
console.log(`✅ 非法输入被拒绝：${err}`);

// B 断线 → AI 接管；重连 → 恢复真人（先挂监听再断开，避免错过一次性 lobby 广播）
const autopilotPromise = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('等待 AI 接管广播超时')), 8000);
  const on = (l) => {
    const bp = l.players.find((p) => p.id === joined.playerId);
    if (bp && bp.autopilot) {
      clearTimeout(t);
      a.off('lobby', on);
      resolve(l);
    }
  };
  a.on('lobby', on);
});
b.disconnect();
await autopilotPromise;
console.log('✅ B 断线 → 引擎 AI 接管');

const b2 = io(URL, { transports: ['websocket'] });
await new Promise((r) => b2.on('connect', r));
const recoverPromise = new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('等待重连恢复广播超时')), 8000);
  const on = (l) => {
    const bp = l.players.find((p) => p.id === joined.playerId);
    if (bp && bp.connected && !bp.autopilot) {
      clearTimeout(t);
      a.off('lobby', on);
      resolve(l);
    }
  };
  a.on('lobby', on);
});
const rejoined = await new Promise((resolve) =>
  b2.emit('joinRoom', { code: created.code, name: '鳄龙B', token: joined.playerId }, resolve),
);
if (!rejoined.ok || !rejoined.rejoin) fail(`重连失败：${JSON.stringify(rejoined)}`);
await recoverPromise;
const snapB = await waitEvent(b2, 'rtSnapshot', 5000);
if (snapB.youId !== joined.playerId) fail('重连快照 youId 错误');
console.log('✅ B 重连恢复，收到本人视角快照');

// 等对局自然结束（持续监听 rtSnapshot，避免轮询错过事件）
const gameOver = await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('对局未在预期时间内结束')), 180_000);
  const on = (s) => {
    if (s?.phase === 'gameOver') {
      clearTimeout(t);
      a.off('rtSnapshot', on);
      resolve(s);
    }
  };
  a.on('rtSnapshot', on);
});
console.log(`✅ 对局结束：winnerId=${gameOver.winnerId}（${gameOver.events.at(-1)?.text ?? ''}）`);

a.disconnect();
b2.disconnect();
console.log('🎉 realtime 冒烟全部通过');
process.exit(0);
