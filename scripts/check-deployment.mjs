/** HTTP/assets and real Socket.IO deployment checks. No browser or screenshots. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readdir } from 'node:fs/promises';
const { io } = createRequire(new URL('../apps/web/package.json', import.meta.url))('socket.io-client');
const base = (process.argv[2] || 'http://127.0.0.1:3002').replace(/\/$/, '');
const sockets = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function http(path, type) {
  const response = await fetch(base + path, { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, 200, path);
  if (type) assert(response.headers.get('content-type')?.includes(type), path);
  return response;
}
function event(socket, name, accept = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off(name, handler); reject(new Error(`Timed out: ${name}`)); }, 10000);
    function handler(value) { if (accept(value)) { clearTimeout(timer); socket.off(name, handler); resolve(value); } }
    socket.on(name, handler);
  });
}
async function connect(namespace = '', transport = 'websocket') {
  const socket = io(base + namespace, { transports: [transport], reconnection: false, autoConnect: false });
  sockets.push(socket);
  const connected = event(socket, 'connect'); socket.connect(); await connected; return socket;
}
async function request(socket, name, data) {
  const response = await socket.timeout(10000).emitWithAck(name, data);
  assert.equal(response.ok, true, `${name}: ${JSON.stringify(response.error)}`);
  return response;
}
try {
  for (const path of ['/healthz', '/api/anqi/health', '/api/mahjong/health']) {
    assert.equal((await (await http(path, 'json')).json()).ok, true);
  }
  const html = await (await http('/', 'text/html')).text();
  assert(html.includes('\u5c0f\u9cc4\u9f99\u4e4b\u5bb6'));
  for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) await http(match[1]);
  for (const path of ['/characters/character_girl_crocodile.png', '/members/background.jpg', '/members/woodstock.png']) await http(path, 'image/');
  const dist = new URL('../apps/web/dist/', import.meta.url);
  for (const dir of ['hall', 'assets']) {
    const files = await readdir(new URL(`${dir}/`, dist));
    for (const file of files.filter(f => dir === 'hall' ? /\.(png|webp|jpe?g)$/.test(f) : /\.glb$/.test(f))) {
      const response = await http(`/${dir}/${file}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assert(bytes.length > 100, file);
      if (file.endsWith('.glb')) assert.equal(Buffer.from(bytes.subarray(0, 4)).toString(), 'glTF');
    }
  }
  await http('/mahjong/index.html', 'text/html');
  console.log('PASS health, homepage title, entry bundles, covers, member images and all GLB assets');
  for (const gameId of ['trouble-magician', 'corcodragon-fight']) {
    const host = await connect(); let guest = await connect('', 'polling');
    try {
      const room = await request(host, 'createRoom', { name: 'DeployHost', gameId, botCount: 0 });
      const joined = await request(guest, 'joinRoom', { code: room.code, name: 'DeployGuest' });
      const stateEvent = gameId === 'trouble-magician' ? 'state' : 'rtSnapshot';
      const started = event(host, stateEvent); host.emit('startGame'); await started;
      guest.disconnect(); await sleep(200); guest = await connect();
      const recovered = event(guest, stateEvent);
      const rejoined = await request(guest, 'joinRoom', { code: room.code, name: 'DeployGuest', token: joined.playerId });
      assert.equal(rejoined.rejoin, true); await recovered;
      console.log(`PASS ${gameId}: create/join/start/reconnect, polling and WebSocket`);
    } finally { host.emit('leaveRoom'); guest.emit('leaveRoom'); await sleep(200); host.disconnect(); guest.disconnect(); }
  }
  const anqiHost = await connect('/anqi'); let anqiGuest = await connect('/anqi');
  try {
    const room = (await request(anqiHost, 'room:create', { nickname: 'DeployHost' })).data;
    const started = event(anqiHost, 'room:snapshot', s => s.phase === 'playing');
    const joined = (await request(anqiGuest, 'room:join', { nickname: 'DeployGuest', roomCode: room.session.roomCode })).data;
    await started; anqiGuest.disconnect(); await sleep(200); anqiGuest = await connect('/anqi');
    const resumed = (await request(anqiGuest, 'room:resume', joined.session)).data;
    assert.equal(resumed.snapshot.phase, 'playing');
    console.log('PASS anqi: create/join/automatic start/resume; disconnected test room expires automatically');
  } finally { anqiHost.disconnect(); anqiGuest.disconnect(); }
  const host = await connect('/zhangzhou-mahjong'); let guest = await connect('/zhangzhou-mahjong'); let roomCode;
  try {
    await request(host, 'session:open', {});
    const guestSession = (await request(guest, 'session:open', {})).data;
    roomCode = (await request(host, 'room:create', { nickname: 'DeployHost' })).data.roomCode;
    await request(guest, 'room:join', { nickname: 'DeployGuest', roomCode });
    await request(host, 'room:start', { roomCode });
    assert.equal((await request(guest, 'room:get', { roomCode })).data.meta.status, 'playing');
    guest.disconnect(); await sleep(200); guest = await connect('/zhangzhou-mahjong');
    await request(guest, 'session:open', { token: guestSession.token });
    assert.equal((await request(guest, 'room:get', { roomCode })).data.meta.status, 'playing');
    console.log('PASS zhangzhou-mahjong: create/join/start/resume');
  } finally {
    if (roomCode) for (const socket of [guest, host]) if (socket.connected) await request(socket, 'room:leave', { roomCode });
    host.disconnect(); guest.disconnect();
  }
  console.log(`Deployment checks passed: ${base}`);
} finally { for (const socket of sockets) socket.disconnect(); }
