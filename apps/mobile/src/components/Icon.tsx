/**
 * The icon registry.
 *
 * Screens ask for an icon by name, never by file path. That keeps the import graph
 * in one place, makes the whole set visible at a glance, and means renaming a file
 * is a change here rather than a search across every screen.
 *
 * The glyphs live in `assets/icons/` as real SVG files on a shared 24x24 grid with a
 * 2px stroke — see `tools/icons/generate.mjs`. They all paint with `currentColor`,
 * so colour is the caller's decision and one file serves active, inactive and
 * disabled states.
 */

import type { SvgProps } from 'react-native-svg';

import BattleIcon from '../../assets/icons/navigation/battle.svg';
import BattleFilledIcon from '../../assets/icons/navigation/battle-filled.svg';
import FeedIcon from '../../assets/icons/navigation/feed.svg';
import FeedFilledIcon from '../../assets/icons/navigation/feed-filled.svg';
import FriendsIcon from '../../assets/icons/navigation/friends.svg';
import FriendsFilledIcon from '../../assets/icons/navigation/friends-filled.svg';
import ProfileIcon from '../../assets/icons/navigation/profile.svg';
import ProfileFilledIcon from '../../assets/icons/navigation/profile-filled.svg';
import TodayIcon from '../../assets/icons/navigation/today.svg';
import TodayFilledIcon from '../../assets/icons/navigation/today-filled.svg';

import CharismaIcon from '../../assets/icons/stats/charisma.svg';
import DexterityIcon from '../../assets/icons/stats/dexterity.svg';
import EnduranceIcon from '../../assets/icons/stats/endurance.svg';
import IntelligenceIcon from '../../assets/icons/stats/intelligence.svg';
import StrengthIcon from '../../assets/icons/stats/strength.svg';
import WisdomIcon from '../../assets/icons/stats/wisdom.svg';

import CreativeIcon from '../../assets/icons/categories/creative.svg';
import FitnessIcon from '../../assets/icons/categories/fitness.svg';
import HealthIcon from '../../assets/icons/categories/health.svg';
import MindfulnessIcon from '../../assets/icons/categories/mindfulness.svg';
import SkillIcon from '../../assets/icons/categories/skill.svg';
import SocialIcon from '../../assets/icons/categories/social.svg';
import StudyIcon from '../../assets/icons/categories/study.svg';

import AlertIcon from '../../assets/icons/ui/alert.svg';
import ArrowLeftIcon from '../../assets/icons/ui/arrow-left.svg';
import AtSignIcon from '../../assets/icons/ui/at-sign.svg';
import BarChartIcon from '../../assets/icons/ui/bar-chart.svg';
import BellIcon from '../../assets/icons/ui/bell.svg';
import CheckCircleIcon from '../../assets/icons/ui/check-circle.svg';
import CheckCircleFilledIcon from '../../assets/icons/ui/check-circle-filled.svg';
import ChevronDownIcon from '../../assets/icons/ui/chevron-down.svg';
import ChevronLeftIcon from '../../assets/icons/ui/chevron-left.svg';
import ChevronRightIcon from '../../assets/icons/ui/chevron-right.svg';
import ClockIcon from '../../assets/icons/ui/clock.svg';
import CloudOffIcon from '../../assets/icons/ui/cloud-off.svg';
import CommentIcon from '../../assets/icons/ui/comment.svg';
import CompassIcon from '../../assets/icons/ui/compass.svg';
import EditIcon from '../../assets/icons/ui/edit.svg';
import EllipsisIcon from '../../assets/icons/ui/ellipsis.svg';
import FlameIcon from '../../assets/icons/ui/flame.svg';
import FlameFilledIcon from '../../assets/icons/ui/flame-filled.svg';
import HeadsetIcon from '../../assets/icons/ui/headset.svg';
import HeartIcon from '../../assets/icons/ui/heart.svg';
import HeartFilledIcon from '../../assets/icons/ui/heart-filled.svg';
import HourglassIcon from '../../assets/icons/ui/hourglass.svg';
import InfoIcon from '../../assets/icons/ui/info.svg';
import LockIcon from '../../assets/icons/ui/lock.svg';
import LogoutIcon from '../../assets/icons/ui/logout.svg';
import MedalIcon from '../../assets/icons/ui/medal.svg';
import MinusIcon from '../../assets/icons/ui/minus.svg';
import PaletteIcon from '../../assets/icons/ui/palette.svg';
import PlayIcon from '../../assets/icons/ui/play.svg';
import PlayFilledIcon from '../../assets/icons/ui/play-filled.svg';
import PlusIcon from '../../assets/icons/ui/plus.svg';
import RepeatIcon from '../../assets/icons/ui/repeat.svg';
import SearchIcon from '../../assets/icons/ui/search.svg';
import SettingsIcon from '../../assets/icons/ui/settings.svg';
import ShieldCheckIcon from '../../assets/icons/ui/shield-check.svg';
import StarIcon from '../../assets/icons/ui/star.svg';
import StarFilledIcon from '../../assets/icons/ui/star-filled.svg';
import SwordsIcon from '../../assets/icons/ui/swords.svg';
import TrophyIcon from '../../assets/icons/ui/trophy.svg';
import UserIcon from '../../assets/icons/ui/user.svg';
import XpBoltIcon from '../../assets/icons/ui/xp-bolt.svg';
import XpBoltFilledIcon from '../../assets/icons/ui/xp-bolt-filled.svg';

