import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MAGIC_DEFS,
  MAGIC_LIST,
  type EffectEvent,
  type LobbyInfo,
  type Magic,
  type PlayerView,
  type SeatView,
} from '@tm/rules';
import { HpBar, MagicCard } from './components';
import { playSfx, setSoundEnabled } from './fx';
import type { GameSettings } from './GameSettings';
import { collectSpellEffects, DICE_DELAY_MS, DICE_VISIBLE_MS, type SpellEffect } from './spellEffects';

/** 本地与联机共用的游戏操作接口 */
export interface GameApi {
  view: PlayerView | null;
  start: () => void;
  declare: (magic: Magic) => void;
  endTurn: () => void;
  /** 开始下一轮（本地直接执行；联机仅房主可发） */
  advanceRound: () => void;
}

interface FloatFx {
  key: number;
  seatId: string;
  text: string;
  kind: 'damage' | 'heal';
}

const EVENT_ICONS: Record<string, string> = {
  roundStart: '🎬',
  turnStart: '▶️',
  cast: '✨',
  dice: '🎲',
  damage: '💥',
  heal: '💚',
  owl: '🦉',
  fail: '😱',
  draw: '🎴',
  turnEnd: '⏭️',
  roundEnd: '🏁',
  gameOver: '🏆',
  info: '💬',
};

function SecretBadge({ seat, isYou }: { seat: SeatView; isYou: boolean }) {
  if (seat.secretCount === 0) return null;
  if (isYou) {
    return (
      <div className="secret-badge" title="你的秘密牌（本轮存活时每张 +1 分）">
        🤫 {seat.secrets.map((m, i) => (m ? <MagicCard key={i} magic={m} small /> : null))}
      </div>
    );
  }
  return <div className="secret-badge">秘密牌 {seat.secretCount} 张</div>;
}

/** 轮末/终局复盘：展示所有玩家的手牌 */
function RevealHands({ seats }: { seats: SeatView[] }) {
  return (
    <div className="reveal-hands">
      <div className="reveal-title">🃏 手牌复盘</div>
      {seats.map((s) => (
        <div key={s.id} className="reveal-row">
          <span className="reveal-name">
            {s.name}
            {s.isBot ? ' 🤖' : ''}
            {!s.alive && ' 💀'}
          </span>
          <span className="reveal-cards">
            {s.hand.map((m, i) => (
              <MagicCard key={i} magic={m} small />
            ))}
            {s.handCount === 0 && <span className="empty-hand">无手牌</span>}
            {s.secretCount > 0 && <span className="reveal-secret">秘密牌 {s.secretCount} 张</span>}
          </span>
        </div>
      ))}
    </div>
  );
}

function Seat({
  seat,
  isYou,
  isCurrent,
  isPrev,
  isNext,
  shaking,
  floats,
  hideOwnHand,
  connInfo,
}: {
  seat: SeatView;
  isYou: boolean;
  isCurrent: boolean;
  isPrev: boolean;
  isNext: boolean;
  shaking: boolean;
  floats: FloatFx[];
  /** 对局中自己手牌背对自己；轮末/终局复盘时揭晓 */
  hideOwnHand: boolean;
  /** 联机模式下的连接/托管状态 */
  connInfo?: { connected: boolean; autopilot: boolean };
}) {
  return (
    <div
      className={`seat ${isYou ? 'you' : ''} ${isCurrent ? 'current' : ''} ${seat.alive ? '' : 'dead'} ${shaking ? 'shaking' : ''}`}
    >
      <div className="seat-top">
        <div className={`avatar av-${seat.isBot ? 'bot' : 'human'}`}>{seat.name.slice(0, 1)}</div>
        <div className="seat-info">
          <div className="seat-name">
            {seat.name}
            {seat.isBot && <span className="bot-tag">AI</span>}
            {connInfo && !connInfo.connected && !connInfo.autopilot && (
              <span className="conn-tag waiting">⏳ 断线等待重连</span>
            )}
            {connInfo && !connInfo.connected && connInfo.autopilot && (
              <span className="conn-tag pilot">🤖 AI 托管中</span>
            )}
            {isPrev && (
              <span className="rel-tag" title="你的上家">
                上家
              </span>
            )}
            {isNext && (
              <span className="rel-tag" title="你的下家">
                下家
              </span>
            )}
            {isCurrent && <span className="turn-tag">施法中</span>}
          </div>
          <HpBar hp={seat.hp} shaking={shaking} />
        </div>
        <div className="seat-side">
          <div className="seat-score"><b>{seat.score}</b> 分</div>
          <SecretBadge seat={seat} isYou={isYou} />
        </div>
      </div>
      <div className="hand-fan">
        {seat.hand.map((m, i) => (
          <MagicCard key={i} magic={m} hidden={isYou && hideOwnHand} small={!isYou} />
        ))}
        {seat.handCount === 0 && <span className="empty-hand">无手牌</span>}
      </div>
      {!seat.alive && <div className="dead-mark">本轮出局</div>}
      {floats.map((f) => (
        <span key={f.key} className={`float-fx ${f.kind}`}>
          {f.text}
        </span>
      ))}
    </div>
  );
}

