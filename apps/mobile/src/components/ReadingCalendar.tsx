/**
 * The last sixteen weeks as a grid of days, one column per week (Monday on top),
 * shaded by how much of the daily goal each day reached.
 *
 * It shows the thing the app is really about: not how much, but how often. A run of
 * filled squares is the habit, visible.
 */

import { useQuery } from '@tanstack/react-query';
import { StyleSheet, Text, View } from 'react-native';

import { getCalendar } from '../api/reading';
import { useT } from '../i18n';
import { colors, spacing, type } from '../theme';
import { cardStyle } from './Button';

const CELL = 15;
const GAP = 3;

/** Shade by share of the daily goal reached: none, some, most, met, double. */
const SHADES = [colors.surfaceSunken, '#E3D1FF', '#B98AFF', colors.accent, colors.accentDark] as const;

function shade(pages: number, goal: number): string {
  if (pages <= 0) return SHADES[0];
  const ratio = pages / Math.max(1, goal);
  if (ratio < 0.5) return SHADES[1];
  if (ratio < 1) return SHADES[2];
  if (ratio < 2) return SHADES[3];
  return SHADES[4];
}

function addDays(dateKey: string, days: number): string {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

export function ReadingCalendar(): React.JSX.Element | null {
  const t = useT();
  const query = useQuery({ queryKey: ['calendar'], queryFn: getCalendar });
  const calendar = query.data;
  if (!calendar) return null;

  const pagesByDay = new Map(calendar.days.map((day) => [day.date, day.pages]));

  // Start the first column on the Monday on or before `from`, so rows are weekdays.
  const weekday = (new Date(`${calendar.from}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(calendar.from, -weekday);

  const columns: (string | null)[][] = [];
  for (let day = start; day <= calendar.to; day = addDays(day, 7)) {
    columns.push(
      Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(day, offset);
        return date < calendar.from || date > calendar.to ? null : date;
      }),
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.overline}>{t.calendar.overline}</Text>
      <View style={styles.grid}>
        {columns.map((column, columnIndex) => (
          <View key={columnIndex} style={styles.column}>
            {column.map((date, rowIndex) => (
              <View
                key={rowIndex}
                style={[
                  styles.cell,
                  { backgroundColor: date ? shade(pagesByDay.get(date) ?? 0, calendar.dailyGoal) : 'transparent' },
                ]}
              />
            ))}
          </View>
        ))}
      </View>
      <View style={styles.legend}>
        <Text style={styles.legendText}>{t.calendar.less}</Text>
        {SHADES.map((color) => (
          <View key={color} style={[styles.cell, { backgroundColor: color }]} />
        ))}
        <Text style={styles.legendText}>{t.calendar.more}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { ...cardStyle, gap: spacing.sm },
  overline: { ...type.overline, color: colors.textFaint },
  grid: { flexDirection: 'row', gap: GAP, alignSelf: 'center' },
  column: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: GAP, alignSelf: 'flex-end' },
  legendText: { ...type.caption, color: colors.textFaint, marginHorizontal: spacing.xs },
});
