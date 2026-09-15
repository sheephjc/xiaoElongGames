import type { Camp, CapturedPiece } from '../game'
import { pieceNames } from '../piecePresentation'

interface CapturedTrayProps {
  camp: Camp
  pieces: CapturedPiece[]
  pendingPieceId?: string
}

export function CapturedTray({ camp, pieces, pendingPieceId }: CapturedTrayProps) {
  const captured = pieces.filter((piece) => piece.capturedBy === camp)
  const title = camp === 'red' ? '红方吃子' : '黑方吃子'
  return (
    <section
      className={`captured-tray captured-${camp} info-card`}
      aria-label={title}
      data-capture-tray={camp}
    >
      <div className="tray-heading">
        <span>{title}</span>
      </div>
      <div className="captured-list">
        {captured.length === 0 ? (
          <span className="captured-empty">尚未取子</span>
        ) : (
          [...captured].reverse().map((piece) => (
            <span
              className={`captured-token token-${piece.identity.camp}${
                piece.pieceId === pendingPieceId ? ' is-pending' : ''
              }`}
              key={`${piece.pieceId}-${piece.capturedBy}`}
              data-captured-piece={piece.pieceId}
              title={`${piece.wasRevealed ? '明棋' : '暗棋'} · ${
                piece.identity.camp === 'red' ? '红' : '黑'
              }${pieceNames[piece.identity.camp][piece.identity.kind]}`}
            >
              {pieceNames[piece.identity.camp][piece.identity.kind]}
              {!piece.wasRevealed && <i>暗</i>}
            </span>
          ))
        )}
      </div>
    </section>
  )
}
