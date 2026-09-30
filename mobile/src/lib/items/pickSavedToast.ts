// One-shot handoff from /pick/new to the item detail it replaces itself with.
// In-memory only: a reload, a back-navigation or a shared link must not replay
// the completion toast.
let pendingPickId: string | null = null;

export function armPickSavedToast(pickId: string) {
  pendingPickId = pickId;
}

export function consumePickSavedToast(pickId: string | undefined) {
  if (!pickId || pendingPickId !== pickId) return false;
  pendingPickId = null;
  return true;
}
