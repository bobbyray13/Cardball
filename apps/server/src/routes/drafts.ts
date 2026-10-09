import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DRAFT_LIMITS, positionSchema } from '@cardball/shared';
import type { SavedLineup } from '@cardball/shared';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import {
  chooseDraftPack,
  createDraft,
  deleteDraft,
  getDraft,
  getDraftTeam,
  joinDraft,
  keepDraftCard,
  listDrafts,
  openPack,
  pickCard,
  rematchDraft,
  setDraftLineup,
  startDraft,
} from '../draftService.js';
import { idParam, parse } from '../http.js';

const createSchema = z.object({
  rounds: z.number().int().min(1).max(DRAFT_LIMITS.maxRounds),
  packSize: z.number().int().min(DRAFT_LIMITS.minPackSize).max(DRAFT_LIMITS.maxPackSize),
  yearFrom: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
  yearTo: z.number().int().min(DRAFT_LIMITS.minYear).max(DRAFT_LIMITS.maxYear),
  playableOnly: z.boolean().default(true),
  themes: z.array(z.string()).default([]),
  rarityCaps: z
    .object({
      rare: z.number().int().min(0).max(DRAFT_LIMITS.maxRare),
      star: z.number().int().min(0).max(DRAFT_LIMITS.maxStar),
      mythic: z.number().int().min(0).max(DRAFT_LIMITS.maxMythic),
    })
    .nullable()
    .default(null),
  /** regulation innings the series' games are played to */
  regulationInnings: z.number().int().min(1).max(30).default(9),
  /** host's per-pass pick clock in seconds; 0 means no clock */
  pickClockSeconds: z.union([z.literal(0), z.literal(60), z.literal(120), z.literal(180)]).default(0),
});

/** A lineup in draft card ids — the ids the room itself works in. */
const lineupSchema = z.object({
  lineup: z.array(z.string()).length(9),
  fieldPositions: z.record(positionSchema, z.string()),
  startingPitcherId: z.string(),
});

const gameSchema = z.object({ gameId: z.number().int().positive() });

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

  /** The assembly screen: this seat's drafted cards with stats, plus a suggestion. */
  app.get('/api/drafts/:id/team', async (request) => {
    const user = requireUser(request);
    return { team: await getDraftTeam(ctx, user, idParam(request.params)) };
  });

  app.post('/api/drafts/:id/lineup', async (request) => {
    const user = requireUser(request);
    const lineup = parse(lineupSchema, request.body) as SavedLineup;
    return { draft: await setDraftLineup(ctx, user, idParam(request.params), lineup) };
  });

  app.post('/api/drafts/:id/rematch', async (request) => {
    const user = requireUser(request);
    return rematchDraft(ctx, user, idParam(request.params));
  });

  app.post('/api/drafts/:id/keep-card', async (request) => {
    const user = requireUser(request);
    const { gameId, cardId } = parse(gameSchema.extend({ cardId: z.string().min(1) }), request.body);
    return { draft: await keepDraftCard(ctx, user, idParam(request.params), gameId, cardId) };
  });

  app.post('/api/drafts/:id/choose-pack', async (request) => {
    const user = requireUser(request);
    const { gameId, themeId } = parse(gameSchema.extend({ themeId: z.string().min(1) }), request.body);
    return { draft: await chooseDraftPack(ctx, user, idParam(request.params), gameId, themeId) };
  });

  app.delete('/api/drafts/:id', async (request) => {
    await deleteDraft(ctx, requireUser(request), idParam(request.params));
    return { ok: true };
  });
}
