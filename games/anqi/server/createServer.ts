import { createServer as createHttpServer } from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../src/online/protocol';
import { bindAnqiNamespace } from './namespace';
import type { RoomManager } from './roomManager';

// Standalone test server; apps/server mounts /anqi in production.
export function createRealtimeServer(options: { roomManager?: RoomManager } = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    Record<string, never>,
    SocketData
  >(httpServer);
  const rooms = bindAnqiNamespace(io.of('/'), options.roomManager);
  app.get('/api/health', (_request, response) => response.json({ ok: true }));
  return {
    app,
    httpServer,
    io,
    rooms,
    async close(): Promise<void> {
      rooms.destroy();
      await new Promise<void>((resolveClose) => io.close(() => resolveClose()));
    },
  };
}
