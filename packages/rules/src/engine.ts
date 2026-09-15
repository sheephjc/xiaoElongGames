/**
 * 《出包魔法师》核心规则引擎。
 *
 * 信息模型（关键）：
 * - 每个玩家看不到自己的手牌，但能看到所有其他人的手牌 → 视图层按玩家视角投影。
 * - 弃牌堆公开；牌堆数量公开、内容不公开；秘密牌堆数量公开、内容不公开。
 * - 自己获得的秘密牌对自己可见，他人获得的秘密牌对他人不可见。
 */
import {
  HAND_SIZE,
  MAGIC_DEFS,
  MAGIC_LIST,
  MAX_HP,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TOTAL_CARDS,
  WIN_SCORE,
  secretCountFor,
} from './types';
import { rollD3, shuffle } from './rng';
import type {
  Card,
  EffectEvent,
  Magic,
  PlayerConfig,
  PlayerView,
  RoundEndKind,
  RoundResult,
  SeatView,
} from './types';

export interface PlayerState {
  id: string;
  name: string;
  isBot: boolean;
  hp: number;
  score: number;
  hand: Card[];
  secrets: Card[];
  alive: boolean;
}

export interface GameOptions {
  players: PlayerConfig[];
  rng?: () => number;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** 构建整副 36 张魔法牌 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const def of MAGIC_LIST) {
    for (let i = 1; i <= def.count; i++) {
      deck.push({ id: `${def.key}-${i}`, magic: def.key });
    }
  }
  if (deck.length !== TOTAL_CARDS) {
    throw new Error(`牌组数量错误：期望 ${TOTAL_CARDS}，实际 ${deck.length}`);
  }
  return deck;
}

export class Game {
  readonly players: PlayerState[];
  round = 0;
  phase: 'playing' | 'roundEnd' | 'gameOver' = 'playing';
  currentIdx = 0;
  deck: Card[] = [];
  discard: Card[] = [];
  secretPile: Card[] = [];
  lastMagic: Magic | null = null;
  events: EffectEvent[] = [];
  roundResult: RoundResult | null = null;
  winnerId: string | null = null;
  /** 全局回合计数，渲染层可据此做动画/调度 */
  turnNo = 0;

  private rng: () => number;
  private seq = 0;

  constructor(opts: GameOptions) {
    const n = opts.players.length;
    if (n < MIN_PLAYERS || n > MAX_PLAYERS) {
      throw new Error(`玩家数量需在 ${MIN_PLAYERS}-${MAX_PLAYERS} 之间`);
    }
    this.players = opts.players.map((p, i) => ({
      id: p.id,
      name: p.name || `玩家${i + 1}`,
      isBot: !!p.isBot,
      hp: MAX_HP,
      score: 0,
      hand: [],
      secrets: [],
      alive: true,
    }));
    this.rng = opts.rng ?? Math.random;
    this.startRound();
  }

  get current(): PlayerState {
    return this.players[this.currentIdx];
  }

  player(id: string): PlayerState {
    const p = this.players.find((x) => x.id === id);
    if (!p) throw new Error(`未知玩家 ${id}`);
    return p;
  }

  private pushEvent(e: Omit<EffectEvent, 'seq'>): void {
    this.events.push({ ...e, seq: this.seq++ });
  }

  /** 服务端/外部注入提示事件（如玩家断线、托管等） */
  log(text: string): void {
    this.pushEvent({ type: 'info', text });
  }

  /** 当前玩家的上家与下家（2 人时上家=下家=对手） */
  private neighbors(): { prev: PlayerState; next: PlayerState } {
    const n = this.players.length;
    return {
      prev: this.players[(this.currentIdx - 1 + n) % n],
      next: this.players[(this.currentIdx + 1) % n],
    };
  }

  private damage(p: PlayerState, amount: number, via: Magic, attackerId: string): void {
    if (!p.alive || p.hp <= 0) return;
    p.hp = Math.max(0, p.hp - amount);
    if (p.hp <= 0) p.alive = false;
    this.pushEvent({
      type: 'damage',
      playerId: attackerId,
      targetId: p.id,
      magic: via,
      amount,
      text: `${p.name} 受到 ${amount} 点伤害（生命 ${p.hp}）${p.hp <= 0 ? '，倒下了！💀' : ''}`,
    });
  }

