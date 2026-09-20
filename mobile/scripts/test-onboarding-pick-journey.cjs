const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

function load(relative, imports = {}) {
  const moduleExports = {};
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(output, {
    exports: moduleExports,
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail(`Unexpected import: ${name}`);
    },
  });
  return moduleExports;
}

async function main() {
  const { queryKeys } = load('src/lib/query/queryKeys.ts');
  const { invalidatePickData } = load('src/lib/query/invalidatePickData.ts', {
    './queryKeys': { queryKeys },
  });

  const cache = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const userId = 'owner';
  const categoryId = 'ramen';
  const itemId = 'item-ramen';
  const profileKey = queryKeys.profiles.mine(userId);
  const tasteKey = queryKeys.profileTaste.composition(userId, userId);
  const aiKey = queryKeys.profileAi.status(userId);

  cache.setQueryData(queryKeys.home.data(userId), { featuredItems: [] });
  cache.setQueryData(queryKeys.items.detail(itemId, userId), { item: { id: itemId } });
  cache.setQueryData(queryKeys.picks.current(userId, categoryId), null);
  cache.setQueryData(profileKey, {
    profile: { id: userId, username: 'owner' },
    currentPicks: Array.from({ length: 4 }, (_, index) => ({ pick: { id: `p${index + 1}` } })),
  });
  cache.setQueryData(tasteKey, { totalPickCount: 4 });
  cache.setQueryData(aiKey, { currentPickCount: 4, canGenerate: false, reason: 'NEED_MORE_PICKS' });
  cache.setQueryData(queryKeys.explore.data(), { pages: [] });

  let mutationOptions;
  const savedPick = {
    id: 'pick-5', userId, categoryId, itemId, oneLineReview: '매운맛이 제일 좋아요', status: 'active',
  };
  const { useChoosePick } = load('src/hooks/useChoosePick.ts', {
    '@tanstack/react-query': {
      useQueryClient: () => cache,
      useMutation: (options) => { mutationOptions = options; return options; },
    },
    '@/lib/query/invalidatePickData': { invalidatePickData },
    '@/services': {
      pickService: { choosePick: async () => savedPick },
      observabilityService: { captureProductEvent: async () => {} },
    },
  });
  useChoosePick();
  assert.ok(mutationOptions, 'useChoosePick must expose a mutation contract');

  const returnedPick = await mutationOptions.mutationFn({ categoryId, itemId, oneLineReview: savedPick.oneLineReview });
  assert.equal(returnedPick.id, savedPick.id);
  await mutationOptions.onSuccess(returnedPick);
  await new Promise((resolve) => setImmediate(resolve));

  for (const [name, key] of [
    ['home', queryKeys.home.all],
    ['items', queryKeys.items.all],
    ['picks', queryKeys.picks.all],
    ['profiles', queryKeys.profiles.all],
    ['profile taste', queryKeys.profileTaste.all],
    ['profile AI', queryKeys.profileAi.all],
    ['explore', queryKeys.explore.all],
  ]) {
    const states = cache.getQueryCache().findAll({ queryKey: key });
    assert.ok(states.length > 0, `${name} fixture query is missing`);
    assert.equal(states.every((query) => query.state.isInvalidated), true, `${name} must be invalidated after Pick save`);
  }

  assert.equal(cache.getQueryState(aiKey).isInvalidated, true, '4→5 Pick save must invalidate the cached AI eligibility state');

  cache.setQueryData(profileKey, {
    profile: { id: userId, username: 'owner' },
    currentPicks: [
      { pick: { id: 'p1', categoryId: 'snacks' } },
      { pick: { id: 'p2', categoryId: 'drama' } },
      { pick: { id: 'p3', categoryId: 'phone' } },
      { pick: { id: 'p4', categoryId: 'notebook' } },
      { pick: savedPick },
    ],
  });
  cache.setQueryData(aiKey, { currentPickCount: 5, canGenerate: true, reason: 'READY_FIRST' });
  assert.equal(cache.getQueryData(profileKey).currentPicks.length, 5);
  assert.equal(cache.getQueryData(aiKey).reason, 'READY_FIRST');

  const sequence = load('src/lib/onboarding/categorySequence.ts', {
    '@/types/domain/category': {},
  });
  const category = (id, slug, parentId = null) => ({
    id, slug, parentId, name: slug, label: slug, status: 'open', isVisible: true, isPickable: true, sortOrder: 0,
  });
  const onboardingCategories = [
    category('ramen', 'ramen', 'food'),
    category('movie', 'movie', 'culture'),
    category('drama', 'drama', 'culture'),
  ];
  const next = sequence.chooseOnboardingCategory({
    categories: onboardingCategories,
    currentCategoryId: 'ramen',
    handledCategoryIds: ['ramen'],
    events: [],
    userId,
  });
  assert.equal(next.slug, 'movie', 'after the ramen Pick is reflected in profile, stale onboarding current state must not repeat ramen');

  const onboardingSource = read('src/app/onboarding.tsx');
  const findSource = read('src/app/pick/find.tsx');
  const chooseSource = read('src/app/pick/choose.tsx');

  assert.match(onboardingSource, /pathname: '\/pick\/find'[\s\S]*?categoryId: current\.id, onboarding: '1'/, 'onboarding must hand category + onboarding intent to Pick finder');
  assert.match(findSource, /pathname: '\/pick\/choose'[\s\S]*?onboarding: '1'/, 'Pick finder must preserve onboarding intent into choose screen');
  assert.match(chooseSource, /onboardingService\.recordAction\(item\.categoryId, 'picked'\)/, 'successful save must record onboarding picked');
  assert.match(chooseSource, /accessibilityLabel="다음 카테고리로 이동"[\s\S]*?router\.replace\('\/onboarding'\)/, 'saved onboarding Pick must offer the next category');
  assert.match(chooseSource, /accessibilityLabel="온보딩을 나중에 이어서 하기"[\s\S]*?router\.replace\('\/profile'\)/, 'saved onboarding Pick must allow returning to profile');

  const invalidationSource = read('src/lib/query/invalidatePickData.ts');
  assert.match(invalidationSource, /queryKeys\.profileAi\.all/, 'Pick invalidation contract must include profile AI eligibility');

  cache.clear();
  console.log('Onboarding Pick journey passed: onboarding handoff, choose save, profile/taste/AI invalidation, 4→5 AI eligibility refresh, picked event, and next-category progression.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
