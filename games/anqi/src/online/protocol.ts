import type { Camp, CapturedPiece, MoveCommand, MoveResult, PublicGameState } from '../game';

export const battleEffectDuration = 1550;
export const reconnectGraceDuration = 60_000;
export const nicknameStorageKey = 'anqi-player-nickname';
export const roomSessionStorageKey = 'anqi-room-session';

export type PlayerRole = 'host' | 'guest';
export type RoomPhase = 'waiting' | 'starting' | 'playing' | 'finished';

export type RoomErrorCode =
  | 'room-not-found'
  | 'room-full'
  | 'invalid-room-code'
  | 'invalid-nickname'
  | 'unauthorized'
  | 'illegal-move'
  | 'round-starting'
  | 'connection-expired'
  | 'opponent-disconnected'
  | 'server-error';

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type Ack<T> = { ok: true; data: T } | { ok: false; error: RoomError };

export interface RoomSession {
  roomCode: string;
  playerToken: string;
  role: PlayerRole;
}

export interface RoomPlayerView {
  role: PlayerRole;
  nickname: string;
  camp?: Camp;
  connected: boolean;
}

export interface RoomSnapshot {
  roomCode: string;
  phase: RoomPhase;
  roundNumber: number;
  version: number;
  self: {
    role: PlayerRole;
    camp?: Camp;
  };
  players: RoomPlayerView[];
  game?: PublicGameState;
}

export interface EnterRoomResult {
  session: RoomSession;
  snapshot: RoomSnapshot;
}

export interface GameUpdate {
  version: number;
  snapshot: RoomSnapshot;
  move: MoveResult;
  captured?: CapturedPiece;
}

export interface ClientToServerEvents {
  'room:create': (
    payload: { nickname: string },
    acknowledge: (response: Ack<EnterRoomResult>) => void,
  ) => void;
  'room:join': (
    payload: { nickname: string; roomCode: string },
    acknowledge: (response: Ack<EnterRoomResult>) => void,
  ) => void;
  'room:resume': (
    payload: { roomCode: string; playerToken: string },
    acknowledge: (response: Ack<EnterRoomResult>) => void,
  ) => void;
  'game:move': (
    payload: MoveCommand,
    acknowledge: (response: Ack<{ accepted: true }>) => void,
  ) => void;
  'game:new-round': (acknowledge: (response: Ack<{ accepted: true }>) => void) => void;
}

export interface ServerToClientEvents {
  'room:snapshot': (snapshot: RoomSnapshot) => void;
  'game:update': (update: GameUpdate) => void;
  'room:closed': (payload: { message: string }) => void;
}

export interface SocketData {
  roomCode?: string;
  playerToken?: string;
}

export function normalizeNickname(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const nickname = value.trim();
  const length = Array.from(nickname).length;
  if (length < 1 || length > 12 || /[\p{Cc}\p{Cf}]/u.test(nickname)) return undefined;
  return nickname;
}

export function normalizeRoomCode(value: string): string | undefined {
  if (typeof value !== 'string') return undefined;
  const roomCode = value.trim();
  return /^[1-9]\d{3}$/.test(roomCode) ? roomCode : undefined;
}
