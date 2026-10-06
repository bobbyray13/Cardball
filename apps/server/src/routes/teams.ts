import { and, count, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { positionSchema } from '@cardball/shared';
import type { SavedLineup, TeamView } from '@cardball/shared';
import { teamCards, teams, userCards } from '@cardball/db';
import { requireUser } from '../auth.js';
import { autoLineup } from '../autoLineup.js';
import type { Ctx } from '../context.js';
import { env } from '../env.js';
import { badRequest, idParam, parse } from '../http.js';
import { lineupProblem, loadTeam, playsOutOfPosition, rosterCards } from '../roster.js';
import type { LoadedTeam } from '../roster.js';

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color must look like #1a2b3c');

const lineupSchema = z.object({
  lineup: z.array(z.string()).length(9),
  fieldPositions: z.record(positionSchema, z.string()),
  startingPitcherId: z.string(),
});

const createSchema = z.object({ name: z.string().trim().min(2).max(40), primaryColor: colorSchema.nullish() });
const updateSchema = z.object({
  name: z.string().trim().min(2).max(40).optional(),
  primaryColor: colorSchema.nullable().optional(),
  lineup: lineupSchema.nullable().optional(),
});

function teamView(loaded: LoadedTeam): TeamView {
  return {
    id: loaded.team.id,
    name: loaded.team.name,
    primaryColor: loaded.team.primaryColor,
    lineup: loaded.team.lineup,
    lineupProblem: lineupProblem(loaded, loaded.team.lineup),
    outOfPosition: playsOutOfPosition(loaded),
    roster: loaded.roster.map((r) => ({ teamCardId: r.teamCardId, ...r.entry })),
  };
}

export function teamRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/teams', async (request) => {
    const user = requireUser(request);
    const rows = await ctx.db
      .select({ id: teams.id, name: teams.name, primaryColor: teams.primaryColor, lineup: teams.lineup, size: count(teamCards.id) })
      .from(teams)
      .leftJoin(teamCards, eq(teamCards.teamId, teams.id))
      .where(eq(teams.userId, user.id))
      .groupBy(teams.id)
      .orderBy(teams.name);
    return { teams: rows.map(({ lineup, ...t }) => ({ ...t, hasLineup: lineup !== null })) };
  });

  app.post('/api/teams', async (request) => {
    const user = requireUser(request);
    const body = parse(createSchema, request.body);
    const [team] = await ctx.db
      .insert(teams)
      .values({ userId: user.id, name: body.name, primaryColor: body.primaryColor ?? null })
      .returning({ id: teams.id });
    return { team: teamView(await loadTeam(ctx, team!.id, user.id)) };
  });

  app.get('/api/teams/:id', async (request) => {
    const user = requireUser(request);
    return { team: teamView(await loadTeam(ctx, idParam(request.params), user.id)) };
  });

  app.patch('/api/teams/:id', async (request) => {
    const user = requireUser(request);
    const id = idParam(request.params);
    const body = parse(updateSchema, request.body);
    const loaded = await loadTeam(ctx, id, user.id);
    if (body.lineup) {
      const problem = lineupProblem(loaded, body.lineup as SavedLineup);
      if (problem) throw badRequest(problem);
    }
    await ctx.db
      .update(teams)
      .set({
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.primaryColor !== undefined ? { primaryColor: body.primaryColor } : {}),
        ...(body.lineup !== undefined ? { lineup: body.lineup as SavedLineup | null } : {}),
      })
      .where(eq(teams.id, id));
    return { team: teamView(await loadTeam(ctx, id, user.id)) };
  });

  app.put('/api/teams/:id/roster', async (request) => {
    const user = requireUser(request);
    const id = idParam(request.params);
    const { userCardIds } = parse(z.object({ userCardIds: z.array(z.number().int().positive()).max(env.maxRosterSize) }), request.body);
    const unique = [...new Set(userCardIds)];
    const before = await loadTeam(ctx, id, user.id);

    if (unique.length > 0) {
      const owned = await ctx.db
        .select({ id: userCards.id })
        .from(userCards)
        .where(and(eq(userCards.userId, user.id), inArray(userCards.id, unique)));
      if (owned.length !== unique.length) throw badRequest('You can only roster cards from your own collection');
    }

    await ctx.db.transaction(async (tx) => {
      const keep = before.roster.filter((r) => unique.includes(r.entry.id));
      const removeIds = before.roster.filter((r) => !unique.includes(r.entry.id)).map((r) => r.teamCardId);
      if (removeIds.length) await tx.delete(teamCards).where(inArray(teamCards.id, removeIds));
      const add = unique.filter((cardId) => !keep.some((r) => r.entry.id === cardId));
      if (add.length) await tx.insert(teamCards).values(add.map((userCardId) => ({ teamId: id, userCardId })));
    });

    // A lineup referencing removed cards is no longer valid.
    const after = await loadTeam(ctx, id, user.id);
    const ids = new Set(after.roster.map((r) => String(r.teamCardId)));
    const lineup = after.team.lineup;
    if (lineup && ![...lineup.lineup, lineup.startingPitcherId].every((x) => ids.has(x))) {
      await ctx.db.update(teams).set({ lineup: null }).where(eq(teams.id, id));
    }
    return { team: teamView(await loadTeam(ctx, id, user.id)) };
  });

  app.post('/api/teams/:id/auto-lineup', async (request) => {
    const user = requireUser(request);
    const id = idParam(request.params);
    const loaded = await loadTeam(ctx, id, user.id);
    const result = autoLineup(rosterCards(loaded.roster), undefined, { outOfPosition: playsOutOfPosition(loaded) });
    if ('error' in result) throw badRequest(result.error);
    await ctx.db.update(teams).set({ lineup: result.lineup }).where(eq(teams.id, id));
    return { team: teamView(await loadTeam(ctx, id, user.id)) };
  });

  app.delete('/api/teams/:id', async (request) => {
    const user = requireUser(request);
    await ctx.db.delete(teams).where(and(eq(teams.id, idParam(request.params)), eq(teams.userId, user.id)));
    return { ok: true };
  });
}
