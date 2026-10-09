import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

type Props = { compact?: boolean; appearance?: 'light' | 'dark' };

// Approved outlined originals with the Korean 원픽 glyphs removed (10-04 decision:
// screens show the English wordmark only). Do not rebuild the wordmark with live fonts.
const logos = {
  light: require('../../public/brand/onepick-wordmark.svg'),
  dark: require('../../public/brand/onepick-wordmark-white.svg'),
};

export function OnePickBrand({ compact = false, appearance = 'light' }: Props) {
  const height = compact ? 24 : 28;
  // Original dot diameter: 508 units in a 931-unit-high viewBox.
  const clearSpace = Math.ceil(height * 508 / 931);
  return (
    <Link href="/" asChild>
      {/* Slot merges child style as `{ ...style }`: an array crashes web, a function is dropped. Pass one object. */}
      <Pressable accessibilityRole="link" accessibilityLabel="원픽 홈"
        style={StyleSheet.flatten([styles.brand, { padding: clearSpace }])}>
        <Image source={logos[appearance]} alt="onepick" contentFit="contain"
          style={{ height, width: height * 3331 / 931 }} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  brand: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
