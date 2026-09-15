export default function GameLobbyHeader({
  game,
  room = false,
}: {
  game: 'magician' | 'fight';
  room?: boolean;
}) {
  const magician = game === 'magician';
  return (
    <header className="foyer-lobby-header">
      <div>
        <h1>
          {magician ? '出包魔法师' : '鳄龙咆哮'}
          <span> / {room ? '准备房间' : '联机大厅'}</span>
        </h1>
        {room && <p>准备好后，由房主开始对战。</p>}
      </div>
      <img src={`${import.meta.env.BASE_URL}hall/cover-${game}.webp`} alt="" />
    </header>
  );
}
