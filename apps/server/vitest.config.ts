import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Each run gets its own database and upload folder. The suite truncates tables
// in `beforeAll`, so sharing one database between concurrent runs (or between a
// run and a manual `pnpm dev:server` session) would wipe the other's sessions.
const runId = `${process.pid}_${randomBytes(3).toString('hex')}`;
const uploadDir = fileURLToPath(new URL(`.test-uploads/${runId}`, import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // These tests talk to a real Postgres, so give the slower ones room.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    env: {
      TEST_RUN_ID: runId,
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? `postgres://cardball:cardball@localhost:5433/cardball_test_${runId}`,
      UPLOAD_DIR: uploadDir,
      NODE_ENV: 'test',
    },
  },
});
