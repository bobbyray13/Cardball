/**
 * A keyed in-process mutex: one command at a time per room, so a double-clicked
 * pick or start can't take two cards or deal two drafts.
 *
 * The entry is pruned once the tail settles and no newer command has queued
 * behind it, so a long-lived server doesn't accumulate a lock for every room
 * ever used.
 */
export function withKeyLock<T>(locks: Map<number, Promise<unknown>>, key: number, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tail = next.catch(() => undefined);
  locks.set(key, tail);
  void tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return next;
}
