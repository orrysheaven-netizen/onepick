const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const item = read('src/app/item/[itemId].tsx');
const choose = read('src/app/pick/choose.tsx');
const toast = read('src/lib/items/pickSavedToast.ts');

// Figma 61-1: "원픽 바꾸기" asks before the review is written; 취소 stays on 36.
assert.match(item, /if \(myPickStatus\.type === 'selected_other'\) setConfirmChange\(true\);\s*else openChoose\(\);/);
assert.match(item, /<Text style=\{styles\.dialogTitle\}>원픽을 바꿀까요\?<\/Text>/);
assert.match(item, /\{changeMenu\} 원픽이 이미 있어요\. 바꾸면 \{changeTarget\}이 새 원픽이 돼요\./, 'names only the new Pick, never the old store');
assert.match(item, /label="취소" onPress=\{\(\) => setConfirmChange\(false\)\}/);
assert.match(item, /label="바꾸고 한줄평 쓰기" onPress=\{openChoose\}/, 'primary, not danger: a change is a choice');
// Figma 61-2 / 61-3: menu-named notice, then straight back to 36 with "원픽을 바꿨어요."
assert.match(choose, /저장하면 \$\{itemQuery\.data\?\.category\?\.name\?\.trim\(\)/);
assert.match(choose, /armPickSavedToast\(result\.id, '원픽을 바꿨어요\.'\);\s*router\.replace\(\{ pathname: '\/item\/\[itemId\]', params: \{ itemId: result\.itemId, pickId: result\.id \} \}\);/);
assert.match(item, /<Text style=\{styles\.toastText\}>\{pickSavedToast\}<\/Text>/);
assert.match(toast, /export function armPickSavedToast\(pickId: string, message = '원픽을 정했어요\.'\)/);

console.log('Pick change confirm checks passed: confirm before writing, menu-named notice, back to the item with "원픽을 바꿨어요."');
