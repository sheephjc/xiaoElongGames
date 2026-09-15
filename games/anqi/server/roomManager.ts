import { randomBytes, randomInt } from 'node:crypto';
import {
  IllegalMoveError,
  applyMove,
  createGame,
  projectPublicState,
  type Camp,
  type CapturedPiece,
  type GameState,
  type MoveCommand,
  type MoveResult,
  type RandomSource,
} from '../src/game/index';
import {
  battleEffectDuration,
  normalizeNickname,
  normalizeRoomCode,
  reconnectGraceDuration,
  type EnterRoomResult,
  type PlayerRole,
  type RoomErrorCode,
  type RoomPhase,
  type RoomPlayerView,
  type RoomSnapshot,
} from '../src/online/protocol';

interface RoomPlayer {
  role: PlayerRole;
  token: string;
  nickname: string;
  camp?: Camp;
  socketId?: string;
  disconnectTimer?: ReturnType<typeof setTimeout>;
}

interface RoomRecord {
  code: string;
  phase: RoomPhase;
  roundNumber: number;
  version: number;
  host: RoomPlayer;
  guest?: RoomPlayer;
  game?: GameState;
  startTimer?: ReturnType<typeof setTimeout>;
}

interface RoomManagerHooks {
  onRoomChanged?: (roomCode: string) => void;
  onRoomClosed?: (socketIds: string[], message: string) => void;
}

interface RoomManagerOptions extends RoomManagerHooks {
  codeFactory?: () => string;
  tokenFactory?: () => string;
  random?: RandomSource;
  gameFactory?: () => GameState;
  startDelayMs?: number;
  disconnectGraceMs?: number;
}

export interface RoomMoveResult {
  roomCode: string;
  move: MoveResult;
  captured?: CapturedPiece;
}

