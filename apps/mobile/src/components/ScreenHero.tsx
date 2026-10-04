/**
 * The illustrated header every screen opens with.
 *
 * It does real work rather than decorating: the art is what makes the app read as a
 * world instead of a form, which is the whole premise of tying habits to a character.
 *
 * Two things keep it legible. A dark scrim runs up from the bottom of the image, so
 * the title has guaranteed contrast no matter which illustration sits behind it — a
 * title placed on raw artwork is legible only until someone swaps the picture. And
 * the image ends square, so the page simply begins where the scene stops.
 */

import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, heroHeight, spacing, type } from '../theme';
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
  /**
   * Overrides the default height, for a hero carrying more than a title.
   *
   * Read as a floor under `grows` and as an exact height without it.
   */
  readonly height?: number;
}

export function ScreenHero({
  image,
  title,
  subtitle,
  icon,
  action,
  children,
  grows = false,
  height = heroHeight,
}: ScreenHeroProps): React.JSX.Element {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.hero,
        // minHeight lets content set the size; height pins it. A hero holding only a
        // title wants the pin, one holding a character card wants the floor.
        grows ? { minHeight: height } : { height },
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
        Scrim, dark at both ends and clear through the middle. The bottom carries the
        banner; the top exists because the name and the settings gear sit up there
        against sky, which is the brightest part of every one of these illustrations.
        Leaving the middle open is what keeps the figure visible between them.
      */}
      <LinearGradient
        colors={[
          'rgba(49,47,39,0.55)',
          'rgba(49,47,39,0.15)',
          'rgba(49,47,39,0.55)',
          'rgba(49,47,39,0.94)',
        ]}
        locations={[0, 0.3, 0.62, 1]}
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

        {/*
          Pushes the children to the bottom edge when the hero has height to spare, so
          the middle of the illustration — where the figure is — stays clear between
          the name above and the banner below. With no children it collapses and the
          title keeps its own position.
        */}
        {children ? <View style={styles.spacer} /> : null}

        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    overflow: 'hidden',
    // No `justifyContent` here: the content block claims the full height and does its
    // own distribution, via the spacer between the title and the children. Pinning to
    // flex-end as well would collapse that spacer and stack everything at the bottom.
    justifyContent: 'flex-start',
    // Shows through until the illustration decodes, and behind its rounded corners.
    backgroundColor: colors.panel,
  },
  image: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  // `flex: 1` so the spacer has room to claim; without it the content block is only
  // as tall as its children and the spacer has nothing to distribute.
  content: { flex: 1, padding: spacing.md, gap: spacing.sm },
  spacer: { flex: 1, minHeight: spacing.md },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  titleText: { flex: 1 },
  /*
    A text shadow under both lines. The scrim sets the general level, but these sit
    against sky — the brightest, most variable part of every illustration — and a
    shadow is what guarantees the edge of each letter regardless of what is behind it.
  */
  title: {
    ...type.hero,
    color: colors.textOnDark,
    textShadowColor: 'rgba(20, 19, 15, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 6,
  },
  subtitle: {
    ...type.caption,
    // Full-strength on-dark ink rather than the muted tone: muted is for a caption on
    // a panel, and here it dissolved into the clouds.
    color: colors.textOnDark,
    textShadowColor: 'rgba(20, 19, 15, 0.75)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
});
