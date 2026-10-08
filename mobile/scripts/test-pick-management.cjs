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
      if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
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
    removePick: async (categoryId, channel) => { repositoryCalls.push(channel ? `${categoryId}:${channel}` : categoryId); },
    deleteReview: async (pickId) => { repositoryCalls.push(`delete:${pickId}`); },
  });
  const result = await service.updateReview({ pickId: 'pick-1', oneLineReview: '  바꾼 이유  ' });
  assert.equal(result.oneLineReview, '바꾼 이유');
  for (const review of ['', '   ', 'x'.repeat(101)]) {
    assert.throws(() => service.updateReview({ pickId: 'pick-1', oneLineReview: review }),
      (error) => error.code === 'REVIEW_INVALID');
  }
  assert.equal(repositoryCalls.length, 1, 'Invalid reviews never reach the repository');
  await service.removePick('category-1');
  assert.equal(repositoryCalls[1], 'category-1');
  await service.removePick('category-1', 'recipe');
  assert.equal(repositoryCalls[2], 'category-1:recipe', 'A food Pick is removed by menu and channel');

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
  const { updateReview, removePick, deleteReview } = useManagePick();
  await updateReview.mutationFn({ pickId: 'pick-1', oneLineReview: '수정' });
  await updateReview.onSuccess();
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');
  invalidated.length = 0;
  await removePick.mutationFn({ categoryId: 'category-2', channel: 'online' });
  await removePick.onSuccess();
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');
  assert.equal(repositoryCalls.at(-1), 'category-2:online');
  invalidated.length = 0;
  await deleteReview.mutationFn('pick-1');
  await deleteReview.onSuccess();
  assert.equal(repositoryCalls.at(-1), 'delete:pick-1');
  assert.equal(invalidated.sort().join(','), 'explore,home,items,picks,profile-ai,profile-taste,profiles');

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
  const { PickManagement, PickManagementActions } = loadSource('components/pick-management.tsx', {
    'react-native': native,
    '@/errors/appError': { AppError },
    '@/hooks/useManagePick': { useManagePick: () => ({ updateReview: {}, removePick: {}, deleteReview: {} }) },
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
    '@/components/current-pick-flag': { CurrentPickFlag: () => React.createElement('i', null, 'flag') },
    '@/components/pick-replies': { PickReplies: () => null },
    '@/components/pick-share-actions': { PickShareActions: () => null },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null } }),
    '@/components/pick-management': { PickManagement, PickManagementActions },
    '@/components/report-action': { ReportAction: () => null },
    '@/errors/appError': { AppError },
    '@/hooks/useAuthSession': { useAuthSession: () => session },
    '@/hooks/useCreateComment': { useCreateComment: () => ({}) },
    '@/hooks/usePickComments': { usePickComments: () => ({ data: [] }) },
    '@/hooks/usePickDetail': { usePickDetail: () => query },
    '@/lib/demoProfile': { isDemoUsername: (username) => typeof username === 'string' && username.trim().toLowerCase().startsWith('demo_') },
  });
  const render = () => renderToStaticMarkup(React.createElement(ItemReviewCard, { pick: data.pick, profile: data.profile, categoryName: data.category.name, itemName: data.item.name, focused: false, highlighted: false, onRemoved() {} }));
  // The owner's corner actions replace the old 내 원픽 관리 box and badge.
  const manage = />수정<[\s\S]*>원픽 해제</;
  assert.match(render(), manage);
  assert.match(render(), /내 한줄평/);
  assert.doesNotMatch(render(), /내 원픽 관리|내 원픽</);
  session = { user: { id: 'someone' }, isLoading: false };
  assert.doesNotMatch(render(), manage);
  session = { user: null, isLoading: false };
  assert.doesNotMatch(render(), manage);
  session = { user: { id: 'owner' }, isLoading: true };
  assert.doesNotMatch(render(), manage);
  session.isLoading = false;
  data.isCurrent = false;
  data.pick.status = 'replaced';
  assert.doesNotMatch(render(), manage);
  data.isCurrent = true;
  data.pick.status = 'needs_review';
  assert.match(render(), manage);

  console.log('Pick management checks passed: review validation, mutation routing, cache refresh, viewer isolation and screen visibility.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
