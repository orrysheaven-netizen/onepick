import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  canPopFocusedStack, getSwipeBackHandler, hasUnsavedTypedText, SWIPE_MAX_START_DY,
  SWIPE_RELEASE_DX, SWIPE_START_DX, UNSAVED_SWIPE_MESSAGE, useSwipeBackRegistryVersion,
} from '@/lib/navigation/swipeBack';

// Track a 32px start zone at document level instead of covering it with a View.
// This preserves header button taps while giving iPhone Safari a larger app gesture zone.
const WEB_EDGE_HIT_WIDTH = 20;
const IOS_SYSTEM_EDGE_WIDTH = 20;

// Screens where a back swipe must never navigate (no back affordance by design).
const EXCLUDED_PREFIXES = ['/admin', '/auth/callback', '/auth/admin-security'];

export default function SwipeBackEdge() {
  const router = useRouter();
  const pathname = usePathname();
  const rootState = useRootNavigationState();
  useSwipeBackRegistryVersion();

  const excluded = EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const registeredHandler = getSwipeBackHandler();
  const hasInternalBackTarget = registeredHandler?.hasInternalBackTarget === true;
  const reserveSystemEdge = registeredHandler?.reserveSystemEdge === true;
  const hasRealBackTarget = canPopFocusedStack(rootState as never) && router.canGoBack();
  // A screen may expose a real previous state inside itself even when the router
  // stack cannot pop. A registered handler alone is not a back target.
  const enabled = !excluded && (hasInternalBackTarget || hasRealBackTarget);

  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let activeTouchId: number | null = null;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let claimed = false;
    let reservedSystemEdge = false;
    let startTarget: EventTarget | null = null;

    const reset = () => {
      activeTouchId = null;
      claimed = false;
      reservedSystemEdge = false;
      startTarget = null;
    };
    const activeTouch = (touches: TouchList) => {
      if (activeTouchId === null) return null;
      for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === activeTouchId) return touch;
      }
      return null;
    };
    const onTouchStart = (event: TouchEvent) => {
      if (activeTouchId !== null || event.touches.length !== 1) return;
      const touch = event.touches.item(0);
      if (!touch || touch.clientX > WEB_EDGE_HIT_WIDTH) return;
      activeTouchId = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
      startTarget = event.target;
      claimed = false;
      reservedSystemEdge = false;
      // Safari can claim its native history gesture immediately at the extreme
      // edge. Only active internal step flows reserve that system edge on touchstart.
      if (reserveSystemEdge && touch.clientX <= IOS_SYSTEM_EDGE_WIDTH) {
        claimed = true;
        reservedSystemEdge = true;
        event.preventDefault();
      }
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = activeTouch(event.touches);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!claimed) {
        if (Math.abs(dy) >= SWIPE_MAX_START_DY || dx <= SWIPE_START_DX) return;
        claimed = true;
      }
      // iOS Safari may otherwise turn this horizontal touch into browser history-back.
      event.preventDefault();
      lastX = touch.clientX;
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = activeTouch(event.changedTouches);
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      const endedMovingRight = touch.clientX >= lastX;
      const shouldRun = claimed && dx >= SWIPE_RELEASE_DX && endedMovingRight;
      const shouldReplayTap = reservedSystemEdge
        && Math.abs(dx) <= SWIPE_START_DX
        && Math.abs(dy) <= SWIPE_START_DX;
      const tapTarget = startTarget;
      reset();
      if (shouldReplayTap && tapTarget instanceof Element) {
        const button = tapTarget.closest<HTMLElement>('button, a, [role="button"]');
        button?.click();
        return;
      }
      if (!shouldRun) return;
      const handler = getSwipeBackHandler();
      const confirmUnsaved = handler ? handler.confirmUnsaved : true;
      if (confirmUnsaved && hasUnsavedTypedText() && !window.confirm(UNSAVED_SWIPE_MESSAGE)) return;
      if (handler) { handler.run(); return; }
      if (routerRef.current.canGoBack()) routerRef.current.back();
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', reset, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', reset, { capture: true });
    };
  }, [enabled, reserveSystemEdge]);

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