  private heal(p: PlayerState, amount: number, via: Magic): void {
    if (!p.alive || p.hp <= 0 || amount <= 0) return;
    const before = p.hp;
    p.hp = Math.min(MAX_HP, p.hp + amount);
    this.pushEvent({
      type: 'heal',
      playerId: p.id,
      targetId: p.id,
      magic: via,
      amount: p.hp - before,
      text: `${p.name} 恢复 ${p.hp - before} 点生命（生命 ${p.hp}）`,
    });
  }

  /** 新一轮：回满生命、重洗重发、重置秘密牌堆、随机起始玩家 */
  startRound(): void {
    this.round++;
    const n = this.players.length;
    this.deck = shuffle(buildDeck(), this.rng);
    for (const p of this.players) {
      p.hp = MAX_HP;
      p.hand = [];
      p.secrets = [];
      p.alive = true;
    }
    // 发牌：每人 5 张
    for (let i = 0; i < HAND_SIZE; i++) {
      for (const p of this.players) {
        const c = this.deck.pop();
        if (c) p.hand.push(c);
      }
    }
    // 秘密牌堆
    const secretN = secretCountFor(n);
    this.secretPile = this.deck.splice(0, secretN);
    this.discard = [];
    this.lastMagic = null;
    this.roundResult = null;
    this.currentIdx = Math.floor(this.rng() * n);
    this.phase = 'playing';
    this.pushEvent({
      type: 'roundStart',
      text: `—— 第 ${this.round} 轮开始：每人 6 生命、5 张手牌（背对自己），秘密牌 ${secretN} 张 ——`,
    });
    this.emitTurnStart();
  }

  private emitTurnStart(): void {
    this.turnNo++;
    this.pushEvent({
      type: 'turnStart',
      playerId: this.current.id,
      text: `轮到 ${this.current.name} 施法`,
    });
  }

  /** 回合结束时摸牌补至 5 张 */
  private refill(p: PlayerState): void {
    let drawn = 0;
    while (p.hand.length < HAND_SIZE && this.deck.length > 0) {
      const c = this.deck.pop();
      if (!c) break;
      p.hand.push(c);
      drawn++;
    }
    if (drawn > 0) {
      this.pushEvent({
        type: 'draw',
        playerId: p.id,
        amount: drawn,
        text: `${p.name} 摸 ${drawn} 张牌补至 ${HAND_SIZE} 张`,
      });
    }
  }

  private advanceToNext(): void {
    const n = this.players.length;
    this.currentIdx = (this.currentIdx + 1) % n;
    this.lastMagic = null;
    this.emitTurnStart();
  }

  /** 声明施法：成功则打出并结算效果；失败则扣血并强制结束回合 */
  declareSpell(playerId: string, magic: Magic): ActionResult {
    // 防御非法魔法值（联机时客户端可伪造任意 payload）
    if (!(magic in MAGIC_DEFS)) return { ok: false, error: '未知魔法' };
    if (this.phase !== 'playing') return { ok: false, error: '当前不在行动阶段' };
    if (playerId !== this.current.id) return { ok: false, error: '还没轮到你' };
    if (this.lastMagic) {
      const lastCount = MAGIC_DEFS[this.lastMagic].count;
      if (MAGIC_DEFS[magic].count < lastCount) {
        return {
          ok: false,
          error: `本回合已施放「${MAGIC_DEFS[this.lastMagic].name}」，不能施放更稀有的魔法`,
        };
      }
    }
    const p = this.current;
    const idx = p.hand.findIndex((c) => c.magic === magic);
    if (idx === -1) {
      // 施法失败
      const dmg = magic === 'dragon' ? rollD3(this.rng) : 1;
      this.pushEvent({
        type: 'fail',
        playerId: p.id,
        magic,
        text: `${p.name} 大喊「${MAGIC_DEFS[magic].name}」……手中并没有这张牌！出包了！😱`,
      });
      if (magic === 'dragon') {
        this.pushEvent({
          type: 'dice',
          playerId: p.id,
          magic,
          amount: dmg,
          text: `🎲 掷出 ${dmg}，反噬伤害 ${dmg} 点`,
        });
      }
      p.hp = Math.max(0, p.hp - dmg);
      if (p.hp <= 0) {
        p.alive = false;
        this.pushEvent({
          type: 'damage',
          playerId: p.id,
          targetId: p.id,
          magic,
          amount: dmg,
          text: `${p.name} 被魔法反噬，生命归零！💀`,
        });
        this.finishRound('suicide', { victimId: p.id });
        return { ok: true };
      }
      this.pushEvent({
        type: 'damage',
        playerId: p.id,
        targetId: p.id,
        magic,
        amount: dmg,
        text: `${p.name} 损失 ${dmg} 点生命（生命 ${p.hp}）`,
      });
      this.pushEvent({ type: 'turnEnd', playerId: p.id, text: `${p.name} 施法失败，回合强制结束` });
      this.refill(p);
      this.advanceToNext();
      return { ok: true };
    }
    // 施法成功：打出该牌
    const [card] = p.hand.splice(idx, 1);
    this.discard.push(card);
    this.lastMagic = magic;
    this.pushEvent({
      type: 'cast',
      playerId: p.id,
      magic,
      text: `${p.name} 施放「${MAGIC_DEFS[magic].emoji} ${MAGIC_DEFS[magic].name}」成功！✨`,
    });
    this.resolveEffect(magic);
    return { ok: true };
  }

