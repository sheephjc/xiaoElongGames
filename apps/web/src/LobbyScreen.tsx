import { useEffect, useState } from 'react';
import { AUTOPILOT_LABELS, type AutopilotMode, type RoomListItem } from '@tm/rules';
import type { RemoteApi } from './useRemoteGame';
import { lastSavedRoom } from './useRemoteGame';
import { AI_SPEED_PRESETS } from './GameSettings';
import GameLobbyHeader from './GameLobbyHeader';

export default function LobbyScreen({
  remote,
  defaultName,
  serverUrl,
  onServerUrlChange,
  onExit,
}: {
  remote: RemoteApi;
  defaultName: string;
  serverUrl: string;
  onServerUrlChange: (url: string) => void;
  onExit: () => void;
}) {
  const [code, setCode] = useState('');
  const [joinPw, setJoinPw] = useState('');
  const [createPw, setCreatePw] = useState('');
  const [selected, setSelected] = useState<RoomListItem | null>(null);
  const saved = lastSavedRoom();

  // 进入界面拉取一次房间列表
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

  // ---- 房间内 ----
  if (remote.lobby) {
    const me = remote.lobby.players.find((p) => p.id === remote.myId);
    const isHost = me?.isHost ?? false;
    const total = remote.lobby.players.length;
    const st = remote.lobby.settings;
    return (
      <div className="page lobby-page game-foyer game-foyer--magician foyer-room">
        <div className="panel lobby-panel">
          <GameLobbyHeader game="magician" room />
          <div className="room-code" title="点击复制">
            <span className="rc-label">
              房间码{remote.lobby.hasPassword ? ' 🔒（有密码）' : ''}
            </span>
            <button className="rc-code" onClick={copyCode}>
              {remote.lobby.code} <span className="rc-copy">📋</span>
            </button>
            <span className="rc-tip">把房间码发给朋友，即可加入对战</span>
          </div>

          <ul className="room-players">
            {remote.lobby.players.map((p) => (
              <li key={p.id} className={p.id === remote.myId ? 'is-me' : ''}>
                <span className="rp-avatar">{p.isBot ? '🤖' : '🧙'}</span>
                <span className="rp-name">
                  {p.name}
                  {p.id === remote.myId && '（你）'}
                </span>
                {p.isHost && <span className="rp-host">👑 房主</span>}
                {!p.connected && !p.autopilot && <span className="rp-off">⏳ 断线等待重连</span>}
                {!p.connected && p.autopilot && <span className="rp-off">🤖 AI 托管中</span>}
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
                <span>断线托管策略（断线多久后交给 AI）</span>
                <select
                  className="bot-select"
                  value={st.autopilot}
                  onChange={(e) =>
                    remote.updateSettings({ autopilot: e.target.value as AutopilotMode })
                  }
                >
                  {(Object.keys(AUTOPILOT_LABELS) as AutopilotMode[]).map((m) => (
                    <option key={m} value={m}>
                      {AUTOPILOT_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <span>AI 行动节奏</span>
                <select
                  className="bot-select"
                  value={st.aiSpeed}
                  onChange={(e) => remote.updateSettings({ aiSpeed: Number(e.target.value) })}
                >
                  {AI_SPEED_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}（{p.value}ms）
                    </option>
                  ))}
                </select>
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
                disabled={total < 2}
                onClick={remote.start}
                title={total < 2 ? '至少 2 名玩家（可添加 AI）' : ''}
              >
                🎮 开始对战（{total} 人）
              </button>
            </div>
          )}
          {isHost && remote.lobby.status === 'playing' && (
            <div className="host-controls">
              <div className="field">
                <span>AI 行动节奏（对局中可调）</span>
                <select
                  className="bot-select"
                  value={st.aiSpeed}
                  onChange={(e) => remote.updateSettings({ aiSpeed: Number(e.target.value) })}
                >
                  {AI_SPEED_PRESETS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}（{p.value}ms）
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {!isHost && <p className="muted">等待房主开始游戏……</p>}

          {remote.error && <div className="error-box">{remote.error}</div>}

          <button className="ghost-btn" onClick={remote.leave}>
            离开房间
          </button>
        </div>
      </div>
    );
  }

  // ---- 房间列表 + 创建/加入 ----
  // 只显示出包魔法师的房间（realtime 房间在各自游戏大厅中列出）
  const rooms = (remote.roomList ?? []).filter((r) => !r.gameId || r.gameId === 'trouble-magician');
  return (
    <div className="page lobby-page game-foyer game-foyer--magician foyer-browser">
      <div className="panel lobby-panel">
        <GameLobbyHeader game="magician" />

        <div className="room-list-block">
          <div className="rl-head">
            <span className="rl-title">🏠 房间列表</span>
            <button className="ghost-btn" onClick={remote.listRooms}>
              🔄 刷新
            </button>
          </div>
          {rooms.length === 0 ? (
            <p className="muted">暂无房间，创建一个吧～</p>
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
            <span>创建新房间</span>
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
                  remote.create(defaultName, 0, createPw);
                  setCreatePw('');
                }}
              >
                ➕ 创建房间
              </button>
            </div>
            <span className="muted">AI 补位在房间内添加</span>
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
            局域网联机：填主机的局域网地址 + 服务端端口；公网服务器：填域名或
            IP+端口。修改后重新连接生效。
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
