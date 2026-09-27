/**
 * The five-week activity grid.
 *
 * Columns are weeks and rows are weekdays, GitHub-contribution style. Five weeks is
 * chosen over a calendar month because the point is momentum, not dates: a fixed
 * 35-day window ending today always answers "have I kept this up recently", whereas
 * a month grid answers it badly on the 2nd of the month.
 *
 * Weeks start on Monday — the Turkish convention, and the one the API's timezone
 * handling assumes.
 *
 * All date maths runs on local-date strings (YYYY-MM-DD), never on Date arithmetic
 * across timezones: the server records a session's local date under the user's own
 * timezone, so comparing UTC instants here would light up the wrong cell for anyone
 * training late at night.
 */

import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { colors, radius, spacing, type } from '../theme';
import { cardStyle } from './Button';

const WEEKS = 5;
const DAYS_PER_WEEK = 7;

/** Monday-first, matching the grid's row order. */
const WEEKDAY_LABELS: readonly string[] = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];

/** Cell height, and therefore the height of each weekday label beside it. */
const CELL_HEIGHT = 22;
const FLAME_SIZE = 24;

export interface StreakCalendarProps {
  /** ISO local dates (YYYY-MM-DD) with at least one completed session. */
  readonly activeDays: readonly string[];
  readonly currentStreak: number;
  /** Injectable for tests and for rendering a user's own timezone "today". */
  readonly today?: Date;
}

export function StreakCalendar({
  activeDays,
  currentStreak,
  today,
}: StreakCalendarProps): React.JSX.Element {
  const active = new Set(activeDays);
  const anchor = today ?? new Date();
  const weeks = buildWeeks(anchor);
  const todayKey = toLocalDateKey(anchor);

  const hasAnyActivity = active.size > 0;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Son 5 hafta</Text>

        {/* The streak is what the card is really about, so it is stated as a figure
            with the flame beside it rather than buried in a sentence. */}
        {currentStreak > 0 ? (
          <View style={styles.streakGroup}>
            <Ionicons name="flame" size={FLAME_SIZE} color={colors.warning} />
            <Text style={styles.streakCount}>{currentStreak}</Text>
            <Text style={styles.streakUnit}>günlük seri</Text>
          </View>
        ) : (
          <View style={styles.streakGroup}>
            <Ionicons name="flame-outline" size={FLAME_SIZE} color={colors.textFaint} />
            <Text style={styles.streakEmpty}>Seri yok</Text>
          </View>
        )}
      </View>

      <View style={styles.gridRow}>
        <View style={styles.dayLabels}>
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} style={styles.dayLabel} numberOfLines={1}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.weeks}>
          {weeks.map((week, weekIndex) => (
            <View key={week[0] ?? weekIndex} style={styles.week}>
              {week.map((dateKey) => {
                const isActive = active.has(dateKey);
                const isToday = dateKey === todayKey;
                // Days after today are rendered as blanks rather than empty cells, so
                // the grid never implies the user missed a day that has not happened.
                const isFuture = dateKey > todayKey;

                return (
                  <Animated.View
                    key={dateKey}
                    entering={FadeIn.duration(200).delay(weekIndex * 40)}
                    style={[
                      styles.cell,
                      isFuture && styles.cellFuture,
                      isActive && styles.cellActive,
                      isToday && styles.cellToday,
                    ]}
                    accessible
                    accessibilityRole="text"
                    accessibilityLabel={describeCell(dateKey, isActive, isFuture)}
                  />
                );
              })}
            </View>
          ))}
        </View>
      </View>

      {!hasAnyActivity && (
        <Text style={styles.empty}>
          Bu beş haftada tamamlanmış seans yok. Bugün bir seans bitir, ilk kare dolsun.
        </Text>
      )}
    </View>
  );
}

/**
 * Builds WEEKS columns of seven local-date keys, oldest week first, each column
 * running Monday to Sunday and the last column containing `anchor`.
 */
function buildWeeks(anchor: Date): readonly (readonly string[])[] {
  // Sunday is 0 in JS; shift so Monday is 0.
  const weekdayIndex = (anchor.getDay() + 6) % 7;

  const startOfThisWeek = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());
  startOfThisWeek.setDate(startOfThisWeek.getDate() - weekdayIndex);

  const firstMonday = new Date(startOfThisWeek);
  firstMonday.setDate(firstMonday.getDate() - (WEEKS - 1) * DAYS_PER_WEEK);

  const weeks: string[][] = [];
  for (let week = 0; week < WEEKS; week += 1) {
    const column: string[] = [];
    for (let day = 0; day < DAYS_PER_WEEK; day += 1) {
      const date = new Date(firstMonday);
      // Adding days through setDate rather than millisecond arithmetic keeps DST
      // transitions from shifting a whole column by an hour and landing on the
      // previous day.
      date.setDate(date.getDate() + week * DAYS_PER_WEEK + day);
      column.push(toLocalDateKey(date));
    }
    weeks.push(column);
  }
  return weeks;
}

/** YYYY-MM-DD in local time. `toISOString` would convert to UTC and skew the date. */
export function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function describeCell(dateKey: string, isActive: boolean, isFuture: boolean): string {
  if (isFuture) return `${dateKey}, henüz gelmedi`;
  return `${dateKey}, ${isActive ? 'seans tamamlandı' : 'seans yok'}`;
}

const styles = StyleSheet.create({
  container: { ...cardStyle, gap: spacing.md },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { ...type.overline, color: colors.textMuted, textTransform: 'uppercase' },

  streakGroup: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  streakCount: { ...type.display, color: colors.warningDark },
  streakUnit: { ...type.caption, color: colors.textMuted },
  streakEmpty: { ...type.label, color: colors.textFaint },

  gridRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  dayLabels: { gap: spacing.xs },
  dayLabel: {
    ...type.caption,
    color: colors.textFaint,
    // Matches the cell height so labels stay aligned with their rows.
    height: CELL_HEIGHT,
    lineHeight: CELL_HEIGHT,
    width: 26,
  },
  weeks: { flex: 1, flexDirection: 'row', gap: spacing.xs, justifyContent: 'space-between' },
  week: { gap: spacing.xs, flex: 1 },
  cell: {
    height: CELL_HEIGHT,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSunken,
    borderWidth: 2,
    borderColor: colors.border,
  },
  cellActive: { backgroundColor: colors.success, borderColor: colors.successDark },
  cellToday: { borderColor: colors.accent },
  // Invisible but still occupying its slot, so the grid keeps its shape. Hiding it
  // with opacity rather than a transparent fill keeps the cell's colours in tokens.
  cellFuture: { opacity: 0 },

  empty: { ...type.caption, color: colors.textFaint, lineHeight: 16 },
});
