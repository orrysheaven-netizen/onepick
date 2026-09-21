import { StyleSheet, Text, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

type Size = 'sm' | 'md' | 'lg';

/**
 * The 원픽 tag on its own — the motif screens use where the logo used to show a
 * lone "1" (state cards, sign-in strip, registration headers, receipts).
 * `soft` sits on white cards; the default is the solid indigo tag.
 */
export function BrandMark({ size = 'md', soft = false }: { size?: Size; soft?: boolean }) {
  return (
    <View style={[styles.tag, sizes[size], soft && styles.soft]}>
      <Text style={[styles.text, texts[size], soft && styles.softText]}>원픽</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', backgroundColor: OnePick.accent },
  soft: { backgroundColor: OnePick.accentSoft },
  text: { color: OnePick.onAccent, fontWeight: '900', letterSpacing: -0.6 },
  softText: { color: OnePick.accentDeep },
});

const sizes = StyleSheet.create({
  sm: { height: 22, paddingHorizontal: 6, borderRadius: 7 },
  md: { height: 32, paddingHorizontal: 9, borderRadius: 10 },
  lg: { height: 48, paddingHorizontal: 14, borderRadius: 14 },
});

const texts = StyleSheet.create({
  sm: { fontSize: 11, lineHeight: 14 },
  md: { fontSize: 15, lineHeight: 20 },
  lg: { fontSize: 22, lineHeight: 28, letterSpacing: -1 },
});
