// Shared interaction rules for UI kit controls. Visual size stays as designed;
// controls smaller than the platform minimum (44pt) grow only their touch area.
export const MIN_TOUCH_TARGET = 44;

// The one pressed state for enabled controls: text stays readable, no scale motion.
export const PRESSED_OPACITY = 0.9;

type Slop = { top: number; bottom: number; left: number; right: number };

const slopFor = (size: number) => Math.max(0, Math.ceil((MIN_TOUCH_TARGET - size) / 2));

/** hitSlop that lifts a width x height control to the 44pt minimum on each axis. */
export function touchSlop(width: number, height: number): Slop {
  const vertical = slopFor(height);
  const horizontal = slopFor(width);
  return { top: vertical, bottom: vertical, left: horizontal, right: horizontal };
}
