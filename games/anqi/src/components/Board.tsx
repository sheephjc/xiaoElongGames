import type { CSSProperties } from 'react'
import type { BoardEffect } from '../effectPresentation'
import type { Position, PublicGameState, PublicPieceState } from '../game'
import { positionKey, samePosition } from '../game'
import { pieceAssetUrl, pieceNames } from '../piecePresentation'
import { HiddenPieceBack } from './HiddenPieceBack'

interface BoardProps {
  game: PublicGameState
  selected?: Position
  legalMoves: Position[]
  effect?: BoardEffect
  warning?: string
  showMoveHints?: boolean
  perspective?: 'red' | 'black'
  onCellClick: (position: Position) => void
  onPieceDoubleClick?: (position: Position) => void
}

function pieceAsset(piece: PublicPieceState): string | undefined {
  if (!piece.identity) return undefined
  return pieceAssetUrl(piece.identity)
}

function pieceLabel(piece: PublicPieceState): string {
  if (!piece.identity) return `暗棋，${piece.position.x + 1}路第${piece.position.y + 1}行`
  const camp = piece.identity.camp === 'red' ? '红方' : '黑方'
  return `${camp}${pieceNames[piece.identity.camp][piece.identity.kind]}`
}

function pointStyle(position: Position, perspective: 'red' | 'black'): CSSProperties {
  const displayPosition = perspective === 'black'
    ? { x: 8 - position.x, y: 9 - position.y }
    : position
  return {
    left: `${((displayPosition.x + 0.55) / 9.1) * 100}%`,
    top: `${((displayPosition.y + 0.55) / 10.1) * 100}%`,
  }
}

function BoardArtwork({ perspective }: { perspective: 'red' | 'black' }) {
  const horizontal = Array.from({ length: 10 }, (_, y) => (
    <line key={`h-${y}`} x1="0" y1={y} x2="8" y2={y} />
  ))
  const vertical = Array.from({ length: 9 }, (_, x) =>
    x === 0 || x === 8 ? (
      <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="9" />
    ) : (
      <g key={`v-${x}`}>
        <line x1={x} y1="0" x2={x} y2="4" />
        <line x1={x} y1="5" x2={x} y2="9" />
      </g>
    ),
  )

  return (
    <svg className="board-art" viewBox="-0.55 -0.55 9.1 10.1" aria-hidden="true">
      <defs>
        <filter id="ink-soften" x="-10%" y="-10%" width="120%" height="120%">
          <feGaussianBlur stdDeviation="0.012" />
        </filter>
        <filter id="ink-splash-distort" x="-20%" y="-20%" width="140%" height="140%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035 0.055"
            numOctaves="2"
            seed="17"
            result="ink-noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="ink-noise"
            scale="13"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <rect className="board-frame-line" x="-0.38" y="-0.38" width="8.76" height="9.76" rx="0.08" />
      <g className="board-grid" filter="url(#ink-soften)">
        {horizontal}
        {vertical}
        <path d="M3 0 L5 2 M5 0 L3 2 M3 7 L5 9 M5 7 L3 9" />
      </g>
      <g className="river-label">
        <text x="1.85" y="4.68">{perspective === 'black' ? '漢 界' : '楚 河'}</text>
        <text x="6.15" y="4.68">{perspective === 'black' ? '楚 河' : '漢 界'}</text>
      </g>
    </svg>
  )
}

export function Board({
  game,
  selected,
  legalMoves,
  effect,
  warning,
  showMoveHints = true,
  perspective = 'red',
  onCellClick,
  onPieceDoubleClick,
}: BoardProps) {
  const legalKeys = new Set(legalMoves.map(positionKey))
  const occupiedKeys = new Set(game.pieces.map((piece) => positionKey(piece.position)))
  const cells = Array.from({ length: 90 }, (_, index) => ({
    x: index % 9,
    y: Math.floor(index / 9),
  }))

  return (
    <div className="board-shell">
      <div className="board-stage" data-testid="xiangqi-board">
        <BoardArtwork perspective={perspective} />

        {cells.map((position) => {
          const key = positionKey(position)
          const isLegal = legalKeys.has(key)
          const isCapture = isLegal && occupiedKeys.has(key)
          const wasFrom = game.lastMove && samePosition(game.lastMove.from, position)
          const wasTo = game.lastMove && samePosition(game.lastMove.to, position)
          return (
            <button
              className={`board-point${showMoveHints && isLegal ? ' is-legal' : ''}${
                showMoveHints && isCapture ? ' is-capture' : ''
              }`}
              data-cell={key}
              key={key}
              style={pointStyle(position, perspective)}
              type="button"
              aria-label={`${position.x + 1}路第${position.y + 1}行${isLegal ? '，可落子' : ''}`}
              onClick={() => onCellClick(position)}
            >
              {showMoveHints && !isCapture && wasFrom && <span className="last-move-marker from" />}
              {showMoveHints && !isCapture && wasTo && <span className="last-move-marker to" />}
              {showMoveHints && isLegal && (
                <span className={isCapture ? 'move-hint capture' : 'move-hint'} />
              )}
            </button>
          )
        })}

        {game.pieces.map((piece) => {
          const isSelected = selected && samePosition(selected, piece.position)
          const wasLastMoved = game.lastMove?.pieceId === piece.id
          const identity = piece.identity
          return (
            <button
              type="button"
              key={piece.id}
              className={`piece ${piece.revealed ? 'is-revealed' : 'is-hidden'} ${
                identity ? `is-${identity.camp}` : ''
              } ${isSelected ? 'is-selected' : ''}${wasLastMoved ? ' is-last-moved' : ''}`}
              style={pointStyle(piece.position, perspective)}
              aria-label={pieceLabel(piece)}
              data-piece-id={piece.id}
              data-revealed={piece.revealed ? 'true' : 'false'}
              data-last-moved={wasLastMoved ? 'true' : undefined}
              onClick={() => onCellClick(piece.position)}
              onDoubleClick={() => onPieceDoubleClick?.(piece.position)}
            >
              <span className="piece-inner" aria-hidden="true">
                <span className="piece-face piece-front">
                  {identity && (
                    <img src={pieceAsset(piece)} alt="" draggable="false" />
                  )}
                </span>
                <HiddenPieceBack className="piece-face piece-back" />
              </span>
              {wasLastMoved && <span className="piece-last-move-marker" aria-hidden="true" />}
            </button>
          )
        })}

        {effect && (
          <div
            className={`board-effect board-effect-${effect}`}
            role="status"
            aria-live="assertive"
            key={`${effect}-${game.moveNumber}`}
          >
            <span>{
              effect === 'battle'
                ? '开战'
                : effect === 'checkmate'
                  ? '绝杀'
                  : effect === 'capture'
                    ? '吃'
                    : '将'
            }</span>
          </div>
        )}

        {warning && (
          <div className="move-warning" role="alert">
            {warning}
          </div>
        )}
      </div>
    </div>
  )
}
