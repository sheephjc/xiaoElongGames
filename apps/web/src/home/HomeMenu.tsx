import type { MouseEvent } from 'react';
import HomeIcon, { type HomeIconName } from './HomeIcons';
import type { HomePanel } from '../HomeScreen';

const ENTRIES: {
  panel: HomePanel;
  icon: HomeIconName;
  title: string;
}[] = [
  { panel: 'hall', icon: 'game', title: '游戏大厅' },
  { panel: 'projects', icon: 'projects', title: '项目' },
  { panel: 'members', icon: 'members', title: '成员介绍' },
];

export default function HomeMenu({
  onChoose,
  busy,
}: {
  onChoose: (panel: HomePanel, event: MouseEvent<HTMLButtonElement>) => void;
  busy: boolean;
}) {
  return (
    <nav className="home-menu" aria-label="首页栏目">
      {ENTRIES.map((entry) => (
        <button
          type="button"
          key={entry.panel}
          disabled={busy}
          className="home-entry"
          data-home-entry={entry.panel}
          onClick={(event) => onChoose(entry.panel, event)}
        >
          <span className="home-entry-icon">
            <HomeIcon name={entry.icon} />
          </span>
          <span className="home-entry-copy">
            <span className="home-entry-title">{entry.title}</span>
          </span>
          <span className="home-entry-end">
            <HomeIcon name="arrow" />
          </span>
          <span className="home-entry-ornament" aria-hidden="true" />
        </button>
      ))}
    </nav>
  );
}
