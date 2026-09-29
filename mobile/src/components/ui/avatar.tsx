import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius } from '@/constants/onepick';

type Size = 24 | 32 | 40 | 64 | 72;

type Props = {
  /** Username or display name; the first character becomes the initial. */
  name: string;
  size?: Size;
  tone?: 'accent' | 'subtle';
  onPress?: () => void;
  accessibilityLabel?: string;
};

const fontSizes: Record<Size, number> = { 24: 11, 32: 13, 40: 15, 64: 24, 72: 26 };

export function Avatar({ name, size = 32, tone = 'accent', onPress, accessibilityLabel }: Props) {
  const initial = name.trim().slice(0, 1).toUpperCase();
  const box = [styles.circle, tone === 'subtle' && styles.subtle, { width: size, height: size }];
  const glyph = <Text style={[styles.initial, { fontSize: fontSizes[size], lineHeight: size }]}>{initial}</Text>;
  if (!onPress) return <View style={box}>{glyph}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? `@${name} 프로필 보기`} onPress={onPress}
      style={({ pressed }) => [box, pressed && styles.pressed]}>
      {glyph}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  circle: { borderRadius: OnePickRadius.pill, alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  subtle: { backgroundColor: OnePick.bgSubtle },
  initial: { color: OnePick.accentDeep, fontWeight: '800' },
  pressed: { opacity: 0.6 },
});
