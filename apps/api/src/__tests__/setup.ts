/**
 * Test bootstrap.
 *
 * Loads apps/api/.env so a plain `npm test` works the same as `npm run dev`. Without
 * this the tests would only pass when the caller happened to export DATABASE_URL,
 * which makes a green local run say nothing about CI.
 */

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envPath = fileURLToPath(new URL('../../.env', import.meta.url));

if (existsSync(envPath)) {
  // Node 24 built-in; no dotenv dependency needed.
  process.loadEnvFile(envPath);
}

if (!process.env['DATABASE_URL']) {
  throw new Error(
    'DATABASE_URL is not set. These tests need a running Postgres — try `npm run db:up` ' +
      'from the repo root and make sure apps/api/.env exists.',
  );
}

process.env['NODE_ENV'] ??= 'test';
