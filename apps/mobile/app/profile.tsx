/**
 * The profile tab (spec §9, tab 5).
 *
 * This is the "who have I become" screen: the character card is the payoff for every
 * session the timer screen recorded, so it leads — laid directly over the hero
 * illustration, so the character and their world are one object — and everything
 * below it is evidence: badges of standing, stats, activity, streak.
 *
 * The numbers are the content here, so they are set in display type and the words
 * that label them are demoted to overlines and captions. On a screen made mostly of
 * figures, sizing the figures like body text throws away the hierarchy for free.
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
import { useCallback, useMemo, useRef, useState } from 'react';
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
import { Button, cardStyle } from '../src/components/Button';
import { Icon, type IconName } from '../src/components/Icon';
import { ScreenHero } from '../src/components/ScreenHero';
import { StatRadar } from '../src/components/StatRadar';
import { StreakCalendar } from '../src/components/StreakCalendar';
import { XpBar } from '../src/components/XpBar';
import { colors, radius, spacing, type } from '../src/theme';

import type { Stat } from '@habitwar/domain';

const ICON_SIZE = 20;

/** Matches ALL_STATS in the domain package, so the total is stable everywhere. */
const STAT_ORDER: readonly Stat[] = ['STR', 'END', 'INT', 'WIS', 'CHA', 'DEX'];

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
  readonly icon: IconName;
  readonly destructive?: boolean;
}[] = [
  { key: 'edit', label: 'Profili düzenle', hint: 'Ad, biyografi ve avatar', icon: 'edit' },
  {
    key: 'blocked',
    label: 'Engellenen kişiler',
    hint: 'Engellediğin hesapları yönet',
    icon: 'lock',
  },
  {
    key: 'export',
    label: 'Verilerimi dışa aktar',
    hint: 'Tüm verilerinin bir kopyasını indir',
    icon: 'shield-check',
  },
  {
    key: 'delete',
    label: 'Hesabımı sil',
    hint: 'Hesabını ve tüm verilerini kalıcı olarak kaldır',
    icon: 'logout',
    destructive: true,
  },
];

/** Each activity metric gets the icon of the thing it counts. */
const METRIC_ICONS: Readonly<Record<'sessions' | 'minutes' | 'xp', IconName>> = {
  sessions: 'check-circle-filled',
  minutes: 'clock',
  xp: 'xp-bolt-filled',
};

/** The colour each activity metric is counted in, matching its badge above. */
const METRIC_COLORS: Readonly<Record<'sessions' | 'minutes' | 'xp', string>> = {
  sessions: colors.success,
  minutes: colors.accent,
  xp: colors.xp,
};

