import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DRAFT_LIMITS } from '@cardball/shared';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { createDraft, deleteDraft, getDraft, joinDraft, listDrafts, openPack, pickCard, startDraft } from '../draftService.js';
import { idParam, parse } from '../http.js';

const createSchema = z.object({
  rounds: z.number().int().min(1).max(DRAFT_LIMITS.maxRounds),
  packSize: z.number().int().min(DRAFT_LIMITS.minPackSize).max(DRAFT_LIMITS.maxPackSize),
  yearFrom: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
  yearTo: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
  playableOnly: z.boolean().default(true),
  themes: z.array(z.string()).default([]),
  rarityCaps: z.object({ rare: z.number().int().min(0).max(DRAFT_LIMITS.maxRare), chase: z.number().int().min(0).max(DRAFT_LIMITS.maxChase) }).nullable().default(null),
});

export function draftRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/drafts', async (request) => ({ drafts: await listDrafts(ctx, requireUser(request)) }));

  app.post('/api/drafts', async (request) => {
    const user = requireUser(request);
    return { draft: await createDraft(ctx, user, parse(createSchema, request.body)) };
  });

  app.get('/api/drafts/:id', async (request) => {
    const user = requireUser(request);
    return { draft: await getDraft(ctx, user, idParam(request.params)) };
  });

  app.post('/api/drafts/:id/join', async (request) => {
    const user = requireUser(request);
    return { draft: await joinDraft(ctx, user, idParam(request.params)) };
  });

  app.post('/api/drafts/:id/start', async (request) => {
    const user = requireUser(request);
    return { draft: await startDraft(ctx, user, idParam(request.params)) };
  });

  app.post('/api/drafts/:id/open', async (request) => {
    const user = requireUser(request);
    return { draft: await openPack(ctx, user, idParam(request.params)) };
  });

  app.post('/api/drafts/:id/pick', async (request) => {
    const user = requireUser(request);
    const { cardId } = parse(z.object({ cardId: z.string().min(1) }), request.body);
    return { draft: await pickCard(ctx, user, idParam(request.params), cardId) };
  });

  app.delete('/api/drafts/:id', async (request) => {
    await deleteDraft(ctx, requireUser(request), idParam(request.params));
    return { ok: true };
  });
}
