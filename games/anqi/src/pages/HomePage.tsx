import { Link } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { readRoomSession } from '../HostContext';

export function HomePage() {
  const session = readRoomSession();
  return (
    <main className="app-shell landing-shell">
      <AppHeader />
      <section className="mode-section" aria-labelledby="mode-title">
        <h2 id="mode-title">选择模式</h2>
        {session && (
          <Link className="quiet-button resume-room-link" to={`/online/${session.roomCode}`}>
            继续房间 {session.roomCode}
          </Link>
        )}
        <div className="mode-grid">
          <Link className="mode-card local-mode" to="/local">
            <span className="mode-seal" aria-hidden="true">
              双
            </span>
            <strong>本地对战</strong>
            <small>同屏落子，轮流行棋</small>
          </Link>
          <Link className="mode-card online-mode" to="/online">
            <span className="mode-seal" aria-hidden="true">
              联
            </span>
            <strong>联机对战</strong>
            <small>创建房间，邀友入局</small>
          </Link>
        </div>
      </section>
    </main>
  );
}
