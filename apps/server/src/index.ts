import { createDb } from '@cardball/db';
import { purgeExpiredSessions } from './auth.js';
import { buildApp } from './app.js';
import type { Ctx } from './context.js';
import { env } from './env.js';
import { attachRealtime } from './realtime.js';
import { refreshHouseRules } from './settingsService.js';

const { db, sql } = createDb(env.databaseUrl);
const ctx: Ctx = { db, io: null };

// Publish the commissioner's rules before anyone can deal a card or a pack.
await refreshHouseRules(ctx);

// Session rows are only checked on use, so expired ones would otherwise sit
// in the table forever. Sweep at boot, then daily.
await purgeExpiredSessions(ctx);
const sweep = setInterval(() => void purgeExpiredSessions(ctx).catch((err) => console.error(err)), 24 * 60 * 60_000);
sweep.unref();

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
