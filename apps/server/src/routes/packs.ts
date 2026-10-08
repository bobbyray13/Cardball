import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam } from '../http.js';
import { STARTER_PACK_COUNT, claimStarterPacks, loadPacks, openPack, starterPacksClaimable } from '../packs.js';

/** The pack shelf and the tear-it-open endpoint. */
export function packRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/packs', async (request) => {
    const user = requireUser(request);
    const [packs, claimable] = await Promise.all([
      loadPacks(ctx.db, user.id),
      starterPacksClaimable(ctx.db, user.id),
    ]);
    return { packs, starter: { claimable, packs: STARTER_PACK_COUNT } };
  });

  // The one-time starter packs, for an account that predates the shelf.
  app.post('/api/packs/starter/claim', async (request) => {
    const user = requireUser(request);
    return { packs: await claimStarterPacks(ctx, user.id) };
  });

  app.post('/api/packs/:id/open', async (request) => {
    const user = requireUser(request);
    return openPack(ctx, user.id, idParam(request.params));
  });
}
