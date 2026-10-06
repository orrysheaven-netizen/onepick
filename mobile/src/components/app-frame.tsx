import { useRouter } from 'expo-router';
import { type PropsWithChildren, useMemo } from 'react';
import { PanResponder, Platform, StyleSheet, View } from 'react-native';

const EDGE_WIDTH = 32;
const RELEASE_DISTANCE = 72;

export default function AppFrame({ children }: PropsWithChildren) {
  const router = useRouter();
  const swipeBackResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: (_, gesture) => gesture.dx > 12 && Math.abs(gesture.dy) < 24,
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < RELEASE_DISTANCE || gesture.vx <= 0 || !router.canGoBack()) return;
      router.back();
    },
  }), [router]);

  return (
    <View style={styles.frame}>
      {children}
      {Platform.OS === 'web' ? (
        <View
          testID="global-swipe-back-edge"
          style={[styles.edge, styles.edgeWeb]}
          {...swipeBackResponder.panHandlers}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { flex: 1, minHeight: 0 },
  edge: {
    position: 'absolute',
    zIndex: 1000,
    left: 0,
    top: 0,
    bottom: 0,
    width: EDGE_WIDTH,
  },
  edgeWeb: { touchAction: 'pan-y' } as never,
});
