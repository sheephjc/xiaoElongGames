const KEY = 'tm-mahjong-room';
let fallback = null;
export function saveSession(value) { fallback = value; try { sessionStorage.setItem(KEY, JSON.stringify(value)); } catch { /* optional storage */ } }
export function loadSession() { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null') || fallback; } catch { return fallback; } }
export function clearSession() { fallback = null; try { sessionStorage.removeItem(KEY); } catch { /* optional storage */ } }
