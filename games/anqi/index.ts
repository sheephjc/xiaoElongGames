import type { GameModule } from '../types';

/** 暗棋保留自己的权威房间服务，通过 /anqi 命名空间接入平台同源端口。 */
export const anqiModule: GameModule = {
  id: 'anqi',
  name: '暗棋',
  emoji: '♟️',
  mode: 'turn-based',
  minPlayers: 2,
  maxPlayers: 2,
  description: '棋背藏兵，落子揭晓身份。在象棋棋盘上双人对弈，支持本地同屏和联机对战。',
  available: true,
};
