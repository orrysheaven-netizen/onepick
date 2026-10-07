import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  canPopFocusedStack, getSwipeBackHandler, hasUnsavedTypedText,
  UNSAVED_SWIPE_MESSAGE, useSwipeBackRegistryVersion,
} from '@/lib/navigation/swipeBack';
import {
  beginWebSwipeGesture, endWebSwipeGesture, moveWebSwipeGesture, type WebSwipeGestureState,
} from '@/lib/navigation/webSwipeGesture';

// Track only the iOS system-edge zone (20px) at document level instead of covering it with a View.
// This keeps the capture area narrow while preserving ordinary content interaction outside the edge.
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
    let gesture: WebSwipeGestureState | null = null;
    let startTarget: EventTarget | null = null;
    let scrollTarget: HTMLElement | null = null;
    let startScrollTop = 0;

    const reset = () => {
      activeTouchId = null;
      gesture = null;
      startTarget = null;
      scrollTarget = null;
      startScrollTop = 0;
    };
    const findScrollable = (target: EventTarget | null) => {
      let element = target instanceof Element ? target : null;
      while (element && element !== document.body) {
        if (element instanceof HTMLElement) {
          const style = window.getComputedStyle(element);
          if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
        }
        element = element.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
    };
    const cancelGesture = () => {
      getSwipeBackHandler()?.onGestureCancel?.();
      reset();
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
      startTarget = event.target;
      scrollTarget = findScrollable(event.target);
      startScrollTop = scrollTarget?.scrollTop ?? 0;
      const reserved = reserveSystemEdge && touch.clientX <= IOS_SYSTEM_EDGE_WIDTH;
      gesture = beginWebSwipeGesture(touch.clientX, touch.clientY, reserved);
      // Safari can claim its native history gesture immediately at the extreme
      // edge. Active internal step flows reserve that lane on touchstart.
      if (reserved) event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = activeTouch(event.touches);
      if (!touch) return;
      if (!gesture) return;
      const move = moveWebSwipeGesture(gesture, touch.clientX, touch.clientY);
      gesture = move.state;
      if (move.kind === 'waiting') return;
      event.preventDefault();
      if (move.kind === 'vertical') {
        getSwipeBackHandler()?.onGestureCancel?.();
        if (scrollTarget) scrollTarget.scrollTop = Math.max(0, startScrollTop - move.dy);
        return;
      }
      getSwipeBackHandler()?.onGestureProgress?.(move.progress);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = activeTouch(event.changedTouches);
      if (!touch) return;
      if (!gesture) return;
      const end = endWebSwipeGesture(gesture, touch.clientX, touch.clientY);
      const tapTarget = startTarget;
      reset();
      if (!end.complete) getSwipeBackHandler()?.onGestureCancel?.();
      if (end.replayTap && tapTarget instanceof Element) {
        const focusTarget = tapTarget.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
        if (focusTarget) { focusTarget.focus(); return; }
        const button = tapTarget.closest<HTMLElement>('button, a, [role="button"]');
        button?.click();
        return;
      }
      if (!end.complete) return;
      const handler = getSwipeBackHandler();
      const confirmUnsaved = handler ? handler.confirmUnsaved : true;
      if (confirmUnsaved && hasUnsavedTypedText() && !window.confirm(UNSAVED_SWIPE_MESSAGE)) return;
      if (handler) { handler.run(); return; }
      if (routerRef.current.canGoBack()) routerRef.current.back();
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', cancelGesture, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, { capture: true });
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
      document.removeEventListener('touchend', onTouchEnd, { capture: true });
      document.removeEventListener('touchcancel', cancelGesture, { capture: true });
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
