import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { OnePick } from '@/constants/onepick';

const storeIcon = require('../../public/icons/store.svg');

/** Figma OnePick / Store Badge (752:4350): storefront icon in a white 28px circle with a 1px border. */
export function StoreBadge() {
  return <View accessible accessibilityLabel="매장" style={styles.badge}>
    <Image source={storeIcon} alt="" style={styles.icon} contentFit="contain" />
  </View>;
}

const styles = StyleSheet.create({
  badge: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: OnePick.borderStrong, backgroundColor: OnePick.bgDefault, alignItems: 'center', justifyContent: 'center' },
  icon: { width: 14, height: 14 },
});
