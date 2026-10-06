/**
 * League settings: the commissioner's house rules.
 *
 * One row in `settings` holds the rules in force. On boot, and after every
 * save, the server publishes them to `activeHouseRules()` so card faces,
 * lineup picks, and drafts all read the same numbers. Games do not read this
 * at play time — they snapshot a copy when they are created.
 */

import { eq } from 'drizzle-orm';
import { defaultHouseRules, parseHouseRules, setActiveHouseRules } from '@cardball/shared';
import type { HouseRules } from '@cardball/shared';
import { settings } from '@cardball/db';
import type { AuthUser } from './auth.js';
import type { Ctx } from './context.js';

/** The saved rules, or the shipped defaults when nothing has been saved yet. */
export async function loadHouseRules(ctx: Ctx): Promise<HouseRules> {
  const [row] = await ctx.db.select({ houseRules: settings.houseRules }).from(settings).where(eq(settings.id, 1)).limit(1);
  if (!row) return defaultHouseRules();
  try {
    return parseHouseRules(row.houseRules);
  } catch {
    // A row written by an older build, or edited by hand. Fall back rather
    // than refusing to boot.
    return defaultHouseRules();
  }
}

/** Read the rules and publish them to every reader in this process. */
export async function refreshHouseRules(ctx: Ctx): Promise<HouseRules> {
  const rules = await loadHouseRules(ctx);
  setActiveHouseRules(rules);
  return rules;
}

/** Save new rules and publish them. Returns the tidied rule set. */
export async function saveHouseRules(ctx: Ctx, user: AuthUser, input: unknown): Promise<HouseRules> {
  const rules = parseHouseRules(input);
  await ctx.db
    .insert(settings)
    .values({ id: 1, houseRules: rules, updatedAt: new Date(), updatedByUserId: user.id })
    .onConflictDoUpdate({
      target: settings.id,
      set: { houseRules: rules, updatedAt: new Date(), updatedByUserId: user.id },
    });
  setActiveHouseRules(rules);
  return rules;
}
