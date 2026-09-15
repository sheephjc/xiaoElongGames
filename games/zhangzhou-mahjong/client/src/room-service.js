import { request, watchRoom, currentVersion } from './server-client.js';

export const createRoom = nickname => request('room:create', { nickname });
export const joinRoom = (roomCode, nickname) => request('room:join', { roomCode, nickname });
export const subscribeRoom = (roomCode, callback) => watchRoom(roomCode, callback);
export const getRoomSnapshot = roomCode => request('room:get', { roomCode });
export const switchSeat = (roomCode, _uid, _nickname, seatId) => request('room:seat', { roomCode, seatId });
export const startRoomGame = roomCode => request('room:start', { roomCode });
export const submitActionIntent = (roomCode, _uid, action) => request('game:action', { roomCode, action, expectedVersion: currentVersion() });
export const leaveRoom = roomCode => request('room:leave', { roomCode });
export const setSeatControlMode = (roomCode, _uid, seatId, control) => request('room:control', { roomCode, seatId, control });
export async function attachPresence(roomCode) {
  await request('room:presence', { roomCode });
  // Presence belongs to the socket; navigating between lobby and table must not leave the room.
  return () => {};
}
export const rebindPresence = roomCode => request('room:presence', { roomCode });
// Host election is performed by the server on membership and connection changes.
export const tryElectHost = async () => false;
