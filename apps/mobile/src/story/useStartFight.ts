/**
 * Starting a fight from anywhere outside Bugün: start the habit's session, ask for the
 * versus intro, and go to Bugün, where the running session is the battle screen.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { startSession } from '../api/sessions';
import { useTimerStore } from '../stores/timer';

function requestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useStartFight(onError: (error: unknown) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (habitId: string) => startSession({ habitId, clientRequestId: requestId() }),
    onSuccess: ({ session }) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const timer = useTimerStore.getState();
      timer.start({
        sessionId: session.id,
        habitId: session.habitId,
        startedAt: session.startedAt,
        pausedSec: session.pausedSec,
        pausedAt: session.pausedAt,
      });
      timer.requestIntro();
      void queryClient.invalidateQueries({ queryKey: ['activeSession'] });
      router.navigate('/');
    },
    onError,
  });
}
