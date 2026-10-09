/**
 * The pack shelf.
 *
 * A pack is a reward that has not happened yet: starter packs arrive with the
 * account, and wins — games, tournaments, finished collections — add more.
 * Tearing one open deals cards straight into the collection, so the shelf is
 * how a manager grows the binder outside of a draft night.
 *
 * Rewards are granted through a per-row reward key with a unique index on it,
 * so the same win can never pay twice even if the game's state is saved again.
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { ACHIEVEMENT_PACKS, REWARDS, packTheme, packThemesForYears } from '@cardball/shared';
import type { AchievementKind, DrawnCard, PackShape, PackSource, PackThemeId, PackView } from '@cardball/shared';
import { seasons, userPacks } from '@cardball/db';
import type { UserPackRow } from '@cardball/db';
import type { GameState } from '@cardball/engine';
import { fileCardIntoCollection } from './cardFiling.js';
import { loadUserCards } from './collection.js';
import type { CollectionCard } from './collection.js';
import type { Ctx, Executor } from './context.js';
import { badRequest, notFound } from './http.js';
import { dealSealedPack } from './packDeal.js';

/** Where the modern packs draw from: everything from the wild-card era on. */
const MODERN_ERA_FROM = 1993;

/**
 * The reward key the one-time starter grant is filed under. Accounts that
 * predate the shelf have no starter packs, so they claim the same three later
 * through this key — and can never be handed a second set.
 */
const STARTER_REWARD_KEY = 'starter';

/** The starter shelf: enough shaped cards to field a legal team on day one. */
const STARTER_PACKS: readonly { themeId: PackThemeId; shape: PackShape; size: number; label: string }[] = [
  { themeId: 'mixed', shape: 'lineup', size: 9, label: 'The starting nine' },
  { themeId: 'aces', shape: 'mound', size: 4, label: 'The pitching staff' },
  { themeId: 'sluggers', shape: 'random', size: 5, label: 'A fistful of sluggers' },
];

/** How a feat reads on the shelf, in the manager's own words. */
const ACHIEVEMENT_LABELS: Record<string, string> = {
  'perfect-game': 'Pitched a perfect game',
  'no-hitter': 'Pitched a no-hitter',
  'grand-slam': 'Hit a grand slam',
  'walkoff-hr': 'Walk-off home run',
  cycle: 'Hit for the cycle',
};

export interface PackGrant {
  themeId: PackThemeId;
  shape?: PackShape;
  size?: number;
  /** the card years the deal draws from */
  era?: { from: number; to: number };
  source: PackSource;
  label?: string | null;
}

/**
 * The newest card year the stats can support: the year after the newest
 * season on file. Packs are dealt up to here, never past what the data knows.
 */
export async function currentCardYear(db: Executor): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${seasons.year})` }).from(seasons);
  return (row?.max ?? new Date().getFullYear() - 1) + 1;
}

/** The era every earned pack is dealt from: the modern game. */
async function modernEra(db: Executor) {
  return { from: MODERN_ERA_FROM, to: await currentCardYear(db) };
}

function pickThemes(era: { from: number; to: number }, count: number): PackThemeId[] {
  const offered = packThemesForYears(era.from, era.to).map((t) => t.id);
  const picks: PackThemeId[] = [];
  for (let i = 0; i < count; i++) {
    // Rotate through the offered themes from a random start, so earned packs
    // vary without ever repeating a wrapper twice in one reward.
    picks.push(offered[(Math.floor(Math.random() * offered.length) + i) % offered.length]!);
  }
  return picks;
}

/**
 * Grant packs to a manager. When a reward key is given the grant is
 * idempotent: a re-run (a game saved twice, a tournament synced again) inserts
 * the same keys, which the unique index turns into a no-op.
 */
export async function grantPacks(db: Executor, userId: number, grants: readonly PackGrant[], rewardKey?: string): Promise<UserPackRow[]> {
  if (grants.length === 0) return [];
  const values = grants.map((grant, i) => ({
    userId,
    themeId: grant.themeId,
    shape: grant.shape ?? 'random',
    size: grant.size ?? 5,
    yearFrom: grant.era?.from ?? MODERN_ERA_FROM,
    yearTo: grant.era?.to ?? 2100,
    source: grant.source,
    label: grant.label ?? null,
    rewardKey: rewardKey === undefined ? null : `${rewardKey}#${i}`,
  }));
  const inserted = await db
    .insert(userPacks)
    .values(values)
    .onConflictDoNothing({ target: [userPacks.userId, userPacks.rewardKey] })
    .returning();
  return inserted;
}

