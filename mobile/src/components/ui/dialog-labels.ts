// Shared copy contract for the secondary (left) action of every dialog, confirm card, sheet and
// inline confirmation. Mirrors the Figma Foundations "Confirm Dialog" component (311:997), whose
// left button defaults to "닫기".
//
// Rule (OnePick-wide, 2026-10-06):
// - The action only dismisses the dialog/sheet/confirmation → DIALOG_CLOSE_LABEL ("닫기"). This is
//   the default; new screens use it unless they fall under the exception below.
// - The action really cancels work in progress (typed input, an edit mode, a multi-step flow,
//   an upload) → DIALOG_CANCEL_LABEL ("취소"), passed explicitly at the call site.
export const DIALOG_CLOSE_LABEL = '닫기';
export const DIALOG_CANCEL_LABEL = '취소';

export type DialogSecondaryKind = 'close' | 'cancel';

/** Default secondary label; `kind` defaults to `'close'` so only real cancels opt into "취소". */
export function dialogSecondaryLabel(kind: DialogSecondaryKind = 'close'): string {
  return kind === 'cancel' ? DIALOG_CANCEL_LABEL : DIALOG_CLOSE_LABEL;
}
