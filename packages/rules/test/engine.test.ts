import { describe, expect, it } from 'vitest';
import { Game, buildDeck } from '../src/engine';
import { MAGIC_DEFS, MAGIC_LIST, TOTAL_CARDS, type Magic } from '../src/types';
import { mulberry32 } from '../src/rng';
import { chooseAiAction, probMagicInHand } from '../src/ai';

const P = (n: number, bots = true) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `玩家${i}`, isBot: i > 0 && bots }));

/** 构造一局游戏并把当前玩家固定为 p0（便于白盒测试） */
function makeGame(n: number, seed = 1) {
  const g = new Game({ players: P(n), rng: mulberry32(seed) });
  g.currentIdx = 0;
  return g;
}

function forceHand(game: Game, playerId: string, magics: Magic[]) {
  const p = game.player(playerId);
  const cards = magics.map((m, i) => ({ id: `forced-${playerId}-${i}`, magic: m }));
  // 手牌以外的牌塞回牌堆
  game.deck.push(...p.hand);
  p.hand = cards;
}

describe('牌组构成', () => {
  it('共 36 张，每种魔法数量为 1..8', () => {
    const deck = buildDeck();
    expect(deck.length).toBe(TOTAL_CARDS);
    for (const def of MAGIC_LIST) {
      expect(deck.filter((c) => c.magic === def.key).length).toBe(def.count);
    }
  });
});

describe('每轮初始化', () => {
  it.each([
    [2, 12],
    [3, 6],
    [4, 4],
    [5, 4],
  ])('%i 人：秘密牌 %i 张', (n, secret) => {
    const g = makeGame(n);
    expect(g.secretPile.length).toBe(secret);
    expect(g.deck.length).toBe(TOTAL_CARDS - n * 5 - secret);
    for (const p of g.players) {
      expect(p.hp).toBe(6);
      expect(p.hand.length).toBe(5);
      expect(p.secrets.length).toBe(0);
      expect(p.alive).toBe(true);
    }
  });

  it('拒绝非法玩家数量', () => {
    expect(() => new Game({ players: P(1) })).toThrow();
    expect(() => new Game({ players: P(6) })).toThrow();
  });
});

describe('视角投影', () => {
  it('自己手牌隐藏、他人手牌公开、他人秘密牌隐藏', () => {
    const g = makeGame(4, 42);
    const v = g.getView('p0');
    const me = v.seats.find((s) => s.id === 'p0')!;
    expect(me.hand.every((m) => m === null)).toBe(true);
    expect(me.hand.length).toBe(5);
    for (const s of v.seats.filter((s) => s.id !== 'p0')) {
      expect(s.hand.every((m) => m !== null)).toBe(true);
      expect(s.hand.length).toBe(5);
    }
    // 给 p1 塞一张秘密牌，p0 看不到身份
    g.player('p1').secrets.push({ id: 'sec', magic: 'dragon' });
    const v2 = g.getView('p0');
    expect(v2.seats.find((s) => s.id === 'p1')!.secrets).toEqual([null]);
    const v3 = g.getView('p1');
    expect(v3.seats.find((s) => s.id === 'p1')!.secrets).toEqual(['dragon']);
  });
});

