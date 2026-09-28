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
assert.match(itemSearch, /<Button accessibilityLabel="검색 실행"[\s\S]*?label="검색"/);
assert.match(home, /onSubmitSearch=\{\(query\) => router\.push\(\{ pathname: '\/explore', params: \{ search: '1', query \} \}\)\}/);
assert.match(explore, /useLocalSearchParams<ExploreParams>/);
assert.match(explore, /incomingQuery/);
assert.match(explore, /initialQuery=\{incomingQuery\}/);
assert.match(explore, /setSearchOpen\(true\)/);
assert.match(explore, /onSearchBook=/);

console.log('Home search submit checks passed: Home -> Explore query handoff, auto-open, query hydration, external provider actions.');
