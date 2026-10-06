import type { Db } from '@cardball/db';
import type { Server as SocketServer } from 'socket.io';

/** Shared server dependencies, passed explicitly instead of module globals. */
export interface Ctx {
  db: Db['db'];
  io: SocketServer | null;
}
