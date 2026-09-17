import { StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

export function OnePickBrand() {
  return <View style={styles.brand} accessibilityLabel="ONE PICK">
    <View style={styles.mark}><Text style={styles.number}>1</Text></View>
    <Text style={styles.name}>ONE PICK</Text>
  </View>;
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  mark: { width: 34, height: 34, borderRadius: 11, backgroundColor: OnePick.accent, alignItems: 'center', justifyContent: 'center' },
  number: { color: OnePick.surface, fontSize: 27, lineHeight: 33, fontWeight: '900' },
  name: { color: OnePick.text, fontSize: 20, fontWeight: '900', letterSpacing: -0.6 },
});
