/**
 * 音效与动画辅助：WebAudio 合成音效（无外部素材，零体积）。
 */
export type SfxName =
  | 'cast'
  | 'fail'
  | 'damage'
  | 'heal'
  | 'dice'
  | 'roundEnd'
  | 'gameOver'
  | 'turn'
  | 'uiConfirm';

let enabled = true;

export function setSoundEnabled(v: boolean): void {
  enabled = v;
}

export function isSoundEnabled(): boolean {
  return enabled;
}

let ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(
  c: AudioContext,
  freq: number,
  start: number,
  dur: number,
  type: OscillatorType = 'sine',
  vol = 0.05,
  slideTo?: number,
): void {
  const t0 = c.currentTime + start;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g);
  g.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

export function playSfx(name: SfxName): void {
  if (!enabled) return;
  const c = ac();
  if (!c) return;
  switch (name) {
    case 'uiConfirm':
      tone(c, 640, 0, 0.075, 'sine', 0.025);
      tone(c, 960, 0.04, 0.12, 'sine', 0.02);
      break;
    case 'cast':
      tone(c, 660, 0, 0.12, 'sine', 0.05);
      tone(c, 990, 0.08, 0.2, 'sine', 0.05);
      break;
    case 'fail':
      tone(c, 220, 0, 0.32, 'sawtooth', 0.04, 110);
      break;
    case 'damage':
      tone(c, 140, 0, 0.22, 'square', 0.05, 70);
      break;
    case 'heal':
      tone(c, 520, 0, 0.15, 'sine', 0.04);
      tone(c, 780, 0.1, 0.22, 'sine', 0.04);
      break;
    case 'dice':
      tone(c, 880, 0, 0.06, 'square', 0.028);
      tone(c, 1100, 0.07, 0.06, 'square', 0.028);
      break;
    case 'turn':
      tone(c, 740, 0, 0.12, 'sine', 0.045);
      break;
    case 'roundEnd':
      tone(c, 523, 0, 0.15, 'triangle', 0.06);
      tone(c, 659, 0.12, 0.15, 'triangle', 0.06);
      tone(c, 784, 0.24, 0.35, 'triangle', 0.06);
      break;
    case 'gameOver':
      [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, i * 0.12, 0.28, 'triangle', 0.06));
      break;
  }
}