describe('施法成功', () => {
  it.each(MAGIC_LIST.map(m => [m.key] as const))('%s 成功时只有巨龙和梦发出掷骰事件', magic => {
    const g = makeGame(3);
    forceHand(g, 'p0', [magic, 'potion', 'potion', 'potion', 'potion']);
    const seq = g.events.at(-1)!.seq;
    expect(g.declareSpell('p0', magic).ok).toBe(true);
    const events = g.events.filter(e => e.seq > seq);
    const dice = events.filter(e => e.type === 'dice');
    expect(dice).toHaveLength(magic === 'dragon' || magic === 'dream' ? 1 : 0);
    if (dice.length) {
      expect(events.findIndex(e => e.type === 'cast')).toBeLessThan(events.indexOf(dice[0]));
      expect(dice[0]).toMatchObject({ magic, playerId: 'p0' });
      expect(dice[0].amount).toBeGreaterThanOrEqual(1);
      expect(dice[0].amount).toBeLessThanOrEqual(3);
    }
  });

  it.each(MAGIC_LIST.map(m => [m.key] as const))('%s 失败时只有巨龙掷骰，其他魔法固定扣一点血', magic => {
    const g = makeGame(3);
    forceHand(g, 'p0', [magic === 'potion' ? 'fire' : 'potion']);
    const seq = g.events.at(-1)!.seq;
    expect(g.declareSpell('p0', magic).ok).toBe(true);
    const events = g.events.filter(e => e.seq > seq);
    const dice = events.filter(e => e.type === 'dice');
    expect(dice).toHaveLength(magic === 'dragon' ? 1 : 0);
    if (magic === 'dragon') {
      expect(events.findIndex(e => e.type === 'fail')).toBeLessThan(events.indexOf(dice[0]));
      expect(g.player('p0').hp).toBe(6 - dice[0].amount!);
    } else expect(g.player('p0').hp).toBe(5);
  });

  it('打出对应牌并结算效果', () => {
    const g = makeGame(4, 7);
    const p0 = g.player('p0');
    p0.hand = []; // 清空，测试可控
    forceHand(g, 'p0', ['fire', 'potion', 'potion', 'potion', 'potion']);
    const nextHp = g.player('p1').hp;
    const r = g.declareSpell('p0', 'fire');
    expect(r.ok).toBe(true);
    expect(g.player('p1').hp).toBe(nextHp - 1);
    expect(p0.hand.some((c) => c.magic === 'fire')).toBe(false);
    expect(g.discard.some((c) => c.magic === 'fire')).toBe(true);
    expect(g.lastMagic).toBe('fire');
    // 效果结算后没有死亡 → 可以继续
    expect(g.phase).toBe('playing');
  });

  it('同类魔法多张时只打出一张', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion', 'potion', 'potion', 'potion', 'potion']);
    g.declareSpell('p0', 'potion');
    expect(g.player('p0').hand.filter((c) => c.magic === 'potion').length).toBe(4);
  });

  it('药水回血且上限 6', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion', 'potion', 'potion', 'potion', 'potion']);
    g.player('p0').hp = 5;
    g.declareSpell('p0', 'potion');
    expect(g.player('p0').hp).toBe(6);
    g.declareSpell('p0', 'potion');
    expect(g.player('p0').hp).toBe(6);
  });

  it('黑暗幽灵：其他玩家 -1，自己 +1', () => {
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['ghost', 'potion', 'potion', 'potion', 'potion']);
    g.player('p0').hp = 4;
    g.declareSpell('p0', 'ghost');
    expect(g.player('p0').hp).toBe(5);
    expect(g.player('p1').hp).toBe(5);
    expect(g.player('p2').hp).toBe(5);
  });

  it('古代巨龙：所有其他玩家 -1~3（由骰子决定）', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['dragon', 'potion', 'potion', 'potion', 'potion']);
    // 脚本化骰子：本次 rollD3 必为 2
    (g as unknown as { rng: () => number }).rng = () => (2 - 0.9) / 3;
    g.declareSpell('p0', 'dragon');
    expect(g.player('p1').hp).toBe(4);
    expect(g.player('p2').hp).toBe(4);
    expect(g.player('p3').hp).toBe(4);
    expect(g.player('p0').hp).toBe(6);
  });

  it('闪电暴风雨：2 人时对手受 2 点伤害，多人时上下家各 1 点', () => {
    const g2 = makeGame(2, 7);
    forceHand(g2, 'p0', ['storm', 'potion', 'potion', 'potion', 'potion']);
    g2.declareSpell('p0', 'storm');
    expect(g2.player('p1').hp).toBe(4);

    const g4 = makeGame(4, 7);
    forceHand(g4, 'p0', ['storm', 'potion', 'potion', 'potion', 'potion']);
    g4.declareSpell('p0', 'storm');
    expect(g4.player('p1').hp).toBe(5); // 下家
    expect(g4.player('p3').hp).toBe(5); // 上家
    expect(g4.player('p2').hp).toBe(6);
  });

  it('猫头鹰：从秘密牌堆取 1 张，仅本人可见', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['owl', 'potion', 'potion', 'potion', 'potion']);
    const before = g.secretPile.length;
    g.declareSpell('p0', 'owl');
    expect(g.secretPile.length).toBe(before - 1);
    expect(g.player('p0').secrets.length).toBe(1);
    const v0 = g.getView('p0');
    expect(v0.seats.find((s) => s.id === 'p0')!.secrets.length).toBe(1);
    const v1 = g.getView('p1');
    expect(v1.seats.find((s) => s.id === 'p0')!.secrets).toEqual([null]);
  });

  it('稀有度限制：不能施放比上一张更稀有的魔法', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion', 'fire', 'dragon', 'potion', 'potion']);
    expect(g.declareSpell('p0', 'potion').ok).toBe(true);
    expect(g.declareSpell('p0', 'dragon').ok).toBe(false); // 8→1 不允许
    expect(g.declareSpell('p0', 'potion').ok).toBe(true); // 8→8 允许
  });
});

