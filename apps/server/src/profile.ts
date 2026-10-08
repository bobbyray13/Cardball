import { and, count, desc, eq, or } from 'drizzle-orm';
import { games, teamCards, teams, users } from '@cardball/db';
import type { GameMode, PublicGameResult, PublicProfileView, TeamSummary } from '@cardball/shared';
import { loadCollection } from './collection.js';
import type { Ctx } from './context.js';
import type { StoredGame } from './gameService.js';
import { HttpError } from './http.js';

/** Flip the opt-in: only the manager themself opens or closes their binder. */
export async function setPublicProfile(ctx: Ctx, userId: number, publicProfile: boolean): Promise<void> {
  await ctx.db.update(users).set({ publicProfile }).where(eq(users.id, userId));
}

/**
 * A manager's public card: the collection, the teams, and the finished games
 * of whoever has opted in. A closed binder returns just the header, so the
 * page can say so without leaking anything.
 */
export async function publicProfile(ctx: Ctx, username: string): Promise<PublicProfileView> {
  const [row] = await ctx.db
    .select({ id: users.id, displayName: users.displayName, publicProfile: users.publicProfile, createdAt: users.createdAt })
    .from(users)
    .where(eq(users.displayName, username))
    .limit(1);
  if (!row) throw new HttpError(404, 'No manager answers to that name');

  const header = { id: row.id, displayName: row.displayName, joinedAt: row.createdAt.toISOString() };
  if (!row.publicProfile) return { user: header, open: false, collection: null, teams: null, games: null };

  const [collection, teamRows, gameRows] = await Promise.all([
    loadCollection(ctx, row.id),
    ctx.db
      .select({ id: teams.id, name: teams.name, primaryColor: teams.primaryColor, lineup: teams.lineup, size: count(teamCards.id) })
      .from(teams)
      .leftJoin(teamCards, eq(teamCards.teamId, teams.id))
      .where(eq(teams.userId, row.id))
      .groupBy(teams.id)
      .orderBy(teams.name),
    ctx.db
      .select({ id: games.id, mode: games.mode, updatedAt: games.updatedAt, state: games.state, homeUserId: games.homeUserId })
      .from(games)
      .where(and(eq(games.status, 'finished'), or(eq(games.homeUserId, row.id), eq(games.awayUserId, row.id))))
      .orderBy(desc(games.updatedAt))
      .limit(25),
  ]);

  const teamsOut: TeamSummary[] = teamRows.map(({ lineup, ...team }) => ({ ...team, hasLineup: lineup !== null }));
  // A finished game always has an engine state; anything odd is skipped, not shown.
  const gamesOut: PublicGameResult[] = gameRows.flatMap((game) => {
    const engine = (game.state as StoredGame).engine;
    if (!engine) return [];
    const mine: 'home' | 'away' = game.homeUserId === row.id ? 'home' : 'away';
    return [
      {
        id: game.id,
        mode: game.mode as GameMode,
        finishedAt: game.updatedAt.toISOString(),
        home: { name: engine.home.name, score: engine.home.score },
        away: { name: engine.away.name, score: engine.away.score },
        winner: engine.winner,
        won: engine.winner === null ? null : engine.winner === mine,
      },
    ];
  });

  return { user: header, open: true, collection, teams: teamsOut, games: gamesOut };
}
