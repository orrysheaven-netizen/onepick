// #874: registered detail → user-controlled completion + item share security contract.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
function load(relative, inputs = {}) {
  const target = path.join(__dirname, '..', 'src', relative);
  const source = fs.readFileSync(target, 'utf8');
  const result = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports, process: { env: { EXPO_PUBLIC_SHARE_BASE_URL: 'https://onepick.example' } },
    require: (name) => {
      if (name in inputs) return inputs[name];
      assert.fail('Unexpected import ' + name);
    },
  }, { filename: target, timeout: 1000 });
  return exports;
}

// The registration write stays in new.tsx, with the same idempotency requestId;
// route replacement keeps the immutable saved Pick identity in the next screen.
const registration = read('src/app/pick/new.tsx');
assert.match(registration, /registration\.mutateAsync\(/);
assert.match(registration, /const requestId = requestIdRef\.current \?\? Crypto\.randomUUID\(\)/);
assert.match(registration, /requestId,\s*expectedPreviousPickId: expected/);
assert.match(registration, /armPickSavedToast\(result\.pickId\)/);
assert.match(registration, /router\.replace\(\{ pathname: '\/item\/\[itemId\]', params: \{ itemId: result\.itemId, pickId: result\.pickId \} \}\)/);
assert.match(registration, /if \(!user \|\| !store \|\| !menu \|\| busy\.current \|\| saving\) return/);

// An in-memory receipt never accidentally acknowledges a different Pick or a
// browser reload. It gets consumed on the item's first navigation only.
const receipt = load('lib/items/pickSavedToast.ts');
receipt.armPickSavedToast('pick-123');
assert.equal(receipt.consumePickSavedToast('pick-321'), false);
assert.equal(receipt.consumePickSavedToast('pick-123'), true);
assert.equal(receipt.consumePickSavedToast('pick-123'), false);
assert.equal(load('lib/items/pickSavedToast.ts').consumePickSavedToast('pick-123'), false);

// The detail displays completed content first, without showing toast on mount.
// The user must press 完了/완료 to display the transient centered toast.
const detail = read('src/app/item/[itemId].tsx');
assert.match(detail, /const \[hasCompletionReceipt\] = useState\(\(\) => Boolean\(!isSessionLoading && user && consumePickSavedToast\(focusPickId\)\)\)/);
assert.match(detail, /const \[pickSavedToast, setPickSavedToast\] = useState\(false\)/);
assert.match(detail, /const onCompleteRegistration = \(\) => \{[\s\S]*?setCompletionAcknowledged\(true\);\s*setPickSavedToast\(true\);\s*\}/);
assert.match(detail, /<Button label="완료" disabled=\{completionAcknowledged\} onPress=\{onCompleteRegistration\} \/>/);
assert.match(detail, /\{completionEligible \? <View style=\{styles\.completionFooter\}>/);
assert.match(detail, /picks\.some\(\(\{ pick \}\) => pick\.id === focusPickId && pick\.userId === user\.id && !pick\.isDeleted\)/);
assert.match(detail, /if \(!pickSavedToast\) return;\s*const timer = setTimeout\(\(\) => setPickSavedToast\(false\), 2000\)/);
assert.match(detail, /justifyContent: 'center', alignItems: 'center'/);
assert.match(detail, /<Text style=\{styles\.toastText\}>원픽을 등록했어요\.<\/Text>/);
assert.doesNotMatch(detail, /registration\.mutateAsync|onPress=\{\(\) => void save\(/,
  'completed detail cannot perform a second registration write');
assert.doesNotMatch(detail, /bottom: OnePickSpace\.xxxl,[\s\S]{0,220}toastText/, 'completion toast is not bottom-positioned');
assert.match(detail, /accessibilityLabel="홈으로" onPress=\{\(\) => router\.replace\('\/'\)\}/);
assert.match(detail, /headerActionButton: \{ width: 44, height: 44/);

// Item content links and review/Pick links have different route semantics.
const urls = load('lib/share/shareLinks.ts', { 'react-native': { Platform: { OS: 'web' } } });
assert.equal(urls.createItemShareUrl('item-1'), 'https://onepick.example/item/item-1');
assert.equal(urls.createPickShareUrl('pick-1'), 'https://onepick.example/pick/pick-1');
assert.equal(urls.createItemShareUrl('item with space'), 'https://onepick.example/item/item%20with%20space');
assert.match(read('src/lib/share/shareItem.ts'), /createItemShareUrl\(itemId\)/);
assert.match(detail, /accessibilityLabel="이 메뉴 화면 공유"/);
assert.match(detail, /item\.status === 'active' && hasPhoto && !item\.photoPendingReview/);
assert.match(detail, /pick\.status === 'active' && !pick\.isDeleted/);
assert.match(detail, /if \(!canSharePublicItem \|\| isSharingItem\) return/);

// Authenticated owner only: three actions are behind one accessible 'more' button.
// Existing mutation methods and their 24h cooldown/confirmation copy are preserved.
const manage = read('src/components/pick-management.tsx');
const card = read('src/components/item-review-card.tsx');
const shareActions = read('src/components/pick-share-actions.tsx');
assert.match(card, /!isLoading && isMine && \(pick\.canManage \?\? isCurrent\) && !isDeleted/);
assert.match(manage, /accessibilityLabel=\{expanded \? '내 한줄평 더보기 닫기' : '내 한줄평 더보기'\}/);
assert.match(manage, /moreButton: \{ width: 44, height: 44/);
assert.match(manage, /menuRow: \{ minHeight: 48/);
for (const action of ["한줄평 수정", "원픽 해제", "한줄평 삭제"]) assert.match(manage, new RegExp(action));
assert.match(manage, /await updateReview\.mutateAsync/);
assert.match(manage, /await removePick\.mutateAsync/);
assert.match(manage, /await deleteReview\.mutateAsync/);
assert.match(manage, /24시간 동안 같은 원픽/);
assert.match(card, /showShare=\{false\}/);
assert.match(shareActions, /props\.showShare !== false/);
assert.match(shareActions, /canReport = Boolean\(user && user\.id !== props\.authorUserId/);

// Genuine category label only, separate store/menu label; don't mix owner's
// private needs_review result into the public Pick counter.
assert.doesNotMatch(detail, /category\?\.name\s*\?\?\s*['"]카테고리['"]/);
assert.match(detail, /<Text style=\{styles\.detailFieldLabel\}>매장<\/Text>/);
assert.match(detail, /<Text style=\{styles\.detailFieldLabel\}>메뉴<\/Text>/);
assert.match(detail, /<ItemPickCount itemId=\{item\.id\} \/>/);
assert.match(detail, /pick\.status === 'needs_review' && !pick\.isDeleted/);
assert.match(detail, /공개 전 관리자 확인 중이에요/);
assert.match(detail, /myPickStatus\.type === 'selected_this' \? null : canChoose/);
assert.match(card, /<CurrentPickFlag mine=\{isMine\} \/>/);

console.log('Registration completion detail contract: PASS');