export class RoomServiceError extends Error {
  constructor(
    public readonly code: RoomErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function oppositeCamp(camp: Camp): Camp {
  return camp === 'red' ? 'black' : 'red';
}

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly socketBindings = new Map<string, { roomCode: string; token: string }>();
  private hooks: RoomManagerHooks;
  private readonly codeFactory: () => string;
  private readonly tokenFactory: () => string;
  private readonly random: RandomSource;
  private readonly gameFactory: () => GameState;
  private readonly startDelayMs: number;
  private readonly disconnectGraceMs: number;

  constructor(options: RoomManagerOptions = {}) {
    this.hooks = options;
    this.codeFactory = options.codeFactory ?? (() => String(randomInt(1000, 10_000)));
    this.tokenFactory = options.tokenFactory ?? (() => randomBytes(24).toString('base64url'));
    this.random = options.random ?? (() => randomInt(0, 0x1_0000_0000) / 0x1_0000_0000);
    this.gameFactory = options.gameFactory ?? (() => createGame(this.random));
    this.startDelayMs = options.startDelayMs ?? battleEffectDuration;
    this.disconnectGraceMs = options.disconnectGraceMs ?? reconnectGraceDuration;
  }

  setHooks(hooks: RoomManagerHooks): void {
    this.hooks = hooks;
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  private requireUnbound(socketId: string): void {
    if (this.socketBindings.has(socketId)) {
      throw new RoomServiceError('unauthorized', '已经在房间中，请先返回并断开连接');
    }
  }

  createRoom(socketId: string, rawNickname: string): EnterRoomResult {
    this.requireUnbound(socketId);
    if (this.rooms.size >= 200) throw new RoomServiceError('server-error', '棋室已满，请稍后再试');
    const nickname = normalizeNickname(rawNickname);
    if (!nickname) throw new RoomServiceError('invalid-nickname', '昵称需为 1 至 12 个字符');
    const code = this.nextRoomCode();
    const host: RoomPlayer = {
      role: 'host',
      token: this.tokenFactory(),
      nickname,
      socketId,
    };
    const room: RoomRecord = {
      code,
      phase: 'waiting',
      roundNumber: 0,
      version: 1,
      host,
    };
    this.rooms.set(code, room);
    this.bindSocket(socketId, room, host);
    this.hooks.onRoomChanged?.(code);
    return this.enterResult(room, host);
  }

  joinRoom(socketId: string, rawRoomCode: string, rawNickname: string): EnterRoomResult {
    this.requireUnbound(socketId);
    const roomCode = normalizeRoomCode(rawRoomCode);
    if (!roomCode) throw new RoomServiceError('invalid-room-code', '请输入四位房间号');
    const nickname = normalizeNickname(rawNickname);
    if (!nickname) throw new RoomServiceError('invalid-nickname', '昵称需为 1 至 12 个字符');
    const room = this.rooms.get(roomCode);
    if (!room) throw new RoomServiceError('room-not-found', '房间不存在或已失效');
    if (room.guest) throw new RoomServiceError('room-full', '房间已满');

    const guest: RoomPlayer = {
      role: 'guest',
      token: this.tokenFactory(),
      nickname,
      socketId,
    };
    const hostCamp: Camp = this.random() < 0.5 ? 'red' : 'black';
    room.host.camp = hostCamp;
    guest.camp = oppositeCamp(hostCamp);
    room.guest = guest;
    room.game = this.gameFactory();
    room.roundNumber = 1;
    room.phase = 'starting';
    room.version += 1;
    this.bindSocket(socketId, room, guest);
    this.scheduleRoundStart(room);
    this.hooks.onRoomChanged?.(room.code);
    return this.enterResult(room, guest);
  }

  resumeRoom(
    socketId: string,
    rawRoomCode: string,
    playerToken: string,
  ): EnterRoomResult & { replacedSocketId?: string } {
    const roomCode = normalizeRoomCode(rawRoomCode);
    const room = roomCode ? this.rooms.get(roomCode) : undefined;
    const binding = this.socketBindings.get(socketId);
    if (binding && binding.roomCode !== roomCode) {
      throw new RoomServiceError('unauthorized', '已经在另一间棋室中');
    }
    const player = room && this.playerByToken(room, playerToken);
    if (!room || !player) {
      throw new RoomServiceError('connection-expired', '房间连接已失效');
    }
    const replacedSocketId =
      player.socketId && player.socketId !== socketId ? player.socketId : undefined;
    if (replacedSocketId) this.socketBindings.delete(replacedSocketId);
    if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
    player.disconnectTimer = undefined;
    this.bindSocket(socketId, room, player);
    room.version += 1;
    this.hooks.onRoomChanged?.(room.code);
    return { ...this.enterResult(room, player), replacedSocketId };
  }

  move(socketId: string, command: MoveCommand): RoomMoveResult {
    const { room, player } = this.requireBinding(socketId);
    if (room.phase === 'starting') {
      throw new RoomServiceError('round-starting', '开战后方可落子');
    }
    if (room.phase !== 'playing' || !room.game) {
      throw new RoomServiceError('illegal-move', '当前棋局不可落子');
    }
    if (!this.bothPlayersConnected(room)) {
      throw new RoomServiceError('opponent-disconnected', '正在等待对方重连');
    }
    if (player.camp !== room.game.turn) {
      throw new RoomServiceError('unauthorized', '还未轮到你行棋');
    }
    try {
      const applied = applyMove(room.game, command);
      room.game = applied.state;
      room.phase = applied.state.status.phase === 'playing' ? 'playing' : 'finished';
      room.version += 1;
      const captured = applied.result.move.captured ? room.game.captured.at(-1) : undefined;
      return {
        roomCode: room.code,
        move: applied.result,
        captured: captured ? { ...captured, identity: { ...captured.identity } } : undefined,
      };
    } catch (error) {
      const message =
        error instanceof IllegalMoveError && error.message
          ? error.message.replace('，将不会实施该移动', '')
          : '该落子不符合规则';
      throw new RoomServiceError('illegal-move', message);
    }
  }

  startNextRound(socketId: string): string {
    const { room, player } = this.requireBinding(socketId);
    if (player.role !== 'host')
      throw new RoomServiceError('unauthorized', '只有房主可以开始下一局');
    if (room.phase !== 'finished' || !room.guest) {
      throw new RoomServiceError('unauthorized', '本局结束后才能开始下一局');
    }
    if (!this.bothPlayersConnected(room)) {
      throw new RoomServiceError('opponent-disconnected', '正在等待对方重连');
    }
    room.host.camp = oppositeCamp(room.host.camp!);
    room.guest.camp = oppositeCamp(room.guest.camp!);
    room.game = this.gameFactory();
    room.roundNumber += 1;
    room.phase = 'starting';
    room.version += 1;
    this.scheduleRoundStart(room);
    this.hooks.onRoomChanged?.(room.code);
    return room.code;
  }

  disconnectSocket(socketId: string): void {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return;
    this.socketBindings.delete(socketId);
    const room = this.rooms.get(binding.roomCode);
    const player = room && this.playerByToken(room, binding.token);
    if (!room || !player || player.socketId !== socketId) return;
    player.socketId = undefined;
    room.version += 1;
    this.hooks.onRoomChanged?.(room.code);
    player.disconnectTimer = setTimeout(() => {
      if (player.socketId || !this.rooms.has(room.code)) return;
      this.closeRoom(room, '对方未在 60 秒内重连，房间已关闭');
    }, this.disconnectGraceMs);
  }

  snapshotForSocket(socketId: string): RoomSnapshot | undefined {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return undefined;
    const room = this.rooms.get(binding.roomCode);
    const player = room && this.playerByToken(room, binding.token);
    return room && player ? this.snapshot(room, player) : undefined;
  }

  socketIds(roomCode: string): string[] {
    const room = this.rooms.get(roomCode);
    if (!room) return [];
    return [room.host.socketId, room.guest?.socketId].filter((id): id is string => Boolean(id));
  }

  destroy(): void {
    for (const room of this.rooms.values()) {
      if (room.startTimer) clearTimeout(room.startTimer);
      for (const player of [room.host, room.guest]) {
        if (player?.disconnectTimer) clearTimeout(player.disconnectTimer);
      }
    }
    this.rooms.clear();
    this.socketBindings.clear();
  }

  private nextRoomCode(): string {
    for (let attempt = 0; attempt < 10_000; attempt += 1) {
      const code = this.codeFactory();
      if (/^[1-9]\d{3}$/.test(code) && !this.rooms.has(code)) return code;
    }
    throw new RoomServiceError('server-error', '暂时无法创建房间');
  }

  private scheduleRoundStart(room: RoomRecord): void {
    if (room.startTimer) clearTimeout(room.startTimer);
    room.startTimer = setTimeout(() => {
      if (!this.rooms.has(room.code) || room.phase !== 'starting') return;
      room.phase = 'playing';
      room.version += 1;
      room.startTimer = undefined;
      this.hooks.onRoomChanged?.(room.code);
    }, this.startDelayMs);
  }

  private bindSocket(socketId: string, room: RoomRecord, player: RoomPlayer): void {
    player.socketId = socketId;
    this.socketBindings.set(socketId, { roomCode: room.code, token: player.token });
  }

  private requireBinding(socketId: string): { room: RoomRecord; player: RoomPlayer } {
    const binding = this.socketBindings.get(socketId);
    const room = binding && this.rooms.get(binding.roomCode);
    const player = room && binding ? this.playerByToken(room, binding.token) : undefined;
    if (!room || !player) throw new RoomServiceError('connection-expired', '房间连接已失效');
    return { room, player };
  }

  private playerByToken(room: RoomRecord, token: string): RoomPlayer | undefined {
    if (room.host.token === token) return room.host;
    return room.guest?.token === token ? room.guest : undefined;
  }

  private bothPlayersConnected(room: RoomRecord): boolean {
    return Boolean(room.host.socketId && room.guest?.socketId);
  }

  private enterResult(room: RoomRecord, player: RoomPlayer): EnterRoomResult {
    return {
      session: { roomCode: room.code, playerToken: player.token, role: player.role },
      snapshot: this.snapshot(room, player),
    };
  }

  private snapshot(room: RoomRecord, self: RoomPlayer): RoomSnapshot {
    const players: RoomPlayerView[] = [room.host, room.guest]
      .filter((player): player is RoomPlayer => Boolean(player))
      .map((player) => ({
        role: player.role,
        nickname: player.nickname,
        camp: player.camp,
        connected: Boolean(player.socketId),
      }));
    return {
      roomCode: room.code,
      phase: room.phase,
      roundNumber: room.roundNumber,
      version: room.version,
      self: { role: self.role, camp: self.camp },
      players,
      game: room.game ? projectPublicState(room.game) : undefined,
    };
  }

  private closeRoom(room: RoomRecord, message: string): void {
    if (room.startTimer) clearTimeout(room.startTimer);
    const socketIds = this.socketIds(room.code);
    for (const player of [room.host, room.guest]) {
      if (!player) continue;
      if (player.disconnectTimer) clearTimeout(player.disconnectTimer);
      if (player.socketId) this.socketBindings.delete(player.socketId);
    }
    this.rooms.delete(room.code);
    this.hooks.onRoomClosed?.(socketIds, message);
  }
}
