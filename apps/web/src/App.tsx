import { lazy, Suspense, useLayoutEffect, useState } from 'react';
import LocalGameScreen from './LocalGameScreen';
import OnlineScreen from './OnlineScreen';
import HomeScreen, { type HomePanel } from './HomeScreen';
import GameDetailScreen from './GameDetailScreen';
import { DEFAULT_SETTINGS, type GameSettings } from './GameSettings';
import { CorcodragonDetailScreen, CorcodragonLocalScreen } from '@tm/game-corcodragon-fire/GameUI';
import type { FightConfig, FightPrefs } from '@tm/game-corcodragon-fight/GameUI';

// 鳄龙咆哮含 Three.js（约 600KB），按需分包加载，避免拖慢大厅首屏
const CorcodragonFightDetailScreen = lazy(() =>
  import('@tm/game-corcodragon-fight/GameUI').then((m) => ({
    default: m.CorcodragonFightDetailScreen,
  })),
);
const CorcodragonFightLocalScreen = lazy(() =>
  import('@tm/game-corcodragon-fight/GameUI').then((m) => ({
    default: m.CorcodragonFightLocalScreen,
  })),
);
const CorcodragonFightOnlineScreen = lazy(() => import('./CorcodragonFightOnlineScreen'));
const AnqiScreen = lazy(() => import('@tm/game-anqi/GameUI'));
const ZhangzhouMahjongScreen = lazy(() => import('./ZhangzhouMahjongScreen'));

