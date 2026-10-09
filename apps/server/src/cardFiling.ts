/**
 * Filing a card into a collection.
 *
 * A card is catalogued once (player + card year + set) and each manager's
 * holding of it is a row in `user_cards`. Adding the same card again — same
 * player, year, set, and photo — bumps the copy count instead of stacking
 * identical rows in the binder. Draft picks go through the same door, so a
 * player drafted twice in one draft lands as one card with two copies.
 *
 * A sandbox holding is a separate row from a real one, even for the same
 * catalog card: a drafted card is playable on its draft team but is not in the
 * binder until its manager keeps it. The two are kept apart by the `sandbox`
 * flag in the lookup, so a draft pick can never inflate the count of a card
 * the manager already owns.
 *
 * The holding row is claimed under a Postgres advisory lock, so two adds of
 * the same card racing each other (two tabs, two server processes) still land
 * as one row with quantity 2.
 */

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { cardModels, teamCards, userCards } from '@cardball/db';
import type { Executor } from './context.js';
import { badRequest } from './http.js';

const MAX_QUANTITY = 99;

export interface CardModelInput {
  personId: number;
  cardYear: number;
  setLabel: string;
  rarity?: string | null;
  source: string;
  userId: number;
}

/** Find or create the catalog card for player + year + set. */
export async function ensureCardModel(db: Executor, input: CardModelInput): Promise<number> {
  const [existing] = await db
    .select({ id: cardModels.id })
    .from(cardModels)
    .where(and(eq(cardModels.personId, input.personId), eq(cardModels.cardYear, input.cardYear), eq(cardModels.setLabel, input.setLabel)))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await db
    .insert(cardModels)
    .values({
      personId: input.personId,
      cardYear: input.cardYear,
      setLabel: input.setLabel,
      rarity: input.rarity ?? null,
      source: input.source,
      createdByUserId: input.userId,
    })
    .onConflictDoNothing()
    .returning({ id: cardModels.id });
  if (created) return created.id;
  // Lost a race with a concurrent insert: read it back.
  return ensureCardModel(db, input);
}

export interface FilingInput extends CardModelInput {
  photoId?: number | null;
  notes?: string | null;
  /** true for a drafted card: playable on its draft team, but not in the binder */
  sandbox?: boolean;
}

/** File a card for a manager, returning the `user_cards` row id. */
export async function fileCardIntoCollection(db: Executor, input: FilingInput): Promise<number> {
  const sandbox = input.sandbox === true;
  const cardModelId = await ensureCardModel(db, input);
  return db.transaction(async (tx) => {
    // Serialize everyone filing the same card, so the count is bumped rather
    // than duplicated. Held to the transaction's commit (or the outer pick's).
    await tx.execute(sql`select pg_advisory_xact_lock(${input.userId}, ${cardModelId})`);
    const [held] = await tx
      .select({ id: userCards.id, quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(
          eq(userCards.userId, input.userId),
          eq(userCards.cardModelId, cardModelId),
          eq(userCards.sandbox, sandbox),
          input.photoId ? eq(userCards.photoId, input.photoId) : isNull(userCards.photoId),
        ),
      )
      .limit(1);
    if (held) {
      if (held.quantity < MAX_QUANTITY) {
        await tx
          .update(userCards)
          .set({ quantity: held.quantity + 1 })
          .where(eq(userCards.id, held.id));
      }
      return held.id;
    }
    const [row] = await tx
      .insert(userCards)
      .values({ userId: input.userId, cardModelId, photoId: input.photoId ?? null, notes: input.notes ?? null, sandbox })
      .returning({ id: userCards.id });
    return row!.id;
  });
}

/**
 * Move one sandbox card into the real binder — what a draft winner does with
 * the card they keep. When the manager already owns a real copy of the same
 * card the two merge: the real row's count goes up and the sandbox row goes
 * away. Either way the survivor is the row the keeper's card now is.
 *
 * A kept card is nearly always still on its draft team, so any team link to
 * the sandbox row is re-pointed at the survivor first — otherwise a merge
 * would silently take a card off the team mid-series.
 */
export async function keepSandboxCard(db: Executor, userId: number, userCardId: number): Promise<number> {
  return db.transaction(async (tx) => {
    const [held] = await tx
      .select({ id: userCards.id, cardModelId: userCards.cardModelId, photoId: userCards.photoId })
      .from(userCards)
      .where(and(eq(userCards.id, userCardId), eq(userCards.userId, userId), eq(userCards.sandbox, true)))
      .limit(1);
    if (!held) throw badRequest('That card is not in your draft sandbox');

    await tx.execute(sql`select pg_advisory_xact_lock(${userId}, ${held.cardModelId})`);
    const [real] = await tx
      .select({ id: userCards.id, quantity: userCards.quantity })
      .from(userCards)
      .where(
        and(
          eq(userCards.userId, userId),
          eq(userCards.cardModelId, held.cardModelId),
          eq(userCards.sandbox, false),
          held.photoId ? eq(userCards.photoId, held.photoId) : isNull(userCards.photoId),
        ),
      )
      .limit(1);

    if (!real) {
      await tx.update(userCards).set({ sandbox: false }).where(eq(userCards.id, held.id));
      return held.id;
    }

    const links = await tx.select({ id: teamCards.id, teamId: teamCards.teamId }).from(teamCards).where(eq(teamCards.userCardId, held.id));
    if (links.length > 0) {
      const taken = new Set(
        (await tx.select({ teamId: teamCards.teamId }).from(teamCards).where(eq(teamCards.userCardId, real.id))).map((r) => r.teamId),
      );
      const drop = links.filter((l) => taken.has(l.teamId)).map((l) => l.id);
      if (drop.length) await tx.delete(teamCards).where(inArray(teamCards.id, drop));
      const move = links.filter((l) => !taken.has(l.teamId)).map((l) => l.id);
      if (move.length) await tx.update(teamCards).set({ userCardId: real.id }).where(inArray(teamCards.id, move));
    }

    if (real.quantity < MAX_QUANTITY) {
      await tx.update(userCards).set({ quantity: real.quantity + 1 }).where(eq(userCards.id, real.id));
    }
    await tx.delete(userCards).where(eq(userCards.id, held.id));
    return real.id;
  });
}
