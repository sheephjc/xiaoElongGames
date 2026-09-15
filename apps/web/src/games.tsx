/**
 * 平台侧游戏注册表：把 games/* 的游戏模块与平台 UI 绑定。
 * 新游戏接入：在下方 import 其模块并加入 GAMES；UI 绑定在 App 路由中按 gameId 分发。
 */
import { troubleMagicianModule } from '@tm/game-trouble-magician';
import { corcodragonFireModule } from '@tm/game-corcodragon-fire';
import { corcodragonFightModule } from '@tm/game-corcodragon-fight';
import type { GameModule } from '../../../games/types';
import { anqiModule } from '@tm/game-anqi';
import { zhangzhouMahjongModule } from '@tm/game-zhangzhou-mahjong';

export type HallGame = GameModule & { cover?: string; tag?: string };

export const GAMES: HallGame[] = [
  { ...troubleMagicianModule, cover: 'cover-magician.webp', tag: '魔法 · 推理' },
  { ...corcodragonFightModule, cover: 'cover-fight.webp', tag: '英雄 · 射击' },
  { ...anqiModule, cover: 'cover-anqi.png', tag: '揭棋 · 对弈' },
  { ...zhangzhouMahjongModule, cover: 'cover-zhangzhou-mahjong.png', tag: '开金 · 游金' },
  corcodragonFireModule,
];

export function getGame(id: string): GameModule | undefined {
  return GAMES.find((g) => g.id === id);
}
