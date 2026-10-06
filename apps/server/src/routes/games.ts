import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activeHouseRules, gameActionSchema } from '@cardball/shared';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import {
  createNewGame,
  deleteOpenGame,
  getGame,
  joinGame,
  listGames,
  performAction,
  postChat,
  setDiscordUrl,
} from '../gameService.js';
import { idParam, parse } from '../http.js';

const createSchema = z.object({
  mode: z.enum(['remote', 'hotseat', 'bot']),
  regulationInnings: z
    .number()
    .int()
    .refine((n) => activeHouseRules().regulationInningsOptions.includes(n), 'Pick a regulation length from the house rules'),
  teamId: z.number().int().positive(),
  opponentTeamId: z.number().int().positive().optional(),
});

const discordSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .refine((u) => /^https:\/\/(www\.)?(discord\.gg|discord\.com)\//.test(u), 'Must be a discord.gg or discord.com link')
    .nullable(),
});

export function gameRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/games', async (request) => ({ games: await listGames(ctx, requireUser(request)) }));

  app.post('/api/games', async (request) => {
    const user = requireUser(request);
    return { game: await createNewGame(ctx, user, parse(createSchema, request.body)) };
  });

  app.get('/api/games/:id', async (request) => getGame(ctx, requireUser(request), idParam(request.params)));

  app.post('/api/games/:id/join', async (request) => {
    const user = requireUser(request);
    const { teamId } = parse(z.object({ teamId: z.number().int().positive() }), request.body);
    return { game: await joinGame(ctx, user, idParam(request.params), teamId) };
  });

  app.post('/api/games/:id/actions', async (request) => {
    const user = requireUser(request);
    const { action } = parse(z.object({ action: gameActionSchema }), request.body);
    return performAction(ctx, user, idParam(request.params), action);
  });

  app.post('/api/games/:id/chat', async (request) => {
    const user = requireUser(request);
    const { body } = parse(z.object({ body: z.string().max(500) }), request.body);
    return { message: await postChat(ctx, user, idParam(request.params), body) };
  });

  app.put('/api/games/:id/discord', async (request) => {
    const user = requireUser(request);
    const { url } = parse(discordSchema, request.body);
    return { game: await setDiscordUrl(ctx, user, idParam(request.params), url) };
  });

  app.delete('/api/games/:id', async (request) => {
    await deleteOpenGame(ctx, requireUser(request), idParam(request.params));
    return { ok: true };
  });
}
