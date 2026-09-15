/**
 * 《鳄龙咆哮》realtime 联机大厅：房间列表 / 创建加入 / 密码 / AI 补位 / 开始。
 * 复用大厅 CSS，独立于出包魔法师的 LobbyScreen，避免影响旧游戏。
 */
import { useEffect, useState } from 'react';
import type { RoomListItem } from '@tm/rules';
import type { RealtimeApi } from './useRealtimeGame';
import type { FightConfig } from '@tm/game-corcodragon-fight/GameUI';
import GameLobbyHeader from './GameLobbyHeader';

const savedLastRoom = (): { code: string; token: string; name: string } | null => {
  try {
    const raw = localStorage.getItem('tm-room-tokens');
    if (!raw) return null;
    const tokens = JSON.parse(raw) as Record<
      string,
      { playerId: string; name: string; ts: number }
    >;
    let best: { code: string; token: string; name: string; ts: number } | null = null;
    for (const [code, t] of Object.entries(tokens)) {
      if (!best || t.ts > best.ts) best = { code, token: t.playerId, name: t.name, ts: t.ts };
    }
    return best ? { code: best.code, token: best.token, name: best.name } : null;
  } catch {
    return null;
  }
};

export default function RealtimeLobbyScreen({
  remote,
  defaultName,
  serverUrl,
  config,
  onServerUrlChange,
  onExit,
}: {
  remote: RealtimeApi;
  defaultName: string;
  serverUrl: string;
  config: FightConfig;
  onServerUrlChange: (url: string) => void;
  onExit: () => void;
}) {
  const [code, setCode] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [createPw, setCreatePw] = useState('');
  const [selected, setSelected] = useState<RoomListItem | null>(null);
  const saved = savedLastRoom();

  useEffect(() => {
    remote.listRooms();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copyCode = async () => {
    if (!remote.lobby) return;
    try {
      await navigator.clipboard.writeText(remote.lobby.code);
    } catch {
      /* ignore */
    }
  };

  const roomConfig = remote.lobby?.config as Partial<FightConfig> | undefined;
  const effectiveMode = roomConfig?.mode === 'tdm' ? 'tdm' : config.mode;
  const effectiveLimit =
    typeof roomConfig?.scoreLimit === 'number' ? roomConfig.scoreLimit : config.scoreLimit;
  const effectiveRespawn =
    typeof roomConfig?.respawnMs === 'number' ? roomConfig.respawnMs : (config.respawnMs ?? 15_000);
  const effectiveTickHz =
    typeof roomConfig?.tickHz === 'number' ? roomConfig.tickHz : (config.tickHz ?? 30);
  const effectiveAiStyle = roomConfig?.aiStyle ?? config.aiStyle;
  const effectiveAiLevel = roomConfig?.aiLevel ?? config.aiLevel ?? 'normal';
  const configLabel = `${effectiveMode === 'tdm' ? '🤝 团队死斗' : '🆚 自由混战'} · ${effectiveLimit} 杀 · ${effectiveTickHz}Hz · 复活 ${Math.round(effectiveRespawn / 1000)}s · ${
    effectiveAiStyle === 'movement' ? '🧪 陪练' : '⚔️ 实战 AI'
  } · ${
    effectiveAiLevel === 'easy' ? '🐣 简单' : effectiveAiLevel === 'hard' ? '🔥 困难' : '⚖️ 普通'
  }`;

  if (remote.lobby) {
    const me = remote.lobby.players.find((p) => p.id === remote.myId);
    const isHost = me?.isHost ?? false;
    const total = remote.lobby.players.length;
    return (
      <div className="page lobby-page game-foyer game-foyer--fight foyer-room">
        <div className="panel lobby-panel">
          <GameLobbyHeader game="fight" room />
          <div className="room-code" title="点击复制">
            <span className="rc-label">
              房间码{remote.lobby.hasPassword ? ' 🔒（有密码）' : ''}
            </span>
            <button className="rc-code" onClick={copyCode}>
              {remote.lobby.code} <span className="rc-copy">📋</span>
            </button>
            <span className="rc-tip">把房间码发给朋友，即可加入对战｜{configLabel}</span>
          </div>

          <ul className="room-players">
            {remote.lobby.players.map((p) => (
              <li key={p.id} className={p.id === remote.myId ? 'is-me' : ''}>
                <span className="rp-avatar">{p.isBot ? '🤖' : '🐊'}</span>
                <span className="rp-name">
                  {p.name}
                  {p.id === remote.myId && '（你）'}
                </span>
                {p.isHost && <span className="rp-host">👑 房主</span>}
                {!p.connected && p.autopilot && <span className="rp-off">🤖 AI 接管中</span>}
              </li>
            ))}
          </ul>

          {isHost && remote.lobby.status === 'lobby' && (
            <div className="host-controls">
              <div className="field">
                <span>AI 对手数量：{remote.lobby.botCount}</span>
                <div className="stepper">
                  <button onClick={() => remote.setBots(Math.max(0, remote.lobby!.botCount - 1))}>
                    −
                  </button>
                  <button onClick={() => remote.setBots(remote.lobby!.botCount + 1)}>＋</button>
                </div>
              </div>
              <div className="field">
                <span>房间密码（可选）</span>
                <div className="create-row">
                  <input
                    className="code-input"
                    value={createPw}
                    maxLength={16}
                    placeholder={
                      remote.lobby.hasPassword ? '已设密码（输入新密码覆盖）' : '留空 = 无密码'
                    }
                    onChange={(e) => setCreatePw(e.target.value)}
                  />
                  <button
                    className="ghost-btn"
                    onClick={() => {
                      remote.setPassword(createPw.trim());
                      setCreatePw('');
                    }}
                  >
                    {createPw.trim() ? '设置密码' : remote.lobby!.hasPassword ? '清除密码' : '设置'}
                  </button>
                </div>
              </div>
              <button
                className="primary-btn big"
                disabled={total < 2 || total > 7}
                onClick={remote.start}
                title={total < 2 ? '至少 2 名玩家（可添加 AI）' : ''}
              >
                🎮 开始对战（{total} 人）
              </button>
            </div>
          )}
          {!isHost && <p className="muted">等待房主开始游戏……</p>}
          {isHost && remote.lobby.status === 'playing' && (
            <p className="muted">对局进行中，祝你好运！</p>
          )}

          {remote.error && <div className="error-box">{remote.error}</div>}
          <button className="ghost-btn" onClick={remote.leave}>
            离开房间
          </button>
        </div>
      </div>
    );
  }

  const rooms = (remote.roomList ?? []).filter((r) => r.gameId === 'corcodragon-fight');
  return (
    <div className="page lobby-page game-foyer game-foyer--fight foyer-browser">
      <div className="panel lobby-panel">
        <GameLobbyHeader game="fight" />
        <p className="foyer-match-summary">本次房间设置：{configLabel}</p>

        <div className="room-list-block">
          <div className="rl-head">
            <span className="rl-title">🏠 房间列表</span>
            <button className="ghost-btn" onClick={remote.listRooms}>
              🔄 刷新
            </button>
          </div>
          {rooms.length === 0 ? (
            <p className="muted">暂无鳄龙咆哮房间，创建一个吧～</p>
          ) : (
            <ul className="room-list">
              {rooms.map((r) => (
                <li
                  key={r.code}
                  className={selected?.code === r.code ? 'rl-row selected' : 'rl-row'}
                  onClick={() => setSelected(r)}
                  role="button"
                  tabIndex={0}
                  aria-pressed={selected?.code === r.code}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelected(r);
                    }
                  }}
                >
                  <span className="rl-lock">{r.hasPassword ? '🔒' : '🔓'}</span>
                  <span className="rl-code">{r.code}</span>
                  <span className="rl-count">
                    👥 {r.playerCount}/{r.maxPlayers}
                  </span>
                  <span className={r.status === 'playing' ? 'rl-status playing' : 'rl-status'}>
                    {r.status === 'playing' ? '⏳ 对局中' : '等待中'}
                  </span>
                  <span className="rl-join">加入 →</span>
                </li>
              ))}
            </ul>
          )}
          {selected && (
            <div className="join-selected">
              <span className="rl-code">{selected.code}</span>
              {selected.hasPassword && (
                <input
                  className="code-input"
                  value={joinPw}
                  maxLength={16}
                  placeholder="房间密码"
                  onChange={(e) => setJoinPw(e.target.value)}
                />
              )}
              <button
                className="primary-btn"
                disabled={selected.status === 'playing' || (selected.hasPassword && !joinPw)}
                onClick={() => {
                  remote.join(selected.code, defaultName, joinPw);
                  setJoinPw('');
                  setSelected(null);
                }}
              >
                {selected.status === 'playing' ? '对局中不可加入' : '加入此房间'}
              </button>
            </div>
          )}
        </div>

        <div className="join-block">
          <div className="field">
            <span>按房间码加入</span>
            <div className="create-row">
              <input
                className="code-input"
                value={code}
                maxLength={4}
                placeholder="4 位房间码"
                onChange={(e) => setCode(e.target.value.toUpperCase())}
              />
              <input
                className="code-input pw"
                value={joinPw}
                maxLength={16}
                placeholder="密码（无锁留空）"
                onChange={(e) => setJoinPw(e.target.value)}
              />
              <button
                className="primary-btn"
                disabled={code.length !== 4}
                onClick={() => {
                  remote.join(code, defaultName, joinPw);
                  setJoinPw('');
                }}
              >
                加入
              </button>
            </div>
          </div>

          <div className="field">
            <span>创建新房间（模式与击杀线在详情页设置）</span>
            <div className="create-row">
              <input
                className="code-input pw"
                value={createPw}
                maxLength={16}
                placeholder="房间密码（可选）"
                onChange={(e) => setCreatePw(e.target.value)}
              />
              <button
                className="primary-btn"
                onClick={() => {
                  remote.create(defaultName, 0, createPw, {
                    mode: config.mode,
                    scoreLimit: config.scoreLimit,
                    tickHz: config.tickHz ?? 30,
                    respawnMs: config.respawnMs ?? 15_000,
                    aiStyle: config.aiStyle ?? 'combat',
                    aiLevel: config.aiLevel ?? 'normal',
                  });
                  setCreatePw('');
                }}
              >
                ➕ 创建房间
              </button>
            </div>
            <span className="muted">AI 补位在房间内添加（最多 7 人）</span>
          </div>

          {saved && (
            <button className="ghost-btn rejoin-btn" onClick={remote.rejoin}>
              🔁 重新加入上次的房间（{saved.code}，恢复原座位）
            </button>
          )}
        </div>

        <details className="rules">
          <summary>⚙️ 服务器地址（默认留空 = 自动使用当前网址）</summary>
          <input
            className="server-input"
            value={serverUrl}
            placeholder="例如 http://192.168.x.x:8787 或 https://你的域名"
            onChange={(e) => onServerUrlChange(e.target.value)}
          />
          <p className="muted">
            局域网联机：填主机的局域网地址 + 服务端端口；公网服务器：填域名或 IP+端口。
            操作：点击画面锁定鼠标；WASD 移动、左键射击、右键开镜、R 换弹、1-4 切枪、Q/E 技能。
          </p>
        </details>

        {remote.error && <div className="error-box">{remote.error}</div>}
        <button className="ghost-btn" onClick={onExit}>
          ← 返回游戏大厅
        </button>
      </div>
    </div>
  );
}
