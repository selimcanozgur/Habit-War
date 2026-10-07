/**
 * The first-run flow, shown once, before the tabs.
 *
 * A new player has to leave it knowing three things — who they are in this world, how
 * a habit becomes a blow, and what to do right now — and holding a habit list they did
 * not have to invent. So it goes:
 *
 *   1. Işıl      the story's hook: the valley's fire is out, and the player is its spark
 *   2. Name      the hero's name, the first thing that makes the character theirs
 *   3. Rules     habit → one damage a second → monsters fall, XP grows the character
 *   4. Goals     what they want to gain; each goal adds its ready-made habits
 *   5. Fight     the first monster, a five-minute fight, and the habit to fight it with
 *
 * The last step ends the flow either way: "Savaşa başla" goes straight into the fight,
 * "Şimdi değil" to Bugün, where the same fight waits on the mission card. Both mark the
 * profile onboarded, so the flow never shows again — on this device or another.
 */

import { WEAKNESS_DAMAGE_MULTIPLIER } from '@habitwar/domain';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Redirect, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, {
  FadeIn,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApiError } from '../src/api/client';
import {
  completeOnboarding,
  getProfile,
  needsOnboarding,
  updateProfile,
  type ProfileResponse,
} from '../src/api/profile';
import { createHabit, listHabits } from '../src/api/sessions';
import { getStory } from '../src/api/story';
import { useAuth } from '../src/auth/AuthContext';
import { Button } from '../src/components/Button';
import { MonsterEmblem, PlayerEmblem } from '../src/components/Emblems';
import { CATEGORY_ICONS, Icon } from '../src/components/Icon';
import { templateHabitInput } from '../src/habitTemplates';
import { GOALS, MAX_GOALS, templatesForGoals } from '../src/onboarding/goals';
import { chapterContent } from '../src/story/content';
import { fightTimeLabel, localDateKey, rankFighters } from '../src/story/fighters';
import { useStartFight } from '../src/story/useStartFight';
import { colors, radius, spacing, statColors, statLabels, type } from '../src/theme';

const STEPS = 5;
const NAME_MAX = 50;

function describeError(error: unknown): string {
  if (error instanceof ApiError) {
    return error.code === 'NETWORK' ? 'Sunucuya ulaşılamadı. Bağlantını kontrol et.' : error.message;
  }
  return 'Beklenmeyen bir hata oluştu.';
}

