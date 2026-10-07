import { randomBytes } from 'node:crypto';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { invites, users } from '@cardball/db';
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  requireAdmin,
  requireUser,
  setSessionCookie,
  verifyPassword,
} from '../auth.js';
import type { Ctx } from '../context.js';
import { HttpError, badRequest, parse } from '../http.js';
import { grantStarterPacks } from '../packs.js';

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
  displayName: z.string().trim().min(2).max(40),
  inviteCode: z.string().trim().optional(),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase(),
  password: z.string(),
});

export function authRoutes(app: FastifyInstance, ctx: Ctx): void {
  app.get('/api/auth/status', async () => {
    const [row] = await ctx.db.select({ n: count() }).from(users);
    // The very first account becomes the commissioner and needs no invite.
    return { needsSetup: (row?.n ?? 0) === 0 };
  });

  app.post('/api/auth/register', async (request, reply) => {
    const body = parse(registerSchema, request.body);
    const [row] = await ctx.db.select({ n: count() }).from(users);
    const firstUser = (row?.n ?? 0) === 0;

    const user = await ctx.db.transaction(async (tx) => {
      let inviteCode: string | null = null;
      if (!firstUser) {
        if (!body.inviteCode) throw badRequest('An invite code is required');
        const [invite] = await tx.select().from(invites).where(eq(invites.code, body.inviteCode)).limit(1);
        if (!invite || invite.usedByUserId) throw badRequest('That invite code is invalid or already used');
        if (invite.expiresAt && invite.expiresAt < new Date()) throw badRequest('That invite code has expired');
        inviteCode = invite.code;
      }

      const [existing] = await tx.select({ id: users.id }).from(users).where(eq(users.email, body.email)).limit(1);
      if (existing) throw badRequest('An account with that email already exists');

      const [created] = await tx
        .insert(users)
        .values({
          email: body.email,
          passwordHash: await hashPassword(body.password),
          displayName: body.displayName,
          isAdmin: firstUser,
        })
        .returning();
      if (inviteCode) {
        await tx
          .update(invites)
          .set({ usedByUserId: created!.id })
          .where(and(eq(invites.code, inviteCode), isNull(invites.usedByUserId)));
      }
      // A new manager starts with starter packs on the shelf, so there is
      // something to tear open before the first draft night.
      await grantStarterPacks(tx, created!.id);
      return created!;
    });

    setSessionCookie(reply, await createSession(ctx, user.id));
    return { user: { id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin } };
  });

  app.post('/api/auth/login', async (request, reply) => {
    const body = parse(loginSchema, request.body);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, body.email)).limit(1);
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw new HttpError(401, 'Wrong email or password');
    }
    setSessionCookie(reply, await createSession(ctx, user.id));
    return { user: { id: user.id, email: user.email, displayName: user.displayName, isAdmin: user.isAdmin } };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await destroySession(ctx, token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (request) => ({ user: request.user }));

  // ---- invites (commissioner) ----

  app.get('/api/invites', async (request) => {
    requireAdmin(request);
    const rows = await ctx.db
      .select({
        code: invites.code,
        createdAt: invites.createdAt,
        expiresAt: invites.expiresAt,
        usedBy: users.displayName,
      })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.usedByUserId))
      .orderBy(desc(invites.createdAt));
    return { invites: rows };
  });

  app.post('/api/invites', async (request) => {
    const admin = requireAdmin(request);
    const { days } = parse(z.object({ days: z.number().int().min(1).max(365).default(30) }), request.body ?? {});
    const code = randomBytes(6).toString('base64url');
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    await ctx.db.insert(invites).values({ code, createdByUserId: admin.id, expiresAt });
    return { code, expiresAt };
  });

  app.delete('/api/invites/:code', async (request) => {
    requireAdmin(request);
    const { code } = request.params as { code: string };
    await ctx.db.delete(invites).where(and(eq(invites.code, code), isNull(invites.usedByUserId)));
    return { ok: true };
  });

  app.get('/api/users', async (request) => {
    requireUser(request);
    const rows = await ctx.db.select({ id: users.id, displayName: users.displayName }).from(users).orderBy(users.displayName);
    return { users: rows };
  });
}
