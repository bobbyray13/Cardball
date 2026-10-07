import type { FastifyInstance } from 'fastify';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { idParam } from '../http.js';
import { loadPacks, openPack } from '../packs.js';

/** The pack shelf and the tear-it-open endpoint. */
export function packRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/packs', async (request) => {
    const user = requireUser(request);
    return { packs: await loadPacks(ctx.db, user.id) };
  });

  app.post('/api/packs/:id/open', async (request) => {
    const user = requireUser(request);
    return openPack(ctx, user.id, idParam(request.params));
  });
}