describe('施法失败', () => {
  it('手中没有该魔法 → 扣 1 生命并强制结束回合', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion', 'potion', 'potion', 'potion', 'potion']);
    const startIdx = g.currentIdx;
    const r = g.declareSpell('p0', 'fire');
    expect(r.ok).toBe(true);
    expect(g.player('p0').hp).toBe(5);
    expect(g.currentIdx).not.toBe(startIdx);
    expect(g.lastMagic).toBeNull();
    expect(g.player('p0').hand.length).toBe(5); // 回合结束补牌
  });

  it('巨龙失败：骰子决定 1~3 点反噬', () => {
    for (const d of [1, 2, 3]) {
      const g = makeGame(4, 7);
      forceHand(g, 'p0', ['potion', 'potion', 'potion', 'potion', 'potion']);
      (g as unknown as { rng: () => number }).rng = () => (d - 0.9) / 3;
      g.declareSpell('p0', 'dragon');
      expect(g.player('p0').hp).toBe(6 - d);
    }
  });
});

describe('回合与补牌', () => {
  it('结束回合补至 5 张并轮到下一位', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['fire', 'fire']);
    const startIdx = g.currentIdx;
    expect(g.endTurn('p0').ok).toBe(true);
    expect(g.player('p0').hand.length).toBe(5);
    expect(g.currentIdx).toBe((startIdx + 1) % 4);
  });

  it('非当前玩家不能操作', () => {
    const g = makeGame(4, 7);
    if (g.current.id === 'p1') g.currentIdx = 0;
    expect(g.declareSpell('p1', 'fire').ok).toBe(false);
    expect(g.endTurn('p1').ok).toBe(false);
  });

  it('非法魔法值被拒绝（联机可伪造 payload，不能崩溃）', () => {
    const g = makeGame(4, 7);
    const r = g.declareSpell('p0', 'hack' as never);
    expect(r.ok).toBe(false);
    expect(g.phase).toBe('playing');
    expect(g.player('p0').hp).toBe(6);
  });

  it('牌堆耗尽时不再补牌', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['fire', 'fire']);
    g.deck = [];
    g.endTurn('p0');
    expect(g.player('p0').hand.length).toBe(2);
  });
});

describe('本轮结束', () => {
  it('击败他人：胜者 +3，其他存活者 +1，死者 +0', () => {
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['fire', 'potion', 'potion', 'potion', 'potion']);
    g.player('p1').hp = 1;
    g.declareSpell('p0', 'fire');
    expect(g.phase).toBe('roundEnd');
    expect(g.roundResult!.kind).toBe('kill');
    expect(g.roundResult!.points.p0).toBe(3);
    expect(g.roundResult!.points.p1).toBe(0);
    expect(g.roundResult!.points.p2).toBe(1);
    expect(g.player('p0').score).toBe(3);
    expect(g.player('p2').score).toBe(1);
  });

  it('施放所有魔法：+3，其他人 0 分', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion']);
    g.declareSpell('p0', 'potion');
    expect(g.phase).toBe('roundEnd');
    expect(g.roundResult!.kind).toBe('all-cast');
    expect(g.roundResult!.points.p0).toBe(3);
    expect(g.roundResult!.points.p1).toBe(0);
    for (const p of g.players) {
      if (p.id !== 'p0') expect(p.alive).toBe(false);
    }
  });

  it('自杀：其他人各 +1', () => {
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['potion', 'potion', 'potion', 'potion', 'potion']);
    g.player('p0').hp = 1;
    g.declareSpell('p0', 'fire');
    expect(g.phase).toBe('roundEnd');
    expect(g.roundResult!.kind).toBe('suicide');
    expect(g.roundResult!.points.p0).toBe(0);
    expect(g.roundResult!.points.p1).toBe(1);
    expect(g.roundResult!.points.p2).toBe(1);
  });

  it('猫头鹰加成：存活者每张秘密牌 +1 分', () => {
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['fire', 'potion', 'potion', 'potion', 'potion']);
    g.player('p2').secrets.push({ id: 's1', magic: 'dragon' }, { id: 's2', magic: 'ghost' });
    g.player('p1').hp = 1;
    g.declareSpell('p0', 'fire');
    expect(g.roundResult!.points.p2).toBe(1 + 2); // 存活 1 分 + 秘密牌 2 分
    expect(g.player('p2').score).toBe(3);
  });
});

