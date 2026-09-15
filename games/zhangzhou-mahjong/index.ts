import type { GameModule } from '../types';

export const zhangzhouMahjongModule: GameModule = {
  id: 'zhangzhou-mahjong',
  name: '漳州麻将',
  emoji: '🀄',
  mode: 'turn-based',
  minPlayers: 1,
  maxPlayers: 4,
  description: '十六张闽南麻将，开金、游金、三金倒。支持单机与 1–4 人联机，空位由 AI 补齐。',
  available: true,
};
