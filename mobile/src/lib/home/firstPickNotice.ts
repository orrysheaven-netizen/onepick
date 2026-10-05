// One-shot handoff from a successful Pick save to Home's "원픽 완료 · 친구에게 공유하기" line
// (Figma 30E). Set only from mutation onSuccess, so a cancelled flow or a failed save never
// arms it. In-memory only: a reload, another device or a shared link never replays it.
// Home shows the line only when the saved Pick is the viewer's single current Pick, then
// consumes it so it appears once.

let pending: { userId: string; pickId: string } | null = null;

export function armFirstPickNotice(userId: string, pickId: string) {
  if (!userId || !pickId) return;
  pending = { userId, pickId };
}

/** The just-saved Pick id for this viewer, without consuming it. */
export function peekFirstPickNotice(userId: string | undefined) {
  return userId && pending?.userId === userId ? pending.pickId : null;
}

/** Clears the handoff once Home has shown (or ruled out) the completion line. */
export function consumeFirstPickNotice(userId: string | undefined, pickId: string) {
  if (!userId || pending?.userId !== userId || pending.pickId !== pickId) return false;
  pending = null;
  return true;
}
