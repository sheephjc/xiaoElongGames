import type { Namespace } from 'socket.io';
import type {
  Ack,
  ClientToServerEvents,
  EnterRoomResult,
  GameUpdate,
  ServerToClientEvents,
  SocketData,
} from '../src/online/protocol';
import { RoomManager, RoomServiceError } from './roomManager';

export type AnqiNamespace = Namespace<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

function failure(error: unknown): Ack<never> {
  if (error instanceof RoomServiceError) {
    return { ok: false, error: { code: error.code, message: error.message } };
  }
  return { ok: false, error: { code: 'server-error', message: '服务器暂时不可用' } };
}

/** 接入现有 Socket.IO 实例，保留暗棋独立的协议、房间与隐藏身份裁决。 */
export function bindAnqiNamespace(io: AnqiNamespace, rooms = new RoomManager()): RoomManager {
  const sendSnapshot = (roomCode: string) => {
    for (const socketId of rooms.socketIds(roomCode)) {
      const snapshot = rooms.snapshotForSocket(socketId);
      if (snapshot) io.to(socketId).emit('room:snapshot', snapshot);
    }
  };
  rooms.setHooks({
    onRoomChanged: sendSnapshot,
    onRoomClosed: (socketIds, message) => {
      for (const socketId of socketIds) io.to(socketId).emit('room:closed', { message });
    },
  });
  io.on('connection', (socket) => {
    socket.on('room:create', (payload, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      try {
        acknowledge({ ok: true, data: rooms.createRoom(socket.id, payload?.nickname) });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
    socket.on('room:join', (payload, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      try {
        acknowledge({
          ok: true,
          data: rooms.joinRoom(socket.id, payload?.roomCode, payload?.nickname),
        });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
    socket.on('room:resume', (payload, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      try {
        const result = rooms.resumeRoom(socket.id, payload?.roomCode, payload?.playerToken);
        const response: EnterRoomResult = { session: result.session, snapshot: result.snapshot };
        acknowledge({ ok: true, data: response });
        if (result.replacedSocketId) io.sockets.get(result.replacedSocketId)?.disconnect(true);
      } catch (error) {
        acknowledge(failure(error));
      }
    });
    socket.on('game:move', (payload, acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      try {
        const result = rooms.move(socket.id, payload);
        for (const socketId of rooms.socketIds(result.roomCode)) {
          const snapshot = rooms.snapshotForSocket(socketId);
          if (!snapshot) continue;
          const update: GameUpdate = {
            version: snapshot.version,
            snapshot,
            move: result.move,
            captured: result.captured,
          };
          io.to(socketId).emit('game:update', update);
        }
        acknowledge({ ok: true, data: { accepted: true } });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
    socket.on('game:new-round', (acknowledge) => {
      if (typeof acknowledge !== 'function') return;
      try {
        rooms.startNextRound(socket.id);
        acknowledge({ ok: true, data: { accepted: true } });
      } catch (error) {
        acknowledge(failure(error));
      }
    });
    socket.on('disconnect', () => rooms.disconnectSocket(socket.id));
  });
  return rooms;
}
