import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import { claimChallenge, challengeViews } from '../challenges.js';
import type { Ctx } from '../context.js';

/** The historic team collections and their reward claim. */
export function challengeRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/challenges', async (request) => {
    const user = requireUser(request);
    return { challenges: await challengeViews(ctx, user.id) };
  });

  app.post('/api/challenges/:id/claim', async (request) => {
    const user = requireUser(request);
    const { id } = request.params as { id: string };
    return claimChallenge(ctx, user.id, id);
  });
}
