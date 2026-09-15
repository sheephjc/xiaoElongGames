import { MAGIC_LIST, MAX_PLAYERS, MIN_PLAYERS } from '@tm/rules';
import { AI_SPEED_PRESETS, type GameSettings } from './GameSettings';

/** 游戏详情页：出包魔法师 → 单人 vs AI / 联机对战 + 游戏偏好 */
export default function GameDetailScreen({
  playerCount,
  onPlayerCountChange,
  aiSpeed,
  onAiSpeedChange,
  settings,
  onUpdateSettings,
  onPlayLocal,
  onPlayOnline,
  onBack,
}: {
  playerCount: number;
  onPlayerCountChange: (n: number) => void;
  aiSpeed: number;
  onAiSpeedChange: (ms: number) => void;
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
  onPlayLocal: () => void;
  onPlayOnline: () => void;
  onBack: () => void;
}) {
  return (
    <div className="page detail-page game-foyer game-foyer--magician">
      <div className="panel detail-panel">
        <button className="ghost-btn foyer-back" onClick={onBack}>
          ← 返回游戏大厅
        </button>
        <div className="foyer-hero">
          <div className="foyer-intro">
            <div className="detail-head">
              <div className="detail-title">
                <h1>出包魔法师</h1>
                <span className="detail-meta">2–5 人 · 欢乐推理 · 轻策略桌游</span>
              </div>
            </div>
            <p className="detail-desc">
              见习魔法师聚在一起乱放魔法：你的手牌背对自己，看不到自己会什么，只能靠观察别人来猜。
              喊对 → 魔法生效；喊错 → 出包扣血！先到 8 分且分数最高者获胜。
            </p>
            <div className="foyer-facts">
              <span>
                <b>8</b> 种魔法
              </span>
              <span>
                <b>36</b> 张牌
              </span>
              <span>
                <b>8</b> 分决胜
              </span>
            </div>
          </div>
          <div className="foyer-art">
            <img
              src={`${import.meta.env.BASE_URL}hall/cover-magician.webp`}
              alt="魔法师围坐桌边施法"
            />
          </div>
        </div>

        <div className="detail-modes">
          <section className="detail-mode foyer-local">
            <h2>单人练习</h2>
            <div className="field">
              <span>玩家总数（其余为 AI）</span>
              <div className="count-picker">
                {Array.from(
                  { length: MAX_PLAYERS - MIN_PLAYERS + 1 },
                  (_, i) => MIN_PLAYERS + i,
                ).map((n) => (
                  <button
                    key={n}
                    className={n === playerCount ? 'count-btn active' : 'count-btn'}
                    onClick={() => onPlayerCountChange(n)}
                  >
                    {n} 人
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <span>AI 行动节奏</span>
              <select
                className="bot-select"
                value={aiSpeed}
                onChange={(e) => onAiSpeedChange(Number(e.target.value))}
              >
                {AI_SPEED_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}（{p.value}ms）
                  </option>
                ))}
              </select>
            </div>
            <button className="primary-btn big" onClick={onPlayLocal}>
              🎮 开始（本地 vs AI）
            </button>
          </section>

          <section className="detail-mode foyer-online">
            <h2>好友同桌</h2>
            <p className="muted">
              创建房间分享房间码，或从房间列表加入；支持 AI 补位、房间密码、断线托管。
            </p>
            <button className="primary-btn big" onClick={onPlayOnline}>
              🌐 进入联机大厅
            </button>
          </section>

          <section className="detail-mode foyer-preferences">
            <h2>游戏偏好</h2>
            <div className="pref-row">
              <button
                className={`pref-btn ${settings.sound ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ sound: !settings.sound })}
              >
                {settings.sound ? '🔊 音效开' : '🔇 音效关'}
              </button>
              <button
                className={`pref-btn ${settings.fx ? 'active' : ''}`}
                onClick={() => onUpdateSettings({ fx: !settings.fx })}
              >
                {settings.fx ? '✨ 动画开' : '💤 动画关'}
              </button>
              <button
                className={`pref-btn ${settings.showLog ? 'active' : ''}`}
                title="战报日志默认隐藏：有些信息（出过的牌）需要玩家自己记忆"
                onClick={() => onUpdateSettings({ showLog: !settings.showLog })}
              >
                {settings.showLog ? '📜 战报开' : '📕 战报关'}
              </button>
            </div>
          </section>
        </div>

        <details className="rules">
          <summary>📜 规则速览</summary>
          <ul>
            <li>共 36 张魔法牌、8 种魔法，每种 1~8 张不等。</li>
            <li>你的手牌背对自己：你看不到自己的牌，但能看到所有人的牌。</li>
            <li>
              轮到你说出一个魔法名：有 → 打出并生效，可继续施法（但不能比上一张更稀有）；没有 →
              出包！扣 1 生命并结束回合（巨龙失败扣 1~3）。
            </li>
            <li>回合结束补牌到 5 张。生命上限 6，每轮开始重置。</li>
            <li>
              一轮结束：击杀他人 +3（存活者 +1）；放完所有魔法 +3；自杀则其他人
              +1。猫头鹰秘密牌存活时每张再 +1。
            </li>
            <li>先到 8 分且分数最高者获胜。</li>
          </ul>
          <div className="magic-list">
            {MAGIC_LIST.map((m) => (
              <div key={m.key} className="magic-line">
                <span className="magic-emoji">{m.emoji}</span>
                <span className="magic-name">
                  {m.name} ×{m.count}
                </span>
                <span className="magic-desc">{m.desc}</span>
              </div>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
