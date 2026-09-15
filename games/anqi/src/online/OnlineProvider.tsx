/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { readRoomSession } from '../HostContext';
import { io, type Socket } from 'socket.io-client';
import type { MoveCommand } from '../game';
import {
  roomSessionStorageKey,
  type Ack,
  type ClientToServerEvents,
  type EnterRoomResult,
  type GameUpdate,
  type RoomSession,
  type RoomSnapshot,
  type ServerToClientEvents,
} from './protocol';

type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

interface OnlineContextValue {
  connected: boolean;
  connectionEpoch: number;
  session?: RoomSession;
  snapshot?: RoomSnapshot;
  lastUpdate?: GameUpdate;
  message?: string;
  createRoom: (nickname: string) => Promise<EnterRoomResult | undefined>;
  joinRoom: (nickname: string, roomCode: string) => Promise<EnterRoomResult | undefined>;
  resumeRoom: () => Promise<boolean>;
  submitMove: (command: MoveCommand) => Promise<Ack<{ accepted: true }>>;
  startNextRound: () => Promise<Ack<{ accepted: true }>>;
  clearMessage: () => void;
  clearSession: () => void;
}

const OnlineContext = createContext<OnlineContextValue | undefined>(undefined);

function readSession(): RoomSession | undefined {
  return readRoomSession();
}

function requestWithTimeout<T>(
  send: (acknowledge: (response: Ack<T>) => void) => void,
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      resolve({ ok: false, error: { code: 'server-error', message: '连接超时，请稍后重试' } });
    }, 6000);
    send((response) => {
      window.clearTimeout(timer);
      resolve(response);
    });
  });
}

export function OnlineProvider() {
  const socket = useMemo<OnlineSocket>(() => io('/anqi', { autoConnect: false }), []);
  const [connected, setConnected] = useState(false);
  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const [session, setSession] = useState<RoomSession | undefined>(readSession);
  const [snapshot, setSnapshot] = useState<RoomSnapshot>();
  const [lastUpdate, setLastUpdate] = useState<GameUpdate>();
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      setConnectionEpoch((value) => value + 1);
    };
    const onDisconnect = () => setConnected(false);
    const onSnapshot = (next: RoomSnapshot) => {
      setSnapshot((current) => (!current || next.version >= current.version ? next : current));
    };
    const onUpdate = (update: GameUpdate) => {
      setSnapshot((current) =>
        !current || update.version >= current.version ? update.snapshot : current,
      );
      setLastUpdate(update);
    };
    const onClosed = ({ message: closedMessage }: { message: string }) => {
      try {
        sessionStorage.removeItem(roomSessionStorageKey);
      } catch {
        /* optional storage */
      }
      setSession(undefined);
      setSnapshot(undefined);
      setLastUpdate(undefined);
      setMessage(closedMessage);
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:snapshot', onSnapshot);
    socket.on('game:update', onUpdate);
    socket.on('room:closed', onClosed);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:snapshot', onSnapshot);
      socket.off('game:update', onUpdate);
      socket.off('room:closed', onClosed);
      socket.disconnect();
    };
  }, [socket]);

  const commitEntry = useCallback((result: EnterRoomResult) => {
    try {
      sessionStorage.setItem(roomSessionStorageKey, JSON.stringify(result.session));
    } catch {
      /* optional storage */
    }
    setSession(result.session);
    setSnapshot(result.snapshot);
    setLastUpdate(undefined);
    setMessage(undefined);
    return result;
  }, []);

  const createRoom = useCallback(
    async (nickname: string) => {
      if (!socket.connected) {
        setMessage('尚未连接到服务器');
        return undefined;
      }
      const response = await requestWithTimeout<EnterRoomResult>((acknowledge) => {
        socket.emit('room:create', { nickname }, acknowledge);
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return undefined;
      }
      return commitEntry(response.data);
    },
    [commitEntry, socket],
  );

  const joinRoom = useCallback(
    async (nickname: string, roomCode: string) => {
      if (!socket.connected) {
        setMessage('尚未连接到服务器');
        return undefined;
      }
      const response = await requestWithTimeout<EnterRoomResult>((acknowledge) => {
        socket.emit('room:join', { nickname, roomCode }, acknowledge);
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return undefined;
      }
      return commitEntry(response.data);
    },
    [commitEntry, socket],
  );

  const resumeRoom = useCallback(async () => {
    if (!socket.connected || !session) return false;
    const response = await requestWithTimeout<EnterRoomResult>((acknowledge) => {
      socket.emit(
        'room:resume',
        {
          roomCode: session.roomCode,
          playerToken: session.playerToken,
        },
        acknowledge,
      );
    });
    if (!response.ok) {
      try {
        sessionStorage.removeItem(roomSessionStorageKey);
      } catch {
        /* optional storage */
      }
      setSession(undefined);
      setSnapshot(undefined);
      setMessage(response.error.message);
      return false;
    }
    commitEntry(response.data);
    return true;
  }, [commitEntry, session, socket]);

  const submitMove = useCallback(
    (command: MoveCommand) => {
      if (!socket.connected) {
        return Promise.resolve<Ack<{ accepted: true }>>({
          ok: false,
          error: { code: 'server-error', message: '连接中断，正在尝试重连' },
        });
      }
      return requestWithTimeout<{ accepted: true }>((acknowledge) => {
        socket.emit('game:move', command, acknowledge);
      });
    },
    [socket],
  );

  const startNextRound = useCallback(() => {
    if (!socket.connected) {
      return Promise.resolve<Ack<{ accepted: true }>>({
        ok: false,
        error: { code: 'server-error', message: '连接中断，正在尝试重连' },
      });
    }
    return requestWithTimeout<{ accepted: true }>((acknowledge) => {
      socket.emit('game:new-round', acknowledge);
    });
  }, [socket]);

  const clearSession = useCallback(() => {
    try {
      sessionStorage.removeItem(roomSessionStorageKey);
    } catch {
      /* optional storage */
    }
    setSession(undefined);
    setSnapshot(undefined);
    setLastUpdate(undefined);
  }, []);

  const value: OnlineContextValue = {
    connected,
    connectionEpoch,
    session,
    snapshot,
    lastUpdate,
    message,
    createRoom,
    joinRoom,
    resumeRoom,
    submitMove,
    startNextRound,
    clearMessage: () => setMessage(undefined),
    clearSession,
  };

  return (
    <OnlineContext.Provider value={value}>
      <Outlet />
    </OnlineContext.Provider>
  );
}

export function useOnline(): OnlineContextValue {
  const context = useContext(OnlineContext);
  if (!context) throw new Error('useOnline 必须在 OnlineProvider 内使用');
  return context;
}
