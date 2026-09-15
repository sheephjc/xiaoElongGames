interface RulesModalProps {
  onClose: () => void
}

export function RulesModal({ onClose }: RulesModalProps) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="rules-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rules-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" onClick={onClose} aria-label="关闭规则">
          ×
        </button>
        <p className="eyebrow">玩法札记</p>
        <h2 id="rules-title">暗棋规则</h2>
        <ol>
          <li>将帅明置原位，其余三十子混洗后盖在标准开局点位；红方先行。</li>
          <li>暗棋按所在点位原本棋子的规则移动，落定后翻开，从此按真实身份与阵营行动。</li>
          <li>任何棋子都可吃暗棋，即使它暂时属于己方；己方明棋之间仍不可互吃。</li>
          <li>暗士守九宫、暗象不过河；明士可斜走全盘，明象可以过河，象眼规则始终保留。</li>
          <li>保留马腿、炮架、将帅照面、自将保护、将死与困毙。翻牌意外反将自己时落子不撤回，仍正常换手。</li>
          <li>同一完整局面第三次出现自动和棋。</li>
        </ol>
        <button className="primary-button rules-done" type="button" onClick={onClose}>
          明白了
        </button>
      </section>
    </div>
  )
}
