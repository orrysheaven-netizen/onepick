import { OnePick, OnePickIcon } from '@/constants/onepick';

import { ICON_SHAPES, ICON_VIEWBOX, type IconName } from './icon-paths';
import type { IconProps } from './icon.types';

export type { IconName, IconProps, IconSize } from './icon.types';

/**
 * Shared UI icon (web): one inline SVG per icon, drawn from `icon-paths.ts`.
 * `size` is a Foundations token (md 24 for primary actions, sm 16 for
 * supporting marks) — never an arbitrary pixel value. Icons are decorative by
 * default; the surrounding Pressable carries the accessibility label.
 */
export function Icon({ name, size = 'md', color = OnePick.textPrimary, filled = false, style }: IconProps) {
  const px = OnePickIcon[size];
  const twoTone = name === 'clear';
  return (
    <svg width={px} height={px} viewBox={`0 0 ${ICON_VIEWBOX} ${ICON_VIEWBOX}`} fill="none" stroke={color}
      strokeWidth={OnePickIcon.strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
      style={{ flexShrink: 0, ...(style as object) }} data-icon={name}>
      {ICON_SHAPES[name].map((shape, index) => {
        if (shape.type === 'path') {
          return <path key={index} d={shape.d} stroke={twoTone ? OnePick.onAction : undefined} fill={filled ? color : undefined} />;
        }
        if (shape.type === 'circle') {
          const shapeFilled = 'filled' in shape && shape.filled;
          return <circle key={index} cx={shape.cx} cy={shape.cy} r={shape.r}
            fill={shapeFilled || filled ? color : undefined} stroke={shapeFilled ? 'none' : undefined} />;
        }
        return <rect key={index} x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx={shape.rx} fill={filled ? color : undefined} />;
      })}
    </svg>
  );
}
