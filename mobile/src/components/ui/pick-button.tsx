import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickIcon, OnePickRadius, OnePickSpace, OnePickType } from '@/constants/onepick';

import { Icon } from './icon';
import { MIN_TOUCH_TARGET, PRESSED_OPACITY } from './touch';

export type PickButtonState = 'default' | 'change' | 'mine';

type Props = {
  state?: PickButtonState;
  onPress?: () => void;
  loading?: boolean;
  fullWidth?: boolean;
};

const labels: Record<PickButtonState, string> = {
  default: '원픽으로 고르기',
  change: '원픽 바꾸기',
  mine: '내 원픽이에요.',
};

export function PickButton({ state = 'default', onPress, loading, fullWidth = true }: Props) {
  const mine = state === 'mine';
  const inactive = mine || Boolean(loading);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={labels[state]}
      accessibilityState={{ disabled: inactive, busy: Boolean(loading) }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.touch,
        fullWidth && styles.fullWidth,
        pressed && !inactive && styles.pressed,
      ]}>
      <View style={[styles.visual, mine ? styles.mine : styles.selectable, fullWidth && styles.fullWidthVisual]}>
        {loading && !mine ? <ActivityIndicator color={OnePick.onAction} /> : (
          <>
            {mine ? <Icon name="check" size="sm" color={OnePick.textPrimary} /> : <View accessibilityElementsHidden importantForAccessibility="no" style={styles.circleIcon} />}
            <Text style={[styles.label, mine ? styles.mineLabel : styles.selectableLabel]}>{labels[state]}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  touch: { minWidth: MIN_TOUCH_TARGET, minHeight: MIN_TOUCH_TARGET, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center' },
  fullWidth: { alignSelf: 'stretch', alignItems: 'stretch' },
  visual: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: OnePickSpace.sm, paddingHorizontal: OnePickSpace.xl, borderRadius: OnePickRadius.md },
  fullWidthVisual: { alignSelf: 'stretch' },
  selectable: { backgroundColor: OnePick.actionPrimary },
  mine: { backgroundColor: OnePick.bgAccent },
  circleIcon: { width: OnePickIcon.sm, height: OnePickIcon.sm, borderRadius: OnePickRadius.full, borderWidth: 2, borderColor: OnePick.onAction },
  label: { ...OnePickType.bodyMedium },
  selectableLabel: { color: OnePick.onAction },
  mineLabel: { color: OnePick.textPrimary },
  pressed: { opacity: PRESSED_OPACITY },
});
