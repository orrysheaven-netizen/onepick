// One-shot handoff from /pick/new and /pick/choose to the item detail they replace
// themselves with. In-memory only: a reload, a back-navigation or a shared link must
// not replay the completion toast.
let pending: { pickId: string; message: string } | null = null;

export function armPickSavedToast(pickId: string, message = '원픽을 정했어요.') {
  pending = { pickId, message };
}

/** The toast message for this Pick, once; null otherwise. */
export function consumePickSavedToast(pickId: string | undefined): string | null {
  if (!pickId || pending?.pickId !== pickId) return null;
  const { message } = pending;
  pending = null;
  return message;
}
