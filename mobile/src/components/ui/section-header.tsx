import { StyleSheet, Text, View } from 'react-native';

import { OnePick, OnePickType } from '@/constants/onepick';
import { Button } from './button';

type Props = {
  title: string;
  count?: number;
  description?: string;
  action?: { label: string; onPress: () => void; accessibilityLabel?: string; disabled?: boolean };
};

export function SectionHeader({ title, count, description, action }: Props) {
  const weeklyMenus=title==='메뉴별 원픽 보기';
  const shownTitle=weeklyMenus?'이번 주 많이 고른 메뉴':title;
  const shownDescription=weeklyMenus?'최근 7일 동안 현재 원픽으로 고른 사람 수예요':description;
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.title}>
          {shownTitle}
          {count !== undefined ? <Text style={styles.count}>  {count.toLocaleString()}</Text> : null}
        </Text>
        {shownDescription ? <Text style={styles.description}>{shownDescription}</Text> : null}
      </View>
      {action ? <Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} disabled={action.disabled} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { ...OnePickType.title, color: OnePick.text },
  count: { color: OnePick.accent },
  description: { ...OnePickType.caption, color: OnePick.muted, marginTop: 4 },
});
