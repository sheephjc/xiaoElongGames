import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { GameSettings } from './GameSettings';
import HallScreen from './HallScreen';
import MembersScreen from './MembersScreen';
import { playSfx, setSoundEnabled } from './fx';
import HomeIcon from './home/HomeIcons';
import HomeMenu from './home/HomeMenu';
import HomeScene from './home/HomeScene';
import './home/home.css';
import './home/home-gallery.css';

export type HomePanel = 'main' | 'hall' | 'projects' | 'members';

const PANEL_COPY = {
  main: { title: '今天，想做点什么？' },
  hall: { title: '游戏大厅' },
  projects: { title: '项目' },
  members: { title: '成员介绍' },
} as const;

export default function HomeScreen({
  panel,
  layout,
  onLayoutChange,
  onPanelChange,
  onEnterGame,
  myName,
  onNameChange,
  settings,
  onUpdateSettings,
}: {
  panel: HomePanel;
  layout: 'list' | 'all';
  onLayoutChange: (layout: 'list' | 'all') => void;
  onPanelChange: (panel: HomePanel) => void;
  onEnterGame: (gameId: string) => void;
  myName: string;
  onNameChange: (name: string) => void;
  settings: GameSettings;
  onUpdateSettings: (patch: Partial<GameSettings>) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const locked = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  const [ring, setRing] = useState<{ x: number; y: number; id: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [transition, setTransition] = useState<'idle' | 'out' | 'in'>('idle');
  const animated = settings.fx && !reducedMotion;
  const copy = PANEL_COPY[panel];

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    media.addEventListener('change', update);
    return () => {
      media.removeEventListener('change', update);
      timers.current.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    // 初次浏览不抢走焦点；打开面板或从游戏返回后，将焦点放在标题。
    if (panel !== 'main' || locked.current) titleRef.current?.focus({ preventScroll: true });
  }, [panel, layout]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [layout]);

  useEffect(() => {
    if (panel !== 'members') return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [panel]);

  const confirm = (action: () => void, event: MouseEvent<HTMLButtonElement>, timing?: { delay: number; duration: number }) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    if (settings.sound) {
      setSoundEnabled(true);
      playSfx('uiConfirm');
    }
    if (animated && rootRef.current) {
      const root = rootRef.current.getBoundingClientRect();
      const button = event.currentTarget.getBoundingClientRect();
      setRing({
        x: (event.detail === 0 ? button.left + button.width / 2 : event.clientX) - root.left,
        y: (event.detail === 0 ? button.top + button.height / 2 : event.clientY) - root.top,
        id: Date.now(),
      });
    }
    // 给按下反馈留出时间，同时防止双击触发两次进入。
    timers.current.push(setTimeout(action, timing?.delay ?? (animated ? 90 : 0)));
    timers.current.push(
      setTimeout(() => {
        locked.current = false;
        setRing(null);
        setBusy(false);
        timers.current = [];
      }, timing?.duration ?? 340),
    );
  };

  const toggleLayout = (event: MouseEvent<HTMLButtonElement>) => {
    if (locked.current) return;
    setTransition(animated ? 'out' : 'idle');
    confirm(() => {
      onLayoutChange(layout === 'list' ? 'all' : 'list');
      setTransition(animated ? 'in' : 'idle');
      if (animated) timers.current.push(setTimeout(() => setTransition('idle'), 560));
    }, event, { delay: animated ? 180 : 0, duration: animated ? 800 : 340 });
  };

  return (
    <div className="home" ref={rootRef} data-panel={panel} data-layout={layout} data-transition={transition} data-motion={animated ? 'on' : 'off'}>
      <HomeScene key={panel === 'members' ? 'members' : 'home'} imagePath={panel === 'members' ? 'members/background.jpg' : undefined} />
      <header className="home-header">
        <div className="home-brand">
          <span className="home-brand-mark" aria-hidden="true">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" />
          </span>
          <div>
            <span className="home-brand-name">小鳄龙之家</span>
          </div>
        </div>
        {panel !== 'members' && <div className="home-tools">
          <label className="home-name">
            <span className="home-name-label">昵称</span>
            <input
              aria-label="玩家昵称"
              value={myName}
              maxLength={8}
              onChange={(e) => onNameChange(e.target.value)}
              onBlur={() => onNameChange(myName.trim() || '你')}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <span className="home-tools-divider" aria-hidden="true" />
          <button
            type="button"
            className="home-tool"
            aria-label="首页音效"
            aria-pressed={settings.sound}
            title={settings.sound ? '关闭音效' : '开启音效'}
            onClick={() => onUpdateSettings({ sound: !settings.sound })}
          >
            <HomeIcon name={settings.sound ? 'sound' : 'muted'} />
          </button>
          <button
            type="button"
            className="home-tool"
            aria-label="首页动效"
            aria-pressed={settings.fx}
            title={settings.fx ? '关闭动效' : '开启动效'}
            onClick={() => onUpdateSettings({ fx: !settings.fx })}
          >
            <HomeIcon name="sparkle" />
          </button>
        </div>}
      </header>
      <main className="home-main">
        <section className="home-panel" aria-labelledby="home-panel-title" aria-busy={busy}>
          <div className="home-panel-content" key={`${panel}:${layout}`}>
            <div className={`home-panel-heading${panel === 'members' ? ' home-panel-heading--hidden' : ''}`}>
              <h1 id="home-panel-title" ref={titleRef} tabIndex={-1}>
                {copy.title}
              </h1>
            </div>
            {panel === 'main' ? (
              <HomeMenu
                busy={busy}
                onChoose={(next, event) => confirm(() => onPanelChange(next), event)}
              />
            ) : (
              <>
                {panel === 'hall' ? (
                  <HallScreen
                    busy={busy}
                    onEnter={(id, event) => confirm(() => onEnterGame(id), event)}
                  />
                ) : panel === 'members' ? (
                  <MembersScreen />
                ) : (
                  <div id="home-panel-items" className="home-placeholder">
                    <span className="home-placeholder-icon">
                      <HomeIcon name="projects" />
                    </span>
                    <h2>项目内容正在整理</h2>
                    <span className="home-placeholder-decoration" aria-hidden="true">
                      ✦
                    </span>
                  </div>
                )}
                <div className="home-panel-actions">
                  <button
                    type="button"
                    className="home-back"
                    disabled={busy}
                    onClick={(event) => confirm(() => onPanelChange('main'), event)}
                  >
                    <HomeIcon name="back" /> 返回首页
                  </button>
                  {(panel === 'hall' || panel === 'projects') && (
                    <button
                      type="button"
                      className="home-expand"
                      aria-expanded={layout === 'all'}
                      aria-controls="home-panel-items"
                      disabled={busy}
                      onClick={toggleLayout}
                    >
                      {layout === 'all' ? '收起展示' : '展示全部'}
                      <HomeIcon name={layout === 'all' ? 'back' : 'arrow'} />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      {panel !== 'members' && <footer className="home-footer">
        <span>
          <HomeIcon name="leaf" /> 小小鳄龙，大大快乐
        </span>
      </footer>}
      {ring && animated && (
        <span
          key={ring.id}
          className="home-click-ring"
          style={{ left: ring.x, top: ring.y }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
