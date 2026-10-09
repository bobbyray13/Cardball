/**
 * Shared card art.
 *
 * A photo uploaded for one card is the art for every copy of that card in the
 * game: player + card year, whoever holds it and whatever set it was filed
 * under. A 2003 Ichiro photo dresses every 2003 Ichiro; a 2004 Ichiro keeps the
 * stock face until someone shoots one. When several managers have photographed
 * the same card, the newest upload wins.
 */

import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { cardModels, photos, userCards } from '@cardball/db';
import type { Ctx } from './context.js';

export interface CardKey {
  personId: number;
  cardYear: number;
}

export const cardArtKey = (k: CardKey): string => `${k.personId}:${k.cardYear}`;

/** The shared art photo for each player + year that has one, keyed by `cardArtKey`. */
export async function loadCardArt(ctx: Ctx, keys: CardKey[]): Promise<Map<string, number>> {
  const art = new Map<string, number>();
  if (keys.length === 0) return art;
  const wanted = new Set(keys.map(cardArtKey));
  const rows = await ctx.db
    .selectDistinctOn([cardModels.personId, cardModels.cardYear], {
      personId: cardModels.personId,
      cardYear: cardModels.cardYear,
      photoId: photos.id,
    })
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    .innerJoin(photos, eq(photos.id, userCards.photoId))
    .where(
      and(
        isNotNull(userCards.photoId),
        inArray(cardModels.personId, [...new Set(keys.map((k) => k.personId))]),
        inArray(cardModels.cardYear, [...new Set(keys.map((k) => k.cardYear))]),
      ),
    )
    .orderBy(cardModels.personId, cardModels.cardYear, desc(photos.createdAt), desc(photos.id));
  for (const r of rows) {
    const key = cardArtKey(r);
    if (wanted.has(key)) art.set(key, r.photoId);
  }
  return art;
}
