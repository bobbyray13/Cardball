/**
 * Stock bot teams: ready-made opponents for a game against the bot.
 *
 * The catalog is static (see @cardball/shared stockTeams.ts): one iconic
 * team-season per active franchise, with a full game-ready roster. Unlike a
 * manager's team, a stock team owns no database rows — its cards are built on
 * demand from the stats database, at the season after the one being played, and
 * its lineup is derived with the same auto-lineup a manager uses. That keeps
 * the team legal under the current house rules without a hand-written lineup to
 * drift, and it can never be edited as if it belonged to the user.
 */
import { inArray } from 'drizzle-orm';
import { validateTeamSetup } from '@cardball/engine';
import type { PlayerSetup, TeamSetup } from '@cardball/engine';
import { STOCK_TEAMS, activeHouseRules, matchProblem, rateCard, stockTeamById } from '@cardball/shared';
import type { MatchRules, StockTeamSummary } from '@cardball/shared';
import { people } from '@cardball/db';
import { autoLineup } from './autoLineup.js';
import type { RosterCard } from './autoLineup.js';
import { buildCard, loadWindowSeasons } from './cards.js';
import type { CardSnapshot } from './cards.js';
import type { Ctx } from './context.js';
import { badRequest, notFound } from './http.js';

/**
 * A stock team is printed the year after the season it plays, so its card back
 * covers that season — the same rule the historic collections use.
 */
const STOCK_CARD_YEAR_OFFSET = 1;

export interface StockRosterEntry {
  /** the player's bbref id — also the engine player id */
  key: string;
  /** the slot the record books put him in */
  slot: string;
  card: CardSnapshot;
}

export interface LoadedStockTeam {
  id: string;
  name: string;
  year: number;
  entries: StockRosterEntry[];
}

/** Every stock team, as the opponent picker needs it. */
export function listStockTeams(): StockTeamSummary[] {
  return STOCK_TEAMS.map((team) => ({
    id: team.id,
    name: team.name,
    year: team.year,
    tagline: team.tagline,
  }));
}

/** Build one stock team's cards from the stats database. */
export async function loadStockTeam(ctx: Ctx, id: string): Promise<LoadedStockTeam> {
  const team = stockTeamById(id);
  if (!team) throw notFound('Stock team not found');

  const ids = team.players.map((p) => p.bbrefId);
  const rows = await ctx.db.select().from(people).where(inArray(people.bbrefId, ids));
  const byBbref = new Map(rows.map((row) => [row.bbrefId, row]));
  const missing = ids.filter((bbrefId) => !byBbref.has(bbrefId));
  if (missing.length > 0) throw new Error(`${team.name} is missing stats for ${missing.join(', ')}`);

  const cardYear = team.year + STOCK_CARD_YEAR_OFFSET;
  const seasonRows = await loadWindowSeasons(
    ctx,
    rows.map((row) => ({ personId: row.id, cardYear })),
  );
  const entries: StockRosterEntry[] = team.players.map((player) => {
    const person = byBbref.get(player.bbrefId)!;
    return { key: player.bbrefId, slot: player.position, card: buildCard(person, seasonRows, cardYear) };
  });
  return { id: team.id, name: team.name, year: team.year, entries };
}

/** The roster reduced to what the auto-lineup reads. */
export function stockRosterCards(loaded: LoadedStockTeam): RosterCard[] {
  return loaded.entries.map((entry) => ({ id: entry.key, card: entry.card }));
}

/** Refuse a stock roster that breaks the match, in the same words a team gets. */
export function stockTeamMatchProblem(loaded: LoadedStockTeam, match: MatchRules): string | null {
  const cards = loaded.entries.map((entry) => ({ name: entry.card.name, cardYear: entry.card.cardYear, rarity: rateCard(entry.card).rarity }));
  return matchProblem(loaded.name, cards, match);
}

/**
 * A stock team as an engine setup: a bot-managed side with no owning user, its
 * lineup filled by the same auto-lineup a manager's team uses.
 */
export function stockTeamSetup(loaded: LoadedStockTeam): TeamSetup {
  const rules = activeHouseRules();
  const players: PlayerSetup[] = loaded.entries
    .filter((entry) => entry.card.playable)
    .map((entry) => ({
      id: entry.key,
      cardModelId: 0,
      userCardId: null,
      name: entry.card.name,
      cardYear: entry.card.cardYear,
      teamLabel: entry.card.teamLabel,
      rarity: rateCard(entry.card).rarity,
      positions: entry.card.positions,
      seasons: entry.card.seasons,
      fielding: entry.card.fielding,
      pitcherClass: entry.card.pitcherClass,
    }));

  const auto = autoLineup(stockRosterCards(loaded), rules);
  if ('error' in auto) throw new Error(`${loaded.name}: ${auto.error}`);

  // Fail loudly here rather than letting a bad catalog surface mid-game.
  validateTeamSetup(players, auto.lineup, loaded.name, rules);

  return { userId: null, isBot: true, name: loaded.name, players, ...auto.lineup };
}

/** Load, check against the match, and turn into an engine setup. */
export async function stockTeamForGame(ctx: Ctx, id: string, match: MatchRules): Promise<TeamSetup> {
  const loaded = await loadStockTeam(ctx, id);
  const problem = stockTeamMatchProblem(loaded, match);
  if (problem) throw badRequest(problem);
  try {
    return stockTeamSetup(loaded);
  } catch (err) {
    throw badRequest(err instanceof Error ? err.message : String(err));
  }
}
