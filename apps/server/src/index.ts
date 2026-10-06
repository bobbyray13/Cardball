import { createDb } from '@cardball/db';
import { buildApp } from './app.js';
import type { Ctx } from './context.js';
import { env } from './env.js';
import { attachRealtime } from './realtime.js';

const { db, sql } = createDb(env.databaseUrl);
const ctx: Ctx = { db, io: null };

const app = await buildApp(ctx);
ctx.io = attachRealtime(app.server, ctx);

await app.listen({ port: env.port, host: env.host });

const shutdown = async () => {
  ctx.io?.close();
  await app.close();
  await sql.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