  private resolveEffect(magic: Magic): void {
    const p = this.current;
    const { prev, next } = this.neighbors();
    const others = this.players.filter((x) => x.id !== p.id);
    switch (magic) {
      case 'dragon': {
        const d = rollD3(this.rng);
        this.pushEvent({ type: 'dice', playerId: p.id, magic, amount: d, text: `🎲 掷出 ${d}` });
        for (const o of others) this.damage(o, d, magic, p.id);
        break;
      }
      case 'ghost': {
        for (const o of others) this.damage(o, 1, magic, p.id);
        this.heal(p, 1, magic);
        break;
      }
      case 'dream': {
        const d = rollD3(this.rng);
        this.pushEvent({ type: 'dice', playerId: p.id, magic, amount: d, text: `🎲 掷出 ${d}` });
        this.heal(p, d, magic);
        break;
      }
      case 'owl': {
        if (this.secretPile.length === 0) {
          this.pushEvent({
            type: 'info',
            playerId: p.id,
            magic,
            text: '秘密牌堆已空，猫头鹰什么也没找到 🦉💤',
          });
          break;
        }
        const i = Math.floor(this.rng() * this.secretPile.length);
        const [secret] = this.secretPile.splice(i, 1);
        p.secrets.push(secret);
        this.pushEvent({
          type: 'owl',
          playerId: p.id,
          magic,
          text: `${p.name} 查看并获取了 1 张秘密牌（内容保密）🤫`,
        });
        break;
      }
      case 'storm': {
        this.damage(prev, 1, magic, p.id);
        this.damage(next, 1, magic, p.id);
        break;
      }
      case 'blizzard':
        this.damage(prev, 1, magic, p.id);
        break;
      case 'fire':
        this.damage(next, 1, magic, p.id);
        break;
      case 'potion':
        this.heal(p, 1, magic);
        break;
    }
    this.afterEffect();
  }

  private afterEffect(): void {
    const p = this.current;
    const killed = this.players.filter((x) => x.id !== p.id && !x.alive);
    if (killed.length > 0) {
      this.finishRound('kill', { winnerId: p.id, victimId: killed[0].id });
      return;
    }
    if (p.hand.length === 0) {
      // 施放了自己所有的魔法 → 本轮结束，独得 3 分
      this.finishRound('all-cast', { winnerId: p.id });
      return;
    }
    // 可以继续施法（限制：不能比上一张更稀有）
    this.turnNo++;
  }

  /** 主动结束回合 */
  endTurn(playerId: string): ActionResult {
    if (this.phase !== 'playing') return { ok: false, error: '当前不在行动阶段' };
    if (playerId !== this.current.id) return { ok: false, error: '还没轮到你' };
    const p = this.current;
    this.pushEvent({ type: 'turnEnd', playerId: p.id, text: `${p.name} 结束回合` });
    this.refill(p);
    this.advanceToNext();
    return { ok: true };
  }

