// Home-only bottom tab bar hide/show by scroll direction (#762, user request 2026-10-12):
// scrolling down hides the bar, scrolling up shows it again. Pure so it can be tested
// without a renderer; the Home screen feeds it FlatList scroll events.

// Minimum travel in one direction before the bar toggles, so finger jitter and tiny
// scrolls never flip it back and forth.
export const HOME_TAB_BAR_SCROLL_THRESHOLD = 24;

export type HomeTabBarScrollState = {
  hidden: boolean;
  // Turning point: the lowest offset seen while shown, the highest while hidden.
  anchorY: number | null;
  // Viewport height of the previous event; a change means the layout moved, not the finger.
  viewportHeight: number | null;
};

export const initialHomeTabBarScroll: HomeTabBarScrollState = { hidden: false, anchorY: null, viewportHeight: null };

export type HomeTabBarScrollSample = { offsetY: number; contentHeight: number; viewportHeight: number };

export function nextHomeTabBarScroll(state: HomeTabBarScrollState, sample: HomeTabBarScrollSample): HomeTabBarScrollState {
  const { offsetY, contentHeight, viewportHeight } = sample;
  // Clamp away pull-to-refresh / end bounce overscroll so rubber-banding is not "a scroll up".
  const maxY = Math.max(0, contentHeight - viewportHeight);
  const y = Math.min(Math.max(offsetY, 0), maxY);
  // At the top (or content too short to scroll) the bar is always shown.
  if (y <= 0) return { hidden: false, anchorY: 0, viewportHeight };
  // First event after (re)focus or a list swap, or the viewport resized (the bar itself
  // appearing/disappearing, a rotation): take a new baseline without toggling.
  if (state.anchorY === null || state.viewportHeight !== viewportHeight) return { ...state, anchorY: y, viewportHeight };
  if (!state.hidden) {
    if (y - state.anchorY >= HOME_TAB_BAR_SCROLL_THRESHOLD) return { hidden: true, anchorY: y, viewportHeight };
    return { ...state, anchorY: Math.min(state.anchorY, y) };
  }
  if (state.anchorY - y >= HOME_TAB_BAR_SCROLL_THRESHOLD) return { hidden: false, anchorY: y, viewportHeight };
  return { ...state, anchorY: Math.max(state.anchorY, y) };
}
