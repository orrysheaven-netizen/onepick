import { usePathname } from 'expo-router';
import { useEffect, useMemo, useRef, type PropsWithChildren } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { OnePick } from '@/constants/onepick';
import { registerSwipeSceneController, type SwipeSceneController } from '@/lib/navigation/swipeAnimation';

/**
 * Keep the established centered/max-width canvas and move only the active app
 * scene. All web/PWA screens, including in-screen registration steps, use one
 * visual back-swipe controller; native stacks remain unchanged.
 */
export default function AppFrame({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const translateX = useRef(new Animated.Value(0)).current;
  const sceneWidth = useRef(390);
  const finishing = useRef(false);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const controller = useMemo<SwipeSceneController>(() => {
    const reset = () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = null;
      translateX.stopAnimation();
      translateX.setValue(0);
      finishing.current = false;
    };
    return {
      isFinishing: () => finishing.current,
      drag: (dx) => {
        if (finishing.current) return;
        translateX.stopAnimation();
        translateX.setValue(Math.min(sceneWidth.current, Math.max(0, dx)));
      },
      cancel: () => {
        if (finishing.current) return;
        Animated.timing(translateX, {
          toValue: 0, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }).start();
      },
      finish: (navigate) => {
        if (finishing.current) return;
        finishing.current = true;
        Animated.timing(translateX, {
          toValue: sceneWidth.current, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false,
        }).start(({ finished }) => {
          if (!finished) { reset(); return; }
          try {
            navigate();
          } finally {
            // Same-URL registration steps update React state, not pathname.
            resetTimer.current = setTimeout(reset, 60);
          }
        });
      },
    };
  }, [translateX]);

  useEffect(() => registerSwipeSceneController(controller), [controller]);

  useEffect(() => {
    // Header back, another tab, or route changes must not inherit old progress.
    translateX.stopAnimation();
    translateX.setValue(0);
    finishing.current = false;
  }, [pathname, translateX]);

  useEffect(() => () => {
    if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    translateX.stopAnimation();
  }, [translateX]);

  return (
    <View style={styles.canvas}>
      <View
        testID="app-swipe-viewport"
        style={styles.app}
        onLayout={(event) => { sceneWidth.current = event.nativeEvent.layout.width; }}>
        <Animated.View
          testID="app-swipe-scene"
          style={[styles.scene, { transform: [{ translateX }] }]}>
          {children}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: { flex: 1, minHeight: 0, alignItems: 'center', backgroundColor: OnePick.sunken },
  app: { flex: 1, minHeight: 0, width: '100%', maxWidth: OnePick.maxWidth, overflow: 'hidden', backgroundColor: OnePick.bgDefault,
    boxShadow: '0 0 48px rgba(32, 33, 36, 0.08)' },
  scene: { flex: 1, minHeight: 0, width: '100%', backgroundColor: OnePick.bgDefault },
});