export default function ProfileScreen(): React.JSX.Element {
  const [period, setPeriod] = useState<StatsPeriod>('week');
  const [pendingSetting, setPendingSetting] = useState<string | null>(null);

  /**
   * The gear in the hero scrolls to the settings card rather than opening a screen.
   *
   * Settings live at the bottom of a long page, and the comp puts a gear at the top —
   * so the affordance has to lead somewhere. Recording the card's offset as it lays
   * out is what makes that possible without a second route; the guard means a press
   * before layout does nothing instead of jumping to zero.
   */
  const scrollRef = useRef<ScrollView>(null);
  const bodyOffset = useRef(0);
  const settingsOffset = useRef<number | null>(null);
  const goToSettings = useCallback((): void => {
    const y = settingsOffset.current;
    if (y === null) return;
    void Haptics.selectionAsync();
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
  }, []);

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
        <Icon name="cloud-off" size={48} color={colors.textOnDarkMuted} />
        <Text style={styles.errorTitle}>Profil açılamadı</Text>
        <Text style={styles.errorBody}>{describeError(profileQuery.error)}</Text>
        <Button
          label="Tekrar dene"
          tone="neutral"
          block={false}
          onPress={() => void profileQuery.refetch()}
          accessibilityLabel="Profili yeniden yükle"
        />
      </SafeAreaView>
    );
  }

  const displayName = user.displayName?.trim() || user.username;
  const statTotal = STAT_ORDER.reduce((sum, stat) => sum + stats[stat], 0);

  return (
    <View style={styles.screen}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* ------------------------------------------ character card, on the hero */}
        <ScreenHero
          image="profile"
          title={displayName}
          subtitle={describeClass(user.classType)}
          grows
          action={
            <Pressable
              onPress={goToSettings}
              hitSlop={spacing.sm}
              accessibilityRole="button"
              accessibilityLabel="Ayarlar"
              style={({ pressed }) => [styles.gearButton, pressed && styles.gearPressed]}
            >
              <Icon name="settings" size={ICON_SIZE + 4} color={colors.textOnDark} />
            </Pressable>
          }
        >
          {/*
            The uploaded photo, when there is one. The comp has no avatar disc — the
            illustration is the character — so showing an initials circle there would
            add a placeholder the design never asked for. A real photo is different:
            it is the user's own choice and has to appear somewhere on their profile.
          */}
          {(user.avatarUrl !== null || user.prestige > 0) && (
            <View style={styles.heroChips}>
              {user.avatarUrl !== null && <Avatar url={user.avatarUrl} name={displayName} />}
              {user.prestige > 0 && (
                <View style={styles.prestigeChip}>
                  <Icon name="trophy" size={ICON_SIZE - 6} color={colors.textOnAccent} />
                  <Text style={styles.prestigeChipText}>{user.prestige}. yükseliş</Text>
                </View>
              )}
            </View>
          )}

          {/*
            Level and counter sit on one line with the bar between them, as the comp
            has it. The counter is pulled out of XpBar and set beside the track in
            light ink rather than printed on a parchment strip: over an illustration a
            pale panel reads as a patch taped to the artwork, and the whole point of
            the hero is that the character and the progress are one object.
          */}
          <View style={styles.heroProgress}>
            <Text style={styles.heroLevel}>Seviye {progress.level}</Text>
            <XpBar
              ratio={progress.ratio}
              level={progress.level}
              xpIntoLevel={progress.xpIntoLevel}
              xpForNextLevel={progress.isMaxLevel ? 0 : progress.xpForNextLevel}
              compact
              onDark
            />
          </View>

          {/* ------------------------------------------------- standing at a glance */}
          <Animated.View entering={FadeInDown.duration(320)} style={styles.badgeRow}>
            <StandingBadge
              icon="flame-filled"
              tint={colors.fire}
              value={`${summary?.currentStreak ?? 0}`}
              label="Gün Serisi"
            />
            <StandingBadge
              icon="xp-bolt-filled"
              tint={colors.xp}
              value={`${user.cycleXp}`}
              label="XP"
            />
            <StandingBadge
              icon="star-filled"
              tint={colors.gold}
              value={`${statTotal}`}
              label="Puan"
            />
          </Animated.View>
        </ScreenHero>

        <View
          style={styles.body}
          onLayout={(event) => {
            bodyOffset.current = event.nativeEvent.layout.y;
          }}
        >
          {user.bio ? (
            <View style={styles.card}>
              <Text style={styles.bio}>{user.bio}</Text>
            </View>
          ) : null}

          {/* ------------------------------------------------------ stat sheet */}
          <StatRadar stats={stats} />

          {/* --------------------------------------------------- activity summary */}
          <View style={styles.card}>
            <View style={styles.headerRow}>
              <Text style={styles.sectionTitle}>Etkinlik</Text>

              {/*
                Left as hand-built Pressables rather than ChipButton: a segmented
                control has to report `accessibilityState.selected` so a screen reader
                says which period is active, and the chip component takes no such prop.
              */}
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
                <Button
                  label="Tekrar dene"
                  tone="neutral"
                  size="small"
                  block={false}
                  onPress={() => void statsQuery.refetch()}
                  accessibilityLabel="Etkinlik özetini yeniden yükle"
                />
              </View>
            ) : summary && (summary.sessionCount ?? 0) > 0 ? (
              <View style={styles.metrics}>
                <Metric
                  icon={METRIC_ICONS.sessions}
                  tint={METRIC_COLORS.sessions}
                  label="Seans"
                  value={`${summary.sessionCount ?? 0}`}
                />
                <Metric
                  icon={METRIC_ICONS.minutes}
                  tint={METRIC_COLORS.minutes}
                  label="Süre"
                  value={formatMinutes(summary.totalMinutes ?? 0)}
                />
                <Metric
                  icon={METRIC_ICONS.xp}
                  tint={METRIC_COLORS.xp}
                  label="XP"
                  value={`${summary.totalXp ?? 0}`}
                />
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
              <Button
                label="Tekrar dene"
                tone="neutral"
                size="small"
                block={false}
                onPress={() => void achievementsQuery.refetch()}
                accessibilityLabel="Rozetleri yeniden yükle"
              />
            </View>
          ) : (
            <AchievementShelf achievements={achievements} />
          )}

          {/* ------------------------------------------------------- settings */}
          {/* `y` here is relative to `body`, whose own offset is added on read — the
              gear needs a content-space coordinate, not a sibling-space one. */}
          <View
            style={styles.card}
            onLayout={(event) => {
              settingsOffset.current = bodyOffset.current + event.nativeEvent.layout.y;
            }}
          >
            <Text style={styles.sectionTitle}>Ayarlar</Text>

            <View style={styles.settingsList}>
              {SETTINGS_ENTRIES.map((entry) => (
                <Pressable
                  key={entry.key}
                  style={({ pressed }) => [styles.settingRow, pressed && styles.settingRowPressed]}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setPendingSetting(entry.key);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.label}. ${entry.hint}`}
                >
                  <View style={[styles.settingIcon, entry.destructive && styles.settingIconDanger]}>
                    <Icon
                      name={entry.icon}
                      size={ICON_SIZE}
                      color={entry.destructive ? colors.danger : colors.textMuted}
                    />
                  </View>
                  <View style={styles.settingText}>
                    <Text style={[styles.settingLabel, entry.destructive && styles.destructive]}>
                      {entry.label}
                    </Text>
                    <Text style={styles.settingHint}>{entry.hint}</Text>
                  </View>
                    <Icon name="chevron-right" size={ICON_SIZE} color={colors.textFaint} />
                </Pressable>
              ))}
            </View>

            {/*
              Placeholder screens are not built yet, but the entries must be visible and
              tappable — data export and account deletion are store requirements. Saying
              so plainly beats a dead tap that looks like a bug.
            */}
            {pendingSetting !== null && (
              <Animated.View entering={FadeInDown.duration(200)} style={styles.placeholderNotice}>
                  <Icon name="alert" size={ICON_SIZE} color={colors.fireDark} />
                <Text style={styles.placeholderNoticeText}>
                  Bu ekran henüz hazır değil. Yakında burada açılacak.
                </Text>
              </Animated.View>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
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

/**
 * One of the three dark badges under the hero.
 *
 * Stone rather than parchment, because these are what the user *is* rather than
 * what they recorded — the same distinction the season banner makes on the battle
 * screen. The figure leads and the word beneath it is demoted to an overline.
 */
function StandingBadge({
  icon,
  tint,
  value,
  label,
}: {
  readonly icon: IconName;
  readonly tint: string;
  readonly value: string;
  readonly label: string;
}): React.JSX.Element {
  return (
    <View
      style={styles.standingBadge}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${label}: ${value}`}
    >
      <Icon name={icon} size={ICON_SIZE} color={tint} />
      <Text style={styles.standingValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.standingLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Metric({
  icon,
  tint,
  label,
  value,
}: {
  icon: IconName;
  tint: string;
  label: string;
  value: string;
}): React.JSX.Element {
  return (
    <View style={styles.metric} accessible accessibilityRole="text" accessibilityLabel={`${label}: ${value}`}>
      <Icon name={icon} size={ICON_SIZE} color={tint} />
      {/* Two lines allowed: at display size a long duration ("12 sa 30 dk") wraps to
          "12 sa / 30 dk", which still reads as one figure. Clipping it would not. */}
      <Text style={styles.metricValue} numberOfLines={2}>
        {value}
      </Text>
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

const AVATAR_SIZE = 52;
/** Matches the 2px outline this language uses everywhere else. */
const AVATAR_BORDER = 2;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  // The hero runs edge to edge, so only the content below it is inset.
  content: { paddingBottom: spacing.xxl },
  body: { padding: spacing.md, gap: spacing.md },
  centered: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },

  card: { ...cardStyle, gap: spacing.md },

  // ------------------------------------------------------------ hero identity
  // The gear is a plain glyph on the illustration rather than a filled button: at the
  // top right of a scrim it already has contrast, and a solid chip there would compete
  // with the name it sits beside.
  gearButton: { padding: spacing.xs },
  gearPressed: { opacity: 0.6 },

  heroChips: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },
  prestigeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.xp,
  },
  prestigeChipText: { ...type.caption, color: colors.textOnAccent },

  heroProgress: { gap: spacing.xs },
  heroLevel: { ...type.heading, color: colors.textOnDark },

  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    // Gold, because on the illustration a warm grey ring would read as a smudge.
    borderWidth: AVATAR_BORDER + 1,
    borderColor: colors.gold,
  },
  avatarFallback: { alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { ...type.title, color: colors.textMuted },

  bio: { ...type.body, color: colors.textMuted, lineHeight: 21 },

  // -------------------------------------------------------- standing badges
  badgeRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  standingBadge: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    // Softer than a card's corner: these now sit inside the hero, and the comp reads
    // them as rounded tokens on the scene rather than three small panels.
    borderRadius: radius.lg,
    backgroundColor: colors.stone,
    borderWidth: 2,
    borderColor: colors.frame,
  },
  standingValue: { ...type.title, color: colors.textOnDark, fontVariant: ['tabular-nums'] },
  standingLabel: {
    ...type.overline,
    color: colors.textOnDarkMuted,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: { ...type.heading, color: colors.text },

  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.pill,
    padding: 2,
  },
  segment: { paddingHorizontal: spacing.sm + 2, paddingVertical: 5, borderRadius: radius.pill },
  segmentSelected: { backgroundColor: colors.accent },
  segmentText: { ...type.label, color: colors.textMuted },
  segmentTextSelected: { color: colors.textOnAccent },

  metrics: { flexDirection: 'row', gap: spacing.sm },
  metric: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 2,
    borderColor: colors.border,
  },
  // The figure is the point of the tile, so it is set at display size.
  metricValue: { ...type.display, color: colors.text, textAlign: 'center' },
  metricLabel: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },

  settingsList: { gap: spacing.xs },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  settingRowPressed: { backgroundColor: colors.surfaceRaised },
  settingIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingIconDanger: { backgroundColor: colors.dangerSoft },
  settingText: { flex: 1, gap: 1 },
  settingLabel: { ...type.body, color: colors.text },
  settingHint: { ...type.caption, color: colors.textFaint },
  destructive: { color: colors.danger },

  placeholderNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.fireSoft,
  },
  placeholderNoticeText: { ...type.caption, color: colors.fireDark, flex: 1 },

  inlineSpinner: { alignSelf: 'center', marginVertical: spacing.md },
  inlineError: { gap: spacing.sm, alignItems: 'flex-start' },
  empty: { ...type.body, color: colors.textFaint, lineHeight: 21 },
  mutedBody: { ...type.body, color: colors.textOnDarkMuted, textAlign: 'center' },

  errorTitle: { ...type.heading, color: colors.textOnDark },
  errorBody: { ...type.body, color: colors.textOnDarkMuted, textAlign: 'center' },
});
