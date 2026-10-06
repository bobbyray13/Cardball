import type { Db } from '@cardball/db';
import type { Server as SocketServer } from 'socket.io';

/** Shared server dependencies, passed explicitly instead of module globals. */
export interface Ctx {
  db: Db['db'];
  io: SocketServer | null;
}

/** Anything that can run queries: the pool itself or a transaction/savepoint. */
export type Executor = Ctx['db'] | Parameters<Parameters<Ctx['db']['transaction']>[0]>[0];
