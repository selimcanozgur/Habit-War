/**
 * A grouped list: rows inside one card, divided by inset hairlines.
 *
 * The way iOS draws Settings, Contacts and every other list of like things. A stack of
 * separately boxed rows reads as N objects; one card with separators reads as one list,
 * which is what a leaderboard or a friend list is.
 *
 * The separator starts at `inset`, so it lines up with the text column rather than
 * running under the avatar — the leading image already separates one row from the next.
 */

import { Children, Fragment, isValidElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, hairline, radius } from '../theme';

export interface GroupProps {
  readonly children: React.ReactNode;
  /** Where the separator starts, measured from the card's left edge. */
  readonly inset?: number;
}

export function Group({ children, inset = 0 }: GroupProps): React.JSX.Element {
  const rows = Children.toArray(children).filter(isValidElement);

  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={row.key ?? index}>
          {index > 0 && <View style={[styles.separator, { marginLeft: inset }]} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  separator: { height: hairline, backgroundColor: colors.border },
});