import { colors } from '../theme';

const ICONS = {
  // Navigation
  today: TodayIcon,
  'today-filled': TodayFilledIcon,
  feed: FeedIcon,
  'feed-filled': FeedFilledIcon,
  battle: BattleIcon,
  'battle-filled': BattleFilledIcon,
  friends: FriendsIcon,
  'friends-filled': FriendsFilledIcon,
  profile: ProfileIcon,
  'profile-filled': ProfileFilledIcon,

  // Stats
  strength: StrengthIcon,
  endurance: EnduranceIcon,
  intelligence: IntelligenceIcon,
  wisdom: WisdomIcon,
  charisma: CharismaIcon,
  dexterity: DexterityIcon,

  // Habit categories
  fitness: FitnessIcon,
  study: StudyIcon,
  mindfulness: MindfulnessIcon,
  creative: CreativeIcon,
  social: SocialIcon,
  health: HealthIcon,
  skill: SkillIcon,

  // UI
  alert: AlertIcon,
  'arrow-left': ArrowLeftIcon,
  'at-sign': AtSignIcon,
  'bar-chart': BarChartIcon,
  bell: BellIcon,
  'check-circle': CheckCircleIcon,
  'check-circle-filled': CheckCircleFilledIcon,
  'chevron-down': ChevronDownIcon,
  'chevron-left': ChevronLeftIcon,
  'chevron-right': ChevronRightIcon,
  clock: ClockIcon,
  'cloud-off': CloudOffIcon,
  comment: CommentIcon,
  compass: CompassIcon,
  edit: EditIcon,
  ellipsis: EllipsisIcon,
  flame: FlameIcon,
  'flame-filled': FlameFilledIcon,
  headset: HeadsetIcon,
  heart: HeartIcon,
  'heart-filled': HeartFilledIcon,
  hourglass: HourglassIcon,
  info: InfoIcon,
  lock: LockIcon,
  logout: LogoutIcon,
  medal: MedalIcon,
  minus: MinusIcon,
  palette: PaletteIcon,
  play: PlayIcon,
  'play-filled': PlayFilledIcon,
  plus: PlusIcon,
  repeat: RepeatIcon,
  search: SearchIcon,
  settings: SettingsIcon,
  'shield-check': ShieldCheckIcon,
  star: StarIcon,
  'star-filled': StarFilledIcon,
  swords: SwordsIcon,
  trophy: TrophyIcon,
  user: UserIcon,
  'xp-bolt': XpBoltIcon,
  'xp-bolt-filled': XpBoltFilledIcon,
} as const;

export type IconName = keyof typeof ICONS;

/** Habit category to its glyph. Category is the only thing every habit has. */
export const CATEGORY_ICONS: Readonly<Record<string, IconName>> = {
  FITNESS: 'fitness',
  STUDY: 'study',
  MINDFULNESS: 'mindfulness',
  CREATIVE: 'creative',
  SOCIAL: 'social',
  HEALTH: 'health',
  SKILL: 'skill',
};

/** Stat to its glyph. */
export const STAT_ICONS: Readonly<Record<string, IconName>> = {
  STR: 'strength',
  END: 'endurance',
  INT: 'intelligence',
  WIS: 'wisdom',
  CHA: 'charisma',
  DEX: 'dexterity',
};

export interface IconProps extends Omit<SvgProps, 'width' | 'height' | 'color'> {
  readonly name: IconName;
  /** Both dimensions. Icons are square by construction. */
  readonly size?: number;
  readonly color?: string;
}

export function Icon({ name, size = 22, color = colors.text, ...rest }: IconProps): React.JSX.Element {
  const Glyph = ICONS[name];
  return <Glyph width={size} height={size} color={color} {...rest} />;
}
