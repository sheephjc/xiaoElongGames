import type { GameStatus } from './game'

export type BoardEffect = 'battle' | 'check' | 'checkmate' | 'capture'

export const effectDurations: Record<BoardEffect, number> = {
  battle: 1550,
  capture: 1300,
  check: 1550,
  checkmate: 2000,
}

export function resolveBoardEffect(status: GameStatus, didCapture: boolean): BoardEffect | undefined {
  if (status.phase === 'won' && status.reason === 'checkmate') return 'checkmate'
  if (status.checkedCamps.length > 0) return 'check'
  return didCapture ? 'capture' : undefined
}
