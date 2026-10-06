import type { FastifyInstance } from 'fastify';
import { requireAdmin, requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { badRequest } from '../http.js';
import { loadHouseRules, saveHouseRules } from '../settingsService.js';

/**
 * League settings.
 *
 * Any signed-in manager can read the house rules, because the card faces and
 * the draft room show them. Only the commissioner can change them.
 */
export function adminRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/settings/rules', async (request) => {
    requireUser(request);
    return { rules: await loadHouseRules(ctx) };
  });

  app.put('/api/settings/rules', async (request) => {
    const user = requireAdmin(request);
    try {
      return { rules: await saveHouseRules(ctx, user, request.body) };
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Invalid house rules');
    }
  });
}
