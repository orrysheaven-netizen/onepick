const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadSource(relativePath, imports = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === '@/services/onboardingService') return { onboardingService: { recordAction: async () => {} } };
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';

async function main() {
  const { AppError } = loadSource('errors/appError.ts');
  const { ItemService } = loadSource('services/itemService.ts', { '@/errors/appError': { AppError } });
  let category = { id: 'category', status: 'open', isVisible: true, isPickable: true };
  let item = { id: 'item', categoryId: 'category', status: 'active', name: '제품' };
  let currentPick = null;
  const service = new ItemService(
    { getById: async () => item },
    { getCurrentPick: async () => currentPick },
    { getById: async () => category, getOpenCategories: async () => category.status === 'open' && category.isVisible && category.isPickable ? [category] : [] },
    { getPicks: async () => [], getPickById: async () => null },
  );
  assert.equal((await service.getItemDetail('item')).canChoose, true);
  for (const status of ['draft', 'paused', 'closed']) {
    category.status = status;
    assert.equal((await service.getItemDetail('item')).canChoose, false);
  }
  category.status = 'open';
  category.isVisible = false;
  assert.equal((await service.getItemDetail('item')).canChoose, false);
  category.isVisible = true; category.isPickable = false;
  assert.equal((await service.getItemDetail('item')).canChoose, false);
  category.isPickable = true;
  for (const status of ['pending', 'hidden', 'merged', 'rejected']) {
    item.status = status;
    assert.equal((await service.getItemDetail('item')).canChoose, false);
  }
  item.status = 'discontinued';
  assert.equal((await service.getItemDetail('item')).canChoose, true);
  currentPick = { id: 'mine', itemId: 'item', oneLineReview: '기존 한줄평' };
  let detail = await service.getItemDetail('item', 'owner');
  assert.equal(detail.myPickStatus.oneLineReview, '기존 한줄평');

  const presses = [], inputs = [];
  let destination, params = { itemId: 'item' }, pullToRefresh;
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    View: nativeComponent('div'), Text: nativeComponent('span'), RefreshControl: () => null,
    ScrollView: (props) => { if (!props.horizontal) pullToRefresh = props.refreshControl; return React.createElement('main', null, props.children); },
    ActivityIndicator: () => null,
    Image: nativeComponent('img'),
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    TextInput: (props) => { inputs.push(props); return null; },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  };
  const base = {
    '@/components/item-review-card': { ItemReviewCard: () => null },
    '@/components/item-pick-count': { ItemPickCount: () => null },
    '@/components/pick-photo': { PickPhoto: () => null },
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {} }), useLocalSearchParams: () => params },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('section') },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false }) },
    '@/errors/appError': { AppError },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ data: detail }) },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => ({ isPending: false, isError: false, mutateAsync: async () => null }),
      useAttachItemPhoto: () => ({ isPending: false, isError: false, mutateAsync: async () => null, reset() {} }),
    },
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  };
  const render = (Screen) => { presses.length = 0; inputs.length = 0; return renderToStaticMarkup(React.createElement(Screen)); };
  const { default: Item } = loadSource('app/item/[itemId].tsx', base);
  detail = { ...detail, canChoose: false, myPickStatus: { type: 'not_selected' } };
  assert.match(render(Item), /새 원픽을 선택할 수 없어요/);
  assert.ok(!presses.some((p) => textOf(p.children) === '이 제품을 내 원픽으로'));
  detail.myPickStatus = { type: 'selected_this', pickId: 'mine', oneLineReview: '기존 한줄평' };
  render(Item);
  presses.find((p) => textOf(p.children) === '내 원픽 한줄평 보기/수정').onPress();
  assert.equal(destination, undefined, 'Own review action stays on the product page');

  const { default: Choose } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}) },
  });
  assert.match(render(Choose), /지금은 선택할 수 없어요/);
  assert.equal(inputs.length, 0, 'Unavailable items must not show the submission form');
  detail.canChoose = true;
  render(Choose);
  assert.equal(inputs[0].value, '기존 한줄평');

  // A product change starts with a blank review. The action must explain what is
  // missing instead of silently disabling itself or copying the previous reason.
  let chooseStates = [], chooseStateIndex = 0, reviewFocuses = 0;
  const chosenInputs = [];
  const choiceMutation = { isPending: false, mutateAsync: async (input) => { chosenInputs.push(input); return input; } };
  const { default: ChangeChoice } = loadSource('app/pick/choose.tsx', {
    ...base,
    react: { ...React,
      useState: (initial) => {
        const index = chooseStateIndex++;
        if (!(index in chooseStates)) chooseStates[index] = initial;
        return [chooseStates[index], (value) => { chooseStates[index] = value; }];
      },
      useRef: () => ({ current: { focus: () => reviewFocuses++ } }),
    },
    '@/hooks/useChoosePick': { useChoosePick: () => choiceMutation },
  });
  detail.myPickStatus = { type: 'selected_other', pickId: 'previous', itemId: 'previous-item' };
  const renderChoice = () => { chooseStateIndex = 0; return render(ChangeChoice); };
  const changeButton = () => presses.find((p) => p.accessibilityLabel === '이 제품으로 바꾸기');
  renderChoice();
  assert.equal(inputs[0].value, '', 'A new product needs the user’s own reason');
  assert.equal(changeButton().disabled, false);
  changeButton().onPress();
  assert.equal(chosenInputs.length, 0);
  assert.equal(reviewFocuses, 1);
  assert.match(renderChoice(), /한줄평을 입력해주세요/);
  inputs[0].onChangeText('   '); renderChoice(); changeButton().onPress();
  assert.equal(chosenInputs.length, 0, 'Whitespace is not a valid review');
  inputs[0].onChangeText('  삼양라면이 좋아요  ');
  assert.doesNotMatch(renderChoice(), /한줄평을 입력해주세요/);
  choiceMutation.isPending = true; renderChoice();
  assert.equal(changeButton().disabled, true);
  changeButton().onPress(); assert.equal(chosenInputs.length, 0);
  choiceMutation.isPending = false; renderChoice(); changeButton().onPress();
  await flush();
  assert.equal(chosenInputs.length, 1);
  assert.equal(chosenInputs[0].oneLineReview, '삼양라면이 좋아요');
  assert.equal(chosenInputs[0].itemId, 'item');
  assert.match(renderChoice(), /원픽이 선택됐어요/);

  const { default: MissingItem } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}) },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ isPending: true }) },
  });
  params = {};
  assert.match(render(MissingItem), /제품을 불러오지 못했어요/);

  let draft = '  댓글 초안  ', attempts = 0, rejectSave, resolveSave;
  let pick = { id: 'pick', userId: 'owner', status: 'active', oneLineReview: '이유' };
  let mutation = { mutateAsync: () => { attempts++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); } };
  const commentsQuery = { data: [] };
  params = { pickId: 'pick' };
  const { PickReplies } = loadSource('components/pick-replies.tsx', {
    ...base,
    react: { ...React, useState: () => [draft, (value) => { draft = value; }] },
    '@/components/pick-share-card': { PickShareCard: () => null },
    '@/components/pick-photo': { PickPhoto: () => null },
    '@/components/pick-management': { PickManagement: () => null },
    '@/components/report-action': { ReportAction: () => null },
    '@/hooks/usePickDetail': { usePickDetail: () => ({ data: { pick, item, category, profile: { username: 'owner' }, isCurrent: true } }) },
    '@/hooks/usePickComments': { usePickComments: () => commentsQuery },
    '@/hooks/useCreateComment': { useCreateComment: () => mutation },
  });
  const Pick = () => React.createElement(PickReplies, { pickId: 'pick' });
  render(Pick);
  const submit = presses.find((p) => textOf(p.children) === '답글 남기기').onPress;
  const unhandled = [];
  const capture = (error) => unhandled.push(error);
  process.on('unhandledRejection', capture);
  try {
    submit(); submit();
    assert.equal(attempts, 1, 'Rapid taps must submit only once');
    rejectSave(new Error('offline'));
    await flush();
    assert.equal(unhandled.length, 0);
    assert.equal(draft, '  댓글 초안  ', 'Failed saves retain the draft');
    submit();
    assert.equal(attempts, 2, 'A failed request can be retried');
    resolveSave({});
    await flush();
    assert.equal(draft, '', 'Successful saves clear the draft');
  } finally { process.removeListener('unhandledRejection', capture); }
  pick.status = 'needs_review';
  assert.match(render(Pick), /확인이 필요한 원픽에는 새 답글을 남길 수 없습니다/);
  assert.equal(inputs.length, 0);
  pick.status = 'active';
  mutation = { isError: true, error: new AppError('PROFILE_NOT_FOUND') };
  assert.match(render(Pick), /사용자명 만들고 계속/);
  presses.find((p) => textOf(p.children) === '사용자명 만들고 계속').onPress();
  assert.equal(destination.params.action, 'comment_pick');
  assert.equal(destination.params.pickId, 'pick');
  let commentPages = 0, fullCommentRefreshes = 0;
  Object.assign(commentsQuery, {
    data: [{ comment: { id: 'cached', body: '이미 불러온 댓글' }, author: null }],
    hasNextPage: true, isError: true, isFetchNextPageError: true, isFetching: false,
    fetchNextPage: (options) => { assert.equal(options.cancelRefetch, false); commentPages++; },
    refetch: () => { fullCommentRefreshes++; },
  });
  const failedComments = render(Pick);
  assert.match(failedComments, /이미 불러온 댓글/);
  assert.match(failedComments, /다음 답글을 불러오지 못했어요/);
  presses.find((p) => textOf(p.children) === '답글 더 보기 다시 시도').onPress();
  assert.equal(commentPages, 1); assert.equal(fullCommentRefreshes, 0);
  commentsQuery.isFetching = true;
  render(Pick);
  const commentMore = presses.find((p) => textOf(p.children) === '답글 더 보기 다시 시도');
  assert.equal(commentMore.disabled, true);
  commentMore.onPress(); assert.equal(commentPages, 1, 'Background refresh must not be interrupted by loading more comments');

  const browseCategories = [{ id: 'root', parentId: null, name: '과자', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 }];
  let rankRefreshes = 0;
  const rankingQuery = { data: [{ itemId: 'ranked-item', name: '선택된 과자', thumbnailUrl: null, rank: 2, isTied: true, pickCount: 101 }],
    isFetching: false, isError: false, refetch: () => { rankRefreshes++; } };
  const { browseCategoryGroups, categoryLabel } = loadSource('lib/categories/categoryTree.ts');
  const { default: Explore } = loadSource('app/(tabs)/explore.tsx', {
    ...base, 'react-native': { ...native, useWindowDimensions: () => ({ width: 390 }) },
    react: { ...React, useState: () => ['root', () => {}] },
    '@/lib/categories/categoryTree': { browseCategoryGroups, categoryLabel },
    '@/components/item-search': { ItemSearch: () => null },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: browseCategories, refetch() {} }), useCategoryTopItems: () => rankingQuery },
  });
  const ranking = render(Explore);
  assert.match(ranking, /원픽 TOP 3/);
  assert.match(ranking, /101명이 선택/);
  presses.find((p) => p.accessibilityLabel === '공동 2위 선택된 과자, 101명이 선택, 제품 상세 보기').onPress();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'ranked-item');
  rankingQuery.isError = true;
  assert.match(render(Explore), /순위를 갱신하지 못했어요/);
  rankingQuery.data = undefined;
  assert.match(render(Explore), /제품 순위를 불러오지 못했어요/);
  const beforeRankRetry = rankRefreshes;
  presses.find((p) => p.accessibilityLabel === '제품 순위 새로고침').onPress();
  assert.equal(rankRefreshes, beforeRankRetry + 1);
  rankingQuery.isFetching = true;
  render(Explore);
  const rankRefresh = presses.find((p) => p.accessibilityLabel === '제품 순위 새로고침');
  assert.equal(rankRefresh.disabled, true);
  rankRefresh.onPress(); pullToRefresh.props.onRefresh();
  assert.equal(rankRefreshes, beforeRankRetry + 1, 'Refreshing must not cancel a pending ranking request');
  rankingQuery.isFetching = false; rankingQuery.isRefetching = true;
  render(Explore);
  assert.equal(pullToRefresh.props.refreshing, true);
  pullToRefresh.props.onRefresh(); assert.equal(rankRefreshes, beforeRankRetry + 2);
  rankingQuery.isFetching = false; rankingQuery.isError = false; rankingQuery.data = [];
  assert.match(render(Explore), /아직 선택된 제품이 없어요/);
  console.log('Interaction checks passed: item/category eligibility, read-model item picks, review prefill, comment failure/retry, duplicate taps and profile recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
