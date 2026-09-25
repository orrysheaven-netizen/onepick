import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

type Props = {
  label: string;
  onPress?: () => void;
  selected?: boolean;
  /** Dashed outline marks an empty slot, e.g. a category without a Pick yet. */
  dashed?: boolean;
  leading?: ReactNode;
  accessibilityLabel?: string;
};

export function Chip({ label, onPress, selected = false, dashed = false, leading, accessibilityLabel }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, dashed && styles.dashed, selected && styles.selected, pressed && styles.pressed]}>
      {leading}
      <Text numberOfLines={1} style={[styles.label, dashed && styles.labelDashed, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
    borderRadius: OnePickRadius.pill, borderWidth: 1, borderColor: OnePick.border, backgroundColor: OnePick.surface,
  },
  dashed: { borderStyle: 'dashed' },
  selected: { borderColor: OnePick.text, backgroundColor: OnePick.accentSoft },
  pressed: { opacity: 0.9 },
  label: { ...OnePickType.label, color: OnePick.text },
  labelDashed: { color: OnePick.muted },
  labelSelected: { color: OnePick.text, fontWeight: '700' },
});
