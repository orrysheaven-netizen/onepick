const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const route = read('src/lib/categories/registrationRoute.ts');
assert.match(route, /withOnboardingParam/);
assert.match(route, /onboarding: '1'/);
assert.match(route, /registrationRoute\(category:[\s\S]*onboarding\?: OnboardingParam/);
assert.match(route, /withOnboardingParam\(\{ categoryId: category\.id \}, onboarding\)/);

for (const file of ['music.tsx', 'game.tsx', 'book.tsx', 'pokemon.tsx']) {
  const source = read('src/app/pick/' + file);
  assert.match(source, /onboarding\?: string \| string\[\]/, file + ' accepts onboarding');
  assert.match(source, /withOnboardingParam\(\{ itemId, categoryId \}, params\.onboarding\)/, file + ' preserves onboarding into choose');
}

const register = read('src/app/(tabs)/register.tsx');
assert.match(register, /Redirect href="\/pick\/new"/, 'register tab must use store-first entry');

const choose = read('src/app/pick/choose.tsx');
const storeFirst = read('src/app/pick/new.tsx');
const pickToast = read('src/lib/items/pickSavedToast.ts');
assert.match(choose, />원픽을 정했어요<\/Text>/, 'choose completion copy is unified');
const itemDetail = read('src/app/item/[itemId].tsx');
assert.match(storeFirst, /armPickSavedToast\(result\.pickId\)/, 'store-first completion hands off to the item detail toast');
assert.match(pickToast, /message: '원픽을 정했어요'/, 'store-first completion arms the unified saved toast');
assert.match(itemDetail, /<Text style=\{styles\.toastText\}>\{pickResultToast\}<\/Text>/, 'item detail renders the one-shot result toast copy');
assert.doesNotMatch(storeFirst, /등록 요청을 보냈어요|승인 대기/, 'store-first completion has no pending-request success state');

const book = read('src/app/pick/book.tsx');
const pokemon = read('src/app/pick/pokemon.tsx');
assert.match(book, /그래도 없으면 나중에 다시 찾거나 다른 카테고리를 먼저 골라도 돼요/);
assert.match(pokemon, /그래도 없으면 나중에 다시 찾거나 다른 카테고리를 먼저 골라도 돼요/);

console.log('Registration/onboarding route checks passed: shared onboarding helper, catalog pickers, register entry, completion copy and empty-result guidance.');
