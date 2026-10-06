/**
 * Filing a card into a collection.
 *
 * A card is catalogued once (player + card year + set) and each manager's
 * holding of it is a row in `user_cards`. Adding the same card again — same
 * player, year, set, and photo — bumps the copy count instead of stacking
 * identical rows in the binder. Draft picks go through the same door, so a
 * player drafted twice in one draft lands as one card with two copies.
 *
 * The holding row is claimed under a Postgres advisory lock, so two adds of
 * the same card racing each other (two tabs, two server processes) still land
 * as one row with quantity 2.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { cardModels, userCards } from '@cardball/db';
import type { Executor } from './context.js';

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
}

/** File a card for a manager, returning the `user_cards` row id. */
export async function fileCardIntoCollection(db: Executor, input: FilingInput): Promise<number> {
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
      .values({ userId: input.userId, cardModelId, photoId: input.photoId ?? null, notes: input.notes ?? null })
      .returning({ id: userCards.id });
    return row!.id;
  });
}
