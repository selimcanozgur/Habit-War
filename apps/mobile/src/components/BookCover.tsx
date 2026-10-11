/**
 * A book's cover, or a plain book glyph when it has none (or the image fails to
 * load). A finished book wears gold: on the shelf it is a trophy.
 */

import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { colors, radius } from '../theme';
import { Icon } from './Icon';

export interface BookCoverProps {
  readonly uri: string | null;
  readonly width: number;
  readonly finished?: boolean;
}

/** Book covers are roughly 2:3. */
const ASPECT = 1.5;

export function BookCover({ uri, width, finished = false }: BookCoverProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const size = { width, height: Math.round(width * ASPECT) };

  if (uri && !failed) {
    return (
      <View style={[styles.frame, size, finished && styles.finished]}>
        <Image
          source={{ uri }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      </View>
    );
  }

  return (
    <View style={[styles.frame, styles.placeholder, size, finished && styles.placeholderFinished]}>
      <Icon
        name={finished ? 'trophy' : 'shelf'}
        size={Math.round(width * 0.45)}
        color={finished ? colors.goldDark : colors.accent}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.surfaceRaised },
  finished: { borderWidth: 2, borderColor: colors.gold },
  placeholder: { alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accentSoft },
  placeholderFinished: { backgroundColor: colors.goldSoft },
});
