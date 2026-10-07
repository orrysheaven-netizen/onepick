import { SWIPE_MAX_START_DY, SWIPE_RELEASE_DX, SWIPE_START_DX } from './swipeBack';

export type WebSwipeGestureState = {
  startX: number;
  startY: number;
  lastX: number;
  claimed: boolean;
  reservedSystemEdge: boolean;
  verticalScroll: boolean;
};

export type WebSwipeMove =
  | { kind: 'waiting'; state: WebSwipeGestureState; dx: number; dy: number }
  | { kind: 'horizontal'; state: WebSwipeGestureState; dx: number; dy: number; progress: number }
  | { kind: 'vertical'; state: WebSwipeGestureState; dx: number; dy: number };

export function beginWebSwipeGesture(x: number, y: number, reserveSystemEdge: boolean): WebSwipeGestureState {
  return {
    startX: x,
    startY: y,
    lastX: x,
    claimed: reserveSystemEdge,
    reservedSystemEdge: reserveSystemEdge,
    verticalScroll: false,
  };
}

export function moveWebSwipeGesture(state: WebSwipeGestureState, x: number, y: number): WebSwipeMove {
  const dx = x - state.startX;
  const dy = y - state.startY;

  if (state.reservedSystemEdge && !state.verticalScroll
    && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > SWIPE_START_DX) {
    return {
      kind: 'vertical',
      dx,
      dy,
      state: { ...state, claimed: false, verticalScroll: true, lastX: x },
    };
  }
  if (state.verticalScroll) {
    return { kind: 'vertical', dx, dy, state: { ...state, lastX: x } };
  }

  if (!state.claimed) {
    if (Math.abs(dy) >= SWIPE_MAX_START_DY || dx <= SWIPE_START_DX) {
      return { kind: 'waiting', dx, dy, state: { ...state, lastX: x } };
    }
    state = { ...state, claimed: true };
  }

  return {
    kind: 'horizontal',
    dx,
    dy,
    progress: Math.max(0, dx),
    state: { ...state, lastX: x },
  };
}

export function endWebSwipeGesture(state: WebSwipeGestureState, x: number, y: number) {
  const dx = x - state.startX;
  const dy = y - state.startY;
  const endedMovingRight = x >= state.lastX;
  return {
    complete: !state.verticalScroll && state.claimed && dx >= SWIPE_RELEASE_DX && endedMovingRight,
    replayTap: state.reservedSystemEdge
      && !state.verticalScroll
      && Math.abs(dx) <= SWIPE_START_DX
      && Math.abs(dy) <= SWIPE_START_DX,
    dx,
    dy,
  };
}
