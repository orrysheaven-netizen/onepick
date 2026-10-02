const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', 'src', relative), 'utf8');
const home = read('app/(tabs)/(home)/index.tsx');
const service = read('services/homeService.ts');
const hooks = read('hooks/useExploreData.ts');

assert.doesNotMatch(service, /getOpenCategories\(/, 'Home context must not repeat the category tree query');
assert.match(home, /useExploreCategories\(!isSessionLoading && !sessionError\)/,
  'Category browsing starts in parallel with Home after session resolution');
assert.doesNotMatch(home, /useExploreCategories\(Boolean\(data\)\)/,
  'Category browsing must not wait for Home data');
assert.match(home, /selectableCategories\(categoryCatalog\)/,
  'Home search/registration derives selectable leaves from the shared browse result');
assert.match(hooks, /staleTime: CATEGORY_BROWSE_STALE_TIME/);
assert.match(hooks, /CATEGORY_BROWSE_STALE_TIME = 5 \* 60_000/);

console.log('Shared category query passed: Home no longer duplicates or serializes the category tree read.');
