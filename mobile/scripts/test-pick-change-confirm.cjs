const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const detail = read('src/app/item/[itemId].tsx');
const choose = read('src/app/pick/choose.tsx');
const dialog = read('src/components/ui/confirm-dialog.tsx');
const toast = read('src/lib/items/pickSavedToast.ts');

assert.match(detail, /myPickStatus\.type === 'selected_other'[\s\S]*?setReplaceConfirmOpen\(true\)/,
  'selected_other opens confirmation instead of navigating directly');
assert.match(detail, /title="이걸로 원픽을 바꿀까요\?"/);
assert.match(detail, /confirmLabel="바꾸고 한줄평 쓰기"/);
assert.match(detail, /대상은 \$\{replacementItemName\}입니다\. 바꾸면 이 항목이 새 원픽이 되고/,
  '61-1 copy avoids name-dependent Korean particles');
assert.match(detail, /replaceConfirmed: '1'/);
assert.match(dialog, /confirmVariant = 'primary'/, 'replacement confirmation is not destructive danger');
assert.match(dialog, /backgroundColor: OnePick\.bgOverlay/, 'shared dialog uses the Foundations overlay token');
assert.doesNotMatch(dialog, /accessibilityRole="alert"/, 'confirmation dialog is modal content, not a live alert');
assert.match(dialog, /variant="secondary"[\s\S]*?fullWidth[\s\S]*?variant=\{confirmVariant\}[\s\S]*?fullWidth/,
  'confirmation actions fill their half-width columns');
assert.match(detail, /consumePickResultToast\(focusPickId\)[\s\S]*?\[focusPickId\]/,
  'item detail consumes the one-shot toast when dismissTo updates the focused Pick');
assert.match(choose, /replacementConfirmed \? '원픽 바꾸기'/);
assert.match(choose, /저장하면 \$\{categoryName\} 원픽이 이걸로 바뀌어요\. 이전 선택은 기록으로 남아요\./);
assert.match(choose, /armPickChangedToast\(result\.id\)/);
assert.match(choose, /router\.dismissTo\(\{ pathname: '\/item\/\[itemId\]'/);
assert.match(toast, /'원픽을 바꿨어요'/);
assert.match(toast, /In-memory only/);

console.log('Figma 61 checks passed: pre-review confirmation, non-danger confirm, replacement copy, item-detail return and one-shot changed toast.');
