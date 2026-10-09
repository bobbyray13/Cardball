import { and, eq, inArray } from 'drizzle-orm';
import type { CollectionCard } from '@cardball/shared';
import { cardModels, people, userCards } from '@cardball/db';
import type { CardModelRow, PersonRow, UserCardRow } from '@cardball/db';
import { cardArtKey, loadCardArt } from './cardArt.js';
import { buildCard, loadWindowSeasons } from './cards.js';
import type { Ctx } from './context.js';

export type { CollectionCard };

type Row = { user_cards: UserCardRow; card_models: CardModelRow; people: PersonRow };

export async function toCollectionCards(ctx: Ctx, rows: Row[]): Promise<CollectionCard[]> {
  const keys = rows.map((r) => ({ personId: r.people.id, cardYear: r.card_models.cardYear }));
  const [seasonRows, art] = await Promise.all([loadWindowSeasons(ctx, keys), loadCardArt(ctx, keys)]);
  return rows.map((r) => ({
    id: r.user_cards.id,
    cardModelId: r.card_models.id,
    setLabel: r.card_models.setLabel,
    rarity: r.card_models.rarity,
    quantity: r.user_cards.quantity,
    // A manager's own photo of their copy comes first; otherwise the card wears
    // whatever art anyone has uploaded for this player and year.
    photoId: r.user_cards.photoId ?? art.get(cardArtKey({ personId: r.people.id, cardYear: r.card_models.cardYear })) ?? null,
    ownPhotoId: r.user_cards.photoId,
    notes: r.user_cards.notes,
    addedAt: r.user_cards.createdAt.toISOString(),
    card: buildCard(r.people, seasonRows, r.card_models.cardYear),
  }));
}

function baseQuery(ctx: Ctx) {
  return ctx.db
    .select()
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    .innerJoin(people, eq(people.id, cardModels.personId));
}

export async function loadCollection(ctx: Ctx, userId: number): Promise<CollectionCard[]> {
  // The binder proper: sandbox cards (draft picks) stay out of it until their
  // manager keeps them.
  const rows = await baseQuery(ctx)
    .where(and(eq(userCards.userId, userId), eq(userCards.sandbox, false)))
    .orderBy(people.nameLast, cardModels.cardYear);
  return toCollectionCards(ctx, rows);
}

export async function loadUserCards(ctx: Ctx, userId: number, ids: number[]): Promise<CollectionCard[]> {
  if (ids.length === 0) return [];
  const rows = await baseQuery(ctx).where(and(eq(userCards.userId, userId), inArray(userCards.id, ids)));
  return toCollectionCards(ctx, rows);
}
