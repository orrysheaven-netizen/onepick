const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
function load(p, imports = {}) {
  const exports = {};
  const output = ts.transpileModule(read('src/' + p), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(output, { exports, require: (name) => {
    assert.ok(name in imports, 'Unexpected import: ' + name);
    return imports[name];
  }});
  return exports;
}

(async () => {
  const calls = [];
  const readRepository = {
    getCategoryTopItems: async (...args) => { calls.push(['top', ...args]); return []; },
    getCategoryRanking: async (...args) => { calls.push(['ranking', ...args]); return []; },
    getRankingCategories: async (...args) => { calls.push(['categories', ...args]); return []; },
  };
  const { ExploreService } = load('services/exploreService.ts', {
    '@/repositories/interfaces/categoryRepository': {},
    '@/repositories/interfaces/readRepository': {},
    '@/lib/items/pickChannel': {},
  });
  const service = new ExploreService({}, readRepository);
  await service.getCategoryTopItems('soup', 'offline');
  await service.getCategoryRanking('miyeokguk', 20, 'offline', 'food');
  await service.getRankingCategories('food');
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    ['top', 'soup', 'offline'],
    ['ranking', 'miyeokguk', 20, 'offline', 'food'],
    ['categories', 'food'],
  ]);

  const { queryKeys } = load('lib/query/queryKeys.ts', {
    '@/repositories/interfaces/readRepository': {},
  });
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(queryKeys.explore.ranking('miyeokguk', 'offline', 'food'))),
    JSON.parse(JSON.stringify(queryKeys.explore.ranking('miyeokguk', 'online', 'food'))),
    'Different rollout channels have isolated ranking caches',
  );
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(queryKeys.explore.rankingCategories('food'))),
    JSON.parse(JSON.stringify(queryKeys.explore.rankingCategories(null))),
    'Food ranking category cache is isolated from the future full catalogue',
  );

  const explore = read('src/app/(tabs)/explore.tsx');
  assert.match(explore, /useCategoryTopItems\(selectedCategoryId, OnePickMvp\.publicPickChannel\)/);

  const index = read('src/app/ranking/index.tsx');
  assert.match(index, /useRankingCategories\(true, OnePickMvp\.browseGroupSlug\)/);

  const detail = read('src/app/ranking/[slug].tsx');
  assert.match(detail, /useCategoryRanking\(slug, RANKING_PAGE_SIZE, OnePickMvp\.publicPickChannel, OnePickMvp\.browseGroupSlug\)/);
  assert.match(detail, /useRankingCategories\(Boolean\(slug\), OnePickMvp\.browseGroupSlug\)/);
  assert.doesNotMatch(detail, /useCategoryBySlug/, 'Direct non-food ranking URLs are gated by the food ranking list');
  assert.match(detail, /fixedChannel=\{OnePickMvp\.publicPickChannel\}/);

  const functionSource = read('functions/ranking/[slug].ts');
  assert.match(functionSource, /p_channel: 'offline', p_root_slug: 'food'/);
  assert.match(functionSource, /p_root_slug: 'food'/);

  const sitemap = read('functions/sitemap.xml.ts');
  assert.match(sitemap, /JSON\.stringify\(\{ p_root_slug: 'food' \}\)/);

  console.log('MVP ranking scope checks passed: app, repository contract, SSR and sitemap use offline + food while scoped caches stay isolated.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