/** How many packs a starter claim hands over. */
export const STARTER_PACK_COUNT = STARTER_PACKS.length;

/**
 * The packs a new account starts with, so the binder is never empty. Keyed to
 * the account, so this can also be called later for an account that never got
 * them without risking a second set.
 */
export async function grantStarterPacks(db: Executor, userId: number): Promise<UserPackRow[]> {
  const era = await modernEra(db);
  return grantPacks(
    db,
    userId,
    STARTER_PACKS.map((pack) => ({ ...pack, source: 'starter' as const, era })),
    STARTER_REWARD_KEY,
  );
}

/** Whether the one-time starter packs are still waiting to be claimed. */
export async function starterPacksClaimable(db: Executor, userId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: userPacks.id })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.source, 'starter')))
    .limit(1);
  return row === undefined;
}

/**
 * Claim the starter packs, once per account. This is the door for managers
 * whose account predates the shelf: the grant is filed under the starter
 * reward key, so a second claim finds the keys taken and hands back nothing.
 */
export async function claimStarterPacks(ctx: Ctx, userId: number): Promise<PackView[]> {
  const granted = await grantStarterPacks(ctx.db, userId);
  if (granted.length === 0) throw badRequest('You have already claimed your starter packs');
  return granted.map(toPackView);
}

/** A pack for winning a game — any mode, once per game. */
export async function rewardGameWin(db: Executor, game: { id: number; mode: string }, engine: GameState): Promise<void> {
  if (engine.phase !== 'finished' || !engine.winner) return;
  const winner = engine[engine.winner];
  if (winner.userId === null) return; // the bot won; nobody earns a pack
  const opponent = engine[engine.winner === 'home' ? 'away' : 'home'];
  const label =
    game.mode === 'bot' ? 'Beat the bot' : game.mode === 'hotseat' ? 'Won a hotseat game' : `Beat the ${opponent.name}`;

  const era = await modernEra(db);
  await grantPacks(
    db,
    winner.userId,
    [{ themeId: pickThemes(era, 1)[0]!, source: 'game-win', label, era, size: 5 }],
    `game:${game.id}`,
  );
}

/**
 * The bonus packs a game's feats earn. The engine records each achievement
 * against the side that pulled it off, so the packs go to that side's manager
 * — a bot side earns nothing, and an achievement in a draft game pays here
 * too, since the draft only replaces the ordinary win reward.
 *
 * One pack per feat, sized by the feat's own table. Repeats of the same feat
 * in one game (two grand slams) are numbered in the reward key, so the second
 * is a second pack rather than a duplicate the unique index swallows.
 */
export async function rewardAchievements(db: Executor, gameId: number, engine: GameState): Promise<void> {
  const feats = engine.achievements ?? [];
  if (feats.length === 0) return;
  const era = await modernEra(db);
  const seen = new Map<string, number>();
  for (const feat of feats) {
    const size = ACHIEVEMENT_PACKS[feat.kind as AchievementKind];
    if (size === undefined) continue; // an unknown kind is not worth paying for
    const userId = engine[feat.side].userId;
    if (userId === null) continue;
    const count = `${feat.side}:${feat.kind}`;
    const index = seen.get(count) ?? 0;
    seen.set(count, index + 1);
    await grantPacks(
      db,
      userId,
      [{ themeId: pickThemes(era, 1)[0]!, source: 'achievement', label: ACHIEVEMENT_LABELS[feat.kind] ?? 'A feat', era, size }],
      `achievement:${gameId}:${feat.kind}:${index}`,
    );
  }
}

