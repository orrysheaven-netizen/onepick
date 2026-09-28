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
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={styles.title}>
          {title}
          {count !== undefined ? <Text style={styles.count}>  {count.toLocaleString()}</Text> : null}
        </Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
      {action ? <Button variant="ghost" size="sm" label={action.label} onPress={action.onPress} accessibilityLabel={action.accessibilityLabel} disabled={action.disabled} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  copy: { flex: 1, minWidth: 0 },
  title: { ...OnePickType.headline, color: OnePick.text },
  count: { color: OnePick.accent },
  description: { ...OnePickType.caption, color: OnePick.muted, marginTop: 4 },
});
