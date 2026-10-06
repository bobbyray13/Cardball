import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>;

export function createDb(url: string) {
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

/** The generated drizzle migrations, next to this package. */
export const migrationsFolder = resolve(fileURLToPath(new URL('../drizzle', import.meta.url)));

/** Apply every pending migration. Used by `pnpm db:migrate` and by the tests. */
export async function runMigrations(url: string, folder: string = migrationsFolder): Promise<void> {
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: folder });
  } finally {
    await sql.end();
  }
}

export * from './schema.js';