export default function GameTable({
  api,
  settings,
  onExit,
  onRematch,
  onToggleSound,
  onToggleFx,
  onToggleLog,
  roomInfo,
  canAdvanceRound,
  online,
}: {
  api: GameApi;
  settings: GameSettings;
  onExit: () => void;
  onRematch?: () => void;
  onToggleSound: () => void;
  onToggleFx: () => void;
  onToggleLog: () => void;
  /** 联机模式：大厅信息（用于显示断线/托管状态与房主判断） */
  roomInfo?: LobbyInfo | null;
  /** 当前玩家是否可以开始下一轮（本地恒为 true；联机仅房主） */
  canAdvanceRound: boolean;
  online?: boolean;
}) {
  const [floats, setFloats] = useState<FloatFx[]>([]);
  const [shake, setShake] = useState<{ seatId: string; key: number } | null>(null);
  const [fullFx, setFullFx] = useState<SpellEffect | null>(null);
  const [diceVisible, setDiceVisible] = useState(false);
  const spellQueue = useRef<SpellEffect[]>([]);
  const presenting = useRef(false);
  const timers = useRef(new Set<number>());
  const [confetti, setConfetti] = useState(false);
  const prevSeq = useRef<number | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const fxOn = useRef(settings.fx);
  fxOn.current = settings.fx;

  function later(action: () => void, delay: number) {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      action();
    }, delay);
    timers.current.add(timer);
  }

  function clearEffects() {
    timers.current.forEach(clearTimeout);
    timers.current.clear();
    spellQueue.current = [];
    presenting.current = false;
  }

  useEffect(() => clearEffects, []);

  useEffect(() => {
    if (settings.fx) return;
    clearEffects();
    setFullFx(null);
    setDiceVisible(false);
    setFloats([]);
    setShake(null);
    setConfetti(false);
  }, [settings.fx]);

  useEffect(() => {
    setSoundEnabled(settings.sound);
  }, [settings.sound]);

  useEffect(() => {
    api.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const view = api.view;

  // 事件增量 → 特效/音效
  useEffect(() => {
    if (!view) return;
    const last = view.events.length ? view.events[view.events.length - 1].seq : 0;
    if (prevSeq.current === null) {
      prevSeq.current = last;
      return;
    }
    const fresh = view.events.filter((e) => e.seq > prevSeq.current!);
    prevSeq.current = last;
    const spells = collectSpellEffects(fresh);
    if (fxOn.current) {
      spellQueue.current.push(...spells);
      if (!presenting.current) presentNextSpell();
    } else {
      for (const spell of spells) {
        playSfx(spell.fail ? 'fail' : 'cast');
        if (spell.dice != null) later(() => playSfx('dice'), DICE_DELAY_MS);
      }
    }
    for (const e of fresh) handleFx(e);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.events.at(-1)?.seq]);

  // 战报自动滚动
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [view?.events.at(-1)?.seq]);

  function presentNextSpell() {
    const spell = spellQueue.current.shift();
    presenting.current = !!spell;
    setFullFx(spell ?? null);
    setDiceVisible(false);
    if (!spell) return;
    playSfx(spell.fail ? 'fail' : 'cast');
    if (spell.dice != null) {
      later(() => {
        playSfx('dice');
        setDiceVisible(true);
      }, DICE_DELAY_MS);
    }
    later(presentNextSpell, spell.dice != null
      ? DICE_DELAY_MS + DICE_VISIBLE_MS
      : spell.fail ? 1800 : 1500);
  }

  function handleFx(e: EffectEvent) {
    const fx = fxOn.current;
    switch (e.type) {
      case 'damage': {
        if (!e.targetId) break;
        playSfx('damage');
        if (!fx) break;
        const key = e.seq;
        setFloats((f) => [...f, { key, seatId: e.targetId!, text: `-${e.amount ?? 1}`, kind: 'damage' }]);
        setShake({ seatId: e.targetId!, key });
        later(() => {
          setFloats((f) => f.filter((x) => x.key !== key));
          setShake((s) => (s?.key === key ? null : s));
        }, 1400);
        break;
      }
      case 'heal': {
        if (!e.targetId || (e.amount ?? 0) <= 0) break;
        playSfx('heal');
        if (!fx) break;
        const key = e.seq;
        setFloats((f) => [...f, { key, seatId: e.targetId!, text: `+${e.amount}`, kind: 'heal' }]);
        later(() => setFloats((f) => f.filter((x) => x.key !== key)), 1400);
        break;
      }
      case 'turnStart':
        if (e.playerId === view?.youId) playSfx('turn');
        break;
      case 'roundEnd':
        playSfx('roundEnd');
        break;
      case 'gameOver':
        playSfx('gameOver');
        if (fx) setConfetti(true);
        break;
      default:
        break;
    }
  }

  const confettiPieces = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 1.4,
        dur: 2.2 + Math.random() * 2,
        size: 6 + Math.random() * 8,
        color: ['#ffb84d', '#8a6bff', '#43d17a', '#ff5d73', '#4dd8ff'][i % 5],
        rot: Math.random() * 720,
      })),
    [],
  );

  if (!view) return <div className="app-loading" role="status">加载中……</div>;

  const you = view.seats.find((s) => s.id === view.youId)!;
  const others = view.seats.filter((s) => s.id !== view.youId);
  const youIdx = view.seats.findIndex((s) => s.id === view.youId);
  const n = view.seats.length;
  const prevId = view.seats[(youIdx - 1 + n) % n].id;
  const nextId = view.seats[(youIdx + 1) % n].id;
  // 对局中自己手牌隐藏；轮末/终局复盘揭晓
  const hideOwnHand = view.phase === 'playing';

  return (
    <div className={`page game-page magician-table ${settings.showLog ? '' : 'no-log'}`} data-motion={settings.fx ? 'on' : 'off'}>
      <header className="topbar">
        <h1 className="topbar-title">出包魔法师</h1>
        <div className="topbar-info">
          <span className="chip-info">第 <b>{view.round}</b> 轮</span>
          <span className="chip-info">牌堆 <b>{view.deckCount}</b></span>
          <span className="chip-info">秘密 <b>{view.secretPileCount}</b></span>
          <span className="chip-info">弃牌 <b>{view.discard.length}</b></span>
          {online && <span className="chip-info online">联机</span>}
        </div>
        <div className="table-tools">
          <button className="ghost-btn" aria-label="战报" aria-pressed={settings.showLog} title={settings.showLog ? '隐藏战报（凭记忆推理）' : '显示战报'} onClick={onToggleLog}>
            战报
          </button>
          <button className="ghost-btn" aria-label="音效" aria-pressed={settings.sound} title={settings.sound ? '关闭音效' : '开启音效'} onClick={onToggleSound}>
            音效
          </button>
          <button className="ghost-btn" aria-label="动效" aria-pressed={settings.fx} title={settings.fx ? '关闭动画' : '开启动画'} onClick={onToggleFx}>
            动效
          </button>
          <button className="ghost-btn" onClick={onExit}>
            退出
          </button>
        </div>
      </header>

      <main className="board">
        <div className="opponents">
          {others.map((s) => {
            const cp = roomInfo?.players.find((p) => p.id === s.id);
            return (
              <Seat
                key={s.id}
                seat={s}
                isYou={false}
                isCurrent={view.currentPlayerId === s.id}
                isPrev={s.id === prevId}
                isNext={s.id === nextId}
                shaking={shake?.seatId === s.id}
                floats={floats.filter((f) => f.seatId === s.id)}
                hideOwnHand={hideOwnHand}
                connInfo={cp ? { connected: cp.connected, autopilot: cp.autopilot } : undefined}
              />
            );
          })}
        </div>

        <div className="your-zone">
          <div className="turn-status" role="status" aria-live="polite">
            {view.isYourTurn ? (
              <span className="your-turn">轮到你了，选择要施放的魔法</span>
            ) : (
              <span className="wait-turn">
                {view.phase !== 'playing' ? '本轮已结束，可以查看手牌' : `等待 ${view.currentPlayerId ? view.seats.find((s) => s.id === view.currentPlayerId)?.name : '……'} 施法`}
              </span>
            )}
          </div>
          <Seat
            seat={you}
            isYou
            isCurrent={view.currentPlayerId === you.id}
            isPrev={you.id === prevId}
            isNext={you.id === nextId}
            shaking={shake?.seatId === you.id}
            floats={floats.filter((f) => f.seatId === you.id)}
            hideOwnHand={hideOwnHand}
            connInfo={(() => {
              const cp = roomInfo?.players.find((p) => p.id === you.id);
              return cp ? { connected: cp.connected, autopilot: cp.autopilot } : undefined;
            })()}
          />
          <div className="action-heading"><h2>施放魔法</h2><span>你的手牌背对自己，观察其他玩家的牌来判断。</span></div>
          <div className="action-bar">
            {MAGIC_LIST.map((m) => {
              const legal = view.legalMagics.includes(m.key);
              const isLast = view.lastMagic === m.key;
              const remaining = view.magicRemaining[m.key];
              return (
                <button
                  key={m.key}
                  className={`magic-btn card-btn-${m.key} ${legal ? '' : 'illegal'} ${isLast ? 'last' : ''}`}
                  disabled={!view.isYourTurn || !legal}
                  onClick={() => api.declare(m.key)}
                  title={`${m.desc}｜全副牌共 ${m.count} 张｜你的视角还有 ${remaining} 张未被看见`}
                >
                  <span className="mb-emoji">{m.emoji}</span>
                  <span className="mb-name">{m.name}</span>
                  <span className={`mb-count ${remaining > 0 ? '' : 'zero'}`}>剩 {remaining}</span>
                  {view.isYourTurn && !legal && <span className="mb-lock">🔒</span>}
                </button>
              );
            })}
            <button className="end-btn" disabled={!view.isYourTurn} onClick={api.endTurn}>
              结束回合
            </button>
          </div>
          {view.isYourTurn && view.lastMagic && (
            <div className="restrict-hint">
              {MAGIC_DEFS[view.lastMagic].emoji} 已施放「{MAGIC_DEFS[view.lastMagic].name}」：
              下一张魔法不能比它更稀有（总张数不能更少）。
            </div>
          )}
        </div>
      </main>

      {settings.showLog && (
        <aside className="log-panel">
          <h3>📜 战报</h3>
          <div className="log" ref={logRef}>
            {view.events.map((e) => (
              <div key={e.seq} className={`log-line ev-${e.type}`}>
                <span className="log-icon">{EVENT_ICONS[e.type] ?? '•'}</span>
                <span>{e.text}</span>
              </div>
            ))}
          </div>
        </aside>
      )}

      {/* 全屏施法特效（成功/失败两版） */}
      {fullFx && (
        <div className={`full-fx ${fullFx.fail ? 'fail' : 'success'}`} key={fullFx.key} role="status">
          <div className="fx-rays" />
          <div className="fx-plate">
            <span className="fx-badge">{fullFx.fail ? '❌ 出包' : '✅ 成功'}</span>
            <span className="fx-emoji">{fullFx.fail ? '😱' : MAGIC_DEFS[fullFx.magic].emoji}</span>
            <span className="fx-name">{MAGIC_DEFS[fullFx.magic].name}</span>
            <span className="fx-text">
              {fullFx.fail ? '施放失败！' : '施放成功！'}
            </span>
          </div>
          {diceVisible && fullFx.dice != null && (
            <div className="dice-box" role="status">
              <span className="dice-label">掷骰子</span>
              <div className="dice-row">
                <span className="dice-cube" aria-hidden="true">🎲</span>
                <span className="dice-num">{fullFx.dice}</span>
              </div>
            </div>
          )}
        </div>
      )}
      {confetti &&
        confettiPieces.map((p, i) => (
          <span
            key={i}
            className="confetti"
            style={{
              left: `${p.left}%`,
              width: p.size,
              height: p.size * 1.6,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: `${p.dur}s`,
              transform: `rotate(${p.rot}deg)`,
            }}
          />
        ))}

      {/* 轮末结算：右侧浮动面板，不遮挡手牌，可复盘 */}
      {view.phase === 'roundEnd' && view.roundResult && (
        <aside className="round-panel panel">
          <h2>🏁 本轮结束</h2>
          <p className="round-result-text">{view.roundResult.text}</p>
          <ul className="score-list">
            {view.seats.map((s) => (
              <li key={s.id}>
                {s.name}：
                <b className={view.roundResult!.points[s.id] > 0 ? 'gain' : ''}>
                  +{view.roundResult!.points[s.id] ?? 0}
                </b>{' '}
                （累计 ⭐{s.score}）
              </li>
            ))}
          </ul>
          <RevealHands seats={view.seats} />
          {canAdvanceRound ? (
            <button className="primary-btn" onClick={api.advanceRound}>
              ▶️ 开始下一轮
            </button>
          ) : (
            <p className="muted">等待房主开始下一轮……</p>
          )}
        </aside>
      )}

      {view.phase === 'gameOver' && (
        <div className="overlay">
          <div className="panel overlay-panel">
            <h2>🏆 游戏结束</h2>
            <p className="winner">
              {view.winnerId
                ? `${view.seats.find((s) => s.id === view.winnerId)!.name} 获得最终胜利！`
                : '平局！'}
            </p>
            <ul className="score-list">
              {[...view.seats]
                .sort((a, b) => b.score - a.score)
                .map((s, i) => (
                  <li key={s.id}>
                    {['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][i] ?? ''} {s.name}：⭐{s.score}
                  </li>
                ))}
            </ul>
            <RevealHands seats={view.seats} />
            <div className="overlay-btns">
              {onRematch && (
                <button className="primary-btn" onClick={onRematch}>
                  🔁 再来一局
                </button>
              )}
              <button className="ghost-btn" onClick={onExit}>
                {online ? '离开房间' : '返回游戏'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