describe('胜负判定', () => {
  it('达到 8 分且唯一最高 → 游戏结束', () => {
    const g = makeGame(2, 7);
    forceHand(g, 'p0', ['fire', 'potion', 'potion', 'potion', 'potion']);
    g.player('p0').score = 7;
    g.player('p1').hp = 1;
    g.declareSpell('p0', 'fire');
    expect(g.phase).toBe('gameOver');
    expect(g.winnerId).toBe('p0');
  });

  it('并列最高 → 继续下一轮', () => {
    // 3 人局：p0 击杀 p2，p0 +3、p1 +1，双方同为 8 分 → 并列不结束
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['blizzard', 'potion', 'potion', 'potion', 'potion']);
    g.player('p0').score = 5;
    g.player('p1').score = 7;
    g.player('p2').hp = 1; // p0 的上家
    g.declareSpell('p0', 'blizzard'); // p0: 8, p1: 8
    expect(g.phase).toBe('roundEnd'); // 并列，不结束
    expect(g.winnerId).toBeNull();
  });

  it('nextRound 开始新轮次', () => {
    const g = makeGame(4, 7);
    forceHand(g, 'p0', ['potion']);
    g.declareSpell('p0', 'potion');
    expect(g.nextRound().ok).toBe(true);
    expect(g.round).toBe(2);
    expect(g.phase).toBe('playing');
    for (const p of g.players) {
      expect(p.hp).toBe(6);
      expect(p.hand.length).toBe(5);
      expect(p.secrets.length).toBe(0);
    }
  });

  it('轮末复盘：向本人揭晓自己的手牌，对局中仍隐藏', () => {
    // 对局中：自己手牌为 null（背对自己）
    const g = makeGame(3, 7);
    forceHand(g, 'p0', ['fire', 'dragon', 'potion', 'potion', 'potion']);
    const v0 = g.getView('p0');
    expect(v0.seats.find((s) => s.id === 'p0')!.hand.every((m) => m === null)).toBe(true);
    // 击杀结束本轮后：自己手牌揭晓，可复盘
    g.player('p1').hp = 1;
    g.declareSpell('p0', 'fire');
    expect(g.phase).toBe('roundEnd');
    const v1 = g.getView('p0');
    const me = v1.seats.find((s) => s.id === 'p0')!;
    expect(me.hand.every((m) => m !== null)).toBe(true);
    expect(me.hand.filter((m) => m === 'potion').length).toBe(3);
    // 他人秘密牌身份仍保密
    g.player('p2').secrets.push({ id: 's1', magic: 'dragon' });
    const v2 = g.getView('p0');
    expect(v2.seats.find((s) => s.id === 'p2')!.secrets).toEqual([null]);
  });

  it('视角剩余数：看不到自己手牌，因此每个玩家的剩余数不同', () => {
    const g = makeGame(2, 7);
    // 唯一的龙在 p0 手中
    forceHand(g, 'p0', ['dragon', 'potion', 'potion', 'potion', 'potion']);
    g.deck = g.deck.filter((c) => c.magic !== 'dragon');
    g.secretPile = g.secretPile.filter((c) => c.magic !== 'dragon');
    // p1 视角：龙在 p0 明牌里 → 剩余 0
    const v1 = g.getView('p1');
    expect(v1.magicRemaining.dragon).toBe(0);
    // p0 视角：看不到自己的手牌 → 龙仍可能在未知区域 → 剩余 1
    const v0 = g.getView('p0');
    expect(v0.magicRemaining.dragon).toBe(1);
    // 药水：p0 手中有 4 张，其他 4 张分布未知区域
    // p1 视角可见 4 张（在 p0 手中）→ 剩余 8 - 4 - 弃牌0 = 4
    expect(v1.magicRemaining.potion).toBe(4);
    expect(v0.magicRemaining.potion).toBe(8);
    // 施放药水后（进弃牌堆）：双方剩余都减 1
    g.declareSpell('p0', 'potion');
    const v1b = g.getView('p1');
    const v0b = g.getView('p0');
    expect(v1b.magicRemaining.potion).toBe(4); // 8 - 3(明牌) - 1(弃牌)
    expect(v0b.magicRemaining.potion).toBe(7); // 8 - 0(看不到自己的牌) - 1(弃牌)
  });
});

describe('AI 决策', () => {
  it('AI 不使用自己的手牌信息（只基于视角）', () => {
    const g = makeGame(4, 7);
    const v = g.getView('p1');
    const a = chooseAiAction(v);
    expect(['declare', 'end']).toContain(a.type);
  });

  it('概率推理：确定不在手中时概率为 0', () => {
    const g = makeGame(2, 7);
    const v = g.getView('p0');
    // p1 的手牌 + 弃牌堆 + 牌堆 + 秘密牌堆都公开计数；构造：把某魔法全部放到 p1 手中
    // 简单场景：所有龙都在可见区域 → p0 手里不可能有
    const p1 = g.player('p1');
    p1.hand = p1.hand.map((c, i) => ({ id: `x${i}`, magic: 'dragon' as Magic }));
    g.deck = g.deck.filter((c) => c.magic !== 'dragon');
    g.secretPile = g.secretPile.filter((c) => c.magic !== 'dragon');
    const v2 = g.getView('p0');
    expect(probMagicInHand(v2, 'dragon')).toBe(0);
  });
});
