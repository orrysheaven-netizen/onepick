import { SWIPE_MAX_START_DY, SWIPE_RELEASE_DX, SWIPE_START_DX } from './swipeBack';

/** Pure touch classifier; DOM capture and animations are deliberately separate. */
export type WebSwipeGestureState = {
  startX: number;
  startY: number;
  peakDx: number;
  claimed: boolean;
  vertical: boolean;
};

export type WebSwipeMove =
  | { kind: 'waiting' | 'vertical'; state: WebSwipeGestureState; dx: number; dy: number }
  | { kind: 'horizontal'; state: WebSwipeGestureState; dx: number; dy: number; progress: number };

export function beginWebSwipeGesture(x: number, y: number): WebSwipeGestureState {
  return { startX: x, startY: y, peakDx: 0, claimed: false, vertical: false };
}

export function moveWebSwipeGesture(state: WebSwipeGestureState, x: number, y: number): WebSwipeMove {
  const dx = x - state.startX;
  const dy = y - state.startY;
  if (state.vertical) return { kind: 'vertical', state, dx, dy };

  if (!state.claimed) {
    if ((Math.abs(dy) >= SWIPE_MAX_START_DY && dx <= SWIPE_START_DX)
      || (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_START_DX)) {
      return { kind: 'vertical', state: { ...state, vertical: true }, dx, dy };
    }
    if (dx <= SWIPE_START_DX) return { kind: 'waiting', state, dx, dy };
  }
  const next = { ...state, claimed: true, peakDx: Math.max(state.peakDx, dx) };
  return { kind: 'horizontal', state: next, dx, dy, progress: Math.max(0, dx) };
}

export function endWebSwipeGesture(state: WebSwipeGestureState, x: number, y: number) {
  const dx = x - state.startX;
  const dy = y - state.startY;
  // Cancelling after pulling the screen back left must never pop navigation.
  const returnedLeft = state.peakDx - dx > 24;
  return {
    complete: state.claimed && !state.vertical && dx >= SWIPE_RELEASE_DX && !returnedLeft,
    replayTap: !state.claimed && !state.vertical
      && Math.abs(dx) <= SWIPE_START_DX && Math.abs(dy) <= SWIPE_START_DX,
    dx,
  };
}
