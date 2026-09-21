// Guards the request shape of a cold start. The numbers here are configured
// waits and cache windows, not measured device timings: what they protect is
// that the first screen issues its reads in parallel and that a result already
// in memory is reused instead of re-requested.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const home = read('src/app/(tabs)/index.tsx');
// The visible category list is public, identical for every reader and needed by
// the Home filter chips. Gating it behind the feed put a third request in
// series behind the session lookup and the feed itself.
assert.match(home, /useExploreCategories\(\)/, 'Home must request categories without waiting for feed data');
assert.doesNotMatch(home, /useExploreCategories\(Boolean\(/, 'Home must not gate the category list behind another query');

const exploreData = read('src/hooks/useExploreData.ts');
const categoryFresh = exploreData.match(/const CATEGORY_FRESH_MS = ([\d *_]+);/);
assert.ok(categoryFresh, 'The browse category query must declare how long its result stays fresh');
// eslint-disable-next-line no-eval -- a numeric literal from this repository's own source
const categoryFreshMs = eval(categoryFresh[1]);
assert.ok(categoryFreshMs >= 60_000,
  'Categories change only through Admin edits, which invalidate the key; refetching them every 30s is wasted latency');
assert.match(exploreData, /queryKey: queryKeys\.categories\.browse[\s\S]{0,200}staleTime: CATEGORY_FRESH_MS/,
  'The freshness window must apply to the browse category query');

const admin = read('src/hooks/useAdmin.ts');
assert.match(admin, /invalidateQueries\(\{ queryKey: queryKeys\.categories\.all \}\)/,
  'A longer freshness window is only safe while Admin category edits still invalidate the key');

const queryClient = read('src/lib/query/queryClient.ts');
const gcTime = queryClient.match(/gcTime: ([\d *_]+),/);
assert.ok(gcTime, 'The shared query client must declare how long unused results are kept');
// eslint-disable-next-line no-eval -- a numeric literal from this repository's own source
assert.ok(eval(gcTime[1]) >= 20 * 60_000,
  'Dropping a cached page on navigation re-renders an empty loading state on the way back');

const homeService = read('src/services/homeService.ts');
assert.doesNotMatch(homeService, /await this\.categoryRepository/,
  'Home reads must go out together; awaiting the category list first adds a round trip to the first screen');

const headers = read('public/_headers');
assert.match(headers, /\/_expo\/static\/\*\n\s+Cache-Control: public, max-age=31536000, immutable/,
  'The content-hashed JavaScript bundle must be cacheable across visits');
assert.doesNotMatch(headers, /Cache-Control: no-store/,
  'no-store on the Pages host re-downloaded the whole bundle on every visit');

console.log('Startup loading checks passed: parallel Home reads, ungated category list, reused category and page results, cacheable hashed web assets.');
