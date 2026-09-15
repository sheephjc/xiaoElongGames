import { Link } from 'react-router-dom';
import { useAnqiHost } from '../HostContext';

interface AppHeaderProps {
  backTo?: string;
  backLabel?: string;
  onRules?: () => void;
}

export function AppHeader({ backTo, backLabel = '返回', onRules }: AppHeaderProps) {
  const { onExit } = useAnqiHost();
  return (
    <header className="masthead">
      <Link className="brand-mark" to="/" aria-label="返回暗棋首页">
        暗
      </Link>
      <div>
        <h1>暗棋</h1>
      </div>
      <div className="header-actions">
        {!backTo && onExit && (
          <button className="quiet-button" type="button" onClick={onExit}>
            返回游戏大厅
          </button>
        )}
        {backTo && (
          <Link className="quiet-button header-link" to={backTo}>
            {backLabel}
          </Link>
        )}
        {onRules && (
          <button className="quiet-button" type="button" onClick={onRules}>
            玩法
          </button>
        )}
      </div>
    </header>
  );
}
