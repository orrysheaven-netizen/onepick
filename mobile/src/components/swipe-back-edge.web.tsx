import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import {
  canPopFocusedStack, getSwipeBackHandler, hasUnsavedTypedText, SWIPE_MAX_START_DY,
  SWIPE_RELEASE_DX, SWIPE_START_DX, UNSAVED_SWIPE_MESSAGE, useSwipeBackRegistryVersion,
} from '@/lib/navigation/swipeBack';

// Keep the hit-test strip clear of the 44px header back controls (which start around x=10).
// The drag can continue outside this strip after it starts.
const WEB_EDGE_HIT_WIDTH = 8;

// Screens where a back swipe must never navigate (no back affordance by design).
const EXCLUDED_PREFIXES = ['/admin', '/auth/callback', '/auth/admin-security'];

export default function SwipeBackEdge() {
  const router = useRouter();
  const pathname = usePathname();
  const rootState = useRootNavigationState();
  useSwipeBackRegistryVersion();

  const excluded = EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const hasInternalBackTarget = getSwipeBackHandler()?.hasInternalBackTarget === true;
  const hasRealBackTarget = canPopFocusedStack(rootState as never) && router.canGoBack();
  // A screen may expose a real previous state inside itself even when the router
  // stack cannot pop. A registered handler alone is not a back target.
  const enabled = !excluded && (hasInternalBackTarget || hasRealBackTarget);

  const routerRef = useRef(router);
  routerRef.current = router;

  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => gesture.x0 <= WEB_EDGE_HIT_WIDTH
      && gesture.dx > SWIPE_START_DX
      && Math.abs(gesture.dy) < SWIPE_MAX_START_DY,
    // A small scroll during the drag makes react-native-web request termination;
    // keep ownership so the release still runs.
    onPanResponderTerminationRequest: () => false,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < SWIPE_RELEASE_DX || gesture.vx <= 0) return;
      const handler = getSwipeBackHandler();
      const confirmUnsaved = handler ? handler.confirmUnsaved : true;
      if (confirmUnsaved && hasUnsavedTypedText() && !window.confirm(UNSAVED_SWIPE_MESSAGE)) return;
      if (handler) { handler.run(); return; }
      if (routerRef.current.canGoBack()) routerRef.current.back();
    },
  }), []);

  if (!enabled) return null;
  return <View testID="swipe-back-edge" style={styles.edge} {...responder.panHandlers} />;
}

const styles = StyleSheet.create({
  edge: {
    position: 'absolute',
    zIndex: 100,
    left: 0,
    top: 0,
    bottom: 0,
    width: WEB_EDGE_HIT_WIDTH,
    // Browser keeps vertical panning; horizontal drags go to JS instead of scrolling.
    touchAction: 'pan-y',
  } as never,
});
