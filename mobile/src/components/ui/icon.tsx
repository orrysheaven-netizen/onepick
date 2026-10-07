import { Image } from 'expo-image';

import { OnePick, OnePickIcon } from '@/constants/onepick';

import type { IconName, IconProps } from './icon.types';

export type { IconName, IconProps, IconSize } from './icon.types';

// Native: the same geometry as icon.web.tsx, rendered from the generated SVG
// assets (scripts/generate-ui-icons.cjs keeps them in sync with icon-paths.ts).
// Metro needs static require() paths, so the map is spelled out.
const ASSETS: Record<IconName, number> = {
  back: require('../../../public/icons/ui/back.svg'),
  chevronRight: require('../../../public/icons/ui/chevronRight.svg'),
  chevronDown: require('../../../public/icons/ui/chevronDown.svg'),
  chevronUp: require('../../../public/icons/ui/chevronUp.svg'),
  close: require('../../../public/icons/ui/close.svg'),
  clear: require('../../../public/icons/ui/clear.svg'),
  plus: require('../../../public/icons/ui/plus.svg'),
  search: require('../../../public/icons/ui/search.svg'),
  share: require('../../../public/icons/ui/share.svg'),
  more: require('../../../public/icons/ui/more.svg'),
  check: require('../../../public/icons/ui/check.svg'),
  comment: require('../../../public/icons/ui/comment.svg'),
  home: require('../../../public/icons/ui/home.svg'),
  explore: require('../../../public/icons/ui/explore.svg'),
  bell: require('../../../public/icons/ui/bell.svg'),
  profile: require('../../../public/icons/ui/profile.svg'),
};
const HOME_FILLED = require('../../../public/icons/ui/home-filled.svg');

/**
 * Shared UI icon (native). `size` is a Foundations token (md 24 / sm 16).
 * Single-color icons are tinted with `color`; the two-tone clear mark keeps
 * its asset colors (text/tertiary circle + white ×).
 */
export function Icon({ name, size = 'md', color = OnePick.textPrimary, filled = false, style }: IconProps) {
  const px = OnePickIcon[size];
  const source = name === 'home' && filled ? HOME_FILLED : ASSETS[name];
  return (
    <Image source={source} alt="" accessible={false} contentFit="contain"
      tintColor={name === 'clear' ? undefined : color}
      style={[{ width: px, height: px, flexShrink: 0 }, style]} />
  );
}
