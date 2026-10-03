// One-shot handoff into item detail after a Pick save.
// In-memory only: reloads, back-navigation and shared links must never replay it.
export type PickResultToastMessage = '원픽을 정했어요' | '원픽을 바꿨어요';

let pending: { pickId: string; message: PickResultToastMessage } | null = null;

export function armPickSavedToast(pickId: string) {
  pending = { pickId, message: '원픽을 정했어요' };
}

export function armPickChangedToast(pickId: string) {
  pending = { pickId, message: '원픽을 바꿨어요' };
}

export function consumePickResultToast(pickId: string | undefined): PickResultToastMessage | null {
  if (!pickId || pending?.pickId !== pickId) return null;
  const message = pending.message;
  pending = null;
  return message;
}

// Backward-compatible helper used by existing registration regression tests.
export function consumePickSavedToast(pickId: string | undefined) {
  return consumePickResultToast(pickId) !== null;
}
