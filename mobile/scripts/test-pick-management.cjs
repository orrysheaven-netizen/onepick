const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadSource(relativePath, imports = {}) {
  const file = path.join(__dirname, '..', 'src', relativePath);
  const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

async function main() {
  const { AppError } = loadSource('errors/appError.ts');
  const { PickService } = loadSource('services/pickService.ts', {
    '@/errors/appError': { AppError },
  });
  const repositoryCalls = [];
  const service = new PickService({
    updateReview: async (input) => { repositoryCalls.push(input); return input; },
    removePick: async (input) => { repositoryCalls.push(input); },
    setRepresentative: async (pickId) => { repositoryCalls.push({ representative: pickId }); return { id: pickId, position: 1 }; },
  });
  const result = await service.updateReview({ pickId: 'pick-1', oneLineReview: '  바꾼 이유  ' });
  assert.equal(result.oneLineReview, '바꾼 이유');
  for (const review of ['', '   ', 'x'.repeat(101)]) {
    assert.throws(() => service.updateReview({ pickId: 'pick-1', oneLineReview: review }),
      (error) => error.code === 'REVIEW_INVALID');
  }
  assert.equal(repositoryCalls.length, 1, 'Invalid reviews never reach the repository');
  await service.removePick({ categoryId: 'category-1', pickId: 'pick-1' });
  assert.deepEqual(repositoryCalls[1], { categoryId: 'category-1', pickId: 'pick-1' }, 'Removal names the exact pick, not just its category');

  const { queryKeys } = loadSource('lib/query/queryKeys.ts');
  const { invalidatePickData } = loadSource('lib/query/invalidatePickData.ts', {
    './queryKeys': { queryKeys },
  });
  const invalidated = [];
  const queryClient = { invalidateQueries: async ({ queryKey }) => { invalidated.push(queryKey[0]); } };
  const capturedEvents = [];
  const hookImports = {
    '@tanstack/react-query': { useMutation: (options) => options, useQueryClient: () => queryClient },
    '@/lib/query/invalidatePickData': { invalidatePickData },
    '@/services': { pickService: service, observabilityService: { captureProductEvent: async (event) => { capturedEvents.push(event); } } },
  };
  const { useManagePick } = loadSource('hooks/useManagePick.ts', hookImports);
  const { updateReview, removePick, setRepresentative } = useManagePick();
  await updateReview.mutationFn({ pickId: 'pick-1', oneLineReview: '수정' });
  await updateReview.onSuccess();
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');
  invalidated.length = 0;
  await removePick.mutationFn({ categoryId: 'category-2', pickId: 'pick-2' });
  await removePick.onSuccess();
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');
  assert.deepEqual(repositoryCalls.at(-1), { categoryId: 'category-2', pickId: 'pick-2' });
  invalidated.length = 0;
  await setRepresentative.mutationFn('pick-3');
  await setRepresentative.onSuccess();
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles',
    'Changing the representative refreshes rankings and profiles');
  assert.deepEqual(repositoryCalls.at(-1), { representative: 'pick-3' });

  const { useChoosePick } = loadSource('hooks/useChoosePick.ts', hookImports);
  invalidated.length = 0;
  await useChoosePick().onSuccess({ id: 'pick-c', itemId: 'item-c', categoryId: 'cat-c' });
  assert.equal(capturedEvents.at(-1)?.eventName, 'pick_created', 'Choosing a Pick from management must still record product analytics');
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');

  const { usePickDetail } = loadSource('hooks/usePickDetail.ts', {
    '@tanstack/react-query': { useQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services': { pickService: service },
  });
  const keys = [undefined, 'owner', 'someone'].map((id) => JSON.stringify(usePickDetail('pick-1', id).queryKey));
  assert.equal(new Set(keys).size, 3, 'Ownership-dependent results must be cached per viewer');
  assert.equal(usePickDetail().enabled, false);

  // Render the real screen with query results to verify who can see management controls.
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    ActivityIndicator: () => React.createElement('span', null, 'loading'),
    Pressable: nativeComponent('button'),
    ScrollView: nativeComponent('main'),
    Text: nativeComponent('span'),
    TextInput: () => React.createElement('input'),
    View: nativeComponent('section'),
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  };
  const { PickManagement } = loadSource('components/pick-management.tsx', {
    'react-native': native,
    '@/errors/appError': { AppError },
    '@/hooks/useManagePick': { useManagePick: () => ({ updateReview: {}, removePick: {}, setRepresentative: {} }) },
  });
  let session = { user: { id: 'owner' }, isLoading: false };
  const data = {
    pick: { id: 'pick-1', userId: 'owner', categoryId: 'category-1', oneLineReview: '기존 이유', status: 'active' },
    category: { name: '라면' }, item: { name: '제품' }, profile: { username: 'owner' }, isCurrent: true,
  };
  let query = { data, isPending: false, isError: false };
  const { ItemReviewCard } = loadSource('components/item-review-card.tsx', {
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({ pickId: 'pick-1' }) },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('div') },
    '@/components/pick-replies': { PickReplies: () => null },
    '@/components/pick-share-card': { PickShareCard: () => null },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/pick-management': { PickManagement },
    '@/components/report-action': { ReportAction: () => null },
    '@/errors/appError': { AppError },
    '@/hooks/useAuthSession': { useAuthSession: () => session },
    '@/hooks/useCreateComment': { useCreateComment: () => ({}) },
    '@/hooks/usePickComments': { usePickComments: () => ({ data: [] }) },
    '@/hooks/usePickDetail': { usePickDetail: () => query },
    '@/lib/demoProfile': { isDemoUsername: (username) => typeof username === 'string' && username.trim().toLowerCase().startsWith('demo_') },
  });
  const render = () => renderToStaticMarkup(React.createElement(ItemReviewCard, { pick: data.pick, profile: data.profile, categoryName: data.category.name, itemName: data.item.name, focused: false, highlighted: false, onRemoved() {} }));
  assert.match(render(), /한줄평 수정/);
  assert.match(render(), /원픽 선택 해제/);
  session = { user: { id: 'someone' }, isLoading: false };
  assert.doesNotMatch(render(), /내 원픽 관리/);
  session = { user: null, isLoading: false };
  assert.doesNotMatch(render(), /내 원픽 관리/);
  session = { user: { id: 'owner' }, isLoading: true };
  assert.doesNotMatch(render(), /내 원픽 관리/);
  session.isLoading = false;
  data.isCurrent = false;
  data.pick.status = 'replaced';
  assert.doesNotMatch(render(), /내 원픽 관리/);
  data.isCurrent = true;
  data.pick.status = 'needs_review';
  assert.match(render(), /내 원픽 관리/);
  data.pick.status = 'active';
  data.pick.position = 1;
  assert.doesNotMatch(render(), /대표 원픽으로 지정/, 'The representative (or a single pick) has nothing to promote');
  data.pick.position = 3;
  assert.match(render(), /대표 원픽으로 지정/, 'A later pick in a multi-pick category can become the representative');
  assert.match(render(), /내 원픽 3/);

  console.log('Pick management checks passed: review validation, mutation routing, cache refresh, viewer isolation and screen visibility.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
