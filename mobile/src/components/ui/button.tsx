import { ActivityIndicator, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
export type ButtonSize = 'lg' | 'md' | 'sm';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  accessibilityLabel?: string;
  selected?: boolean;
  style?: StyleProp<ViewStyle>;
};

// Primary = one per screen. Soft is the in-card action ("나도 이게 원픽"); ghost is a text link.
export function Button({ label, onPress, variant = 'primary', size = 'md', disabled, loading, fullWidth, accessibilityLabel, selected, style }: Props) {
  const inactive = Boolean(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading), ...(selected === undefined ? {} : { selected }) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.base, sizes[size], variants[variant], fullWidth && styles.fullWidth, pressed && !inactive && styles.pressed, inactive && styles.disabled, style]}>
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? OnePick.onBrand : variant === 'danger' ? OnePick.danger : OnePick.text} />
        : <Text numberOfLines={1} style={[styles.label, size === 'sm' && styles.labelSmall, labels[variant]]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', borderRadius: OnePickRadius.pill },
  fullWidth: { alignSelf: 'stretch' },
  // Keep enabled pressed text readable; only unavailable controls are dimmed.
  pressed: { opacity: 0.9 },
  disabled: { opacity: 0.6 },
  label: { ...OnePickType.body, fontWeight: '700' },
  labelSmall: { ...OnePickType.label, fontWeight: '700' },
});

const sizes = StyleSheet.create({
  lg: { minHeight: 52, paddingHorizontal: 24 },
  md: { minHeight: 48, paddingHorizontal: 20 },
  sm: { minHeight: 40, paddingHorizontal: 14 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: OnePick.brand },
  secondary: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  soft: { backgroundColor: OnePick.accentSoft },
  ghost: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  danger: { backgroundColor: 'transparent', paddingHorizontal: 8 },
});

const labels = StyleSheet.create({
  primary: { color: OnePick.onBrand },
  secondary: { color: OnePick.text, fontWeight: '600' },
  soft: { color: OnePick.accentDeep },
  ghost: { color: OnePick.accent, fontWeight: '600' },
  danger: { color: OnePick.danger, fontWeight: '600' },
});
