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

import ShelfIcon from '../../assets/icons/navigation/shelf.svg';
import ShelfFilledIcon from '../../assets/icons/navigation/shelf-filled.svg';
import ProfileIcon from '../../assets/icons/navigation/profile.svg';
import ProfileFilledIcon from '../../assets/icons/navigation/profile-filled.svg';
import TodayIcon from '../../assets/icons/navigation/today.svg';
import TodayFilledIcon from '../../assets/icons/navigation/today-filled.svg';

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
import EyeIcon from '../../assets/icons/ui/eye.svg';
import EyeOffIcon from '../../assets/icons/ui/eye-off.svg';
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
import XIcon from '../../assets/icons/ui/x.svg';
import XpBoltIcon from '../../assets/icons/ui/xp-bolt.svg';
import XpBoltFilledIcon from '../../assets/icons/ui/xp-bolt-filled.svg';

import { colors } from '../theme';

const ICONS = {
  // Navigation
  today: TodayIcon,
  'today-filled': TodayFilledIcon,
  shelf: ShelfIcon,
  'shelf-filled': ShelfFilledIcon,
  profile: ProfileIcon,
  'profile-filled': ProfileFilledIcon,

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
  eye: EyeIcon,
  'eye-off': EyeOffIcon,
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
  x: XIcon,
  'xp-bolt': XpBoltIcon,
  'xp-bolt-filled': XpBoltFilledIcon,
} as const;

export type IconName = keyof typeof ICONS;

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
