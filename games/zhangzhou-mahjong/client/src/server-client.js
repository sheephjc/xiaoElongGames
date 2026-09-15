const AUTH_KEY = 'tm-mahjong-identity';
const socket = window.io('/zhangzhou-mahjong', { autoConnect: false });
let identity = null;
let authentication = null;
const listeners = new Set();
let snapshot = null;

function readIdentity() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}
function rawRequest(event, data) {
  return new Promise((resolve, reject) => socket.timeout(10000).emit(event, data, (error, result) => {
    if (error) { reject(new Error('连接超时，请检查服务器连接。')); return; }
    if (!result?.ok) { reject(new Error(result?.error || '操作失败。')); return; }
    resolve(result.data);
  }));
}
function openSession() {
  if (authentication) return authentication;
  authentication = (async () => {
    const cached = identity || readIdentity();
    try {
      identity = await rawRequest('session:open', { token: cached?.token || '' });
    } catch (error) {
      if (!error.message.includes('会话已过期')) throw error;
      identity = await rawRequest('session:open', {});
      try { sessionStorage.removeItem('tm-mahjong-room'); } catch { /* optional storage */ }
    }
    try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(identity)); } catch { /* optional storage */ }
    return identity;
  })().catch(error => { authentication = null; throw error; });
  return authentication;
}
socket.on('room:snapshot', room => {
  snapshot = room;
  for (const listener of listeners) listener(room);
});
socket.on('connect', () => { openSession().catch(error => console.error('[mahjong]', error.message)); });
socket.on('disconnect', () => {
  authentication = null;
  window.dispatchEvent(new CustomEvent('mahjong-connection', { detail: '连接已断开，正在重连…' }));
});
socket.on('connect_error', () => {
  window.dispatchEvent(new CustomEvent('mahjong-connection', { detail: '无法连接服务器，正在重试…' }));
});

export async function ensureServerSession() {
  if (!socket.connected) {
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timeout); socket.off('connect', done); resolve(); };
      const timeout = setTimeout(() => { socket.off('connect', done); reject(new Error('无法连接游戏服务器，请稍后重试。')); }, 10000);
      socket.once('connect', done); socket.connect();
    });
  }
  return openSession();
}
export async function request(event, data) {
  await ensureServerSession();
  return rawRequest(event, data);
}
export function watchRoom(code, callback) {
  const listener = room => { if (!room || room.meta.roomCode === code) callback(room); };
  listeners.add(listener);
  if (snapshot?.meta.roomCode === code) queueMicrotask(() => listener(snapshot));
  request('room:get', { roomCode: code }).then(room => { snapshot = room; if (listeners.has(listener)) listener(room); }).catch(error => {
    window.dispatchEvent(new CustomEvent('mahjong-connection', { detail: error.message }));
  });
  return () => listeners.delete(listener);
}
export function currentVersion() { return snapshot?.game.version; }
