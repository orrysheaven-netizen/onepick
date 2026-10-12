import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

const storeIcon = require('../../public/icons/store.svg');

/**
 * Figma OnePick / Store Badge (752:4350): storefront icon in a white 28px circle with a 1px border.
 *
 * `decorative` (#762, 2026-10-12): when the caller places it next to a store link whose label
 * already says "매장", the badge is hidden from screen readers so it adds no extra stop or
 * duplicate announcement. It stays non-interactive either way; the default keeps the "매장" label.
 */
export function StoreBadge({ decorative = false }: { decorative?: boolean } = {}) {
  const a11y = decorative
    ? { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, accessibilityElementsHidden: true, 'aria-hidden': true }
    : { accessible: true, accessibilityLabel: '매장' };
  return <View {...a11y} style={styles.badge}>
    <Image source={storeIcon} alt="" style={styles.icon} contentFit="contain" />
  </View>;
}

const styles = StyleSheet.create({
  badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: OnePick.borderStrong, backgroundColor: OnePick.bgDefault, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 14, height: 14 },
});
