import { StyleSheet, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

/**
 * Figma 30 / node 113:20: icon-only marker for a person's current Pick.
 * The viewer's own current Pick is orange; anyone else's is dark gray (10-04).
 * Callers render it only while the Pick is current, so changed/removed Picks show no flag.
 */
export function CurrentPickFlag({ mine = false }: { mine?: boolean }) {
  const color = mine ? OnePick.flagMine : OnePick.flagOther;
  return (
    <View accessible accessibilityLabel={mine ? '내 현재 원픽' : '현재 원픽'} style={styles.root}>
      <View style={[styles.pole, { backgroundColor: color }]} />
      <View style={[styles.body, { backgroundColor: color }]}>
        <View style={styles.notch} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: OnePick.surface,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  pole: {
    position: 'absolute',
    left: 7,
    top: 5,
    width: 2,
    height: 14,
  },
  body: {
    position: 'absolute',
    left: 7,
    top: 5,
    width: 10,
    height: 8,
  },
  notch: {
    position: 'absolute',
    right: -1,
    top: 3,
    width: 0,
    height: 0,
    borderTopWidth: 2,
    borderBottomWidth: 2,
    borderRightWidth: 3,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderRightColor: OnePick.surface,
  },
});
