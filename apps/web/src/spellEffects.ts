import type { EffectEvent, Magic } from '@tm/rules';

export interface SpellEffect {
  magic: Magic;
  fail: boolean;
  key: number;
  dice?: number;
}

/** Each atomic spell action publishes its result and dice together in the snapshot. */
export function collectSpellEffects(events: EffectEvent[]): SpellEffect[] {
  const effects: SpellEffect[] = [];
  let latest: { effect: SpellEffect; playerId?: string } | undefined;
  for (const event of events) {
    if ((event.type === 'cast' || event.type === 'fail') && event.magic) {
      const effect: SpellEffect = { magic: event.magic, fail: event.type === 'fail', key: event.seq };
      latest = { effect, playerId: event.playerId };
      effects.push(effect);
    } else if (event.type === 'dice' && latest && event.amount != null) {
      const { effect, playerId } = latest;
      if (event.playerId === playerId && event.magic === effect.magic &&
          (effect.magic === 'dragon' || (effect.magic === 'dream' && !effect.fail))) {
        effect.dice = event.amount;
      }
    }
  }
  return effects;
}

export const DICE_DELAY_MS = 600;
export const DICE_VISIBLE_MS = 1300;
