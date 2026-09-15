import type { Camp, PieceIdentity, PieceKind, Position, RandomSource } from './types'

export interface StartingSlot {
  position: Position
  cover: PieceIdentity
}

const backRank: PieceKind[] = [
  'chariot',
  'horse',
  'elephant',
  'advisor',
  'general',
  'advisor',
  'elephant',
  'horse',
  'chariot',
]

function campSlots(camp: Camp): StartingSlot[] {
  const backY = camp === 'black' ? 0 : 9
  const cannonY = camp === 'black' ? 2 : 7
  const soldierY = camp === 'black' ? 3 : 6
  const slots: StartingSlot[] = backRank.map((kind, x) => ({
    position: { x, y: backY },
    cover: { camp, kind },
  }))

  for (const x of [1, 7]) {
    slots.push({ position: { x, y: cannonY }, cover: { camp, kind: 'cannon' } })
  }
  for (const x of [0, 2, 4, 6, 8]) {
    slots.push({ position: { x, y: soldierY }, cover: { camp, kind: 'soldier' } })
  }
  return slots
}

export const STANDARD_SLOTS: StartingSlot[] = [
  ...campSlots('black'),
  ...campSlots('red'),
]

export const GENERAL_SLOTS = STANDARD_SLOTS.filter(
  (slot) => slot.cover.kind === 'general',
)

export const HIDDEN_SLOTS = STANDARD_SLOTS.filter(
  (slot) => slot.cover.kind !== 'general',
)

export function fisherYates<T>(items: readonly T[], rng: RandomSource): T[] {
  const shuffled = [...items]
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const sample = rng()
    const safeSample = Number.isFinite(sample)
      ? Math.max(0, Math.min(sample, 0.9999999999999999))
      : 0
    const swapIndex = Math.floor(safeSample * (index + 1))
    ;[shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ]
  }
  return shuffled
}

export function secureRandom(): number {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint32Array(1)
    globalThis.crypto.getRandomValues(value)
    return value[0] / 0x1_0000_0000
  }
  return Math.random()
}

export function createSeededRng(seed: number): RandomSource {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let mixed = value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x1_0000_0000
  }
}
