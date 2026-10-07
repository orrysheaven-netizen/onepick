import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

import { Icon } from './icon';
import { PRESSED_OPACITY } from './touch';

type Props = {
  title: string;
  meta?: string;
  leading?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
};

export function MenuRow({ title, meta, leading, onPress, accessibilityLabel }: Props) {
  const initial = title.trim().slice(0, 1);
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={accessibilityLabel}
      disabled={!onPress} onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && onPress && styles.pressed]}>
      <View style={styles.leading}>{leading ?? <Text style={styles.initial}>{initial}</Text>}</View>
      <View style={styles.copy}>
        <Text numberOfLines={1} style={styles.title}>{title}</Text>
        {meta ? <Text numberOfLines={1} style={styles.meta}>{meta}</Text> : null}
      </View>
      {onPress ? <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.md, borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  leading: { width: 56, height: 56, borderRadius: OnePickRadius.md, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.bgPlaceholder },
  initial: { ...OnePickType.headline, color: OnePick.textPrimary },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...OnePickType.headline, color: OnePick.textPrimary },
  meta: { ...OnePickType.caption, color: OnePick.textSecondary },
  pressed: { opacity: PRESSED_OPACITY },
});
