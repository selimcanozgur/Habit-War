/**
 * The profile tab (spec §9, tab 5).
 *
 * This is the "who have I become" screen: the character card is the payoff for every
 * session the timer screen recorded, so it leads, and everything below it is
 * evidence — stats, activity, badges, streak.
 *
 * Loading strategy: the identity query gates the screen (there is no profile to show
 * without it), while the stats and achievements queries degrade in place. A badge
 * endpoint that is still being written by another agent must not take the whole tab
 * down with it, so each section renders its own pending/empty/error state.
 *
 * Note this screen does NOT register itself in a tab navigator — `_layout.tsx` is
 * owned elsewhere and wires the tabs in one pass later.
 */

import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import {
  describeClass,
  getProfile,
  getProfileStats,
  listAchievements,
  readAchievements,
  readProfile,
  readStats,
  type StatsPeriod,
} from '../src/api/profile';
import { AchievementShelf } from '../src/components/AchievementShelf';
import { StatRadar } from '../src/components/StatRadar';
import { StreakCalendar } from '../src/components/StreakCalendar';
import { XpBar } from '../src/components/XpBar';
import { colors, radius, spacing, type } from '../src/theme';

const PERIODS: readonly { readonly value: StatsPeriod; readonly label: string }[] = [
  { value: 'week', label: 'Hafta' },
  { value: 'month', label: 'Ay' },
  { value: 'all', label: 'Tümü' },
];

/** Settings rows. Screens do not exist yet, but the entries are a store requirement. */
const SETTINGS_ENTRIES: readonly {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly destructive?: boolean;
}[] = [
  { key: 'edit', label: 'Profili düzenle', hint: 'Ad, biyografi ve avatar' },
  { key: 'blocked', label: 'Engellenen kişiler', hint: 'Engellediğin hesapları yönet' },
  { key: 'export', label: 'Verilerimi dışa aktar', hint: 'Tüm verilerinin bir kopyasını indir' },
  {
    key: 'delete',
    label: 'Hesabımı sil',
    hint: 'Hesabını ve tüm verilerini kalıcı olarak kaldır',
    destructive: true,
  },
];

