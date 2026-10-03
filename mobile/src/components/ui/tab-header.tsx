import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

type Props = {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  actionAccessibilityLabel?: string;
};

export function TabHeader({ title, actionLabel, onAction, actionAccessibilityLabel }: Props) {
  return (
    <View style={styles.header}>
      <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>{title}</Text>
      {actionLabel ? (
        <Pressable accessibilityRole="button" accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          onPress={onAction} disabled={!onAction}
          style={({ pressed }) => [styles.action, pressed && onAction && styles.pressed]}>
          <Text style={styles.actionLabel}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: OnePickSpace.md },
  title: { ...OnePickType.pageTitle, flex: 1, minWidth: 0, color: OnePick.textPrimary },
  action: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignItems: 'flex-end', justifyContent: 'center' },
  actionLabel: { ...OnePickType.bodyMedium, color: OnePick.actionPrimary },
  pressed: { opacity: PRESSED_OPACITY },
});
