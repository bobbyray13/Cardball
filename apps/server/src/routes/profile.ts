import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth.js';
import type { Ctx } from '../context.js';
import { parse } from '../http.js';
import { publicProfile, setPublicProfile } from '../profile.js';

export function profileRoutes(app: FastifyInstance, ctx: Ctx): void {
  // The manager's own settings. Today that is one switch: open the binder.
  app.patch('/api/me', async (request) => {
    const user = requireUser(request);
    const { publicProfile } = parse(z.object({ publicProfile: z.boolean() }), request.body);
    await setPublicProfile(ctx, user.id, publicProfile);
    return { user: { ...user, publicProfile } };
  });

  // Any signed-in manager can read a public card; the service holds the opt-in.
  app.get('/api/profile/:username', async (request) => {
    requireUser(request);
    const { username } = parse(z.object({ username: z.string().trim().min(1).max(40) }), request.params);
    return { profile: await publicProfile(ctx, username) };
  });
}
