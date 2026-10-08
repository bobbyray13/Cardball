import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { activeHouseRules, gameActionSchema, matchRulesSchema } from '@cardball/shared';
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
  unlockGame,
} from '../gameService.js';
import { idParam, parse } from '../http.js';

const gamePassword = z.string().min(1, 'Enter the password').max(100);

const createSchema = z.object({
  mode: z.enum(['remote', 'hotseat', 'bot']),
  regulationInnings: z
    .number()
    .int()
    .refine((n) => activeHouseRules().regulationInningsOptions.includes(n), 'Pick a regulation length from the house rules'),
  teamId: z.number().int().positive(),
  opponentTeamId: z.number().int().positive().optional(),
  /** a stock bot team id from the catalog, instead of an owned opponent */
  opponentStockTeamId: z.string().min(1).max(40).optional(),
  /** what cards this match allows; missing means any card, no caps */
  match: matchRulesSchema.optional(),
  /** opt-in: watching or joining takes this password */
  password: gamePassword.optional(),
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
    const { teamId, password } = parse(z.object({ teamId: z.number().int().positive(), password: gamePassword.optional() }), request.body);
    return { game: await joinGame(ctx, user, idParam(request.params), teamId, password) };
  });

  app.post('/api/games/:id/unlock', async (request) => {
    const user = requireUser(request);
    const { password } = parse(z.object({ password: gamePassword }), request.body);
    return unlockGame(ctx, user, idParam(request.params), password);
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
