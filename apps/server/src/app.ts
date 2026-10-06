import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { SESSION_COOKIE, userFromToken } from './auth.js';
import type { Ctx } from './context.js';
import { env } from './env.js';
import { HttpError } from './http.js';
import { authRoutes } from './routes/auth.js';
import { cardRoutes } from './routes/cards.js';
import { draftRoutes } from './routes/drafts.js';
import { gameRoutes } from './routes/games.js';
import { teamRoutes } from './routes/teams.js';

export async function buildApp(ctx: Ctx, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: true, bodyLimit: 1024 * 1024 });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: env.maxUploadBytes, files: 1 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (request) => {
    if (request.url.startsWith('/api/')) {
      request.user = await userFromToken(ctx, request.cookies[SESSION_COOKIE]);
    }
  });

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
    const { statusCode: status, message } = err as { statusCode?: number; message?: string };
    if (status && status >= 400 && status < 500) return reply.status(status).send({ error: message ?? 'Bad request' });
    request.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong on our end' });
  });

  app.get('/api/health', async () => ({ ok: true }));
  authRoutes(app, ctx);
  cardRoutes(app, ctx);
  teamRoutes(app, ctx);
  gameRoutes(app, ctx);
  draftRoutes(app, ctx);

  // Production: serve the built web app, falling back to index.html for client routes.
  if (env.webDist && existsSync(join(env.webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: env.webDist, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.method !== 'GET') {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
