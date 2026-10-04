/**
 * The add sheet on the Bugün screen, with two ways in.
 *
 *  - Tek başına: a habit of one's own — a name, a category and a daily target. The
 *    stat a habit trains is derived from its category on the server, so asking for
 *    it here would be a question the user cannot answer yet.
 *  - Düello: the same commitment made against a friend, through the shared
 *    `DuelComposer`, so it is the battle screen's form and not a second copy of it.
 *
 * A segmented control switches between them, as the system does for two views of one
 * task. Inline rather than a separate screen: it opens where the habit list is, and a
 * new habit appears in that list the moment it is saved.
 */

import { CATEGORY_DEFAULT_STAT, COUNT_TARGET_MINUTES, type Category } from '@habitwar/domain';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';

import { ApiError } from '../api/client';
import { createHabit } from '../api/sessions';
import { colors, radius, spacing, type } from '../theme';
import { Button, cardStyle } from './Button';
import { CategoryPicker, OptionPills } from './CategoryPicker';
import { DuelComposer } from './DuelComposer';
import { FEATURES } from '../features';
import { COUNT_UNITS } from '../countUnits';
import { FormField } from './FormField';
import { TemplatePicker } from './TemplatePicker';
import { Icon } from './Icon';

type Mode = 'solo' | 'duel';

const MODES: readonly { readonly value: Mode; readonly label: string }[] = [
  { value: 'solo', label: 'Tek başına' },
  { value: 'duel', label: 'Düello' },
];

/** Common session lengths. One tap each; the API accepts 1–480. */
const DURATIONS: readonly number[] = [10, 15, 30, 45, 60, 90];

const NAME_MAX = 80;
const ICON_SIZE = 18;

export interface NewHabitSheetProps {
  readonly onClose: () => void;
  /** Pre-selects a category, e.g. when a duel sends the user here to add one. */
  readonly initialCategory?: Category | null;
}

