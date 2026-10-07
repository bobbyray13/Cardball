/**
 * Historic team collections.
 *
 * The catalog is static (see @cardball/shared historicTeams.ts): one iconic
 * season per active franchise, lineup pre-built from the record books. A slot
 * is filled when the manager owns any card of that player whose stat window
 * covers the season — a card printed the year after that season, or any of the
 * six years after it. Complete the lineup and the collection pays out packs,
 * claimed once through the same reward keys the shelf uses.
 */

import { and, eq } from 'drizzle-orm';
import { HISTORIC_TEAMS, REWARDS, activeHouseRules, historicTeamById } from '@cardball/shared';
import type { ChallengePlayerView, ChallengeView, PackView } from '@cardball/shared';
import { cardModels, people, userCards, userPacks } from '@cardball/db';
import type { Ctx } from './context.js';
import { badRequest, notFound } from './http.js';
import { rewardChallenge, toPackView } from './packs.js';

/** A card covers a season when the season falls inside the card's stat window. */
function cardCoversSeason(cardYear: number, year: number, windowSeasons: number): boolean {
  return cardYear - windowSeasons <= year && year <= cardYear - 1;
}

interface OwnedCard {
  bbrefId: string;
  cardYear: number;
  userCardId: number;
}

/** Challenge reward keys that already paid out, e.g. `challenge:sea-1995#0`. */
async function claimedChallengeIds(ctx: Ctx, userId: number): Promise<Set<string>> {
  const rows = await ctx.db
    .select({ rewardKey: userPacks.rewardKey })
    .from(userPacks)
    .where(and(eq(userPacks.userId, userId), eq(userPacks.source, 'challenge')));
  const ids = new Set<string>();
  for (const row of rows) {
    const match = /^challenge:(.+)#\d+$/.exec(row.rewardKey ?? '');
    if (match) ids.add(match[1]!);
  }
  return ids;
}

function viewOf(
  team: (typeof HISTORIC_TEAMS)[number],
  owned: OwnedCard[],
  claimed: boolean,
  windowSeasons: number,
): ChallengeView {
  const cardsByBbref = new Map<string, OwnedCard[]>();
  for (const card of owned) {
    const bucket = cardsByBbref.get(card.bbrefId);
    if (bucket === undefined) cardsByBbref.set(card.bbrefId, [card]);
    else bucket.push(card);
  }

  const players: ChallengePlayerView[] = team.players.map((player) => {
    const mine = (cardsByBbref.get(player.bbrefId) ?? []).find((card) => cardCoversSeason(card.cardYear, team.year, windowSeasons));
    return {
      bbrefId: player.bbrefId,
      name: player.name,
      position: player.position,
      have: mine !== undefined,
      cardYear: mine?.cardYear ?? null,
      userCardId: mine?.userCardId ?? null,
    };
  });
  const filled = players.filter((p) => p.have).length;

  return {
    id: team.id,
    year: team.year,
    name: team.name,
    franchise: team.franchise,
    tagline: team.tagline,
    players,
    owned: filled,
    total: players.length,
    complete: filled === players.length,
    rewardClaimed: claimed,
    rewardPacks: REWARDS.perChallenge,
  };
}

/** Every historic team with this manager's progress through its lineup. */
export async function challengeViews(ctx: Ctx, userId: number): Promise<ChallengeView[]> {
  const rules = activeHouseRules();
  const owned: OwnedCard[] = await ctx.db
    .select({ bbrefId: people.bbrefId, cardYear: cardModels.cardYear, userCardId: userCards.id })
    .from(userCards)
    .innerJoin(cardModels, eq(cardModels.id, userCards.cardModelId))
    .innerJoin(people, eq(people.id, cardModels.personId))
    .where(eq(userCards.userId, userId));
  const claimed = await claimedChallengeIds(ctx, userId);

  return HISTORIC_TEAMS.map((team) => viewOf(team, owned, claimed.has(team.id), rules.statWindowSeasons));
}

/**
 * Claim a completed collection's packs. The grant is keyed to the collection,
 * so the check-and-grant is safe even against a double click: the second claim
 * inserts the same reward keys and finds nothing new to hand over.
 */
export async function claimChallenge(ctx: Ctx, userId: number, challengeId: string): Promise<{ challenge: ChallengeView; packs: PackView[] }> {
  const team = historicTeamById(challengeId);
  if (!team) throw notFound('Collection not found');

  const before = (await challengeViews(ctx, userId)).find((c) => c.id === challengeId)!;
  if (!before.complete) {
    const missing = before.total - before.owned;
    throw badRequest(`${missing} more player${missing === 1 ? '' : 's'} to collect before this collection is complete`);
  }

  const granted = await rewardChallenge(ctx.db, team, userId);
  if (granted.length === 0) throw badRequest('You already claimed this collection\u2019s packs');

  const challenge = (await challengeViews(ctx, userId)).find((c) => c.id === challengeId)!;
  return { challenge, packs: granted.map(toPackView) };
}
