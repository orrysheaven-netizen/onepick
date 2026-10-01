import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { OnePick, OnePickRadius, OnePickType } from '@/constants/onepick';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

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
  // The Pressable is the real 44x44 interaction area (layout, not hitSlop, so tight parents cannot shrink it);
  // the visual button inside keeps its designed size.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.touch, fullWidth && styles.fullWidth, pressed && !inactive && styles.pressed, inactive && styles.disabled, inactive && variant === 'primary' && styles.primaryDisabledOpacity, style]}>
      <View style={[styles.base, sizes[size], variants[variant], fullWidth && styles.fullWidthVisual, inactive && variant === 'primary' && styles.primaryDisabled]}>
        {loading
          ? <ActivityIndicator color={variant === 'primary' ? OnePick.onAction : variant === 'danger' ? OnePick.danger : OnePick.text} />
          : <Text numberOfLines={1} style={[styles.label, size === 'sm' && styles.labelSmall, labels[variant]]}>{label}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  fullWidth: { alignSelf: 'stretch', alignItems: 'stretch' },
  base: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', borderRadius: OnePickRadius.md },
  fullWidthVisual: { alignSelf: 'stretch' },
  // Keep enabled pressed text readable; only unavailable controls are dimmed.
  pressed: { opacity: PRESSED_OPACITY },
  disabled: { opacity: 0.6 },
  primaryDisabledOpacity: { opacity: 1 },
  primaryDisabled: { backgroundColor: OnePick.actionDisabled },
  label: { ...OnePickType.bodyMedium },
  labelSmall: { ...OnePickType.captionMedium },
});

const sizes = StyleSheet.create({
  lg: { minHeight: 52, paddingHorizontal: 24 },
  md: { minHeight: 52, paddingHorizontal: 20 },
  sm: { minHeight: 40, paddingHorizontal: 14 },
});

const variants = StyleSheet.create({
  primary: { backgroundColor: OnePick.actionPrimary },
  secondary: { backgroundColor: OnePick.bgDefault, borderWidth: 1, borderColor: OnePick.borderStrong },
  soft: { backgroundColor: OnePick.accentSoft },
  ghost: { backgroundColor: 'transparent', paddingHorizontal: 0 },
  danger: { backgroundColor: 'transparent', paddingHorizontal: 0 },
});

const labels = StyleSheet.create({
  primary: { color: OnePick.onAction },
  secondary: { color: OnePick.text },
  soft: { color: OnePick.accentDeep },
  ghost: { color: OnePick.accent },
  danger: { color: OnePick.danger },
});
