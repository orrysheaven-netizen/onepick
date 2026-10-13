/**
 * One web-app scene owns its visual swipe progress. Navigation remains owned by
 * the focused Expo Router screen; this registry never changes routing itself.
 */
export type SwipeSceneController = {
  drag: (dx: number) => void;
  cancel: () => void;
  finish: (navigate: () => void) => void;
  isFinishing: () => boolean;
};

let activeScene: SwipeSceneController | null = null;

export function getSwipeSceneController(): SwipeSceneController | null {
  return activeScene;
}

export function registerSwipeSceneController(controller: SwipeSceneController): () => void {
  activeScene = controller;
  return () => {
    if (activeScene === controller) activeScene = null;
  };
}
