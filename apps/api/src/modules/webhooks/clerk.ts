/**
 * Clerk webhook receiver.
 *
 * Clerk is authoritative for identity, so profile edits and account deletions reach
 * this product as webhooks rather than being polled. Creation is handled here too,
 * but just-in-time provisioning in the auth plugin is what actually guarantees a
 * user exists — a webhook can be delayed, retried out of order, or dropped, and a
 * brand new user must not get an error on their first request while waiting for one.
 *
 * Signature verification is mandatory. An unsigned endpoint that writes to the user
 * table is an account-takeover primitive: anyone who learns the URL could rewrite
 * another account's email.
 */

import { verifyWebhook } from '@clerk/backend/webhooks';
import type { FastifyInstance } from 'fastify';

import { softDeleteUser, syncUser, type ClerkIdentity } from '../users/service.js';

/** Request bodies this route can accept. Clerk payloads are small. */
const MAX_BODY_BYTES = 1_048_576;

interface ClerkUserEventData {
  id?: string;
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: { id?: string; email_address?: string }[];
}

/** Maps Clerk's snake_case webhook payload onto the shape the user service wants. */
function toIdentity(data: ClerkUserEventData): ClerkIdentity | null {
  if (!data.id) return null;
  const addresses = data.email_addresses ?? [];
  const primary =
    addresses.find((address) => address.id === data.primary_email_address_id) ?? addresses[0];
  const email = primary?.email_address;
  if (!email) return null;

  return {
    clerkId: data.id,
    email,
    username: data.username ?? null,
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    imageUrl: data.image_url ?? null,
  };
}

export interface ClerkWebhookOptions {
  readonly signingSecret: string;
}

export async function clerkWebhookRoutes(
  app: FastifyInstance,
  options: ClerkWebhookOptions,
): Promise<void> {
  /**
   * Signature verification runs over the exact bytes Clerk signed, so this route
   * takes the body as a string and parses it itself. Fastify's JSON parser would
   * hand back an object whose re-serialisation no longer matches the signature.
   * The parser is registered inside this plugin, so it applies only here.
   */
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string', bodyLimit: MAX_BODY_BYTES },
    (_request, body, done) => {
      done(null, body);
    },
  );

  app.post('/webhooks/clerk', async (request, reply) => {
    const raw = typeof request.body === 'string' ? request.body : '';

    // verifyWebhook wants a standard Request; rebuild one from the raw bytes and
    // the signature headers.
    const headers = new Headers();
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === 'string') headers.set(key, value);
      else if (Array.isArray(value)) headers.set(key, value.join(','));
    }

    let event;
    try {
      event = await verifyWebhook(new Request('https://api.habitwar.app/webhooks/clerk', {
        method: 'POST',
        headers,
        body: raw,
      }), { signingSecret: options.signingSecret });
    } catch (error) {
      request.log.warn({ err: error }, 'clerk webhook signature verification failed');
      return reply.status(400).send({
        error: { code: 'BAD_REQUEST', message: 'Webhook signature verification failed' },
      });
    }

    const data = event.data as ClerkUserEventData;

    switch (event.type) {
      case 'user.created':
      case 'user.updated': {
        const identity = toIdentity(data);
        if (!identity) {
          // A user with no email address cannot be mapped. Acknowledge rather than
          // 4xx: Clerk would retry forever and the payload will never improve.
          request.log.warn({ eventType: event.type }, 'clerk webhook payload had no usable email');
          break;
        }
        const updated = await syncUser(app.prisma, identity);
        if (!updated) {
          // Not provisioned locally yet. The auth plugin creates the row on the
          // user's first authenticated request, so there is nothing to do.
          request.log.info({ clerkId: identity.clerkId }, 'webhook for a user not provisioned yet');
        }
        break;
      }

      case 'user.deleted': {
        if (data.id) await softDeleteUser(app.prisma, data.id);
        break;
      }

      default:
        request.log.debug({ eventType: event.type }, 'ignoring clerk webhook event');
    }

    // Always 200 on a verified event. A non-2xx puts Clerk into retry, and retrying
    // an event this product does not act on achieves nothing.
    return reply.status(200).send({ received: true });
  });
}
