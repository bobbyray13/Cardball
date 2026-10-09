import { HttpError } from './http.js';

/**
 * Sliding-window attempt counters for the two unauthenticated endpoints that
 * do real work: login (an argon2 password verification) and register (an
 * invite check plus password hash). The server runs as a single process (see
 * lock.ts), so the counters live in memory: a restart clears them, which is
 * the right failure mode — an attacker gets a fresh window, an honest manager
 * is never stuck behind a stale lock.
 *
 * Login counts failures per IP address and per email, so one person fat-
 * fingering their own password does not lock out the league, but a credential
 * stuffing run hits the wall from either direction. Register counts attempts
 * (not failures) per IP: every attempt costs a hash even when the invite is
 * wrong, and legitimate sign-ups are invite-gated and rare.
 */

const WINDOWS = {
  loginFailure: { max: 10, windowMs: 15 * 60_000 },
  registerAttempt: { max: 20, windowMs: 60 * 60_000 },
} as const;

type Kind = keyof typeof WINDOWS;

const LONGEST_WINDOW_MS = 60 * 60_000;

const attempts = new Map<string, number[]>();

function recent(kind: Kind, key: string, now: number): number[] {
  const id = `${kind}:${key}`;
  const cutoff = now - WINDOWS[kind].windowMs;
  const stamps = (attempts.get(id) ?? []).filter((t) => t > cutoff);
  attempts.set(id, stamps);
  return stamps;
}

function count(kind: Kind, key: string, now = Date.now()): number {
  return recent(kind, key, now).length;
}

function push(kind: Kind, key: string, now: number): void {
  const id = `${kind}:${key}`;
  recent(kind, key, now).push(now);
  // Bound the map even if a script rotates IP addresses at us.
  if (attempts.size > 10_000) {
    const cutoff = now - LONGEST_WINDOW_MS;
    for (const [mapKey, stamps] of attempts) {
      if (!stamps.some((t) => t > cutoff)) attempts.delete(mapKey);
    }
  }
}

/** Throw 429 if either the address or the account has failed too often recently. */
export function assertLoginAllowed(ip: string, email: string, now = Date.now()): void {
  const { max } = WINDOWS.loginFailure;
  if (count('loginFailure', `ip:${ip}`, now) >= max || count('loginFailure', `email:${email}`, now) >= max) {
    throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  }
}

export function noteLoginFailure(ip: string, email: string, now = Date.now()): void {
  push('loginFailure', `ip:${ip}`, now);
  push('loginFailure', `email:${email}`, now);
}

/** A successful login forgives the address and the account. */
export function noteLoginSuccess(ip: string, email: string): void {
  attempts.delete(`loginFailure:ip:${ip}`);
  attempts.delete(`loginFailure:email:${email}`);
}

/** Throw 429 if this address has tried to register too often in the past hour. */
export function assertRegisterAllowed(ip: string, now = Date.now()): void {
  if (count('registerAttempt', `ip:${ip}`, now) >= WINDOWS.registerAttempt.max) {
    throw new HttpError(429, 'Too many attempts. Wait an hour and try again.');
  }
}

export function noteRegisterAttempt(ip: string, now = Date.now()): void {
  push('registerAttempt', `ip:${ip}`, now);
}

/** Test hook: wipe every counter. */
export function resetRateLimits(): void {
  attempts.clear();
}
