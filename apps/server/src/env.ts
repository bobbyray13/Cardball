import { resolve } from 'node:path';

const num = (value: string | undefined, fallback: number) => (value ? Number(value) : fallback);

export const env = {
  port: num(process.env.PORT, 3001),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://cardball:cardball@localhost:5433/cardball',
  uploadDir: resolve(process.env.UPLOAD_DIR ?? './uploads'),
  /** Built web app to serve in production (unset in dev, where Vite serves it). */
  webDist: process.env.WEB_DIST ? resolve(process.env.WEB_DIST) : null,
  /** Set to false only for plain-http local testing. */
  cookieSecure: (process.env.COOKIE_SECURE ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  /** Optional standing Discord voice channel invite offered in every game room. */
  discordVoiceUrl: process.env.DISCORD_VOICE_URL ?? null,
  /** Trust X-Forwarded-* headers: on in production (behind Caddy), off in dev. */
  trustProxy: (process.env.TRUST_PROXY ?? (process.env.NODE_ENV === 'production' ? 'true' : 'false')) === 'true',
  sessionDays: 30,
  maxUploadBytes: 8 * 1024 * 1024,
  maxRosterSize: 26,
};
