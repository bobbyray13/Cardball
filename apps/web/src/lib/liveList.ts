import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

export type LiveListName = 'lobby' | 'drafts' | 'tournaments';

/** Coalesce a burst of server nudges into one list fetch. */
export function debouncedRefresh(refresh: () => void, delay = 180) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(refresh, delay);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Subscribe to one authenticated list room and re-fetch its REST snapshot. */
export function useLiveListUpdates(name: LiveListName, refresh: () => void): void {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    const socket = io({ path: '/socket.io', withCredentials: true });
    const debounce = debouncedRefresh(() => refreshRef.current());
    const event = `${name}:update`;
    socket.on('connect', () => {
      socket.emit('list:join', name);
      // Reconnects may have missed changes while this page was away.
      debounce.schedule();
    });
    socket.on(event, debounce.schedule);
    return () => {
      debounce.cancel();
      socket.emit('list:leave', name);
      socket.close();
    };
  }, [name]);
}
