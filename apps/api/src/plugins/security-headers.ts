/**
 * Security headers.
 *
 * This API serves JSON to a mobile client, never HTML to a browser, so most of
 * helmet's defaults protect against attacks that cannot reach it. The ones kept are
 * the ones that still matter for a JSON endpoint:
 *
 *  - `noSniff` — stops a browser from re-interpreting a JSON error page as HTML,
 *    which is the one way a response here could become script.
 *  - `frameguard` / `hidePoweredBy` — cheap, no downside.
 *  - HSTS — only meaningful over TLS, and enabled only in production, where the API
 *    sits behind one. Sending it in development would pin localhost to HTTPS in the
 *    developer's browser, which is an afternoon nobody enjoys.
 *
 * CSP is deliberately OFF. A content policy governs what a *page* may load; there is
 * no page. Enabling it would be cargo cult — a header nobody evaluates, obscuring
 * the fact that no HTML surface has been threat-modelled yet. Revisit if this ever
 * serves a web client.
 */

import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Env } from '../env.js';

async function securityHeadersPlugin(app: FastifyInstance, options: { env: Env }): Promise<void> {
  const isProduction = options.env.NODE_ENV === 'production';

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    // Media in this product is served from object storage on another origin.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
}

export default fp(securityHeadersPlugin, { name: 'security-headers' });
