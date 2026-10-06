import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  canPopFocusedStack, getSwipeBackHandler, hasUnsavedTypedText, SWIPE_MAX_START_DY,
  SWIPE_RELEASE_DX, SWIPE_START_DX, UNSAVED_SWIPE_MESSAGE, useSwipeBackRegistryVersion,
} from '@/lib/navigation/swipeBack';

// Track a 32px start zone at document level instead of covering it with a View.
// This preserves header button taps while giving iPhone Safari a larger app gesture zone.
const WEB_EDGE_HIT_WIDTH = 32;

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

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let startX: number | null = null;
    let startY = 0;
    let claimed = false;

    const reset = () => { startX = null; claimed = false; };
    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || event.clientX > WEB_EDGE_HIT_WIDTH) return;
      startX = event.clientX;
      startY = event.clientY;
      claimed = false;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.abs(dy) >= SWIPE_MAX_START_DY || dx <= SWIPE_START_DX) return;
      claimed = true;
      // Only claim after horizontal intent is clear, so ordinary taps (including
      // the header back button) keep their normal click behaviour.
      event.preventDefault();
    };
    const onPointerUp = (event: PointerEvent) => {
      if (startX === null) return;
      const dx = event.clientX - startX;
      const shouldRun = claimed && dx >= SWIPE_RELEASE_DX;
      reset();
      if (!shouldRun) return;
      const handler = getSwipeBackHandler();
      const confirmUnsaved = handler ? handler.confirmUnsaved : true;
      if (confirmUnsaved && hasUnsavedTypedText() && !window.confirm(UNSAVED_SWIPE_MESSAGE)) return;
      if (handler) { handler.run(); return; }
      if (routerRef.current.canGoBack()) routerRef.current.back();
    };

    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    document.addEventListener('pointermove', onPointerMove, { capture: true, passive: false });
    document.addEventListener('pointerup', onPointerUp, { capture: true });
    document.addEventListener('pointercancel', reset, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
      document.removeEventListener('pointermove', onPointerMove, { capture: true });
      document.removeEventListener('pointerup', onPointerUp, { capture: true });
      document.removeEventListener('pointercancel', reset, { capture: true });
    };
  }, [enabled]);

  if (!enabled) return null;
  return <View testID="swipe-back-edge" pointerEvents="none" style={styles.edge} />;
}

const styles = StyleSheet.create({
  edge: {
    position: 'absolute',
    zIndex: 100,
    left: 0,
    top: 0,
    bottom: 0,
    width: 0,
  } as never,
});