  /** 本轮结算并检查胜负 */
  private finishRound(kind: RoundEndKind, opts: { winnerId?: string; victimId?: string }): void {
    const points: Record<string, number> = {};
    for (const p of this.players) points[p.id] = 0;
    let text = '';
    switch (kind) {
      case 'kill': {
        const winner = this.player(opts.winnerId!);
        points[winner.id] += 3;
        for (const p of this.players) {
          if (p.id !== winner.id && p.alive) points[p.id] += 1;
        }
        const victim = this.player(opts.victimId!);
        text = `${winner.name} 击败了 ${victim.name}，本轮结束！`;
        break;
      }
      case 'suicide': {
        const victim = this.player(opts.victimId!);
        for (const p of this.players) {
          if (p.id !== victim.id) points[p.id] += 1;
        }
        text = `${victim.name} 被自己的魔法反噬倒下，本轮结束！`;
        break;
      }
      case 'all-cast': {
        const winner = this.player(opts.winnerId!);
        points[winner.id] += 3;
        for (const p of this.players) {
          if (p.id !== winner.id) p.alive = false; // 其他人死亡，不得分
        }
        text = `${winner.name} 施放了自己所有的魔法，本轮结束！`;
        break;
      }
    }
    // 猫头鹰加成：本轮存活的玩家，每张秘密牌 +1 分
    for (const p of this.players) {
      if (p.alive && p.secrets.length > 0) {
        points[p.id] += p.secrets.length;
        text += ` ${p.name} 因 ${p.secrets.length} 张秘密牌 +${p.secrets.length} 分`;
      }
    }
    for (const p of this.players) p.score += points[p.id];
    this.roundResult = { kind, ...opts, points, text };
    this.phase = 'roundEnd';
    this.pushEvent({ type: 'roundEnd', text: `本轮结算：${text}` });
    this.checkWin();
  }

  private checkWin(): void {
    const max = Math.max(...this.players.map((p) => p.score));
    if (max >= WIN_SCORE) {
      const tops = this.players.filter((p) => p.score === max);
      if (tops.length === 1) {
        this.phase = 'gameOver';
        this.winnerId = tops[0].id;
        this.pushEvent({
          type: 'gameOver',
          playerId: tops[0].id,
          text: `🏆 ${tops[0].name} 达到 ${max} 分，获得最终胜利！`,
        });
      }
    }
  }

  nextRound(): ActionResult {
    if (this.phase === 'gameOver') return { ok: false, error: '游戏已结束' };
    if (this.phase !== 'roundEnd') return { ok: false, error: '本轮尚未结束' };
    this.startRound();
    return { ok: true };
  }

  /** 以指定玩家的视角投影游戏状态（隐藏其手牌、他人秘密牌） */
  getView(playerId: string): PlayerView {
    const you = this.player(playerId);
    const seats: SeatView[] = this.players.map((p) => {
      const isYou = p.id === playerId;
      // 轮末/终局复盘时向本人揭晓自己的手牌
      const revealOwnHand = this.phase !== 'playing';
      return {
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        hp: p.hp,
        score: p.score,
        alive: p.alive,
        handCount: p.hand.length,
        hand: isYou && !revealOwnHand ? p.hand.map(() => null) : p.hand.map((c) => c.magic),
        secretCount: p.secrets.length,
        secrets: isYou ? p.secrets.map((c) => c.magic) : p.secrets.map(() => null),
      };
    });
    let legalMagics: Magic[] = [];
    if (this.phase === 'playing' && this.current.id === playerId) {
      const minCount = this.lastMagic ? MAGIC_DEFS[this.lastMagic].count : 0;
      legalMagics = MAGIC_LIST.filter((d) => d.count >= minCount).map((d) => d.key);
    }
    // 本视角每个魔法的剩余张数：总数 - 可见明牌（他人手牌 + 弃牌堆 + 自己秘密牌）
    const magicRemaining = {} as Record<Magic, number>;
    for (const def of MAGIC_LIST) {
      let visible = this.discard.filter((c) => c.magic === def.key).length;
      for (const p of this.players) {
        if (p.id === playerId) {
          visible += p.secrets.filter((c) => c.magic === def.key).length;
        } else {
          visible += p.hand.filter((c) => c.magic === def.key).length;
        }
      }
      magicRemaining[def.key] = def.count - visible;
    }
    return {
      round: this.round,
      turnNo: this.turnNo,
      phase: this.phase,
      youId: playerId,
      currentPlayerId: this.phase === 'playing' ? this.current.id : null,
      seats,
      deckCount: this.deck.length,
      secretPileCount: this.secretPile.length,
      discard: this.discard.map((c) => c.magic),
      lastMagic: this.lastMagic,
      events: this.events,
      roundResult: this.roundResult,
      winnerId: this.winnerId,
      isYourTurn: this.phase === 'playing' && this.current.id === playerId,
      legalMagics,
      magicRemaining,
    };
  }
}
