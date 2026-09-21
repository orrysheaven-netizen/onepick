// Guards the request shape of a cold start. The numbers here are configured
// waits and cache windows, not measured device timings: what they protect is
// that the first screen issues its reads in parallel and that a result already
// in memory is reused instead of re-requested.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

function loadService(relativePath) {
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(read(relativePath), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports: exportsObject, require: () => ({ AppError: Error }) });
  return exportsObject;
}

// A read that resolves only once `open()` is called from another repository.
// Whatever the service was supposed to start in the same round has to reach its
// repository first, so a re-serialised implementation stalls here — and the
// deadline below turns that stall into a failure instead of a silent pass.
function gate() {
  let open;
  const held = new Promise((resolve) => { open = resolve; });
  return { held, open: (value) => open(value) };
}

function within(promise, label) {
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not finish: its reads are still queued behind each other`)), 5_000);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

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

const publicProfile = read('src/app/u/[username].tsx');
assert.match(publicProfile, /useExploreCategories\(\)/,
  'A shared profile link must not queue the public category list behind the profile read');

// react-native-reanimated was the single largest dependency in the web bundle
// (13% of it) and the only module that reached it rendered nothing on web.
const webSplash = read('src/components/animated-icon.web.tsx');
assert.doesNotMatch(webSplash, /^\s*(import|export) [^\n]*['"](react-native-reanimated|react-native-worklets|expo-image)['"]/m,
  'The web splash module must stay free of animation and image dependencies');

async function main() {
  const { ItemService } = loadService('src/services/itemService.ts');
  // Item detail is the screen every feed card opens, and a shared Pick link is
  // a cold open. Only the category row and the viewer's current Pick need the
  // item first; the review page, the category list and a shared link's focused
  // Pick are addressable up front and must go out with it.
  const itemGate = gate();
  const itemCalls = [];
  const detail = new ItemService(
    { getById: async () => { itemCalls.push('item'); return itemGate.held; } },
    { getCurrentPick: async () => { itemCalls.push('current'); return null; } },
    {
      getById: async () => { itemCalls.push('category'); return { id: 'category' }; },
      getOpenCategories: async () => { itemCalls.push('categories'); return [{ id: 'category' }]; },
    },
    {
      getPicks: async () => { itemCalls.push('reviews'); itemGate.open({ id: 'item', categoryId: 'category', status: 'active' }); return []; },
      getPickById: async () => { itemCalls.push('focused'); return null; },
    },
  );
  const detailResult = await within(detail.getItemDetail('item', 'me', 'shared-pick'), 'Item detail');
  assert.equal(detailResult.item.id, 'item');
  const firstRound = itemCalls.slice(0, itemCalls.indexOf('category'));
  assert.deepEqual([...firstRound].sort(), ['categories', 'focused', 'item', 'reviews'],
    'The item row, its review page, the category list and a shared link target must be read in one round');
  assert.equal(Math.abs(itemCalls.indexOf('current') - itemCalls.indexOf('category')), 1,
    'The category row and the current Pick share the one round that needs the item first');

  const { ProfileService } = loadService('src/services/profileService.ts');
  const profileGate = gate();
  const profileCalls = [];
  const profiles = new ProfileService(
    { getById: async () => { profileCalls.push('profile'); return profileGate.held; } },
    { getPicks: async () => { profileCalls.push('collection'); profileGate.open({ id: 'me', username: 'me' }); return []; } },
  );
  const mine = await within(profiles.getMyProfile('me'), 'My profile');
  assert.equal(mine.profile.id, 'me');
  assert.deepEqual([...profileCalls].sort(), ['collection', 'profile'],
    'Both reads are keyed by the same user id and must not wait for each other');

  console.log('Startup loading checks passed: parallel Home, item detail and profile reads, ungated category lists, reused results, reanimated-free web splash, cacheable hashed web assets.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
