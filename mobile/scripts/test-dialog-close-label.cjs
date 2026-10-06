// Dialog secondary-button copy contract (OnePick-wide, 2026-10-06):
// the left/secondary action of a dialog, sheet or inline confirmation says "닫기" unless it really
// cancels work in progress, in which case the call site opts into "취소" explicitly through
// DIALOG_CANCEL_LABEL. Mirrors the Figma Foundations "Confirm Dialog" default.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const labels = require('./dialog-labels.cjs');
assert.equal(labels.DIALOG_CLOSE_LABEL, '닫기');
assert.equal(labels.DIALOG_CANCEL_LABEL, '취소');
assert.equal(labels.dialogSecondaryLabel(), '닫기', 'default secondary label is 닫기');
assert.equal(labels.dialogSecondaryLabel('close'), '닫기');
assert.equal(labels.dialogSecondaryLabel('cancel'), '취소');

const srcDir = path.join(__dirname, '../src');
const read = (file) => fs.readFileSync(path.join(srcDir, file), 'utf8');

// Simple-dismiss sites: must render the shared close label, never a literal 취소.
const closeSites = [
  ['components/follow-button.tsx', /<Text style=\{styles\.cancelText\}>\{DIALOG_CLOSE_LABEL\}<\/Text>/],
  ['components/block-user-button.tsx', /<Text style=\{styles\.cancelText\}>\{DIALOG_CLOSE_LABEL\}<\/Text>/],
  ['components/pick-replies.tsx', /accessibilityLabel="댓글 삭제 확인 닫기"[\s\S]*?<Text style=\{styles\.textActionLabel\}>\{DIALOG_CLOSE_LABEL\}<\/Text>/],
  ['components/pick-management.tsx', /mode === 'edit' \? DIALOG_CANCEL_LABEL : DIALOG_CLOSE_LABEL/],
  ['app/settings.tsx', /label=\{DIALOG_CLOSE_LABEL\} onPress=\{\(\) => setConfirmDelete\(false\)\}/],
  ['app/(tabs)/(profile)/u/[username].tsx', /label=\{DIALOG_CLOSE_LABEL\} onPress=\{closeFollowLogin\}/],
];
for (const [file, pattern] of closeSites) assert.match(read(file), pattern, `${file} uses the shared 닫기 label`);

// Real cancels keep 취소, but only through the explicit override constant.
const cancelSites = [
  ['components/profile-bio-editor.tsx', /\{DIALOG_CANCEL_LABEL\}/],
  ['components/profile-social-links.tsx', /\{DIALOG_CANCEL_LABEL\}/],
  ['app/pick/new.tsx', /accessibilityLabel="원픽 등록 취소"[\s\S]*?\{DIALOG_CANCEL_LABEL\}/],
];
for (const [file, pattern] of cancelSites) assert.match(read(file), pattern, `${file} opts into 취소 explicitly`);

// No bare "취소" button label may remain anywhere in the user-facing app tree. Admin tools keep
// their form-cancel buttons (real cancels of an open form) and are listed here on purpose.
const allowedBareCancel = new Set([
  'components/admin/data/items-panel.tsx', // new-item form / alias edit cancel (admin, form in progress)
  'components/admin/data/pending-panel.tsx', // new-category form cancel (admin, form in progress)
]);
const bare = /(>\s*취소\s*<|label=["']취소["']|text:\s*['"]취소['"])/;
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
});
const offenders = walk(srcDir)
  .map((full) => path.relative(srcDir, full).split(path.sep).join('/'))
  .filter((file) => !allowedBareCancel.has(file) && bare.test(read(file)));
assert.deepEqual(offenders, [], `bare 취소 button labels must go through dialog-labels: ${offenders.join(', ')}`);

console.log('Dialog close-label checks passed: 닫기 default, explicit 취소 overrides for real cancels, and no bare 취소 button labels outside admin forms.');
