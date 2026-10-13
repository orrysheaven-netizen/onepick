import { usePathname, useRootNavigationState, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import {
  canPopFocusedStack, getSwipeBackHandler, hasUnsavedTypedText, SWIPE_MAX_START_DY,
  SWIPE_RELEASE_DX, SWIPE_START_DX, UNSAVED_SWIPE_MESSAGE, useSwipeBackRegistryVersion,
} from '@/lib/navigation/swipeBack';
import { getSwipeSceneController } from '@/lib/navigation/swipeAnimation';
import {
  beginWebSwipeGesture, endWebSwipeGesture, moveWebSwipeGesture, type WebSwipeGestureState,
} from '@/lib/navigation/webSwipeGesture';

// Preserve the 8px pointer responder and its locked header-tap contract.
// Touchscreens additionally capture iOS's 20px history-back edge at document level.
const WEB_EDGE_HIT_WIDTH = 8;
const IOS_TOUCH_EDGE_WIDTH = 20;

const EXCLUDED_PREFIXES = ['/admin', '/auth/callback', '/auth/admin-security'];

export default function SwipeBackEdge() {
  const router = useRouter();
  const pathname = usePathname();
  const rootState = useRootNavigationState();
  useSwipeBackRegistryVersion();

  const excluded = EXCLUDED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  const hasInternalBackTarget = getSwipeBackHandler()?.hasInternalBackTarget === true;
  const hasRealBackTarget = canPopFocusedStack(rootState as never) && router.canGoBack();
  // The locked swipe contract permits an in-screen previous step even without
  // a stack pop. A registered handler without such a target does not enable it.
  const enabled = !excluded && (hasInternalBackTarget || hasRealBackTarget);

  const routerRef = useRef(router);
  routerRef.current = router;

  const completeBack = () => {
    const scene = getSwipeSceneController();
    const handler = getSwipeBackHandler();
    const confirmUnsaved = handler ? handler.confirmUnsaved : true;
    if (confirmUnsaved && hasUnsavedTypedText() && !window.confirm(UNSAVED_SWIPE_MESSAGE)) {
      scene?.cancel();
      return;
    }
    if (!handler && !routerRef.current.canGoBack()) {
      scene?.cancel();
      return;
    }
    const navigate = () => {
      if (handler) { handler.run(); return; }
      if (routerRef.current.canGoBack()) routerRef.current.back();
    };
    if (scene) scene.finish(navigate);
    else navigate();
  };
  const completeBackRef = useRef(completeBack);
  completeBackRef.current = completeBack;
  const documentGestureActive = useRef(false);

  // Keep desktop/pointer support, while touch capture below owns mobile Safari.
  const responder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, gesture) => !documentGestureActive.current
      && gesture.x0 <= WEB_EDGE_HIT_WIDTH
      && gesture.dx > SWIPE_START_DX
      && Math.abs(gesture.dy) < SWIPE_MAX_START_DY,
    onPanResponderMove: (_, gesture) => {
      getSwipeSceneController()?.drag(gesture.dx);
    },
    onPanResponderTerminationRequest: () => false,
    onPanResponderTerminate: () => {
      getSwipeSceneController()?.cancel();
    },
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dx < SWIPE_RELEASE_DX || gesture.vx <= 0) {
        getSwipeSceneController()?.cancel();
        return;
      }
      completeBackRef.current();
    },
  }), []);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    let identifier: number | null = null;
    let gesture: WebSwipeGestureState | null = null;
    let originalTarget: EventTarget | null = null;
    let scrollTarget: HTMLElement | null = null;
    let scrollStart = 0;

    const clear = () => {
      identifier = null;
      gesture = null;
      originalTarget = null;
      scrollTarget = null;
      scrollStart = 0;
      documentGestureActive.current = false;
    };
    const abort = () => {
      getSwipeSceneController()?.cancel();
      clear();
    };
    const tracked = (list: TouchList): Touch | null => {
      if (identifier === null) return null;
      for (let i = 0; i < list.length; i += 1) {
        const touch = list.item(i);
        if (touch?.identifier === identifier) return touch;
      }
      return null;
    };
    const isHorizontalControl = (target: EventTarget | null): boolean => {
      let element = target instanceof Element ? target : null;
      if (element?.closest('input[type="range"], [role="slider"], [data-swipe-back-ignore]')) return true;
      while (element && element !== document.body) {
        if (element instanceof HTMLElement) {
          const css = window.getComputedStyle(element);
          if (/(auto|scroll)/.test(css.overflowX) && element.scrollWidth > element.clientWidth + 2) return true;
        }
        element = element.parentElement;
      }
      return false;
    };
    const findScrollable = (target: EventTarget | null): HTMLElement | null => {
      let element = target instanceof Element ? target : null;
      while (element && element !== document.body) {
        if (element instanceof HTMLElement) {
          const css = window.getComputedStyle(element);
          if (/(auto|scroll)/.test(css.overflowY) && element.scrollHeight > element.clientHeight) return element;
        }
        element = element.parentElement;
      }
      return document.scrollingElement instanceof HTMLElement ? document.scrollingElement : null;
    };

    const onTouchStart = (event: TouchEvent) => {
      if (identifier !== null || event.touches.length !== 1 || getSwipeSceneController()?.isFinishing()) return;
      const touch = event.touches.item(0);
      if (!touch || isHorizontalControl(event.target)) return;
      // On a wide browser/iPad, the app is centered. Use its own left edge
      // rather than incorrectly reacting to the outer page's left margin.
      const frame = document.querySelector('[data-testid="app-swipe-viewport"]');
      const bounds = frame?.getBoundingClientRect();
      const appX = touch.clientX - (bounds?.left ?? 0);
      if (appX < 0 || appX > IOS_TOUCH_EDGE_WIDTH
        || (bounds && (touch.clientY < bounds.top || touch.clientY > bounds.bottom))) return;
      identifier = touch.identifier;
      gesture = beginWebSwipeGesture(touch.clientX, touch.clientY);
      originalTarget = event.target;
      scrollTarget = findScrollable(event.target);
      scrollStart = scrollTarget?.scrollTop ?? 0;
      documentGestureActive.current = true;
      // Safari can take control of history-back before touchmove; reserve the
      // narrow edge at touchstart. A short tap is replayed on touchend.
      if (event.cancelable) event.preventDefault();
    };
    const onTouchMove = (event: TouchEvent) => {
      if (identifier === null) return;
      if (event.touches.length !== 1) { abort(); return; }
      const touch = tracked(event.touches);
      if (!touch || !gesture) return;
      const movement = moveWebSwipeGesture(gesture, touch.clientX, touch.clientY);
      gesture = movement.state;
      if (movement.kind === 'waiting') return;
      if (event.cancelable) event.preventDefault();
      if (movement.kind === 'vertical') {
        getSwipeSceneController()?.cancel();
        // Only a 20px edge zone is captured. Preserve ordinary vertical
        // scrolling in that lane when Safari's default was prevented.
        if (scrollTarget) scrollTarget.scrollTop = Math.max(0, scrollStart - movement.dy);
        return;
      }
      getSwipeSceneController()?.drag(movement.progress);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = tracked(event.changedTouches);
      if (!touch || !gesture) return;
      // A fast flick can deliver its final displacement on touchend.
      const atRelease = moveWebSwipeGesture(gesture, touch.clientX, touch.clientY);
      const end = endWebSwipeGesture(atRelease.state, touch.clientX, touch.clientY);
      const tapTarget = originalTarget;
      clear();
      if (!end.complete) {
        getSwipeSceneController()?.cancel();
        if (end.replayTap && tapTarget instanceof Element) {
          const focusable = tapTarget.closest<HTMLElement>('input, textarea, select, [contenteditable="true"]');
          if (focusable) { focusable.focus(); return; }
          const clickable = tapTarget.closest<HTMLElement>('button, a, [role="button"]');
          clickable?.click();
        }
        return;
      }
      getSwipeSceneController()?.drag(end.dx);
      completeBackRef.current();
    };

    document.addEventListener('touchstart', onTouchStart, { capture: true, passive: false });
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
    document.addEventListener('touchend', onTouchEnd, { capture: true, passive: true });
    document.addEventListener('touchcancel', abort, { capture: true, passive: true });
    return () => {
      document.removeEventListener('touchstart', onTouchStart, true);
      document.removeEventListener('touchmove', onTouchMove, true);
      document.removeEventListener('touchend', onTouchEnd, true);
      document.removeEventListener('touchcancel', abort, true);
      abort();
    };
  }, [enabled]);

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
    touchAction: 'pan-y',
  } as never,
});
