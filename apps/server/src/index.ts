/**
 * 《出包魔法师》联机服务端入口。
 * - Socket.IO 房间制对战（断线自动托管）
 * - 生产环境同端口托管 apps/web 的构建产物
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import express from 'express';
import { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@tm/rules';
import { Room, RoomSocket, genRoomCode, sanitizeName } from './room';
import { RealtimeRoom, RT_GAME_ID } from './realtime-room';
import { clientIp, sanitizeJoinCode } from './security';
import { bindAnqiNamespace, type AnqiNamespace } from '@tm/game-anqi/server';
import { bindMahjongNamespace } from '@tm/game-zhangzhou-mahjong/server';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '0.0.0.0';
/** 仅当部署在可信反向代理后时置 1，才允许 X-Forwarded-For 参与限流/审计 */
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

// ---- 资源限制（防滥用/耗尽攻击） ----
const MAX_ROOMS = 200; // 全局房间数上限
const MAX_ROOMS_PER_IP = 5; // 每个 IP 可同时创建的房间数
const MAX_CONNS_PER_IP = 8; // 每个 IP 最大并发连接数
const MAX_SOCKET_PAYLOAD = 64 * 1024; // 64KB：正常输入远小于此值

const app = express();
app.disable('x-powered-by');
const server = http.createServer(app);

// CORS：默认仅同源（vite 代理/同端口部署均同源）；前后端分离部署时用 CORS_ORIGIN 配白名单
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
  : false;
const io = new Server<ClientToServerEvents, ServerToClientEvents>(server, {
  cors: { origin: corsOrigin },
  maxHttpBufferSize: MAX_SOCKET_PAYLOAD,
});
// 暗棋协议独立于原有大厅协议，共用 HTTP / WebSocket 端口。
const anqiRooms = bindAnqiNamespace(io.of('/anqi') as unknown as AnqiNamespace);
app.get('/api/anqi/health', (_req, res) => res.json({ ok: true, rooms: anqiRooms.roomCount }));
const mahjongRooms = bindMahjongNamespace(io.of('/zhangzhou-mahjong'), {
  ipOf: socket => clientIp(socket.handshake, TRUST_PROXY),
});
app.get('/api/mahjong/health', (_req, res) => res.json({ ok: true, rooms: mahjongRooms.roomCount }));

const rooms = new Map<string, Room | RealtimeRoom>();
const connByIp = new Map<string, number>();
const roomsByIp = new Map<string, number>();

function ipOf(socket: RoomSocket): string {
  return clientIp(socket.handshake, TRUST_PROXY);
}

function guard<T>(fn: () => T): void {
  try {
    fn();
  } catch (err) {
    console.error('[server] handler error:', err);
  }
}

// 健康检查（部署探活用）
app.get('/healthz', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size, uptime: Math.round(process.uptime()) });
});

function uniqueCode(): string {
  for (let i = 0; i < 20; i++) {
    const code = genRoomCode();
    if (!rooms.has(code)) return code;
  }
  throw new Error('房间号生成失败');
}

