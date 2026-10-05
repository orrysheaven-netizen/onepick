import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

// Figma OnePick / Flag (752:4349): one shape on a white 24px circle, only the
// colour differs — the viewer's own current Pick #FF8500, anyone else's #555555.
const flags = {
  mine: require('../../public/icons/flag-mine.svg'),
  other: require('../../public/icons/flag-other.svg'),
};

/** Callers render it only while the Pick is current, so changed/removed Picks show no flag. */
export function CurrentPickFlag({ mine = false }: { mine?: boolean }) {
  // The label sits on a View: expo-image on web does not expose an image's accessibilityLabel.
  return <View accessible accessibilityRole="image" accessibilityLabel={mine ? '내 현재 원픽' : '현재 원픽'} style={styles.flag}>
    <Image source={mine ? flags.mine : flags.other} alt="" style={styles.flag} contentFit="contain" />
  </View>;
}

const styles = StyleSheet.create({
  flag: { width: 24, height: 24 },
});