export default function OnboardingScreen(): React.JSX.Element {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const profileQuery = useQuery({ queryKey: ['profile'], queryFn: getProfile, enabled: user !== null });
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Decided once, from the first profile that arrives: a player who already finished
  // the flow (another device, an old link) goes home. Not re-read afterwards — this
  // screen marks the profile done itself on the way out.
  const alreadyDone = useRef<boolean | null>(null);
  if (alreadyDone.current === null && profileQuery.data) {
    alreadyDone.current = !needsOnboarding(profileQuery.data);
  }

  const go = (next: number): void => {
    setError(null);
    setStep(next);
  };

  /** Ends the flow; the fight step decides where the player goes next. */
  const finish = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: ({ onboardedAt }) => {
      queryClient.setQueryData<ProfileResponse>(['profile'], (old) =>
        old ? { ...old, user: { ...old.user, onboardedAt } } : old,
      );
    },
  });

  if (!user) return <Redirect href="/(auth)/sign-in" />;
  if (alreadyDone.current === true) return <Redirect href="/" />;

  if (profileQuery.isPending) {
    return (
      <View style={[styles.screen, styles.centered]}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  const currentName =
    profileQuery.data?.user.displayName?.trim() || profileQuery.data?.user.username || user.username;

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <StatusBar style="light" />
      <KeyboardAvoidingView style={styles.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* --------------------------------------------------------- progress */}
        <View style={styles.top}>
          {step > 0 && step < STEPS - 1 ? (
            <Pressable
              onPress={() => go(step - 1)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Geri"
              style={styles.back}
            >
              <Icon name="chevron-left" size={22} color={colors.textOnDarkMuted} />
            </Pressable>
          ) : (
            <View style={styles.back} />
          )}
          <View style={styles.dots} accessibilityLabel={`Adım ${step + 1} / ${STEPS}`}>
            {Array.from({ length: STEPS }, (_, index) => (
              <View key={index} style={[styles.dot, index <= step && styles.dotOn]} />
            ))}
          </View>
          <View style={styles.back} />
        </View>

        <Animated.View key={step} entering={FadeInRight.duration(260)} style={styles.fill}>
          {step === 0 && <WelcomeStep onNext={() => go(1)} />}
          {step === 1 && (
            <NameStep
              initial={currentName}
              onDone={(name) => {
                queryClient.setQueryData<ProfileResponse>(['profile'], (old) =>
                  old ? { ...old, user: { ...old.user, displayName: name } } : old,
                );
                go(2);
              }}
            />
          )}
          {step === 2 && <RulesStep onNext={() => go(3)} />}
          {step === 3 && <GoalsStep onDone={() => go(4)} />}
          {step === 4 && (
            <FightStep
              playerName={currentName}
              finishing={finish.isPending}
              error={error}
              onFight={async (startFight) => {
                setError(null);
                try {
                  await finish.mutateAsync();
                  startFight();
                } catch (err) {
                  setError(describeError(err));
                }
              }}
              onLater={async () => {
                setError(null);
                try {
                  await finish.mutateAsync();
                  router.replace('/');
                } catch (err) {
                  setError(describeError(err));
                }
              }}
              onError={(err) => setError(describeError(err))}
            />
          )}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// 1. Işıl
// ---------------------------------------------------------------------------

function WelcomeStep({ onNext }: { readonly onNext: () => void }): React.JSX.Element {
  const glow = useSharedValue(1);
  useEffect(() => {
    glow.value = withRepeat(withSequence(withTiming(1.12, { duration: 900 }), withTiming(1, { duration: 900 })), -1);
    // `glow` is a stable shared value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const glowStyle = useAnimatedStyle(() => ({ transform: [{ scale: glow.value }] }));

  return (
    <View style={styles.step}>
      <View style={[styles.body, styles.welcome]}>
        <Animated.View style={[styles.isilLarge, glowStyle]}>
          <Icon name="flame-filled" size={56} color={colors.fire} />
        </Animated.View>
        <Text style={styles.overline}>Işıl</Text>
        <Text style={styles.title}>Sonunda geldin!</Text>
        <Text style={styles.text}>
          Ben Işıl, Aydınlık Vadisi&apos;nin son kıvılcımı. Vadinin İrade Ateşi söndü: ertelenen her
          alışkanlıktan bir canavar doğdu ve ateşi yuttu.
        </Text>
        <Text style={styles.text}>
          Onları kılıçla yenemezsin. Ama gerçek hayatta yaptığın her iyi alışkanlık, onlara inen bir
          darbe olur. Ve ateş seni seçti.
        </Text>
      </View>
      <Button label="Maceraya başla" onPress={onNext} accessibilityLabel="Maceraya başla" />
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2. Name
// ---------------------------------------------------------------------------

function NameStep({
  initial,
  onDone,
}: {
  readonly initial: string;
  readonly onDone: (name: string) => void;
}): React.JSX.Element {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();
  const save = useMutation({
    mutationFn: () => updateProfile({ displayName: trimmed }),
    onSuccess: () => onDone(trimmed),
    onError: (err) => setError(describeError(err)),
  });

  const submit = (): void => {
    if (trimmed.length === 0) return setError('Kahramanının bir adı olmalı.');
    // Unchanged: nothing to save.
    if (trimmed === initial) return onDone(trimmed);
    setError(null);
    save.mutate();
  };

  return (
    <ScrollView contentContainerStyle={styles.step} keyboardShouldPersistTaps="handled">
      <View style={styles.body}>
        <View style={styles.isilSmall}>
          <Icon name="flame-filled" size={28} color={colors.fire} />
        </View>
        <Text style={styles.title}>Kahramanına ne diyelim?</Text>
        <Text style={styles.text}>Vadi halkı seni bu adla tanıyacak. Sonra profilinden değiştirebilirsin.</Text>
        <TextInput
          value={name}
          onChangeText={(value) => {
            setName(value);
            setError(null);
          }}
          maxLength={NAME_MAX}
          autoFocus
          autoCapitalize="words"
          returnKeyType="done"
          onSubmitEditing={submit}
          placeholder="Adın"
          placeholderTextColor={colors.textOnDarkMuted}
          style={styles.input}
          accessibilityLabel="Kahramanının adı"
        />
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>
      <Button label="Devam" loading={save.isPending} onPress={submit} accessibilityLabel="Adı kaydet ve devam et" />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// 3. Rules
// ---------------------------------------------------------------------------

const RULES = [
  {
    icon: 'play-filled' as const,
    title: 'Bir alışkanlık başlat',
    text: 'Spor, kitap, meditasyon… Gerçek hayatta ne yapıyorsan sayacını başlat.',
  },
  {
    icon: 'swords' as const,
    title: 'Her saniye 1 hasar',
    text: `Sayaç işledikçe canavarın canı erir. Zayıf noktasına uygun alışkanlık ×${WEAKNESS_DAMAGE_MULTIPLIER} vurur.`,
  },
  {
    icon: 'trophy' as const,
    title: 'Yen, ilerle, güçlen',
    text: 'Canavarlar düştükçe hikaye ilerler. Kazandığın XP de karakterini büyütür.',
  },
];

function RulesStep({ onNext }: { readonly onNext: () => void }): React.JSX.Element {
  return (
    <ScrollView contentContainerStyle={styles.step}>
      <View style={styles.body}>
        <Text style={styles.title}>Nasıl savaşılır?</Text>
        <View style={styles.rules}>
          {RULES.map((rule, index) => (
            <Animated.View key={rule.title} entering={FadeIn.delay(120 * index).duration(300)} style={styles.rule}>
              <View style={styles.ruleIcon}>
                <Icon name={rule.icon} size={22} color={colors.gold} />
              </View>
              <View style={styles.ruleText}>
                <Text style={styles.ruleTitle}>{rule.title}</Text>
                <Text style={styles.ruleBody}>{rule.text}</Text>
              </View>
            </Animated.View>
          ))}
        </View>
        <View style={styles.note}>
          <Icon name="alert" size={18} color={colors.fire} />
          <Text style={styles.noteText}>
            Savaş sürerken uygulamadan çıkarsan canavar karşı saldırır ve odağın düşer. Hasarın gitmez,
            ama odak bonusu azalır.
          </Text>
        </View>
      </View>
      <Button label="Anladım" onPress={onNext} accessibilityLabel="Anladım, devam et" />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// 4. Goals
// ---------------------------------------------------------------------------

function GoalsStep({ onDone }: { readonly onDone: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const [picked, setPicked] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const templates = useMemo(() => templatesForGoals(picked), [picked]);

  const toggle = (key: string): void => {
    void Haptics.selectionAsync();
    setError(null);
    setPicked((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : current.length >= MAX_GOALS
          ? current
          : [...current, key],
    );
  };

  // Habits the player already has (a second pass through the flow, or a retry after
  // a dropped request) are not added twice.
  const create = useMutation({
    mutationFn: async () => {
      const { habits } = await queryClient.fetchQuery({ queryKey: ['habits'], queryFn: listHabits, staleTime: 0 });
      const owned = new Set(habits.map((habit) => habit.name.toLocaleLowerCase('tr-TR')));
      for (const template of templates) {
        if (owned.has(template.name.toLocaleLowerCase('tr-TR'))) continue;
        await createHabit(templateHabitInput(template));
      }
    },
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onDone();
    },
    onError: (err) => setError(describeError(err)),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['habits'] }),
  });

  return (
    <ScrollView contentContainerStyle={styles.step}>
      <View style={styles.body}>
        <Text style={styles.title}>Ne kazanmak istiyorsun?</Text>
        <Text style={styles.text}>
          En fazla {MAX_GOALS} tane seç. Alışkanlıklarını senin için hazırlayalım.
        </Text>
        <View style={styles.goals}>
          {GOALS.map((goal) => {
            const on = picked.includes(goal.key);
            const full = !on && picked.length >= MAX_GOALS;
            return (
              <Pressable
                key={goal.key}
                onPress={() => toggle(goal.key)}
                disabled={full}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: full }}
                accessibilityLabel={goal.label}
                style={({ pressed }) => [
                  styles.goal,
                  on && { borderColor: statColors[goal.stat], backgroundColor: 'rgba(255, 255, 255, 0.14)' },
                  full && styles.goalFull,
                  pressed && styles.pressed,
                ]}
              >
                <View style={[styles.goalIcon, { backgroundColor: statColors[goal.stat] }]}>
                  <Icon name={goal.icon} size={18} color={colors.textOnAccent} />
                </View>
                <Text style={styles.goalLabel} numberOfLines={2}>
                  {goal.label}
                </Text>
                {on && (
                  <View style={styles.goalCheck}>
                    <Icon name="check-circle-filled" size={18} color={colors.gold} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {templates.length > 0 && (
          <Animated.View entering={FadeIn.duration(200)} style={styles.adding}>
            <Text style={styles.addingTitle}>Listene eklenecek</Text>
            {templates.map((template) => (
              <View key={template.key} style={styles.addingRow}>
                <Icon name={CATEGORY_ICONS[template.category] ?? 'play'} size={16} color={colors.textOnDarkMuted} />
                <Text style={styles.addingName}>{template.name}</Text>
                <Text style={styles.addingMeta}>
                  {template.kind === 'COUNT'
                    ? `günde ${template.targetCount} ${template.unit}`
                    : `${template.targetMinutes} dk`}
                </Text>
              </View>
            ))}
          </Animated.View>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>
      <Button
        label={picked.length === 0 ? 'En az birini seç' : 'Devam'}
        disabled={picked.length === 0}
        loading={create.isPending}
        onPress={() => create.mutate()}
        accessibilityLabel="Alışkanlıkları ekle ve devam et"
      />
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// 5. The first fight
// ---------------------------------------------------------------------------

function FightStep({
  playerName,
  finishing,
  error,
  onFight,
  onLater,
  onError,
}: {
  readonly playerName: string;
  readonly finishing: boolean;
  readonly error: string | null;
  /** Marks the flow done, then calls `startFight`. */
  readonly onFight: (startFight: () => void) => void;
  readonly onLater: () => void;
  readonly onError: (error: unknown) => void;
}): React.JSX.Element {
  const storyQuery = useQuery({ queryKey: ['story'], queryFn: getStory });
  const habitsQuery = useQuery({ queryKey: ['habits'], queryFn: listHabits });
  const start = useStartFight(onError);
  const fight = storyQuery.data?.story.current ?? null;
  const fighters = useMemo(
    () => rankFighters(habitsQuery.data?.habits ?? [], fight?.weakness ?? null, localDateKey(new Date())),
    [habitsQuery.data, fight?.weakness],
  );
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = fighters.find((item) => item.habit.id === chosen) ?? fighters[0] ?? null;

  if (!fight || habitsQuery.isPending) {
    return (
      <View style={[styles.step, styles.centered]}>
        {storyQuery.isError || habitsQuery.isError ? (
          <>
            <Text style={styles.text}>Bağlanılamadı.</Text>
            <Button label="Bugün'e geç" tone="neutral" onPress={onLater} accessibilityLabel="Bugün ekranına geç" />
          </>
        ) : (
          <ActivityIndicator color={colors.gold} />
        )}
      </View>
    );
  }

  const busy = finishing || start.isPending;

  return (
    <ScrollView contentContainerStyle={styles.step}>
      <View style={styles.body}>
        <Text style={styles.overline}>
          Bölüm {fight.chapter} · {chapterContent(fight.chapter).region}
        </Text>
        <Text style={styles.title}>İlk savaşın seni bekliyor</Text>

        <View style={styles.arena}>
          <View style={styles.side}>
            <PlayerEmblem size={64} />
            <Text style={styles.sideName} numberOfLines={1}>
              {playerName}
            </Text>
          </View>
          <Text style={styles.vs}>VS</Text>
          <View style={styles.side}>
            <MonsterEmblem monsterKey={fight.monsterKey} size={64} onDark />
            <Text style={styles.sideName} numberOfLines={2}>
              {fight.name}
            </Text>
            <View style={styles.hpTrack}>
              <View style={[styles.hpFill, { width: `${(fight.hp / fight.maxHp) * 100}%` }]} />
            </View>
            <Text style={styles.sideMeta}>{fight.hp} can</Text>
          </View>
        </View>

        <View style={styles.speech}>
          <Icon name="flame-filled" size={18} color={colors.fire} />
          <Text style={styles.speechText}>
            {fight.name} köyü sarmış. {fight.hp} canı var, yani{' '}
            {selected ? fightTimeLabel(fight.hp, selected.rate) : fightTimeLabel(fight.hp, 1)} çalışman onu yener.
            Zayıf noktası {statLabels[fight.weakness]}: bu tür alışkanlıklar ×{WEAKNESS_DAMAGE_MULTIPLIER} vurur.
          </Text>
        </View>

        {fighters.length > 0 && (
          <View style={styles.choices}>
            <Text style={styles.addingTitle}>Hangi alışkanlıkla savaşacaksın?</Text>
            {fighters.slice(0, 4).map((item) => {
              const on = selected?.habit.id === item.habit.id;
              return (
                <Pressable
                  key={item.habit.id}
                  onPress={() => setChosen(item.habit.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={`${item.habit.name}${item.weak ? ', zayıf noktasına vurur' : ''}`}
                  style={[styles.choice, on && styles.choiceOn]}
                >
                  <Icon
                    name={on ? 'check-circle-filled' : 'check-circle'}
                    size={20}
                    color={on ? colors.gold : colors.textOnDarkMuted}
                  />
                  <Text style={styles.choiceName} numberOfLines={1}>
                    {item.habit.name}
                  </Text>
                  {item.weak && (
                    <Text style={[styles.choiceWeak, { color: statColors[fight.weakness] }]}>
                      ×{WEAKNESS_DAMAGE_MULTIPLIER}
                    </Text>
                  )}
                  <Text style={styles.choiceMeta}>{fightTimeLabel(fight.hp, item.rate)}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {error !== null && <Text style={styles.error}>{error}</Text>}
      </View>

      <View style={styles.actions}>
        {selected ? (
          <>
            <Button
              label={`${selected.habit.name} ile savaşa başla`}
              loading={busy}
              onPress={() => onFight(() => start.mutate(selected.habit.id))}
              accessibilityLabel={`${selected.habit.name} ile savaşa başla`}
            />
            <Pressable
              disabled={busy}
              onPress={onLater}
              accessibilityRole="button"
              style={({ pressed }) => [styles.later, pressed && styles.pressed]}
            >
              <Text style={styles.laterText}>Şimdi değil, önce etrafa bakayım</Text>
            </Pressable>
          </>
        ) : (
          // No timed habit to fight with: Bugün's catalog is where one is added.
          <Button label="Bugün'e geç" loading={busy} onPress={onLater} accessibilityLabel="Bugün ekranına geç" />
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.stone },
  fill: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center', gap: spacing.md },
  pressed: { opacity: 0.7 },

  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  back: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 22, height: 4, borderRadius: radius.pill, backgroundColor: 'rgba(255, 255, 255, 0.18)' },
  dotOn: { backgroundColor: colors.gold },

  step: { flexGrow: 1, padding: spacing.lg, gap: spacing.lg, justifyContent: 'space-between' },
  body: { gap: spacing.md, flexShrink: 1 },
  welcome: { flex: 1, justifyContent: 'center' },
  overline: { ...type.overline, color: colors.gold, textTransform: 'uppercase' },
  title: { ...type.hero, color: colors.textOnDark },
  text: { ...type.body, color: colors.textOnDarkMuted, lineHeight: 22 },
  error: { ...type.label, color: colors.danger },

  isilLarge: {
    width: 104,
    height: 104,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  isilSmall: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },

  input: {
    ...type.title,
    color: colors.textOnDark,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
  },

  rules: { gap: spacing.md, marginTop: spacing.sm },
  rule: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  ruleIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ruleText: { flex: 1, gap: 2 },
  ruleTitle: { ...type.heading, color: colors.textOnDark },
  ruleBody: { ...type.body, color: colors.textOnDarkMuted, lineHeight: 21 },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginTop: spacing.sm,
  },
  noteText: { ...type.caption, color: colors.textOnDarkMuted, flex: 1, lineHeight: 18 },

  goals: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  goal: {
    width: '48%',
    flexGrow: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  goalFull: { opacity: 0.4 },
  goalIcon: { width: 32, height: 32, borderRadius: radius.sm + 2, alignItems: 'center', justifyContent: 'center' },
  goalLabel: { ...type.label, color: colors.textOnDark, flex: 1 },
  goalCheck: { position: 'absolute', top: 4, right: 4 },

  adding: { gap: spacing.xs, padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(255, 255, 255, 0.06)' },
  addingTitle: { ...type.overline, color: colors.textOnDarkMuted, textTransform: 'uppercase', marginBottom: 2 },
  addingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  addingName: { ...type.label, color: colors.textOnDark, flex: 1 },
  addingMeta: { ...type.caption, color: colors.textOnDarkMuted },

  arena: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
  },
  side: { flex: 1, alignItems: 'center', gap: spacing.xs },
  sideName: { ...type.heading, color: colors.textOnDark, textAlign: 'center' },
  sideMeta: { ...type.caption, color: colors.textOnDarkMuted },
  vs: { fontFamily: 'Nunito_800ExtraBold', fontSize: 28, color: colors.gold, marginTop: 18 },
  hpTrack: {
    alignSelf: 'stretch',
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  hpFill: { height: '100%', borderRadius: radius.pill, backgroundColor: colors.danger },

  speech: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  speechText: { ...type.body, color: colors.textOnDark, flex: 1, lineHeight: 22 },

  choices: { gap: spacing.xs },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm + 4,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: 'rgba(255, 255, 255, 0.07)',
  },
  choiceOn: { borderColor: colors.gold },
  choiceName: { ...type.label, color: colors.textOnDark, flex: 1 },
  choiceWeak: { ...type.label, fontFamily: 'Nunito_800ExtraBold' },
  choiceMeta: { ...type.caption, color: colors.textOnDarkMuted, fontVariant: ['tabular-nums'] },

  actions: { gap: spacing.xs },
  later: { alignSelf: 'center', paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  laterText: { ...type.label, color: colors.textOnDarkMuted },
});
