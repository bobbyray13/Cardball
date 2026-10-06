import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DRAFT_LIMITS, TOURNAMENT_LIMITS } from '@cardball/shared';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam, parse } from '../http.js';
import { createTournament, deleteTournament, getTournament, joinTournament, listTournaments, simulateTournament, startTournament } from '../tournamentService.js';

const createSchema = z.object({
  name: z.string().trim().min(2).max(40),
  format: z.enum(['round-robin', 'semis']),
  seats: z.number().int().min(TOURNAMENT_LIMITS.minSeats).max(TOURNAMENT_LIMITS.maxSeats),
  regulationInnings: z.number().int().min(1).max(30),
  autoSimulate: z.boolean().default(false),
  draft: z.object({
    rounds: z.number().int().min(TOURNAMENT_LIMITS.minRounds).max(TOURNAMENT_LIMITS.maxRounds),
    packSize: z.number().int().min(TOURNAMENT_LIMITS.minPackSize).max(TOURNAMENT_LIMITS.maxPackSize),
    yearFrom: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
    yearTo: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
    themes: z.array(z.string()).default([]),
    rarityCaps: z.object({ rare: z.number().int().min(0).max(DRAFT_LIMITS.maxRare), chase: z.number().int().min(0).max(DRAFT_LIMITS.maxChase) }).nullable().default(null),
  }),
});

export function tournamentRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/tournaments', async (request) => ({ tournaments: await listTournaments(ctx, requireUser(request)) }));

  app.post('/api/tournaments', async (request) => {
    const user = requireUser(request);
    return { tournament: await createTournament(ctx, user, parse(createSchema, request.body)) };
  });

  app.get('/api/tournaments/:id', async (request) => {
    const user = requireUser(request);
    return { tournament: await getTournament(ctx, user, idParam(request.params)) };
  });

  app.post('/api/tournaments/:id/join', async (request) => {
    const user = requireUser(request);
    return { tournament: await joinTournament(ctx, user, idParam(request.params)) };
  });

  app.post('/api/tournaments/:id/start', async (request) => {
    const user = requireUser(request);
    return { tournament: await startTournament(ctx, user, idParam(request.params)) };
  });

  app.post('/api/tournaments/:id/simulate', async (request) => {
    const user = requireUser(request);
    return { tournament: await simulateTournament(ctx, user, idParam(request.params)) };
  });

  app.delete('/api/tournaments/:id', async (request) => {
    await deleteTournament(ctx, requireUser(request), idParam(request.params));
    return { ok: true };
  });
}
