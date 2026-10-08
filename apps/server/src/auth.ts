import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import { and, eq, gt } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { sessions, users } from '@cardball/db';
import type { Ctx } from './context.js';
import { env } from './env.js';
import { HttpError } from './http.js';

export const SESSION_COOKIE = 'cb_session';

export interface AuthUser {
  id: number;
  email: string;
  displayName: string;
  isAdmin: boolean;
  publicProfile: boolean;
}

export const hashPassword = (password: string) => hash(password);
export const verifyPassword = (passwordHash: string, password: string) => verify(passwordHash, password);

const tokenId = (token: string) => createHash('sha256').update(token).digest('hex');

export async function createSession(ctx: Ctx, userId: number): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.sessionDays * 86_400_000);
  await ctx.db.insert(sessions).values({ id: tokenId(token), userId, expiresAt });
  return token;
}

export async function destroySession(ctx: Ctx, token: string): Promise<void> {
  await ctx.db.delete(sessions).where(eq(sessions.id, tokenId(token)));
}

export async function userFromToken(ctx: Ctx, token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await ctx.db
    .select({ id: users.id, email: users.email, displayName: users.displayName, isAdmin: users.isAdmin, publicProfile: users.publicProfile })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, tokenId(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    maxAge: env.sessionDays * 86_400,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Parse the session token out of a raw Cookie header (used by Socket.IO). */
export function tokenFromCookieHeader(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthUser | null;
  }
}

export function requireUser(request: FastifyRequest): AuthUser {
  if (!request.user) throw new HttpError(401, 'Please sign in');
  return request.user;
}

export function requireAdmin(request: FastifyRequest): AuthUser {
  const user = requireUser(request);
  if (!user.isAdmin) throw new HttpError(403, 'Commissioner only');
  return user;
}
