import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { GAMES } from './games';
import HomeIcon from './home/HomeIcons';

function GameCover({ file, emoji }: { file: string; emoji: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? (
    <span className="home-game-fallback" aria-hidden="true">
      {emoji}
    </span>
  ) : (
    <img
      src={`${import.meta.env.BASE_URL}hall/${file}`}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** 游戏选择面板：保持首页场景，沿用游戏注册表和现有详情页入口。 */
export default function HallScreen({
  onEnter,
  busy,
}: {
  onEnter: (gameId: string, event: MouseEvent<HTMLButtonElement>) => void;
  busy: boolean;
}) {
  const [scrolling, setScrolling] = useState(false);
  const scrollTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  const showScrollbar = () => {
    setScrolling(true);
    clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => setScrolling(false), 900);
  };
  return (
    <div id="home-panel-items" className="home-games" data-scrolling={scrolling} onScroll={showScrollbar} role="region" aria-label="可玩的游戏" tabIndex={0}>
      {GAMES.filter((game) => game.available).map((game) => {
        const { id, cover, tag } = game;
        return (
          <button
            type="button"
            disabled={busy}
            className={`home-game home-game--${id}`}
            data-game-id={id}
            key={id}
            onClick={(event) => onEnter(id, event)}
          >
            <span className="home-game-cover">
              {cover ? (
                <GameCover file={cover} emoji={game.emoji} />
              ) : (
                <span className="home-game-fallback" aria-hidden="true">
                  {game.emoji}
                </span>
              )}
              <span className="home-game-players">
                {game.minPlayers === game.maxPlayers
                  ? game.minPlayers
                  : `${game.minPlayers}–${game.maxPlayers}`}{' '}
                人
              </span>
            </span>
            <span className="home-game-body">
              <span className="home-game-tag">{tag}</span>
              <span className="home-game-title">{game.name}</span>
              <span className="home-game-description">{game.description}</span>
              <span className="home-game-cta">
                进入游戏 <HomeIcon name="arrow" />
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
