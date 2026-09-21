import { StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

// Lockup: an indigo tag that reads 원픽 in Korean, with "one pick" beside it.
export function OnePickBrand({ compact = false }: { compact?: boolean }) {
  return <View style={styles.brand} accessibilityLabel="원픽">
    <View style={[styles.mark, compact && styles.markCompact]}><Text style={[styles.markText, compact && styles.markTextCompact]}>원픽</Text></View>
    <Text style={[styles.name, compact && styles.nameCompact]}>one pick</Text>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  mark: { height: 32, paddingHorizontal: 9, borderRadius: 10, backgroundColor: OnePick.accent, alignItems: 'center', justifyContent: 'center' },
  markCompact: { height: 26, paddingHorizontal: 7, borderRadius: 8 },
  markText: { color: OnePick.onAccent, fontSize: 16, lineHeight: 20, fontWeight: '900', letterSpacing: -0.8 },
  markTextCompact: { fontSize: 13, lineHeight: 16, letterSpacing: -0.6 },
  name: { color: OnePick.text, fontSize: 19, lineHeight: 24, fontWeight: '800', letterSpacing: -0.6 },
  nameCompact: { fontSize: 15, lineHeight: 20 },
});
