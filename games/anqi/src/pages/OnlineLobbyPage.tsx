import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { useOnline } from '../online/OnlineProvider';
import { useAnqiHost } from '../HostContext';
import { nicknameStorageKey, normalizeNickname, normalizeRoomCode } from '../online/protocol';

function initialNickname(): string {
  try {
    return localStorage.getItem(nicknameStorageKey) ?? '';
  } catch {
    return '';
  }
}

export function OnlineLobbyPage() {
  const host = useAnqiHost();
  const navigate = useNavigate();
  const { connected, createRoom, joinRoom, message, clearMessage } = useOnline();
  const [nickname, setNickname] = useState(() => host.nickname ?? initialNickname());
  const [roomCode, setRoomCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string>();

  const validNickname = normalizeNickname(nickname);
  const rememberNickname = () => {
    try {
      if (validNickname) localStorage.setItem(nicknameStorageKey, validNickname);
    } catch {
      /* optional storage */
    }
  };

  const handleCreate = async () => {
    clearMessage();
    if (!validNickname) {
      setFormError('请输入 1 至 12 个字符的昵称');
      return;
    }
    setBusy(true);
    setFormError(undefined);
    rememberNickname();
    const result = await createRoom(validNickname);
    setBusy(false);
    if (result) navigate(`/online/${result.session.roomCode}`);
  };

  const handleJoin = async (event: FormEvent) => {
    event.preventDefault();
    clearMessage();
    if (!validNickname) {
      setFormError('请输入 1 至 12 个字符的昵称');
      return;
    }
    const validRoomCode = normalizeRoomCode(roomCode);
    if (!validRoomCode) {
      setFormError('请输入四位房间号');
      return;
    }
    setBusy(true);
    setFormError(undefined);
    rememberNickname();
    const result = await joinRoom(validNickname, validRoomCode);
    setBusy(false);
    if (result) navigate(`/online/${result.session.roomCode}`);
  };

  return (
    <main className="app-shell lobby-shell">
      <AppHeader backTo="/" backLabel="首页" />
      <section className="lobby-panel">
        <div className="lobby-heading">
          <h2>联机大厅</h2>
          <p>两人入室即刻开战，首局红黑随机。</p>
        </div>

        <label className="field-label nickname-field">
          <span>你的昵称</span>
          <input
            value={nickname}
            maxLength={12}
            autoComplete="nickname"
            placeholder="请输入昵称"
            onChange={(event) => {
              setNickname(event.target.value);
              setFormError(undefined);
            }}
          />
        </label>

        <div className="lobby-actions">
          <section className="lobby-action-card">
            <span className="action-number">壹</span>
            <h3>开一间棋室</h3>
            <p>生成四位房间号，分享给另一位玩家。</p>
            <button
              className="primary-button lobby-main-button"
              type="button"
              disabled={!connected || busy}
              onClick={handleCreate}
            >
              创建房间
            </button>
          </section>

          <form className="lobby-action-card" onSubmit={handleJoin}>
            <span className="action-number">贰</span>
            <h3>加入棋友房间</h3>
            <p>输入棋友发来的四位数字房间号。</p>
            <label className="field-label room-code-field">
              <span className="sr-only">四位房间号</span>
              <input
                value={roomCode}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                placeholder="房间号"
                aria-label="四位房间号"
                onChange={(event) => {
                  setRoomCode(event.target.value.replace(/\D/g, '').slice(0, 4));
                  setFormError(undefined);
                }}
              />
            </label>
            <button
              className="secondary-button lobby-main-button"
              type="submit"
              disabled={!connected || busy}
            >
              加入房间
            </button>
          </form>
        </div>

        <div className={`lobby-status${formError || message ? ' is-error' : ''}`} role="status">
          {formError ?? message ?? (connected ? '服务器已连接' : '正在连接服务器…')}
        </div>
      </section>
    </main>
  );
}
