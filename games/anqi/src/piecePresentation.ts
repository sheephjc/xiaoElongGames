import type { Camp, PieceIdentity, PieceKind } from './game';

const assetKinds: Record<PieceKind, string> = {
  general: 'king',
  advisor: 'advisor',
  elephant: 'elephant',
  horse: 'horse',
  chariot: 'chariot',
  cannon: 'cannon',
  soldier: 'pawn',
};

export function pieceAssetUrl(identity: PieceIdentity): string {
  return `${import.meta.env.BASE_URL}anqi/assets/pieces/${identity.camp}_${assetKinds[identity.kind]}.svg`;
}

export const pieceNames: Record<Camp, Record<PieceKind, string>> = {
  red: {
    general: '帥',
    advisor: '仕',
    elephant: '相',
    horse: '馬',
    chariot: '車',
    cannon: '炮',
    soldier: '兵',
  },
  black: {
    general: '將',
    advisor: '士',
    elephant: '象',
    horse: '馬',
    chariot: '車',
    cannon: '砲',
    soldier: '卒',
  },
};
