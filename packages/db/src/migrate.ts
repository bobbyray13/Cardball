/**
 * Applies pending drizzle migrations (generated via `pnpm db:generate`).
 * Run with `tsx` — see the root `db:migrate` script.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const url = process.env.DATABASE_URL ?? 'postgres://cardball:cardball@localhost:5432/cardball';

const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

const folder = resolve(fileURLToPath(new URL('../drizzle', import.meta.url)));

try {
  await migrate(db, { migrationsFolder: folder });
  console.log('Migrations applied.');
} finally {
  await sql.end();
}
