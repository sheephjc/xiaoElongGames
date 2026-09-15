import { useState } from 'react';

function BackArrow() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m10 5-7 7 7 7M3 12h18" /></svg>;
}

export default function ZhangzhouMahjongScreen({ nickname, onExit }: { nickname: string; onExit: () => void }) {
  const [mode, setMode] = useState<'local' | 'online' | null>(null);
  if (mode) return (
    <div className="mahjong-host">
      <button type="button" className="mahjong-host-back" aria-label="返回游戏菜单" title="返回游戏菜单" onClick={() => setMode(null)}><BackArrow /></button>
      <iframe
        title={`漳州麻将${mode === 'local' ? '单机' : '联机'}`}
        src={`${import.meta.env.BASE_URL}mahjong/${mode === 'local' ? 'singleplayer/index.html' : `index.html?nickname=${encodeURIComponent(nickname.trim() || '你')}`}`}
        className="mahjong-host-frame"
        onLoad={event => {
          event.currentTarget.contentDocument?.body.classList.add('mahjong-embedded');
        }}
      />
    </div>
  );
  return (
    <main className="page game-foyer game-foyer--fight mahjong-foyer">
      <section className="panel detail-panel">
        <button type="button" className="mahjong-menu-back foyer-back" onClick={onExit}><BackArrow /><span>返回游戏大厅</span></button>
        <div className="foyer-hero">
          <div className="foyer-intro"><div className="detail-title detail-head"><h1>漳州麻将</h1></div>
            <p className="detail-desc">十六张闽南麻将，支持开金、游金和三金倒，可选择单机或联机对局。</p>
            <p className="detail-meta">1–4 人 · AI 补位 · 十六张闽南麻将</p>
          </div>
          <div className="foyer-art"><img src={`${import.meta.env.BASE_URL}hall/cover-zhangzhou-mahjong.png`} alt="漳州麻将闽南庭院概念插画" onError={e => { e.currentTarget.hidden = true; }} /></div>
        </div>
        <div className="detail-modes">
          <section className="section detail-mode foyer-local"><h2>单机练习</h2><p className="muted">与三位 AI 对局，熟悉开金、游金和三金倒。</p><button type="button" className="mahjong-mode-button" onClick={() => setMode('local')}>开始单机<span aria-hidden="true">→</span></button></section>
          <section className="section detail-mode foyer-online"><h2>朋友联机</h2><p className="muted">分享六位房间码邀请朋友，空位由 AI 补齐。</p><button type="button" className="mahjong-mode-button mahjong-mode-button--soft" onClick={() => setMode('online')}>进入联机大厅<span aria-hidden="true">→</span></button></section>
        </div>
      </section>
    </main>
  );
}
