import { Pressable, StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';
import { Icon } from '@/components/ui';

type Props = {
  /** Lab Picks of the profile shown; 0 still renders for the owner so they can start one. */
  count: number;
  description: string;
  onPress: () => void;
};

/** One-line door from a profile or Explore into 실험실 (themes outside the restaurant-first MVP). */
export function ProfileLabEntry({ count, description, onPress }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `실험실 원픽 ${count}개 보기` : '실험실 열기'}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.copy}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>실험실</Text>
          {count > 0 ? <Text style={styles.count}>원픽 {count}개</Text> : null}
        </View>
        <Text style={styles.description}>{description}</Text>
      </View>
      <Icon name="chevronRight" size="sm" color={OnePick.textTertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: OnePick.border, backgroundColor: OnePick.surface, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13 },
  copy: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  title: { color: OnePick.text, fontSize: 14, lineHeight: 20, fontWeight: '800' },
  count: { color: OnePick.accent, fontSize: 12, lineHeight: 16, fontWeight: '700' },
  description: { color: OnePick.muted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  pressed: { opacity: 0.68 },
});
