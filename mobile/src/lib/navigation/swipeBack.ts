import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

// Web left-edge swipe-back (UX-SWIPE-001).
//
// One edge zone mounted in the root layout owns the gesture on web. A focused
// screen whose back is more than "pop this screen" (step flows, returnTo
// origins, follower lists) registers its own handler here; every other screen
// that sits above a stack root gets the default pop. Native keeps the native
// stack's own swipe; only the public profile adds its own edge zone there.

export const SWIPE_EDGE_WIDTH = 32;
export const SWIPE_START_DX = 12;
export const SWIPE_MAX_START_DY = 24;
export const SWIPE_RELEASE_DX = 72;

export type SwipeBackHandler = {
  run: () => void;
  // false when the handler only moves within the screen (e.g. previous step),
  // so the unsaved-input confirmation is not needed.
  confirmUnsaved: boolean;
  // True only while this screen has a real in-screen previous state. This may
  // enable the web edge gesture even when the router stack itself cannot pop.
  hasInternalBackTarget: boolean;
};

let current: { token: object; get: () => SwipeBackHandler | null } | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export function getSwipeBackHandler(): SwipeBackHandler | null {
  return current?.get() ?? null;
}

/** Re-renders when the focused screen registers or drops a handler. */
export function useSwipeBackRegistryVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const listener = () => setVersion((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);
  return version;
}

/** Registers the focused screen's swipe-back behaviour (web edge gesture). */
export function useSwipeBackHandler(
  run: (() => void) | null,
  options?: { confirmUnsaved?: boolean; hasInternalBackTarget?: boolean },
) {
  const latest = useRef<SwipeBackHandler | null>(null);
  const previousInternalTarget = useRef<boolean | undefined>(undefined);
  latest.current = run ? {
    run,
    confirmUnsaved: options?.confirmUnsaved ?? true,
    hasInternalBackTarget: options?.hasInternalBackTarget ?? false,
  } : null;
  useEffect(() => {
    const next = latest.current?.hasInternalBackTarget ?? false;
    if (previousInternalTarget.current === undefined) {
      previousInternalTarget.current = next;
      return;
    }
    if (previousInternalTarget.current !== next) {
      previousInternalTarget.current = next;
      notify();
    }
  }, [options?.hasInternalBackTarget]);
  useFocusEffect(useCallback(() => {
    const token = {};
    current = { token, get: () => latest.current };
    notify();
    return () => {
      if (current?.token === token) { current = null; notify(); }
    };
  }, []));
}

type NavState = { type?: string; index?: number; routes?: { state?: NavState }[] } | undefined;

/** True when some stack on the focused path has a screen to pop (tab roots: false). */
export function canPopFocusedStack(state: NavState): boolean {
  let node = state;
  while (node && node.routes?.length) {
    const index = node.index ?? node.routes.length - 1;
    if (node.type === 'stack' && index > 0) return true;
    node = node.routes[index]?.state;
  }
  return false;
}

/** Visible, editable text the user typed and would lose by leaving (search boxes excluded). */
export function hasUnsavedTypedText(): boolean {
  if (typeof document === 'undefined') return false;
  const fields = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    'textarea, input:not([type]), input[type="text"], input[type="url"], input[type="email"]',
  );
  return Array.from(fields).some((field) => !field.readOnly && !field.disabled
    && field.offsetParent !== null
    && field.value.trim() !== ''
    && !/검색/.test(field.getAttribute('aria-label') ?? ''));
}

export const UNSAVED_SWIPE_MESSAGE = '작성 중인 내용이 있어요. 나가면 사라질 수 있어요. 나갈까요?';
