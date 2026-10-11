/**
 * Profil — the reader's level and numbers, and the few settings the app has.
 *
 * The character art is still to come (docs/product-v2.md, "Karakter"); until it
 * lands, the level badge and XP bar stand in for it.
 */

import { DAILY_GOAL_OPTIONS } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { deleteAccount, getProfile, PROFILE_KEY, updateProfile, type ProfileUpdate } from '../../src/api/me';
import { useAuth } from '../../src/auth/AuthContext';
import { cardStyle } from '../../src/components/Button';
import { Group } from '../../src/components/Group';
import { Icon } from '../../src/components/Icon';
import { OptionPills } from '../../src/components/OptionPills';
import { ReadingCalendar } from '../../src/components/ReadingCalendar';
import { ScreenHero } from '../../src/components/ScreenHero';
import { XpBar } from '../../src/components/XpBar';
import { confirmDestructive } from '../../src/confirm';
import { toServerLocale, useLanguage, useT, type Lang } from '../../src/i18n';
import { REMINDER_TIMES } from '../../src/push';
import { colors, radius, spacing, type } from '../../src/theme';

const LANGUAGES: readonly Lang[] = ['tr', 'en'];
/** Yearly goals offered: none, one every two months, monthly, two a month, weekly. */
const YEARLY_GOALS: readonly (number | null)[] = [null, 6, 12, 24, 52];
const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = { tr: 'Türkçe', en: 'English' };

export default function ProfileScreen(): React.JSX.Element {
  const t = useT();
  const { signOut } = useAuth();
  const queryClient = useQueryClient();
  const { lang, setLang } = useLanguage();
  const profileQuery = useQuery({ queryKey: PROFILE_KEY, queryFn: getProfile });

  const update = useMutation({
    mutationFn: (change: ProfileUpdate) => updateProfile(change),
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_KEY, profile);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
    },
  });

  const remove = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => void signOut(),
  });

  const profile = profileQuery.data;
  if (!profile) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const { progress, stats, streak, yearly } = profile;

  function changeLanguage(next: Lang): void {
    setLang(next);
    update.mutate({ locale: toServerLocale(next) });
  }

  function confirmDelete(): void {
    confirmDestructive({
      title: t.profile.deleteTitle,
      message: t.profile.deleteBody,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      onConfirm: () => remove.mutate(),
    });
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.scroll}>
      <ScreenHero image="profile" title={profile.displayName} subtitle={t.profile.level(progress.level)} />

      <View style={styles.body}>
        <View style={styles.card}>
          <XpBar
            ratio={progress.ratio}
            level={progress.level}
            xpIntoLevel={progress.xpIntoLevel}
            xpForNextLevel={progress.xpForNextLevel}
          />
          <Text style={styles.caption}>
            {progress.isMaxLevel
              ? t.profile.maxLevel
              : t.profile.xpToNext(progress.xpForNextLevel - progress.xpIntoLevel)}
          </Text>
        </View>

        {yearly.goal !== null ? (
          <View style={styles.card}>
            <Text style={styles.overlineInCard}>{t.yearly.overline(yearly.year)}</Text>
            <Text style={styles.statValue}>{t.yearly.progress(yearly.finished, yearly.goal)}</Text>
            <View style={styles.track}>
              <View
                style={[styles.fill, { width: `${Math.min(100, (yearly.finished / yearly.goal) * 100)}%` }]}
              />
            </View>
          </View>
        ) : null}

        <ReadingCalendar />

        <Text style={styles.overline}>{t.profile.statsOverline}</Text>
        <View style={styles.statsGrid}>
          <Stat label={t.profile.totalPages} value={String(stats.totalPages)} />
          <Stat label={t.profile.booksFinished} value={String(stats.booksFinished)} />
          <Stat label={t.profile.longestStreak} value={t.today.streakDays(streak.longest)} />
          <Stat
            label={t.today.consistency(stats.windowDays)}
            value={t.today.consistencyValue(stats.daysRead, stats.windowDays)}
          />
        </View>

        <Text style={styles.overline}>{t.profile.settingsOverline}</Text>
        <View style={styles.card}>
          <Text style={styles.settingLabel}>{t.profile.dailyGoal}</Text>
          <OptionPills
            options={DAILY_GOAL_OPTIONS}
            value={profile.dailyGoal}
            onChange={(dailyGoal) => update.mutate({ dailyGoal })}
            format={(option) => t.common.pages(option)}
          />
        </View>
        <View style={styles.card}>
          <Text style={styles.settingLabel}>{t.yearly.setting}</Text>
          <OptionPills
            options={YEARLY_GOALS}
            value={yearly.goal}
            onChange={(yearlyBookGoal) => update.mutate({ yearlyBookGoal })}
            format={(option) => (option === null ? t.profile.reminderOff : t.yearly.option(option))}
          />
        </View>
        <View style={styles.card}>
          <Text style={styles.settingLabel}>{t.profile.reminder}</Text>
          <OptionPills
            options={REMINDER_TIMES}
            value={profile.reminderTime}
            onChange={(reminderTime) => update.mutate({ reminderTime })}
            format={(option) => option ?? t.profile.reminderOff}
          />
        </View>
        <View style={styles.card}>
          <Text style={styles.settingLabel}>{t.profile.language}</Text>
          <OptionPills
            options={LANGUAGES}
            value={lang}
            onChange={changeLanguage}
            format={(option) => LANGUAGE_NAMES[option]}
          />
        </View>

        <Group inset={spacing.md}>
          <Row icon="logout" label={t.profile.signOut} onPress={() => void signOut()} />
          <Row icon="alert" label={t.profile.deleteAccount} onPress={confirmDelete} danger />
        </Group>
      </View>
    </ScrollView>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View style={[styles.card, styles.stat]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.caption}>{label}</Text>
    </View>
  );
}

function Row({
  icon,
  label,
  onPress,
  danger = false,
}: {
  icon: 'logout' | 'alert';
  label: string;
  onPress: () => void;
  danger?: boolean;
}): React.JSX.Element {
  const tint = danger ? colors.danger : colors.text;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
    >
      <Icon name={icon} size={20} color={tint} />
      <Text style={[styles.rowLabel, { color: tint }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  card: { ...cardStyle, gap: spacing.sm },
  caption: { ...type.caption, color: colors.textMuted },
  overline: { ...type.overline, color: colors.textFaint, marginTop: spacing.sm },
  overlineInCard: { ...type.overline, color: colors.textFaint },
  track: { height: 10, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.gold },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  stat: { flexBasis: '45%', flexGrow: 1 },
  statValue: { ...type.title, color: colors.text, fontVariant: ['tabular-nums'] },
  settingLabel: { ...type.heading, color: colors.text },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  rowLabel: { ...type.label },
  pressed: { opacity: 0.6 },
});
