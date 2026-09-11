import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/__tests__/setup.ts'],
    // These tests talk to a real Postgres and share test rows by prefix, so files
    // must not run concurrently against the same database.
    fileParallelism: false,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
