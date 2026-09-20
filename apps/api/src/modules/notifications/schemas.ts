import { z } from 'zod';

export const listNotificationsQuery = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const notificationIdParams = z.object({ id: z.string().cuid() });

export const registerPushTokenBody = z.object({
  /** Expo issues these as `ExponentPushToken[...]`. */
  token: z.string().min(10).max(256),
  platform: z.enum(['IOS', 'ANDROID', 'WEB']),
  /** Stable per-install id, so a reinstall replaces its own row. */
  deviceId: z.string().max(128).optional(),
});

export const pushTokenParams = z.object({ token: z.string().min(10).max(256) });
