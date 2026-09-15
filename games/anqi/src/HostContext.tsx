import { createContext, useContext } from 'react';
import { normalizeRoomCode, roomSessionStorageKey, type RoomSession } from './online/protocol';

export const AnqiHostContext = createContext<{ nickname?: string; onExit?: () => void }>({});
export const useAnqiHost = () => useContext(AnqiHostContext);

export function readRoomSession(): RoomSession | undefined {
  try {
    const raw = sessionStorage.getItem(roomSessionStorageKey);
    const session = raw ? JSON.parse(raw) : undefined;
    if (
      session &&
      typeof session.roomCode === 'string' &&
      normalizeRoomCode(session.roomCode) &&
      typeof session.playerToken === 'string' &&
      (session.role === 'host' || session.role === 'guest')
    )
      return session;
  } catch {
    /* session storage may be unavailable */
  }
  return undefined;
}