export default function ProfileScreen(): React.JSX.Element {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [pendingSetting, setPendingSetting] = useState<string | null>(null);

  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile });
  const statsQuery = useQuery({
    queryKey: ['profileStats', period],
    queryFn: () => getProfileStats(period),
  });
  const achievementsQuery = useQuery({ queryKey: ['achievements'], queryFn: listAchievements });

  // The API is still in flux between the agreed contract and what shipped, so every
  // response is flattened once here rather than read field-by-field in the JSX.
  const profile = useMemo(() => readProfile(profileQuery.data), [profileQuery.data]);
  const summary = useMemo(() => readStats(statsQuery.data), [statsQuery.data]);
  const achievements = useMemo(
    () => readAchievements(achievementsQuery.data),
    [achievementsQuery.data],
  );

  const user = profile?.user;
  const stats = profile?.stats ?? { STR: 0, END: 0, INT: 0, WIS: 0, CHA: 0, DEX: 0 };
  const progress = profile?.progress;

  /**
   * Days to fill in the streak grid.
   *
   * The stats endpoint's day series is preferred; habit `lastCompletedDate` values
   * stand in when it is absent. That lights up today correctly for an active user
   * even before the backend ships full history — a partly-right grid beats an empty
   * one.
   */
  const activeDays = useMemo(() => {
    const fromStats = summary?.activeDays ?? [];
    if (fromStats.length > 0) return fromStats;
    return profile?.lastCompletedDates ?? [];
  }, [summary?.activeDays, profile?.lastCompletedDates]);

  if (profileQuery.isPending) {
    return (
      <SafeAreaView style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.mutedBody}>Profilin yükleniyor…</Text>
      </SafeAreaView>
    );
  }

  // readProfile returns user and progress together or neither, but the type cannot
  // express that. Guarding on both keeps the JSX free of optional chaining.
  if (profileQuery.isError || !user || !progress) {
    return (
      <SafeAreaView style={styles.centered}>
        <Text style={styles.errorTitle}>Profil açılamadı</Text>
        <Text style={styles.errorBody}>{describeError(profileQuery.error)}</Text>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => void profileQuery.refetch()}
          accessibilityRole="button"
          accessibilityLabel="Profili yeniden yükle"
        >
          <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const displayName = user.displayName?.trim() || user.username;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* -------------------------------------------------- character card */}
        <Animated.View entering={FadeInDown.duration(320)} style={styles.card}>
          <View style={styles.identityRow}>
            <Avatar url={user.avatarUrl} name={displayName} />

            <View style={styles.identityText}>
              <Text style={styles.displayName} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={styles.username} numberOfLines={1}>
                @{user.username}
              </Text>

              <View style={styles.chips}>
                <View style={styles.chip}>
                  <Text style={styles.chipText}>{describeClass(user.classType)}</Text>
                </View>
                {user.prestige > 0 && (
                  <View style={[styles.chip, styles.chipAccent]}>
                    <Text style={[styles.chipText, styles.chipTextAccent]}>
                      {user.prestige}. yükseliş
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {user.bio ? <Text style={styles.bio}>{user.bio}</Text> : null}

          {/* Reuses the existing XpBar rather than duplicating the fill animation. */}
          <XpBar
            ratio={progress.ratio}
            level={progress.level}
            xpIntoLevel={progress.xpIntoLevel}
            xpForNextLevel={progress.isMaxLevel ? 0 : progress.xpForNextLevel}
          />
        </Animated.View>

        {/* -------------------------------------------------------- stat sheet */}
        <StatRadar stats={stats} />

        {/* --------------------------------------------------- activity summary */}
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <Text style={styles.sectionTitle}>Etkinlik</Text>

            <View style={styles.segmented}>
              {PERIODS.map((option) => {
                const selected = option.value === period;
                return (
                  <Pressable
                    key={option.value}
                    style={[styles.segment, selected && styles.segmentSelected]}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setPeriod(option.value);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`${option.label} istatistiklerini göster`}
                    accessibilityState={{ selected }}
                  >
                    <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {statsQuery.isPending ? (
            <ActivityIndicator color={colors.accent} style={styles.inlineSpinner} />
          ) : statsQuery.isError ? (
            <View style={styles.inlineError}>
              <Text style={styles.mutedBody}>{describeError(statsQuery.error)}</Text>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => void statsQuery.refetch()}
                accessibilityRole="button"
                accessibilityLabel="Etkinlik özetini yeniden yükle"
              >
                <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
              </Pressable>
            </View>
          ) : summary && (summary.sessionCount ?? 0) > 0 ? (
            <View style={styles.metrics}>
              <Metric label="Seans" value={`${summary.sessionCount ?? 0}`} />
              <Metric label="Süre" value={formatMinutes(summary.totalMinutes ?? 0)} />
              <Metric label="XP" value={`${summary.totalXp ?? 0}`} />
            </View>
          ) : (
            <Text style={styles.empty}>
              {period === 'week'
                ? 'Bu hafta henüz seans yok. Zamanlayıcı sekmesinden kısa bir seans başlat.'
                : 'Bu dönemde kayıtlı seans yok.'}
            </Text>
          )}
        </View>

        {/* ------------------------------------------------------ streak grid */}
        <StreakCalendar
          activeDays={activeDays}
          currentStreak={summary?.currentStreak ?? 0}
        />

        {/* --------------------------------------------------------- badges */}
        {achievementsQuery.isPending ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Rozetler</Text>
            <ActivityIndicator color={colors.accent} style={styles.inlineSpinner} />
          </View>
        ) : achievementsQuery.isError ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Rozetler</Text>
            <Text style={styles.mutedBody}>{describeError(achievementsQuery.error)}</Text>
            <Pressable
              style={styles.secondaryButton}
              onPress={() => void achievementsQuery.refetch()}
              accessibilityRole="button"
              accessibilityLabel="Rozetleri yeniden yükle"
            >
              <Text style={styles.secondaryButtonText}>Tekrar dene</Text>
            </Pressable>
          </View>
        ) : (
          <AchievementShelf achievements={achievements} />
        )}

        {/* ------------------------------------------------------- settings */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Ayarlar</Text>

          <View style={styles.settingsList}>
            {SETTINGS_ENTRIES.map((entry) => (
              <Pressable
                key={entry.key}
                style={styles.settingRow}
                onPress={() => {
                  void Haptics.selectionAsync();
                  setPendingSetting(entry.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${entry.label}. ${entry.hint}`}
              >
                <View style={styles.settingText}>
                  <Text style={[styles.settingLabel, entry.destructive && styles.destructive]}>
                    {entry.label}
                  </Text>
                  <Text style={styles.settingHint}>{entry.hint}</Text>
                </View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            ))}
          </View>

          {/*
            Placeholder screens are not built yet, but the entries must be visible and
            tappable — data export and account deletion are store requirements. Saying
            so plainly beats a dead tap that looks like a bug.
          */}
          {pendingSetting !== null && (
            <Animated.Text entering={FadeInDown.duration(200)} style={styles.placeholderNotice}>
              Bu ekran henüz hazır değil. Yakında burada açılacak.
            </Animated.Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Avatar({ url, name }: { url: string | null; name: string }): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  // A broken avatar URL must fall back to initials, not to an empty grey box — the
  // image host is third-party and will fail eventually.
  if (url && !failed) {
    return (
      <Image
        source={{ uri: url }}
        style={styles.avatar}
        onError={() => setFailed(true)}
        accessibilityLabel={`${name} profil fotoğrafı`}
      />
    );
  }

  return (
    <View style={[styles.avatar, styles.avatarFallback]}>
      <Text style={styles.avatarInitial}>{(name[0] ?? '?').toLocaleUpperCase('tr-TR')}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={styles.metric} accessible accessibilityRole="text" accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  if (safe < 60) return `${safe} dk`;
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  return rest === 0 ? `${hours} sa` : `${hours} sa ${rest} dk`;
}

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },

  identityRow: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: colors.surfaceRaised },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...type.title, color: colors.accentBright },
  identityText: { flex: 1, gap: 2 },
  displayName: { ...type.title, color: colors.text },
  username: { ...type.label, color: colors.textMuted },
  bio: { ...type.body, color: colors.textMuted, lineHeight: 21 },

  chips: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap', marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceRaised,
  },
  chipAccent: { borderColor: colors.accent },
  chipText: { ...type.caption, color: colors.textMuted },
  chipTextAccent: { color: colors.accentBright },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: { ...type.heading, color: colors.text },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    padding: 2,
  },
  segment: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  segmentSelected: { backgroundColor: colors.accent },
  segmentText: { ...type.caption, color: colors.textMuted },
  segmentTextSelected: { color: '#FFFFFF' },

  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  metricValue: {
    ...type.heading,
    color: colors.text,
    fontSize: 20,
    fontVariant: ['tabular-nums'],
  },
  metricLabel: { ...type.caption, color: colors.textMuted },

  settingsList: { gap: 1 },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm + 2,
  },
  settingText: { flex: 1, gap: 1 },
  settingLabel: { ...type.body, color: colors.text },
  settingHint: { ...type.caption, color: colors.textFaint },
  destructive: { color: colors.danger },
  chevron: { ...type.heading, color: colors.textFaint },
  placeholderNotice: { ...type.caption, color: colors.warning },

  inlineSpinner: { alignSelf: 'center', marginVertical: spacing.md },
  inlineError: { gap: spacing.sm, alignItems: 'flex-start' },
  empty: { ...type.body, color: colors.textFaint, lineHeight: 21 },
  mutedBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },

  errorTitle: { ...type.heading, color: colors.text },
  errorBody: { ...type.body, color: colors.textMuted, textAlign: 'center' },
  secondaryButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  secondaryButtonText: { ...type.label, color: colors.text },
});