/** The champion's packs for winning a tournament. */
export async function rewardTournamentWin(db: Executor, tournament: { id: number; name: string }, userId: number): Promise<void> {
  const era = await modernEra(db);
  const themes = pickThemes(era, REWARDS.perTournamentWin);
  await grantPacks(
    db,
    userId,
    themes.map((themeId) => ({ themeId, source: 'tournament-win' as const, label: `${tournament.name} champions`, era, size: 5 })),
    `tournament:${tournament.id}`,
  );
}

/** The packs for completing a historic collection, dealt from that team's era. */
export async function rewardChallenge(
  db: Executor,
  challenge: { id: string; name: string; year: number },
  userId: number,
): Promise<UserPackRow[]> {
  const top = Math.min(challenge.year + 6, await currentCardYear(db));
  const era = { from: Math.max(1872, challenge.year - 30), to: top };
  const themes = pickThemes(era, REWARDS.perChallenge);
  return grantPacks(
    db,
    userId,
    themes.map((themeId) => ({ themeId, source: 'challenge' as const, label: `${challenge.name} collection`, era, size: 5 })),
    `challenge:${challenge.id}`,
  );
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

export function toPackView(row: UserPackRow): PackView {
  return {
    id: row.id,
    themeId: row.themeId as PackThemeId,
    shape: row.shape,
    size: row.size,
    source: row.source,
    label: row.label,
    rewardKey: row.rewardKey,
    era: { from: row.yearFrom, to: row.yearTo },
    createdAt: row.createdAt.toISOString(),
    openedAt: row.openedAt ? row.openedAt.toISOString() : null,
    drawn: row.drawn ?? null,
  };
}

/** The shelf: sealed packs first, then recently opened ones. */
export async function loadPacks(db: Executor, userId: number): Promise<PackView[]> {
  const rows = await db.select().from(userPacks).where(eq(userPacks.userId, userId)).limit(200);
  return rows
    .map(toPackView)
    .sort((a, b) => (a.openedAt === null ? 0 : 1) - (b.openedAt === null ? 0 : 1) || (b.createdAt).localeCompare(a.createdAt));
}

// ---------------------------------------------------------------------------
// Opening
// ---------------------------------------------------------------------------

export async function openPack(ctx: Ctx, userId: number, packId: number): Promise<{ pack: PackView; cards: CollectionCard[] }> {
  const { pack, drawn } = await ctx.db.transaction(async (tx) => {
    // Claim the pack first: opening sets the timestamp, so a double-click finds
    // the row already open and the transaction can say so instead of dealing twice.
    const claimed = await tx
      .update(userPacks)
      .set({ openedAt: new Date() })
      .where(and(eq(userPacks.id, packId), eq(userPacks.userId, userId), isNull(userPacks.openedAt)))
      .returning();
    if (claimed.length === 0) {
      const [row] = await tx
        .select({ id: userPacks.id })
        .from(userPacks)
        .where(and(eq(userPacks.id, packId), eq(userPacks.userId, userId)))
        .limit(1);
      if (!row) throw notFound('Pack not found');
      throw badRequest('This pack is already open');
    }

    const sealed = claimed[0]!;
    const dealt = await dealSealedPack({ db: tx }, sealed);
    if (dealt.length === 0) throw badRequest('No cards could be dealt for this pack'); // rolls back the claim

    const theme = packTheme(sealed.themeId as PackThemeId);
    const setLabel = theme.id === 'mixed' ? 'Cardball' : theme.name;
    const drawn: DrawnCard[] = [];
    for (const card of dealt) {
      const userCardId = await fileCardIntoCollection(tx, {
        userId,
        personId: card.personId,
        cardYear: card.cardYear,
        setLabel,
        rarity: card.rarity,
        source: 'pack',
      });
      drawn.push({
        userCardId,
        personId: card.personId,
        cardYear: card.cardYear,
        name: card.name,
        teamLabel: card.teamLabel,
        rarity: card.rarity,
        headline: card.headline,
      });
    }

    const [saved] = await tx.update(userPacks).set({ drawn }).where(eq(userPacks.id, packId)).returning();
    return { pack: saved!, drawn };
  });

  return { pack: toPackView(pack), cards: await loadUserCards(ctx, userId, drawn.map((d) => d.userCardId)) };
}
