import type { ImageStyle, StyleProp } from 'react-native';

import type { IconName } from './icon-paths';

export type { IconName };

/** Foundations icon sizes: md = 24 (primary actions), sm = 16 (supporting marks). */
export type IconSize = 'sm' | 'md';

export type IconProps = {
  name: IconName;
  size?: IconSize;
  /** Stroke (and dot/fill) color. Defaults to text/primary; inactive icons and chevrons use text/tertiary. */
  color?: string;
  /** Fill closed shapes with `color` as well (active Home tab). */
  filled?: boolean;
  style?: StyleProp<ImageStyle>;
};
