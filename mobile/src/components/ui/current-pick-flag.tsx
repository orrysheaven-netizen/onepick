import { StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickSpace, OnePickType } from '@/constants/onepick';

export function CurrentPickFlag() {
  return (
    <View accessible accessibilityLabel="현재 원픽" style={styles.flag}>
      <Text accessibilityElementsHidden importantForAccessibility="no" style={styles.icon}>⚑</Text>
      <Text style={styles.label}>원픽</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flag: { flexDirection: 'row', alignItems: 'center', gap: OnePickSpace.xs },
  icon: { ...OnePickType.captionMedium, color: OnePick.textAccent },
  label: { ...OnePickType.captionMedium, color: OnePick.textAccent },
});
