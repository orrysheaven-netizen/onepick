import { Image } from 'expo-image';
import { Link } from 'expo-router';
import { Pressable, StyleSheet } from 'react-native';

type Props = { compact?: boolean; appearance?: 'light' | 'dark' };

// Approved outlined originals. Do not rebuild the wordmark with live fonts.
const logos = {
  light: require('../../public/brand/onepick-logo-horizontal.svg'),
  dark: require('../../public/brand/onepick-logo-horizontal-white.svg'),
};

export function OnePickBrand({ compact = false, appearance = 'light' }: Props) {
  const height = compact ? 24 : 28;
  // Original dot diameter: 508 units in a 931-unit-high viewBox.
  const clearSpace = Math.ceil(height * 508 / 931);
  return (
    <Link href="/" asChild>
      <Pressable accessibilityRole="link" accessibilityLabel="원픽 홈"
        style={[styles.brand, { padding: clearSpace }]}>
        <Image source={logos[appearance]} alt="onepick 원픽" contentFit="contain"
          style={{ height, width: height * 4883.77 / 931 }} />
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  brand: { alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
});
