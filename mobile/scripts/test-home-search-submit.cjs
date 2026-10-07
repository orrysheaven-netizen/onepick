const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'src');
const itemSearch = fs.readFileSync(path.join(root, 'components', 'item-search.tsx'), 'utf8');
const home = fs.readFileSync(path.join(root, 'app', '(tabs)', 'index.tsx'), 'utf8');
const explore = fs.readFileSync(path.join(root, 'app', '(tabs)', 'explore.tsx'), 'utf8');

assert.match(itemSearch, /initialQuery\?: string/);
assert.match(itemSearch, /onSubmitSearch\?: \(query: string\) => void/);
assert.match(itemSearch, /onSubmitSearch\?\.\(normalizedSearch\)/);
assert.match(itemSearch, /accessibilityLabel="검색 실행"/);
assert.match(itemSearch, /<Text style=\{styles\.submitText\}>검색하기<\/Text>/);
// Home (Figma 30-1B/C): the search button opens a dialog that runs the existing item search
// for the submitted text and opens a result in the existing item detail.
const header = fs.readFileSync(path.join(root, 'components', 'home-header.tsx'), 'utf8');
assert.match(home, /<HomeHeader onOpenItem=\{openItem\} \/>/);
assert.doesNotMatch(home, /<ItemSearch\b/, 'Home has no inline search field');
assert.match(header, /useItemSearch\(submitted\)/);
assert.match(header, /어떤 메뉴를 찾으세요\?/);
assert.match(header, /label="검색하기" onPress=\{search\}/);
assert.match(header, /onPress=\{\(\) => onOpenItem\(item\.id\)\}/);
assert.match(header, /테마 선택/);
assert.match(header, /다른 테마는 준비 중이에요\./);
assert.match(header, /맛집 ✓/);
// Only the Figma 30-1B placeholder may name an example; results are never hard-coded (PM, #709).
assert.doesNotMatch(header.replace('placeholder="예: 라멘"', ''), /라멘|원픽 ?21/, 'No hard-coded Figma sample results');
assert.match(explore, /useLocalSearchParams<ExploreParams>/);
assert.match(explore, /incomingQuery/);
assert.match(explore, /initialQuery=\{incomingQuery\}/);
assert.match(explore, /setSearchOpen\(true\)/);
assert.match(explore, /onSearchBook=/);

console.log('Home search submit checks passed: Home search dialog, Explore query handoff, auto-open, query hydration, external provider actions.');
