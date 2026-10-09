const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const explore = read('src/app/(tabs)/explore.tsx');
const results = read('src/components/explore-search-results.tsx');
const repository = read('src/repositories/supabase/supabaseReadRepository.ts');

// Figma 43: no separate search screen — typing swaps the menu list for inline results.
assert.match(explore, /const searchActive = !scope\.showChips && searchText\.trim\(\)\.length > 0;/);
assert.match(explore, /!scope\.showChips && !searchActive && !selectedCategoryId/, 'menu list hides while searching');
assert.match(explore, /!scope\.showChips && !searchActive && menuLoadFailed/, 'the menu-load error card hides while searching');
assert.match(explore, /accessibilityLabel="검색어 지우기"[\s\S]{0,200}<Icon name="clear" size="sm"/, 'the shared 16px clear icon (not a × glyph) clears the box');
assert.match(explore, /onRegister=\{\(\) => router\.push\('\/pick\/new'\)\}/, 'empty results lead to registration (75)');
// Two groups: "메뉴 N" → menu detail, then "매장 원픽 N" → item detail with "원픽 N 지역".
assert.match(results, /title=\{`메뉴 \$\{matchedMenus\.length\}`\}/);
assert.match(results, /title=\{`매장 원픽 \$\{items\.length\}`\}/);
assert.match(results, /'원픽을 모으고 있어요\.'/);
assert.ok(results.includes('메뉴 이름과 일치하는 결과는 없어요. 매장 이름이 들어간 원픽만 보여드려요.'));
assert.match(results, /title=\{`‘\$\{needle\}’ 검색 결과가 없어요\.`\}/);
assert.match(results, /label: '원픽 등록하기'/);
assert.match(repository, /async getSearchItemMeta\(itemIds: string\[\]\)/);
assert.match(repository, /rpc\('search_item_pick_counts', \{ p_item_ids: ids \}\)/, 'one server aggregate for Pick counts');
assert.doesNotMatch(repository, /from\('picks'\)\.select\('item_id'\)\.in\('item_id', ids\)/, 'search metadata must not download Pick rows to count in JS');

console.log('Explore inline search checks passed: menu + store Pick groups, notice, empty state with registration, × clear.');
