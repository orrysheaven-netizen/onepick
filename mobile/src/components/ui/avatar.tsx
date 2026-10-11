import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius } from '@/constants/onepick';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

type Size = 24 | 32 | 40 | 64 | 68 | 72;

type Props = {
  /** Username or display name; the first character becomes the initial. */
  name: string;
  size?: Size;
  tone?: 'accent' | 'subtle';
  /** Public photo URL (see profileAvatarUrl). Missing or failing photos fall back to the initial. */
  imageUrl?: string | null;
  onPress?: () => void;
  accessibilityLabel?: string;
};

const fontSizes: Record<Size, number> = { 24: 11, 32: 13, 40: 15, 64: 24, 68: 25, 72: 26 };

export function Avatar({ name, size = 32, tone = 'accent', imageUrl, onPress, accessibilityLabel }: Props) {
  const initial = name.trim().slice(0, 1).toUpperCase();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const photo = imageUrl && imageUrl !== failedUrl ? imageUrl : null;
  const visual = (
    <View style={[styles.circle, tone === 'subtle' && styles.subtle, { width: size, height: size }]}>
      {photo
        ? <Image source={{ uri: photo }} accessibilityIgnoresInvertColors onError={() => setFailedUrl(photo)}
          style={[styles.photo, { width: size, height: size }]} />
        : <Text style={[styles.initial, { fontSize: fontSizes[size], lineHeight: size }]}>{initial}</Text>}
    </View>
  );
  if (!onPress) return visual;
  const touchInset = Math.max(0, (MIN_TOUCH_TARGET - size) / 2);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? `@${name} 프로필 보기`} onPress={onPress}
      style={({ pressed }) => [
        styles.touch,
        touchInset > 0 && { marginHorizontal: -touchInset, marginVertical: -touchInset },
        pressed && styles.pressed,
      ]}>
      {visual}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'center', justifyContent: 'center' },
  circle: { borderRadius: OnePickRadius.pill, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accentSoft },
  subtle: { backgroundColor: OnePick.bgSubtle },
  initial: { color: OnePick.accentDeep, fontWeight: '700' },
  photo: { borderRadius: OnePickRadius.pill },
  pressed: { opacity: PRESSED_OPACITY },
});
