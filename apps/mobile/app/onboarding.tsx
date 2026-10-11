/**
 * First-run flow: language, daily goal, reminder time, first book.
 *
 * Each step sets up one of the few things the research says matters: a goal small
 * enough to keep, a cue tied to an existing routine, and something concrete to read.
 * Nothing is saved until the last step, so backing out leaves no half-made account.
 */

import { DAILY_GOAL_OPTIONS, DEFAULT_DAILY_GOAL, MAX_BOOK_PAGES } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import { completeOnboarding, deviceTimezone, getProfile, PROFILE_KEY } from '../src/api/me';
import { useAuth } from '../src/auth/AuthContext';
import { Button } from '../src/components/Button';
import { FormField } from '../src/components/FormField';
import { OptionPills } from '../src/components/OptionPills';
import { toServerLocale, useLanguage, useT, type Lang } from '../src/i18n';
import { REMINDER_TIMES } from '../src/push';
import { colors, spacing, type } from '../src/theme';

type Step = 'welcome' | 'goal' | 'reminder' | 'book';
const STEPS: readonly Step[] = ['welcome', 'goal', 'reminder', 'book'];

const LANGUAGES: readonly Lang[] = ['tr', 'en'];
const LANGUAGE_NAMES: Readonly<Record<Lang, string>> = { tr: 'Türkçe', en: 'English' };

/** Evening, when most people read; the reader can pick another time or none. */
const DEFAULT_REMINDER = '21:00';

export default function OnboardingScreen(): React.JSX.Element {
  const t = useT();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { lang, setLang } = useLanguage();
  const profileQuery = useQuery({ queryKey: PROFILE_KEY, queryFn: getProfile, enabled: user !== null });

  const [step, setStep] = useState<Step>('welcome');
  const [dailyGoal, setDailyGoal] = useState(DEFAULT_DAILY_GOAL);
  const [reminderTime, setReminderTime] = useState<string | null>(DEFAULT_REMINDER);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [pages, setPages] = useState('');
  const [titleError, setTitleError] = useState('');
  const [pagesError, setPagesError] = useState('');
  const [generalError, setGeneralError] = useState('');

  const finish = useMutation({
    mutationFn: (withBook: boolean) =>
      completeOnboarding({
        timezone: deviceTimezone(),
        locale: toServerLocale(lang),
        dailyGoal,
        reminderTime,
        ...(withBook
          ? {
              firstBook: {
                title: title.trim(),
                author: author.trim() || null,
                pageCount: Number.parseInt(pages, 10),
              },
            }
          : {}),
      }),
    onSuccess: (profile) => {
      queryClient.setQueryData(PROFILE_KEY, profile);
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void queryClient.invalidateQueries({ queryKey: ['books'] });
      router.replace('/');
    },
    onError: (failure) => {
      // Already onboarded on another device: the account is ready, so is the app.
      if (failure instanceof ApiError && failure.code === 'CONFLICT') {
        void queryClient.invalidateQueries({ queryKey: PROFILE_KEY });
        router.replace('/');
        return;
      }
      setGeneralError(
        failure instanceof ApiError && failure.code === 'NETWORK'
          ? t.common.networkError
          : t.common.genericError,
      );
    },
  });

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (profileQuery.data?.onboarded) return <Redirect href="/" />;

  const index = STEPS.indexOf(step);
  const next = (): void => setStep(STEPS[index + 1] ?? step);
  const back = (): void => setStep(STEPS[index - 1] ?? step);

  function submitWithBook(): void {
    const pageCount = Number.parseInt(pages, 10);
    let ok = true;
    if (title.trim() === '') {
      setTitleError(t.bookForm.titleRequired);
      ok = false;
    }
    if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > MAX_BOOK_PAGES) {
      setPagesError(t.bookForm.pagesInvalid(MAX_BOOK_PAGES));
      ok = false;
    }
    if (ok) finish.mutate(true);
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="dark" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.dots}>
          {STEPS.map((dot, dotIndex) => (
            <View key={dot} style={[styles.dot, dotIndex <= index && styles.dotActive]} />
          ))}
        </View>

        {step === 'welcome' ? (
          <>
            <Text style={styles.title}>{t.onboarding.welcomeTitle}</Text>
            <Text style={styles.body}>{t.onboarding.welcomeBody}</Text>
            <OptionPills
              options={LANGUAGES}
              value={lang}
              onChange={setLang}
              format={(option) => LANGUAGE_NAMES[option]}
            />
            <Button label={t.onboarding.start} onPress={next} />
          </>
        ) : null}

        {step === 'goal' ? (
          <>
            <Text style={styles.title}>{t.onboarding.goalTitle}</Text>
            <Text style={styles.body}>{t.onboarding.goalBody}</Text>
            <OptionPills
              options={DAILY_GOAL_OPTIONS}
              value={dailyGoal}
              onChange={setDailyGoal}
              format={(option) => t.common.pages(option)}
            />
            <Text style={styles.hint}>{t.onboarding.goalHint}</Text>
            <Button label={t.common.continue} onPress={next} />
            <Button label={t.common.back} tone="neutral" onPress={back} />
          </>
        ) : null}

        {step === 'reminder' ? (
          <>
            <Text style={styles.title}>{t.onboarding.reminderTitle}</Text>
            <Text style={styles.body}>{t.onboarding.reminderBody}</Text>
            <OptionPills
              options={REMINDER_TIMES}
              value={reminderTime}
              onChange={setReminderTime}
              format={(option) => option ?? t.profile.reminderOff}
            />
            <Button label={t.common.continue} onPress={next} />
            <Button label={t.common.back} tone="neutral" onPress={back} />
          </>
        ) : null}

        {step === 'book' ? (
          <>
            <Text style={styles.title}>{t.onboarding.bookTitle}</Text>
            <Text style={styles.body}>{t.onboarding.bookBody}</Text>
            <FormField
              label={t.bookForm.titleLabel}
              value={title}
              onChangeText={(value) => {
                setTitle(value);
                setTitleError('');
              }}
              error={titleError}
              maxLength={200}
              autoCorrect
            />
            <FormField
              label={t.bookForm.authorLabel}
              value={author}
              onChangeText={setAuthor}
              maxLength={200}
              autoCorrect
            />
            <FormField
              label={t.bookForm.pagesLabel}
              value={pages}
              onChangeText={(value) => {
                setPages(value.replace(/[^0-9]/g, ''));
                setPagesError('');
              }}
              error={pagesError || generalError}
              keyboardType="number-pad"
              maxLength={4}
            />
            <Button label={t.onboarding.finish} onPress={submitWithBook} loading={finish.isPending} />
            <Button
              label={t.onboarding.skip}
              tone="neutral"
              onPress={() => finish.mutate(false)}
              disabled={finish.isPending}
            />
            <Button label={t.common.back} tone="neutral" onPress={back} disabled={finish.isPending} />
          </>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.md, flexGrow: 1, justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.md },
  dot: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.surfaceSunken },
  dotActive: { backgroundColor: colors.accent },
  title: { ...type.title, fontSize: 26, color: colors.text },
  body: { ...type.body, color: colors.textMuted, lineHeight: 22 },
  hint: { ...type.caption, color: colors.textFaint },
});
