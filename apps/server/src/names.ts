import { inArray } from 'drizzle-orm';
import { users } from '@cardball/db';
import type { Ctx } from './context.js';

/**
 * Display names for exactly the ids asked about. Lists and views only ever
 * need a handful of names, so they must not load the whole league to get them.
 */
export async function namesFor(ctx: Ctx, ids: Iterable<number | null>): Promise<Map<number, string>> {
  const wanted = [...new Set([...ids].filter((id): id is number => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = await ctx.db
    .select({ id: users.id, name: users.displayName })
    .from(users)
    .where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.name]));
}