export function NewHabitSheet({
  onClose,
  initialCategory = null,
}: NewHabitSheetProps): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('solo');
  // The catalog leads; the custom form is one tap behind it.
  const [custom, setCustom] = useState(false);
  const [duelSent, setDuelSent] = useState(false);

  return (
    <Animated.View entering={FadeInDown.duration(240)} style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>{mode === 'solo' ? 'Yeni alışkanlık' : 'Yeni düello'}</Text>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Kapat"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Icon name="x" size={ICON_SIZE} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* With duels switched off the sheet is the solo form alone, no switcher. */}
      {FEATURES.duels && !duelSent && (
        <View style={styles.segmented} accessibilityRole="tablist">
          {MODES.map((item) => {
            const selected = item.value === mode;
            return (
              <Pressable
                key={item.value}
                onPress={() => {
                  if (selected) return;
                  void Haptics.selectionAsync();
                  setMode(item.value);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={item.label}
                style={[styles.segment, selected && styles.segmentSelected]}
              >
                <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      )}

      {mode === 'solo' ? (
        custom ? (
          <View style={styles.form}>
            <Pressable
              onPress={() => setCustom(false)}
              accessibilityRole="button"
              hitSlop={8}
              style={styles.back}
            >
              <Icon name="chevron-left" size={16} color={colors.accent} />
              <Text style={styles.backText}>Hazır alışkanlıklar</Text>
            </Pressable>
            <SoloForm onCreated={onClose} initialCategory={initialCategory} />
          </View>
        ) : (
          <TemplatePicker
            focusStat={initialCategory ? CATEGORY_DEFAULT_STAT[initialCategory] : null}
            onCustom={() => setCustom(true)}
          />
        )
      ) : duelSent ? (
        // A sent invitation is not yet a duel — the friend still has to accept — so the
        // sheet says where to follow it instead of pretending something started.
        <Animated.View entering={FadeIn.duration(200)} style={styles.sent}>
          <Text style={styles.sentTitle}>Davet gönderildi</Text>
          <Text style={styles.sentBody}>
            Arkadaşın kabul ettiğinde düello başlar. Skoru Savaş sekmesinden takip edebilirsin.
          </Text>
          <Button label="Tamam" tone="neutral" onPress={onClose} accessibilityLabel="Kapat" />
        </Animated.View>
      ) : (
        <DuelComposer onCreated={() => setDuelSent(true)} />
      )}
    </Animated.View>
  );
}

function SoloForm({
  onCreated,
  initialCategory,
}: {
  readonly onCreated: () => void;
  readonly initialCategory: Category | null;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<Category | null>(initialCategory);
  const [minutes, setMinutes] = useState(30);
  /** Timed (the timer) or counted (quick taps toward a daily number). */
  const [kind, setKind] = useState<'TIMED' | 'COUNT'>('TIMED');
  const [unit, setUnit] = useState<string>(COUNT_UNITS[0]?.unit ?? 'tekrar');
  const [targetCount, setTargetCount] = useState<number>(COUNT_UNITS[0]?.targets[1] ?? 50);
  const [error, setError] = useState<string | null>(null);
  const unitTargets = COUNT_UNITS.find((item) => item.unit === unit)?.targets ?? [];

  const mutation = useMutation({
    mutationFn: () =>
      createHabit(
        kind === 'COUNT'
          ? {
              name: name.trim(),
              category: category as Category,
              // A count habit's credit is fixed on the server; the field is required.
              targetMinutes: COUNT_TARGET_MINUTES,
              kind,
              targetCount,
              unit,
            }
          : { name: name.trim(), category: category as Category, targetMinutes: minutes },
      ),
    onSuccess: () => {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      void queryClient.invalidateQueries({ queryKey: ['habits'] });
      onCreated();
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError && err.code !== 'NETWORK'
          ? err.message
          : 'Sunucuya ulaşılamadı. Bağlantını kontrol et.',
      );
    },
  });

  const canSave = name.trim().length > 0 && category !== null && !mutation.isPending;

  return (
    <View style={styles.form}>
      <FormField
        label="Ad"
        value={name}
        onChangeText={(value) => {
          setName(value);
          if (error) setError(null);
        }}
        placeholder="Örn. Kitap okuma"
        maxLength={NAME_MAX}
        autoCapitalize="sentences"
        autoCorrect
        returnKeyType="done"
      />

      <View style={styles.group}>
        <Text style={styles.label}>Kategori</Text>
        <CategoryPicker value={category} onChange={setCategory} />
      </View>

      <View style={styles.group}>
        <Text style={styles.label}>Nasıl yapılır?</Text>
        <OptionPills
          options={['TIMED', 'COUNT'] as const}
          value={kind}
          onChange={setKind}
          format={(value) => (value === 'TIMED' ? 'Süreli' : 'Sayılı')}
          describe={(value) =>
            value === 'TIMED' ? 'Süreli: zamanlayıcıyla' : 'Sayılı: hızlı dokunuşlarla sayarak'
          }
        />
        <Text style={styles.hint}>
          {kind === 'TIMED'
            ? 'Zamanlayıcı açıp çalışırsın — kitap, ders, meditasyon.'
            : 'Yaptıkça +5, +10 diye eklersin — şınav, su, sayfa. Her dokunuş canavara vurur.'}
        </Text>
      </View>

      {kind === 'TIMED' ? (
        <View style={styles.group}>
          <Text style={styles.label}>Günlük hedef</Text>
          <OptionPills
            options={DURATIONS}
            value={minutes}
            onChange={setMinutes}
            format={(value) => `${value} dk`}
            describe={(value) => `${value} dakika`}
          />
        </View>
      ) : (
        <>
          <View style={styles.group}>
            <Text style={styles.label}>Ne sayılacak?</Text>
            <OptionPills
              options={COUNT_UNITS.map((item) => item.unit)}
              value={unit}
              onChange={(value) => {
                setUnit(value);
                const targets = COUNT_UNITS.find((item) => item.unit === value)?.targets;
                if (targets?.[1] !== undefined) setTargetCount(targets[1]);
              }}
              format={(value) => value}
            />
          </View>
          <View style={styles.group}>
            <Text style={styles.label}>Günlük hedef</Text>
            <OptionPills
              options={unitTargets}
              value={targetCount}
              onChange={setTargetCount}
              format={(value) => `${value} ${unit}`}
            />
          </View>
        </>
      )}

      {error !== null && (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      )}

      <Button
        label="Ekle"
        onPress={() => mutation.mutate()}
        disabled={!canSave}
        loading={mutation.isPending}
        accessibilityLabel="Alışkanlığı ekle"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { ...type.heading, color: colors.text },
  close: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },

  /** The system segmented control: a grey track and a white thumb. */
  segmented: {
    flexDirection: 'row',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm + 1,
    padding: 2,
  },
  segment: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.sm - 1,
  },
  segmentSelected: {
    backgroundColor: colors.surface,
    // The thumb's only lift: the hairline shadow the system control draws.
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  segmentText: { ...type.label, color: colors.textMuted },
  segmentTextSelected: { color: colors.text },

  form: { gap: spacing.md },
  group: { gap: spacing.xs },
  label: { ...type.label, color: colors.textMuted },
  error: { ...type.caption, color: colors.danger },
  hint: { ...type.caption, color: colors.textFaint },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, alignSelf: 'flex-start' },
  backText: { ...type.label, color: colors.accent },

  sent: { gap: spacing.sm },
  sentTitle: { ...type.heading, color: colors.text },
  sentBody: { ...type.body, color: colors.textMuted },
});
