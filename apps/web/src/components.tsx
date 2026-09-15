import { MAGIC_DEFS, MAX_HP, type Magic } from '@tm/rules';

/** 素材化魔法卡（CSS 渐变 + emoji，无外部图片素材） */
export function MagicCard({
  magic,
  hidden,
  small,
}: {
  magic?: Magic | null;
  hidden?: boolean;
  small?: boolean;
}) {
  if (hidden || !magic) {
    return (
      <div className={`card card-back ${small ? 'small' : ''}`}>
        <span className="card-back-glyph">✦</span>
      </div>
    );
  }
  const def = MAGIC_DEFS[magic];
  return (
    <div
      className={`card card-${def.key} ${small ? 'small' : ''}`}
      title={`${def.name} ×${def.count}：${def.desc}`}
    >
      <span className="card-emoji">{def.emoji}</span>
      <span className="card-name">{def.name}</span>
    </div>
  );
}

export function HpBar({ hp, shaking }: { hp: number; shaking?: boolean }) {
  const pct = (hp / MAX_HP) * 100;
  const cls = hp >= 5 ? 'ok' : hp >= 3 ? 'warn' : 'danger';
  return (
    <div className={`hpbar ${shaking ? 'shaking' : ''}`}>
      <div className={`hpfill ${cls}`} style={{ width: `${pct}%` }} />
      <span className="hptext">
        ❤️ {hp}/{MAX_HP}
      </span>
    </div>
  );
}
