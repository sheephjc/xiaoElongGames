import { useEffect, useState, type CSSProperties } from 'react'
import type { Camp, PieceIdentity, Position } from '../game'
import { positionKey } from '../game'
import { pieceAssetUrl, pieceNames } from '../piecePresentation'
import { HiddenPieceBack } from './HiddenPieceBack'

export interface CaptureRevealState {
  key: number
  pieceId: string
  position: Position
  identity: PieceIdentity
  capturedBy: Camp
  wasRevealed: boolean
}

interface CaptureRevealAnimationProps {
  capture: CaptureRevealState
}

interface FlightGeometry {
  left: number
  top: number
  size: number
  targetLeft: number
  targetTop: number
  targetSize: number
}

export const captureRevealDuration = 1450
export const reducedCaptureRevealDuration = 320

export function CaptureRevealAnimation({ capture }: CaptureRevealAnimationProps) {
  const [geometry, setGeometry] = useState<FlightGeometry>()

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const source = document.querySelector<HTMLElement>(`[data-cell="${positionKey(capture.position)}"]`)
      const destination = document.querySelector<HTMLElement>(`[data-captured-piece="${capture.pieceId}"]`)
      if (!source || !destination) return

      const sourceBox = source.getBoundingClientRect()
      const destinationBox = destination.getBoundingClientRect()
      const size = sourceBox.width * 1.03
      const left = sourceBox.left + sourceBox.width / 2 - size / 2
      const top = sourceBox.top + sourceBox.height / 2 - size / 2
      setGeometry({
        left,
        top,
        size,
        targetLeft: destinationBox.left,
        targetTop: destinationBox.top,
        targetSize: destinationBox.width,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [capture])

  const style = geometry ? ({
    left: geometry.left,
    top: geometry.top,
    width: geometry.size,
    height: geometry.size,
    '--capture-target-left': `${geometry.targetLeft}px`,
    '--capture-target-top': `${geometry.targetTop}px`,
    '--capture-target-size': `${geometry.targetSize}px`,
  } as CSSProperties) : undefined

  return (
    <div
      className={`capture-reveal-flight${geometry ? ' is-ready' : ''}`}
      data-testid="capture-reveal-animation"
      style={style}
      aria-hidden="true"
      key={capture.key}
    >
      <span
        className={`capture-reveal-piece ${
          capture.wasRevealed ? 'is-revealed-capture' : 'is-hidden-capture'
        }`}
      >
        {capture.wasRevealed && (
          <span className="capture-reveal-face capture-reveal-board-front">
            <img src={pieceAssetUrl(capture.identity)} alt="" draggable="false" />
          </span>
        )}
        <span
          className={`capture-reveal-face capture-reveal-front captured-token token-${capture.identity.camp}`}
        >
          {pieceNames[capture.identity.camp][capture.identity.kind]}
          {!capture.wasRevealed && <i>暗</i>}
        </span>
        {!capture.wasRevealed && (
          <HiddenPieceBack className="capture-reveal-face capture-reveal-back" />
        )}
      </span>
    </div>
  )
}
