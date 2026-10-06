/**
 * Applies pending drizzle migrations (generated via `pnpm db:generate`).
 * Run with `tsx` — see the root `db:migrate` script.
 */
import { runMigrations } from './index.js';

const url = process.env.DATABASE_URL ?? 'postgres://cardball:cardball@localhost:5433/cardball';

await runMigrations(url);
console.log('Migrations applied.');
