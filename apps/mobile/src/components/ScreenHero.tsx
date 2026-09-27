/**
 * The illustrated header every screen opens with.
 *
 * It does real work rather than decorating: the art is what makes the app read as a
 * world instead of a form, which is the whole premise of tying habits to a character.
 *
 * Two things keep it legible. A dark scrim runs up from the bottom of the image, so
 * the title has guaranteed contrast no matter which illustration sits behind it — a
 * title placed on raw artwork is legible only until someone swaps the picture. And
 * the content below overlaps the image slightly, so the page reads as parchment laid
 * on a scene rather than two stacked rectangles.
 */

import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, heroHeight, radius, spacing, type } from '../theme';
import { Icon, type IconName } from './Icon';

/**
 * The four illustrations, keyed by the screen they head.
 *
 * `require` rather than a dynamic path: Metro resolves asset references statically,
 * so a computed path silently produces nothing at runtime.
 */
const HERO_IMAGES = {
  today: require('../../assets/heroes/hero-today.webp') as ImageSourcePropType,
  feed: require('../../assets/heroes/hero-feed.webp') as ImageSourcePropType,
  battle: require('../../assets/heroes/hero-battle.webp') as ImageSourcePropType,
  friends: require('../../assets/heroes/hero-friends.webp') as ImageSourcePropType,
  profile: require('../../assets/heroes/hero-today.webp') as ImageSourcePropType,
};

export type HeroImage = keyof typeof HERO_IMAGES;

export interface ScreenHeroProps {
  readonly image: HeroImage;
  readonly title: string;
  /** Sits under the title, e.g. the user's class. */
  readonly subtitle?: string | undefined;
  /** Small glyph before the title. */
  readonly icon?: IconName | undefined;
  /** Rendered at the top right — a settings or info affordance. */
  readonly action?: React.ReactNode;
  /** Extra content inside the hero, below the title. */
  readonly children?: React.ReactNode;
  /**
   * Lets the hero grow past `heroHeight` when its children need the room.
   *
   * A fixed height is right for a title and nothing else, and wrong for the profile,
   * where the whole character card lives inside the hero: at a fixed height the
   * children pushed the title off the top of the image and it rendered clipped.
   */
  readonly grows?: boolean;
}

export function ScreenHero({
  image,
  title,
  subtitle,
  icon,
  action,
  children,
  grows = false,
}: ScreenHeroProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.hero,
        // minHeight lets content set the size; height pins it. A hero holding only a
        // title wants the pin, one holding a character card wants the floor.
        grows ? { minHeight: heroHeight } : { height: heroHeight },
        { paddingTop: insets.top + spacing.sm },
      ]}
    >
      {/*
        The illustration is positioned behind the content rather than being the
        container's background. An ImageBackground takes part in layout and adopts its
        source's intrinsic box when either axis is unpinned — which is how the profile
        hero ended up 920x613, painting the artwork two thirds of the way down the page
        behind the cards. Taking it out of the flow means the hero is sized by its
        content and its content alone.
      */}
      <Image source={HERO_IMAGES[image]} style={styles.image} resizeMode="cover" />

      {/*
        Bottom-up scrim. Without it the title's legibility depends on whichever part
        of the illustration happens to sit behind it.
      */}
      <LinearGradient
        colors={['transparent', 'rgba(29,42,53,0.35)', 'rgba(29,42,53,0.88)']}
        locations={[0, 0.45, 1]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <View style={styles.content}>
        <View style={styles.titleRow}>
          {icon ? <Icon name={icon} size={24} color={colors.textOnDark} /> : null}
          <View style={styles.titleText}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          {action}
        </View>

        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    overflow: 'hidden',
    justifyContent: 'flex-end',
    // Shows through until the illustration decodes, and behind its rounded corners.
    backgroundColor: colors.panel,
  },
  image: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
    // The content below overlaps this radius, which is what makes the page read as
    // laid over the scene rather than butted against it.
    borderBottomLeftRadius: radius.lg,
    borderBottomRightRadius: radius.lg,
  },
  content: { padding: spacing.md, gap: spacing.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleText: { flex: 1 },
  title: { ...type.hero, color: colors.textOnDark },
  subtitle: { ...type.caption, color: colors.textOnDarkMuted },
});
