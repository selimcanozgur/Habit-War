/**
 * Process bootstrap.
 *
 * Boot failures exit non-zero rather than leaving a half-started process behind, and
 * SIGTERM/SIGINT drain in-flight requests so a deploy does not cut a session
 * completion in half.
 */

import { buildServer } from './server.js';
import { loadEnv } from './env.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildServer(env);

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      app.log.info({ signal }, 'shutting down');
      void app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'error during shutdown');
          process.exit(1);
        },
      );
    });
  }

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
