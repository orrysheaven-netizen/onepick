import { Pressable, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '@/components/ui/touch';
import { OnePick, OnePickType } from '@/constants/onepick';

export type ProfileTabKey = 'picks' | 'records';

const TABS: readonly { key: ProfileTabKey; label: string }[] = [
  { key: 'picks', label: '원픽' },
  { key: 'records', label: '기록' },
];

/**
 * Own-profile underline tabs (#757): 원픽 | 기록. 기록 is private to the owner, so the
 * public profile renders no tab row at all. The row stays in place with zero Picks.
 */
export function ProfileTabs({ value, onChange }: { value: ProfileTabKey; onChange: (key: ProfileTabKey) => void }) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {TABS.map((tab) => {
        const selected = tab.key === value;
        // `aria-selected` reaches both the web DOM (react-native-web 0.21 drops
        // `accessibilityState`) and native accessibilityState (RN >= 0.71 maps it).
        return (
          <Pressable key={tab.key} accessibilityRole="tab" aria-selected={selected}
            accessibilityLabel={`${tab.label} 탭`} onPress={() => onChange(tab.key)} style={styles.tab}>
            <Text style={[styles.label, selected && styles.labelSelected]}>{tab.label}</Text>
            <View style={[styles.indicator, selected && styles.indicatorSelected]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: OnePick.borderDefault },
  tab: { flex: 1, minHeight: MIN_TOUCH_TARGET + 4, alignItems: 'center', justifyContent: 'flex-end' },
  label: { ...OnePickType.bodyMedium, color: OnePick.textSecondary, paddingBottom: 10 },
  labelSelected: { color: OnePick.textPrimary },
  indicator: { alignSelf: 'stretch', height: 2, marginBottom: -1, backgroundColor: 'transparent' },
  indicatorSelected: { backgroundColor: OnePick.actionPrimary },
});
