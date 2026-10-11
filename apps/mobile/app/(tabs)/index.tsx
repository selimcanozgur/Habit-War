/**
 * Bugün — the screen the reader opens every day.
 *
 * Top to bottom it answers three questions: how far am I from today's goal, am I
 * keeping it up, and which book am I fighting. Logging pages is one tap from here.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getProfile, PROFILE_KEY, updateProfile } from '../../src/api/me';
import { getToday, type Book, type LogResult } from '../../src/api/reading';
import { BookCard } from '../../src/components/BookCard';
import { BookFormSheet } from '../../src/components/BookFormSheet';
import { Button, cardStyle } from '../../src/components/Button';
import { Icon } from '../../src/components/Icon';
import { LogPagesSheet } from '../../src/components/LogPagesSheet';
import { RewardSheet } from '../../src/components/RewardSheet';
import { ScreenHero } from '../../src/components/ScreenHero';
import { useT } from '../../src/i18n';
import { colors, radius, spacing, type } from '../../src/theme';

export default function TodayScreen(): React.JSX.Element {
  const t = useT();
  const queryClient = useQueryClient();
  const todayQuery = useQuery({ queryKey: ['today'], queryFn: getToday });
  const profileQuery = useQuery({ queryKey: PROFILE_KEY, queryFn: getProfile });

  const [loggingBook, setLoggingBook] = useState<Book | null>(null);
  const [reward, setReward] = useState<LogResult | null>(null);
  const [addingBook, setAddingBook] = useState(false);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<string | null>(null);

  const acceptGoal = useMutation({
    mutationFn: (dailyGoal: number) => updateProfile({ dailyGoal }),
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_KEY, profile);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const today = todayQuery.data;
  const name = profileQuery.data?.displayName;

  function onLogged(result: LogResult): void {
    setLoggingBook(null);
    setReward(result);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl
            refreshing={todayQuery.isRefetching}
            onRefresh={() => void todayQuery.refetch()}
            tintColor={colors.accent}
          />
        }
      >
        <ScreenHero image="today" title={t.today.title} subtitle={name ? t.today.greeting(name) : undefined} />

        <View style={styles.body}>
          {todayQuery.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : !today ? (
            <View style={styles.card}>
              <Text style={styles.muted}>{t.common.loadError}</Text>
              <Button label={t.common.retry} tone="neutral" onPress={() => void todayQuery.refetch()} />
            </View>
          ) : (
            <>
              <GoalCard pagesToday={today.pagesToday} dailyGoal={today.dailyGoal} goalMet={today.goalMet} />

              <View style={styles.tiles}>
                <Tile icon="flame-filled" tint={colors.fire} label={t.today.streak} value={t.today.streakDays(today.streak.current)} />
                <Tile
                  icon="check-circle-filled"
                  tint={colors.success}
                  label={t.today.consistency(today.windowDays)}
                  value={t.today.consistencyValue(today.daysRead, today.windowDays)}
                />
              </View>

              {today.suggestedGoal !== null && dismissedSuggestion !== today.date ? (
                <View style={[styles.card, styles.suggestion]}>
                  <Text style={styles.suggestionTitle}>{t.today.suggestionTitle}</Text>
                  <Text style={styles.muted}>{t.today.suggestionBody(today.suggestedGoal)}</Text>
                  <Button
                    label={t.today.suggestionAccept(today.suggestedGoal)}
                    onPress={() => acceptGoal.mutate(today.suggestedGoal as number)}
                    loading={acceptGoal.isPending}
                  />
                  <Button
                    label={t.today.suggestionDismiss}
                    tone="neutral"
                    onPress={() => setDismissedSuggestion(today.date)}
                  />
                </View>
              ) : null}

              <Text style={styles.overline}>{t.today.booksOverline}</Text>
              {today.books.length === 0 ? (
                <View style={styles.card}>
                  <Text style={styles.emptyTitle}>{t.today.emptyTitle}</Text>
                  <Text style={styles.muted}>{t.today.emptyBody}</Text>
                  <Button label={t.today.addBook} onPress={() => setAddingBook(true)} />
                </View>
              ) : (
                <>
                  {today.books.map((book) => (
                    <BookCard key={book.id} book={book} forecast={book.forecast} onLog={() => setLoggingBook(book)} />
                  ))}
                  <Button label={t.today.addBook} tone="neutral" onPress={() => setAddingBook(true)} />
                </>
              )}
            </>
          )}
        </View>
      </ScrollView>

      <LogPagesSheet book={loggingBook} onClose={() => setLoggingBook(null)} onLogged={onLogged} />
      <RewardSheet result={reward} onClose={() => setReward(null)} />
      <BookFormSheet visible={addingBook} book={null} onClose={() => setAddingBook(false)} />
    </View>
  );
}

function GoalCard({
  pagesToday,
  dailyGoal,
  goalMet,
}: {
  pagesToday: number;
  dailyGoal: number;
  goalMet: boolean;
}): React.JSX.Element {
  const t = useT();
  const ratio = Math.min(1, pagesToday / dailyGoal);
  return (
    <View style={styles.card}>
      <Text style={styles.overlineInCard}>{t.today.goalOverline}</Text>
      <Text style={styles.goalNumber}>{t.today.goalProgress(pagesToday, dailyGoal)}</Text>
      <View
        style={styles.goalTrack}
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: dailyGoal, now: Math.min(pagesToday, dailyGoal) }}
      >
        <View
          style={[
            styles.goalFill,
            { width: `${ratio * 100}%` },
            goalMet && { backgroundColor: colors.success },
          ]}
        />
      </View>
      <Text style={[styles.goalStatus, goalMet && { color: colors.successDark }]}>
        {goalMet ? t.today.goalDone : t.today.goalLeft(dailyGoal - pagesToday)}
      </Text>
    </View>
  );
}

function Tile({
  icon,
  tint,
  label,
  value,
}: {
  icon: 'flame-filled' | 'check-circle-filled';
  tint: string;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={[styles.card, styles.tile]}>
      <Icon name={icon} size={22} color={tint} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  loader: { marginTop: spacing.xl },
  card: { ...cardStyle, gap: spacing.sm },
  muted: { ...type.body, color: colors.textMuted },
  overline: { ...type.overline, color: colors.textFaint, marginTop: spacing.sm },
  overlineInCard: { ...type.overline, color: colors.textFaint },
  goalNumber: { ...type.display, color: colors.text },
  goalTrack: {
    height: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSunken,
    overflow: 'hidden',
  },
  goalFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.accent },
  goalStatus: { ...type.label, color: colors.textMuted },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tile: { flex: 1, alignItems: 'flex-start' },
  tileValue: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  tileLabel: { ...type.caption, color: colors.textMuted },
  suggestion: { backgroundColor: colors.goldSoft },
  suggestionTitle: { ...type.heading, color: colors.text },
  emptyTitle: { ...type.heading, color: colors.text },
});
