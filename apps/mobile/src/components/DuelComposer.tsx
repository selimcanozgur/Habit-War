/**
 * The duel form: an opponent, a daily task and a length.
 *
 * A duel is a task both sides do every day — "50 şınav" — not a category of timed
 * work. Each day either side checks in, the opponent can dispute, and most undisputed
 * days wins. The reward line under the fields states what a duel pays, because that
 * is the reason to open one instead of training alone.
 *
 * Fields only — the caller supplies the card and the header, because the form sits in
 * two places: the battle screen's own composer, and the "Düello" side of the Bugün
 * screen's add sheet. Both send the same invitation through the same mutation, so the
 * two can never drift apart.
 *
 * Opponents are friends only. The API takes a username, but a duel with a stranger is
 * not a feature the product has; the friend list is both the source and the guard.
 */

import {
  DUEL_DAY_XP,
  DUEL_PERFECT_XP,
  DUEL_TASK_MAX_LENGTH,
  DUEL_TASK_MIN_LENGTH,
  DUEL_WIN_XP,
} from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { ApiError } from '../api/client';
import { createChallenge, listFriends, normaliseFriends } from '../api/social';
import { colors, radius, spacing, type } from '../theme';
import { Button, ChipButton } from './Button';
import { OptionPills } from './CategoryPicker';
import { FormField } from './FormField';

/** Spec 5.4: a duel runs 3–7 days. */
const DUEL_DAY_OPTIONS: readonly number[] = [3, 5, 7];

/** One tap to a sensible task; the field takes anything. */
const TASK_SUGGESTIONS: readonly string[] = [
  '50 şınav',
  '20 sayfa kitap',
  '30 dk yürüyüş',
  '10 dk meditasyon',
  '1 saat ders',
];

export interface DuelComposerProps {
  /** Fires once the invitation is accepted by the server. */
  readonly onCreated: () => void;
}

export function DuelComposer({ onCreated }: DuelComposerProps): React.JSX.Element {
  const queryClient = useQueryClient();
  const [opponent, setOpponent] = useState<string | null>(null);
  const [task, setTask] = useState('');
  const [days, setDays] = useState<number>(DUEL_DAY_OPTIONS[0] ?? 3);
  const [error, setError] = useState<string | null>(null);

  const friendsQuery = useQuery({ queryKey: ['friends'], queryFn: listFriends });
  const friends = useMemo(() => normaliseFriends(friendsQuery.data?.friends), [friendsQuery.data]);

  const mutation = useMutation({
    mutationFn: (input: { opponentUsername: string; task: string; days: number }) =>
      createChallenge(input),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['challenges'] });
      void queryClient.invalidateQueries({ queryKey: ['friendsLeaderboard'] });
      onCreated();
    },
    onError: (err: unknown) => setError(describeError(err)),
  });

  const trimmedTask = task.trim();
  const canSubmit =
    opponent !== null && trimmedTask.length >= DUEL_TASK_MIN_LENGTH && !mutation.isPending;

  return (
    <View style={styles.form}>
      <View style={styles.group}>
        <Text style={styles.label}>Rakip</Text>
        {friendsQuery.isPending ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : friendsQuery.isError ? (
          <Text style={styles.error}>{describeError(friendsQuery.error)}</Text>
        ) : friends.length === 0 ? (
          <Text style={styles.empty}>
            Düello için önce arkadaş eklemelisin. Arkadaşlar sekmesinden kullanıcı adı
            arayarak başlayabilirsin.
          </Text>
        ) : (
          <View style={styles.chips}>
            {friends.map((friend) => {
              const selected = opponent === friend.user.username;
              return (
                <ChipButton
                  key={friend.friendshipId}
                  label={friend.user.displayName}
                  tone={selected ? 'primary' : 'neutral'}
                  onPress={() => {
                    setOpponent(selected ? null : friend.user.username);
                    if (error) setError(null);
                  }}
                  accessibilityLabel={`Rakip olarak ${friend.user.displayName} seç`}
                />
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.group}>
        <FormField
          label="Günlük görev"
          value={task}
          onChangeText={(value) => {
            setTask(value);
            if (error) setError(null);
          }}
          placeholder="Örn. 50 şınav"
          maxLength={DUEL_TASK_MAX_LENGTH}
          autoCapitalize="none"
          autoCorrect
          returnKeyType="done"
        />
        <View style={styles.chips}>
          {TASK_SUGGESTIONS.map((suggestion) => (
            <ChipButton
              key={suggestion}
              label={suggestion}
              tone={trimmedTask === suggestion ? 'primary' : 'neutral'}
              onPress={() => setTask(suggestion)}
              accessibilityLabel={`Görev olarak ${suggestion} seç`}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Süre</Text>
        <OptionPills
          options={DUEL_DAY_OPTIONS}
          value={days}
          onChange={setDays}
          format={(value) => `${value} gün`}
          describe={(value) => `${value} günlük düello`}
        />
      </View>

      {/* The rules and the payout in two lines: why this beats training alone. */}
      <View style={styles.rules}>
        <Text style={styles.rulesText}>
          Her gün görevi yapınca "Yaptım" de. Rakibin görür, itiraz edebilir. En çok günü
          olan kazanır.
        </Text>
        <Text style={styles.reward}>
          Günlük +{DUEL_DAY_XP} XP · kazanana +{DUEL_WIN_XP} XP · hiç gün kaçırmayana +{DUEL_PERFECT_XP} XP
        </Text>
      </View>

      {error !== null && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Button
        label="Daveti gönder"
        disabled={!canSubmit}
        loading={mutation.isPending}
        onPress={() => {
          // Narrowed here rather than trusting `canSubmit`: the compiler cannot see
          // through the boolean, and a null username would 400.
          if (opponent === null) return;
          mutation.mutate({ opponentUsername: opponent, task: trimmedTask, days });
        }}
        accessibilityLabel="Düello davetini gönder"
      />
    </View>
  );
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  group: { gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  loader: { alignSelf: 'flex-start' },
  empty: { ...type.body, color: colors.textMuted },
  rules: {
    gap: spacing.xs,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  rulesText: { ...type.caption, color: colors.textMuted, lineHeight: 17 },
  reward: { ...type.label, color: colors.xp },
  error: { ...type.caption, color: colors.danger },
});
