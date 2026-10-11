/**
 * The daily reminder, client side: asking for permission and handing the device's
 * push token to the server. The server decides when to send (jobs/tasks/
 * reading-reminder.ts); this device only has to be reachable.
 *
 * Every failure here is silent on purpose. A reminder is a convenience: a denied
 * permission, a simulator without push, or a build without an EAS project id must
 * never stand between the reader and their books.
 */

import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';

import { registerPushToken } from './api/me';

/** Reminder times offered in onboarding and settings; null turns the reminder off. */
export const REMINDER_TIMES: readonly (string | null)[] = [null, '07:30', '12:30', '19:00', '21:00', '22:30'];

async function obtainToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  const status = current.granted ? current.status : (await Notifications.requestPermissionsAsync()).status;
  if (status !== 'granted') return null;

  const projectId =
    (Constants.expoConfig?.extra?.['eas'] as { projectId?: string } | undefined)?.projectId ??
    Constants.easConfig?.projectId;
  const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return token.data;
}

/**
 * Registers this device for reminders once per app session, when the reader has a
 * reminder set. Asking for permission only then means a reader who turned reminders
 * off is never shown the system prompt.
 */
export function useRegisterPush(enabled: boolean): void {
  const done = useRef(false);

  useEffect(() => {
    if (!enabled || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const token = await obtainToken();
        if (!token) return;
        await registerPushToken(token, Platform.OS === 'ios' ? 'IOS' : 'ANDROID');
      } catch {
        // Silent by design; see the note at the top of this file. Allow a retry on
        // the next launch.
        done.current = false;
      }
    })();
  }, [enabled]);
}
