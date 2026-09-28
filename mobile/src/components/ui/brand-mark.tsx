import { StyleSheet, View } from 'react-native';

import { OnePick, OnePickRadius } from '@/constants/onepick';

type Size = 'sm' | 'md' | 'lg';

/**
 * OnePick's standalone brand mark is the approved tangerine dot.
 * Keep the legacy `soft` prop in the public type while call sites migrate; the
 * mark itself never changes color or becomes a text tag.
 */
export function BrandMark({ size = 'md' }: { size?: Size; soft?: boolean }) {
  return <View accessible={false} style={[styles.dot, sizes[size]]} />;
}

const styles = StyleSheet.create({
  dot: { alignSelf: 'flex-start', backgroundColor: OnePick.brand, borderRadius: OnePickRadius.pill },
});

const sizes = StyleSheet.create({
  sm: { width: 8, height: 8 },
  md: { width: 12, height: 12 },
  lg: { width: 18, height: 18 },
});