io.on('connection', (socket: RoomSocket) => {
  socket.data = {};

  // 每 IP 并发连接限制（防单机刷连接）
  const ip = ipOf(socket);
  const conns = connByIp.get(ip) ?? 0;
  if (conns >= MAX_CONNS_PER_IP) {
    socket.disconnect(true);
    return;
  }
  connByIp.set(ip, conns + 1);
  const releaseConn = () => {
    const n = (connByIp.get(ip) ?? 1) - 1;
    if (n <= 0) connByIp.delete(ip);
    else connByIp.set(ip, n);
  };

  socket.on('listRooms', (cb) => {
    guard(() => cb({ rooms: [...rooms.values()].map((r) => r.listItem()) }));
  });

  socket.on('createRoom', (payload, cb) => {
    guard(() => {
      if (rooms.size >= MAX_ROOMS) {
        cb({ ok: false, error: '服务器繁忙，请稍后再试' });
        return;
      }
      if ((roomsByIp.get(ip) ?? 0) >= MAX_ROOMS_PER_IP) {
        cb({ ok: false, error: '创建的进行中房间过多，请稍后再试' });
        return;
      }
      const name = sanitizeName(payload?.name);
      const playerId = randomUUID();
      const code = uniqueCode();
      const creatorIp = ip;
      const onEmpty = (c: string) => {
        // 房间销毁时回退该 IP 的建房计数（防计数泄漏导致误限流）
        rooms.delete(c);
        const n = (roomsByIp.get(creatorIp) ?? 1) - 1;
        if (n <= 0) roomsByIp.delete(creatorIp);
        else roomsByIp.set(creatorIp, n);
      };
      const room: Room | RealtimeRoom =
        payload?.gameId === RT_GAME_ID
          ? new RealtimeRoom(
              code,
              playerId,
              name,
              payload?.config,
              payload?.password,
              payload?.botCount,
              io,
              onEmpty,
            )
          : new Room(
              code,
              playerId,
              name,
              payload?.settings,
              payload?.password,
              payload?.botCount,
              io,
              onEmpty,
            );
      rooms.set(code, room);
      roomsByIp.set(ip, (roomsByIp.get(ip) ?? 0) + 1);
      socket.join(code);
      socket.data = { roomCode: code, playerId };
      room.attach(socket.id, playerId);
      cb({ ok: true, code, playerId });
      room.broadcastLobby();
    });
  });

  socket.on('joinRoom', (payload, cb) => {
    guard(() => {
      const code = sanitizeJoinCode(payload?.code);
      const name = sanitizeName(payload?.name);
      const room = rooms.get(code);
      if (!room) {
        cb({ ok: false, error: '房间不存在，请检查房间码' });
        return;
      }
      const res = room.join(name, payload?.token, socket.id, payload?.password);
      if (!res.ok) {
        cb({ ok: false, error: res.error });
        return;
      }
      socket.join(code);
      socket.data = { roomCode: code, playerId: res.playerId };
      room.attach(socket.id, res.playerId);
      cb({ ok: true, code, playerId: res.playerId, rejoin: res.rejoin });
      if (room.status === 'playing') {
        if (room instanceof RealtimeRoom) {
          room.emitSnapshotTo(socket.id, res.playerId);
        } else {
          room.emitViewTo(socket.id, res.playerId);
          room.broadcastViews();
        }
      } else {
        room.broadcastLobby();
      }
    });
  });

  socket.on('setBots', (payload) => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      rooms.get(d.roomCode)?.setBots(d.playerId, payload?.count ?? 0, socket.id);
    });
  });

  socket.on('updateSettings', (payload) => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      rooms.get(d.roomCode)?.updateSettings(d.playerId, payload?.settings ?? {}, socket.id);
    });
  });

  socket.on('setPassword', (payload) => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      rooms.get(d.roomCode)?.setPassword(d.playerId, payload?.password ?? '', socket.id);
    });
  });

  socket.on('startGame', () => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      rooms.get(d.roomCode)?.start(d.playerId, socket.id);
    });
  });

  socket.on('nextRound', () => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      const room = rooms.get(d.roomCode);
      if (room instanceof Room) room.nextRound(d.playerId, socket.id);
    });
  });

  socket.on('declareSpell', (payload) => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId || !payload?.magic) return;
      const room = rooms.get(d.roomCode);
      if (room instanceof Room) room.declareSpell(d.playerId, payload.magic, socket.id);
    });
  });

  socket.on('endTurn', () => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      const room = rooms.get(d.roomCode);
      if (room instanceof Room) room.endTurn(d.playerId, socket.id);
    });
  });

  socket.on('rtInput', (payload) => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      const room = rooms.get(d.roomCode);
      if (room instanceof RealtimeRoom) {
        room.applyRealtimeInput(d.playerId, payload, socket.id);
      }
    });
  });

  socket.on('rtPing', (payload, cb) => {
    guard(() => {
      cb({ serverNow: Date.now(), sentAt: typeof payload?.sentAt === 'number' ? payload.sentAt : 0 });
    });
  });

  socket.on('leaveRoom', () => {
    guard(() => {
      const d = socket.data;
      if (!d.roomCode || !d.playerId) return;
      rooms.get(d.roomCode)?.onLeave(d.playerId);
      socket.leave(d.roomCode);
      socket.data = {};
    });
  });

  socket.on('disconnect', () => {
    releaseConn();
    const { roomCode, playerId } = socket.data;
    if (!roomCode || !playerId) return;
    guard(() => rooms.get(roomCode)?.onDisconnect(playerId));
  });
});

// ---- 静态资源（生产模式：托管 web 构建产物） ----
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  // SPA 回退
  app.use((_req, res) => {
    res.sendFile(path.join(webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('text/plain').send('出包魔法师服务端运行中 ✅（web 前端未构建，请先 pnpm build）');
  });
}

server.listen(PORT, HOST, () => {
  console.log(`🧙 出包魔法师服务端已启动：http://${HOST}:${PORT}`);
  console.log(`   静态资源：${fs.existsSync(webDist) ? '已托管 apps/web/dist' : '未构建'}`);
});
