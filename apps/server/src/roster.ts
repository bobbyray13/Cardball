import { and, eq } from 'drizzle-orm';
import { validateTeamSetup } from '@cardball/engine';
import type { PlayerSetup, TeamSetup } from '@cardball/engine';
import { teamCards, teams } from '@cardball/db';
import type { SavedLineup, TeamRow } from '@cardball/db';
import { autoLineup } from './autoLineup.js';
import type { RosterCard } from './autoLineup.js';
import { loadUserCards } from './collection.js';
import type { CollectionCard } from './collection.js';
import type { Ctx } from './context.js';
import { notFound } from './http.js';

export interface RosterEntry {
  /** team_cards.id */
  teamCardId: number;
  entry: CollectionCard;
}

export interface LoadedTeam {
  team: TeamRow;
  roster: RosterEntry[];
}

export async function loadTeam(ctx: Ctx, teamId: number, ownerId?: number): Promise<LoadedTeam> {
  const where = ownerId === undefined ? eq(teams.id, teamId) : and(eq(teams.id, teamId), eq(teams.userId, ownerId));
  const [team] = await ctx.db.select().from(teams).where(where).limit(1);
  if (!team) throw notFound('Team not found');
  const links = await ctx.db.select().from(teamCards).where(eq(teamCards.teamId, team.id));
  const cards = await loadUserCards(ctx, team.userId, links.map((l) => l.userCardId));
  const byId = new Map(cards.map((c) => [c.id, c]));
  const roster = links
    .map((l) => ({ teamCardId: l.id, entry: byId.get(l.userCardId) }))
    .filter((r): r is RosterEntry => r.entry !== undefined);
  return { team, roster };
}

export function rosterCards(roster: RosterEntry[]): RosterCard[] {
  return roster.map((r) => ({ id: String(r.teamCardId), card: r.entry.card }));
}

export function toPlayerSetup(r: RosterEntry, idPrefix: string): PlayerSetup {
  const c = r.entry.card;
  return {
    id: `${idPrefix}${r.teamCardId}`,
    cardModelId: r.entry.cardModelId,
    userCardId: r.entry.id,
    name: c.name,
    cardYear: c.cardYear,
    teamLabel: c.teamLabel,
    rarity: r.entry.rarity,
    positions: c.positions,
    seasons: c.seasons,
    fielding: c.fielding,
    pitcherClass: c.pitcherClass,
  };
}

/** Engine player id prefix → photo ids, so the UI can show real card photos in games. */
export function photoMap(roster: RosterEntry[], idPrefix: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const r of roster) if (r.entry.photoId) map[`${idPrefix}${r.teamCardId}`] = r.entry.photoId;
  return map;
}

function prefixLineup(lineup: SavedLineup, prefix: string): Pick<TeamSetup, 'lineup' | 'fieldPositions' | 'startingPitcherId'> {
  return {
    lineup: lineup.lineup.map((id) => `${prefix}${id}`),
    fieldPositions: Object.fromEntries(Object.entries(lineup.fieldPositions).map(([pos, id]) => [pos, `${prefix}${id}`])),
    startingPitcherId: `${prefix}${lineup.startingPitcherId}`,
  };
}

/** Validate a saved lineup against the roster; returns the problem or null. */
export function lineupProblem(loaded: LoadedTeam, lineup: SavedLineup | null): string | null {
  if (!lineup) return 'No lineup set';
  const players = loaded.roster.filter((r) => r.entry.card.playable).map((r) => toPlayerSetup(r, ''));
  try {
    validateTeamSetup(players, prefixLineup(lineup, ''), loaded.team.name);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Engine team setup for a game. Uses the saved lineup when it's legal,
 * otherwise an automatic one. Throws a readable error if neither works.
 */
export function teamSetupFor(loaded: LoadedTeam, idPrefix: string, opts: { userId: number | null; isBot: boolean }): TeamSetup {
  let lineup = loaded.team.lineup;
  if (lineupProblem(loaded, lineup)) {
    const auto = autoLineup(rosterCards(loaded.roster));
    if ('error' in auto) throw new Error(`${loaded.team.name}: ${auto.error}`);
    lineup = auto.lineup;
  }
  return {
    userId: opts.userId,
    isBot: opts.isBot,
    name: loaded.team.name,
    players: loaded.roster.filter((r) => r.entry.card.playable).map((r) => toPlayerSetup(r, idPrefix)),
    ...prefixLineup(lineup!, idPrefix),
  };
}