const Loading = () => (
  <div className="app-loading" role="status">正在加载游戏……</div>
);

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem('tm-settings');
    if (raw) {
      const s = JSON.parse(raw) as Partial<GameSettings>;
      return {
        fx: s.fx !== false,
        sound: s.sound !== false,
        aiSpeed: typeof s.aiSpeed === 'number' ? s.aiSpeed : DEFAULT_SETTINGS.aiSpeed,
        serverUrl: typeof s.serverUrl === 'string' ? s.serverUrl : '',
        showLog: s.showLog === true,
      };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

/** 鳄龙咆哮专属偏好：与出包魔法师 tm-settings 分离存储 */
function loadFightPrefs(): FightPrefs {
  try {
    const raw = localStorage.getItem('tm-fight-settings');
    if (raw) {
      const s = JSON.parse(raw) as Partial<FightPrefs>;
      return { sound: s.sound !== false, fx: s.fx !== false };
    }
  } catch {
    /* ignore */
  }
  return { sound: true, fx: true };
}

type Screen = 'home' | 'game' | 'local' | 'online';

function loadPlayerName(): string {
  try {
    return localStorage.getItem('tm-player-name')?.slice(0, 8).trim() || '你';
  } catch {
    return '你';
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [playerCount, setPlayerCount] = useState(4);
  const [myName, setMyName] = useState(loadPlayerName);
  const [homePanel, setHomePanel] = useState<HomePanel>('main');
  const [homeLayout, setHomeLayout] = useState<'list' | 'all'>('list');
  const [sessionKey, setSessionKey] = useState(0);
  const [selectedGameId, setSelectedGameId] = useState('trouble-magician');
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [fightConfig, setFightConfig] = useState<FightConfig>({
    mode: 'ffa',
    scoreLimit: 15,
    tickHz: 30,
    respawnMs: 15_000,
    aiStyle: 'combat',
    aiLevel: 'normal',
  });
  const [fightPrefs, setFightPrefs] = useState<FightPrefs>(loadFightPrefs);

  useLayoutEffect(() => {
    document.body.dataset.appTheme =
      screen === 'local' || screen === 'online'
        ? selectedGameId === 'trouble-magician' ? 'magician' : 'game'
        : screen === 'game' && selectedGameId === 'corcodragon-fire' ? 'game' : 'light';
    return () => { delete document.body.dataset.appTheme; };
  }, [screen, selectedGameId]);

  const updateSettings = (patch: Partial<GameSettings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem('tm-settings', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const updateFightPrefs = (patch: Partial<FightPrefs>) => {
    setFightPrefs((s) => {
      const next = { ...s, ...patch };
      try {
        localStorage.setItem('tm-fight-settings', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const updateName = (name: string) => {
    const next = name.slice(0, 8);
    setMyName(next);
    try {
      localStorage.setItem('tm-player-name', next.trim() || '你');
    } catch {
      /* storage may be unavailable */
    }
  };
  const returnToHall = () => {
    setHomePanel('hall');
    setScreen('home');
  };

  if (screen === 'game') {
    if (selectedGameId === 'zhangzhou-mahjong') {
      return <Suspense fallback={<Loading />}><ZhangzhouMahjongScreen nickname={myName} onExit={returnToHall} /></Suspense>;
    }
    if (selectedGameId === 'anqi') {
      return (
        <Suspense fallback={<Loading />}>
          <AnqiScreen nickname={myName} onExit={returnToHall} />
        </Suspense>
      );
    }
    if (selectedGameId === 'corcodragon-fight') {
      return (
        <Suspense fallback={<Loading />}>
          <CorcodragonFightDetailScreen
            coverUrl={`${import.meta.env.BASE_URL}hall/cover-fight.webp`}
            playerCount={playerCount}
            onPlayerCountChange={setPlayerCount}
            prefs={fightPrefs}
            onToggleSound={() => updateFightPrefs({ sound: !fightPrefs.sound })}
            onToggleFx={() => updateFightPrefs({ fx: !fightPrefs.fx })}
            onPlayLocal={(config) => {
              setFightConfig(config);
              setSessionKey((k) => k + 1);
              setScreen('local');
            }}
            onPlayOnline={(config) => {
              setFightConfig(config);
              setSessionKey((k) => k + 1);
              setScreen('online');
            }}
            onlineReady={true}
            onBack={returnToHall}
          />
        </Suspense>
      );
    }
    if (selectedGameId === 'corcodragon-fire') {
      return (
        <CorcodragonDetailScreen
          playerCount={playerCount}
          onPlayerCountChange={setPlayerCount}
          aiSpeed={settings.aiSpeed}
          onAiSpeedChange={(ms) => updateSettings({ aiSpeed: ms })}
          onPlayLocal={() => {
            setSessionKey((k) => k + 1);
            setScreen('local');
          }}
          onBack={returnToHall}
        />
      );
    }
    return (
      <GameDetailScreen
        playerCount={playerCount}
        onPlayerCountChange={setPlayerCount}
        aiSpeed={settings.aiSpeed}
        onAiSpeedChange={(ms) => updateSettings({ aiSpeed: ms })}
        settings={settings}
        onUpdateSettings={updateSettings}
        onPlayLocal={() => {
          setSessionKey((k) => k + 1);
          setScreen('local');
        }}
        onPlayOnline={() => {
          setSessionKey((k) => k + 1);
          setScreen('online');
        }}
        onBack={returnToHall}
      />
    );
  }

  if (screen === 'local') {
    if (selectedGameId === 'corcodragon-fight') {
      return (
        <Suspense fallback={<Loading />}>
          <CorcodragonFightLocalScreen
            key={sessionKey}
            playerCount={playerCount}
            myName={myName}
            config={fightConfig}
            sound={fightPrefs.sound}
            fx={fightPrefs.fx}
            onExit={() => setScreen('game')}
          />
        </Suspense>
      );
    }
    if (selectedGameId === 'corcodragon-fire') {
      return (
        <CorcodragonLocalScreen
          key={sessionKey}
          playerCount={playerCount}
          myName={myName}
          aiSpeed={settings.aiSpeed}
          settings={settings}
          onExit={() => setScreen('game')}
          onRestart={() => setSessionKey((k) => k + 1)}
        />
      );
    }
    return (
      <LocalGameScreen
        key={sessionKey}
        playerCount={playerCount}
        myName={myName}
        settings={settings}
        onExit={() => setScreen('game')}
        onRestart={() => setSessionKey((k) => k + 1)}
        onToggleSound={() => updateSettings({ sound: !settings.sound })}
        onToggleFx={() => updateSettings({ fx: !settings.fx })}
        onToggleLog={() => updateSettings({ showLog: !settings.showLog })}
      />
    );
  }

  if (screen === 'online') {
    if (selectedGameId === 'corcodragon-fight') {
      return (
        <Suspense fallback={<Loading />}>
          <CorcodragonFightOnlineScreen
            key={sessionKey}
            settings={settings}
            prefs={fightPrefs}
            defaultName={myName}
            config={fightConfig}
            onExit={() => setScreen('game')}
            onServerUrlChange={(url) => updateSettings({ serverUrl: url.trim() })}
          />
        </Suspense>
      );
    }
    return (
      <OnlineScreen
        key={sessionKey}
        settings={settings}
        defaultName={myName}
        onExit={() => setScreen('game')}
        onToggleSound={() => updateSettings({ sound: !settings.sound })}
        onToggleFx={() => updateSettings({ fx: !settings.fx })}
        onToggleLog={() => updateSettings({ showLog: !settings.showLog })}
        onServerUrlChange={(url) => updateSettings({ serverUrl: url.trim() })}
      />
    );
  }

  return (
    <HomeScreen
      panel={homePanel}
      layout={homeLayout}
      onLayoutChange={setHomeLayout}
      onPanelChange={(next) => {
        setHomePanel(next);
        setHomeLayout(next === 'members' ? 'all' : 'list');
      }}
      onEnterGame={(gameId) => {
        updateName(myName.trim() || '你');
        setSelectedGameId(gameId);
        setScreen('game');
      }}
      myName={myName}
      onNameChange={updateName}
      settings={settings}
      onUpdateSettings={updateSettings}
    />
  );
}
