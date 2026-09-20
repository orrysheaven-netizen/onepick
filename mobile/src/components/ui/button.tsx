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
  style?: StyleProp<ViewStyle>;
};

// Primary = one per screen. Soft is the in-card action ("나도 이게 원픽"); ghost is a text link.
export function Button({ label, onPress, variant = 'primary', size = 'md', disabled, loading, fullWidth, accessibilityLabel, style }: Props) {
  const inactive = Boolean(disabled || loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.base, sizes[size], variants[variant], fullWidth && styles.fullWidth, (pressed || inactive) && styles.pressed, style]}>
      {loading
        ? <ActivityIndicator color={variant === 'primary' ? OnePick.onAccent : OnePick.accent} />
        : <Text numberOfLines={1} style={[styles.label, size === 'sm' && styles.labelSmall, labels[variant]]}>{label}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start', borderRadius: OnePickRadius.pill },
  fullWidth: { alignSelf: 'stretch' },
  pressed: { opacity: 0.6 },
  label: { ...OnePickType.body, fontWeight: '700' },
  labelSmall: { ...OnePickType.label, fontWeight: '700' },
});

const sizes = StyleSheet.create({
  lg: { minHeight: 52, paddingHorizontal: 24 },
  md: { minHeight: 48, paddingHorizontal: 20 },
  sm: { minHeight: 40, paddingHorizontal: 14 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: OnePick.accent },
  secondary: { backgroundColor: OnePick.surface, borderWidth: 1, borderColor: OnePick.border },
  soft: { backgroundColor: OnePick.accentSoft },
  ghost: { backgroundColor: 'transparent', paddingHorizontal: 8 },
  danger: { backgroundColor: 'transparent', paddingHorizontal: 8 },
});

const labels = StyleSheet.create({
  primary: { color: OnePick.onAccent },
  secondary: { color: OnePick.text, fontWeight: '600' },
  soft: { color: OnePick.accentDeep },
  ghost: { color: OnePick.accent, fontWeight: '600' },
  danger: { color: OnePick.danger, fontWeight: '600' },
});
