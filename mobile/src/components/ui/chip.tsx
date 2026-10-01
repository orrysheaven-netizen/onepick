import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

const CHIP_HEIGHT = 32;

type Props = {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  /** Dashed outline marks an empty slot, e.g. a category without a Pick yet. */
  dashed?: boolean;
  leading?: ReactNode;
  accessibilityLabel?: string;
  /** Layout of the 44pt touch wrapper (margin, alignSelf, flex). */
  style?: StyleProp<ViewStyle>;
  /** Appearance of the visual chip inside the wrapper (padding, colors, border). */
  visualStyle?: StyleProp<ViewStyle>;
};

export function Chip({ label, onPress, selected = false, dashed = false, leading, accessibilityLabel, style, visualStyle }: Props) {
  // The Pressable is the real 44x44 interaction area; the visual chip inside stays 32pt tall.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.touch, style, pressed && styles.pressed]}>
      <View style={[styles.chip, dashed && styles.dashed, selected && styles.selected, visualStyle]}>
        {leading}
        <Text numberOfLines={1} style={[styles.label, dashed && styles.labelDashed, selected && styles.labelSelected]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  chip: {
    minHeight: CHIP_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
    borderRadius: OnePickRadius.full, borderWidth: 1, borderColor: 'transparent', backgroundColor: OnePick.bgMuted,
  },
  dashed: { borderStyle: 'dashed', borderColor: OnePick.borderDefault, backgroundColor: OnePick.bgDefault },
  selected: { borderColor: OnePick.actionPrimary, backgroundColor: OnePick.actionPrimary },
  pressed: { opacity: PRESSED_OPACITY },
  label: { ...OnePickType.captionMedium, color: OnePick.text },
  labelDashed: { color: OnePick.muted },
  labelSelected: { color: OnePick.onAction },
});
