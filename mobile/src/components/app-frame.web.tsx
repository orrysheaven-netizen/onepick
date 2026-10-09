import type { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';
import { OnePick } from '@/constants/onepick';

export default function AppFrame({ children }: PropsWithChildren) {
  return <View style={styles.canvas}><View style={styles.app}>{children}</View></View>;
}

const styles = StyleSheet.create({
  canvas: { flex: 1, minHeight: 0, alignItems: 'center', backgroundColor: OnePick.sunken },
  app: { flex: 1, minHeight: 0, width: '100%', maxWidth: OnePick.maxWidth, overflow: 'hidden', backgroundColor: OnePick.bgDefault,
    boxShadow: '0 0 48px rgba(32, 33, 36, 0.08)' },
});
