import type { Namespace, Socket } from 'socket.io';
export function bindMahjongNamespace(io: Namespace, options?: { tickMs?: number; emptyRoomTtl?: number; ipOf?: (socket: Socket) => string }): { readonly roomCount: number; dispose(): void };
export function projectRoom(room: any, uid: string | null): any;
