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
      if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
      // The choose screen imports these only for comment-origin registration;
    // preserve every existing test hook while rejecting unexpected new writes.
    if (name === 'expo-crypto') return { randomUUID: () => '11111111-1111-4111-8111-111111111111' };
    if (name === '@/hooks/useRegisterPick') {
      const hooks = imports[name] ?? {};
      return { ...hooks, useRegisterItemPick: hooks.useRegisterItemPick ?? (() => ({
        isPending: false, error: null,
        mutateAsync: async () => { throw new Error('unexpected comment-origin registration'); },
      })) };
    }
    if (name in imports) return imports[name];
    // The choose screen reads its originating comment thread only for a
    // comment-origin entry; ordinary entries keep the lookup disabled.
    if (name === '@/hooks/usePickDetail') return { usePickDetail: (pickId) => {
      if (pickId) throw new Error('unexpected comment-thread lookup');
      return { data: undefined, isPending: true, isError: false, isFetching: false };
    } };
      // Pure channel helpers load as-is.
      if (name === '@/lib/items/pickChannel') return loadSource('lib/items/pickChannel.ts');
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
  let item = { id: 'item', categoryId: 'category', status: 'active', name: '제품', imageUrl: 'https://image.test/item.jpg' };
  let currentPick = null;
  const service = new ItemService(
    { getById: async () => item },
    { getCurrentPicksInCategory: async () => (currentPick ? [currentPick] : []) },
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
    Platform: { OS: 'ios' },
    View: nativeComponent('div'), Text: nativeComponent('span'), RefreshControl: () => null,
    ScrollView: (props) => { if (!props.horizontal) pullToRefresh = props.refreshControl; return React.createElement('main', null, props.children); },
    ActivityIndicator: () => null,
    Image: nativeComponent('img'),
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    TextInput: (props) => { inputs.push(props); return null; },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  };
  const base = {
    '@/components/current-pick-flag': { CurrentPickFlag: () => null },
    '@/components/item-review-card': { ItemReviewCard: () => null },
    '@/components/item-pick-count': { ItemPickCount: () => null }, '@/components/item-channel-links': { ItemChannelLinks: () => null }, '@/components/youtube-video-link': { YouTubeVideoLink: () => null },
    '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {} }), useLocalSearchParams: () => params },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('section') },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false }) },
    '@/errors/appError': { AppError },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ data: detail }) },
    '@/hooks/useRegisterPick': {
      useChoosePhoto: () => ({ isPending: false, isError: false, mutateAsync: async () => null }),
      useAttachItemPhoto: () => ({ isPending: false, isError: false, mutateAsync: async () => null, reset() {} }),
      useMyPendingItemPhoto: () => ({ data: null, isPending: false }),
      useRevisePendingItem: () => ({ isPending: false, mutateAsync: async () => ({}) }),
    },
    '@/hooks/useNotifications': { useReadNotificationGroup: () => ({ isPending: false, mutateAsync: async () => 0 }) },
    '@/services/storeFirstService': { isNaverMapUrl: () => true },
    '@/lib/photos/photoFailure': { showPhotoFailure() {}, isPhotoFailure: () => false },
    '@/lib/profile/profilePickGroups': { splitLabPicks: (picks) => ({ main: picks, lab: [] }), isLabCategory: () => false }, '@/components/profile-lab-entry': { ProfileLabEntry: () => null }, '@/lib/home/homeChannels': loadSource('lib/home/homeChannels.ts'), '@/lib/items/itemTitle': loadSource('lib/items/itemTitle.ts'), '@/lib/items/pickSavedToast': loadSource('lib/items/pickSavedToast.ts'), '@/lib/categories/registrationRoute': loadSource('lib/categories/registrationRoute.ts'),
    '@/services': { observabilityService: { captureProductEvent: async () => {} } },
  };
  const render = (Screen) => { presses.length = 0; inputs.length = 0; return renderToStaticMarkup(React.createElement(Screen)); };
  const { default: Item } = loadSource('app/item/[itemId].tsx', base);
  detail = { ...detail, canChoose: false, myPickStatus: { type: 'not_selected' } };
  assert.match(render(Item), /새 원픽을 선택할 수 없어요/);
  assert.ok(!presses.some((p) => textOf(p.children) === '이걸로 원픽 등록'));
  detail.myPickStatus = { type: 'selected_this', pickId: 'mine', oneLineReview: '기존 한줄평' };
  detail.canChoose = true;
  const ownDetail = render(Item);
  // My own review is edited on its card (수정 · 해제); the hero has no button for it.
  assert.ok(!presses.some((p) => /원픽 등록|원픽 바꾸기|보기\/수정/.test(textOf(p.children))), 'No choose button for my own Pick');
  assert.doesNotMatch(ownDetail, /새 원픽을 선택할 수 없어요/);
  assert.equal(destination, undefined, 'Own review stays on the product page');
  // The Pick state is one shape: colored when it is my Pick (not pressable), uncolored otherwise.
  assert.ok(!presses.some((p) => p.accessibilityLabel === '원픽으로 고르기' || p.accessibilityLabel === '이걸로 원픽 바꾸기'), 'My own Pick mark is not a button');
  detail.myPickStatus = { type: 'not_selected' };
  render(Item);
  const chooseMark = presses.find((p) => p.accessibilityLabel === '원픽으로 고르기');
  assert.ok(chooseMark, 'An item that is not my Pick shows the uncolored mark as a button');
  assert.ok(!presses.some((p) => /이걸로 원픽 등록|아직/.test(textOf(p.children))), 'No sentence-style or "아직" label');
  chooseMark.onPress(); assert.equal(destination.pathname, '/pick/choose');
  destination = undefined;
  detail.myPickStatus = { type: 'selected_other', currentPickId: 'previous', currentItemId: 'previous-item' };
  render(Item);
  assert.ok(presses.find((p) => p.accessibilityLabel === '원픽 바꾸기'), 'Another Pick in the category keeps the uncolored mark with a change label');
  detail.myPickStatus = { type: 'selected_this', pickId: 'mine', oneLineReview: '기존 한줄평' };
  detail.canChoose = false;

  const { default: Choose } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}), useRequestPendingPick: () => ({ isPending: false, error: null }) },
  });
  assert.match(render(Choose), /지금은 선택할 수 없어요/);
  assert.equal(inputs.length, 0, 'Unavailable items must not show the submission form');
  detail.canChoose = true;
  render(Choose);
  assert.equal(inputs[0].value, '기존 한줄평');

  // A product change starts with a blank review. The action must explain what is
  // missing instead of silently disabling itself or copying the previous reason.
  let chooseStates = [], chooseStateIndex = 0, chooseRefs = [], chooseRefIndex = 0, reviewFocuses = 0;
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
      useRef: (initial) => {
        const index = chooseRefIndex++;
        if (!(index in chooseRefs)) chooseRefs[index] = { current: index === 1 ? { focus: () => reviewFocuses++ } : initial };
        return chooseRefs[index];
      },
    },
    '@/hooks/useChoosePick': { useChoosePick: () => choiceMutation, useRequestPendingPick: () => ({ isPending: false, error: null }) },
  });
  detail.myPickStatus = { type: 'selected_other', pickId: 'previous', itemId: 'previous-item' };
  const renderChoice = () => { chooseStateIndex = 0; chooseRefIndex = 0; return render(ChangeChoice); };
  const changeButton = () => presses.find((p) => p.accessibilityLabel === '원픽 바꾸기');
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
  assert.match(renderChoice(), /원픽을 정했어요/);

  const { default: MissingItem } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}), useRequestPendingPick: () => ({ isPending: false, error: null }) },
    '@/hooks/useItemDetail': { useItemDetail: () => ({ isPending: true }) },
  });
  params = {};
  assert.match(render(MissingItem), /정보를 불러오지 못했어요/);

  let draft = '  댓글 초안  ', attempts = 0, rejectSave, resolveSave;
  let pick = { id: 'pick', userId: 'owner', status: 'active', oneLineReview: '이유' };
  let mutation = { mutateAsync: () => { attempts++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); } };
  const commentsQuery = { data: [] };
  params = { pickId: 'pick' };
  const { PickReplies } = loadSource('components/pick-replies.tsx', {
    ...base,
    // Only the composer draft (initial '') is driven by the test.
    react: { ...React, useState: (initial) => initial === '' ? [draft, (value) => { draft = value; }] : React.useState(initial) },
    '@/components/pick-share-actions': { PickShareActions: () => null },
    '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': { PickPhoto: () => null }, '@/components/pick-photo-step': { PickPhotoStep: () => null } }),
    '@/components/pick-management': { PickManagement: () => null, PickManagementActions: () => null },
    '@/components/report-action': { ReportAction: () => null },
    '@/hooks/usePickDetail': { usePickDetail: () => ({ data: { pick, item, category, profile: { username: 'owner' }, isCurrent: true } }) },
    '@/hooks/usePickComments': { usePickComments: () => commentsQuery },
    '@/hooks/useCreateComment': { useCreateComment: () => mutation },
    '@/hooks/useDeleteComment': { useDeleteComment: () => ({ isPending: false, isError: false, reset() {} }) },
  });
  let canWrite = true;
  const Pick = () => React.createElement(PickReplies, { pickId: 'pick', canWrite });
  render(Pick);
  const submit = presses.find((p) => textOf(p.children) === '댓글 남기기').onPress;
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
  canWrite = false;
  assert.match(render(Pick), /지금은 댓글을 남길 수 없는 한줄평이에요/);
  assert.equal(inputs.length, 0);
  pick.status = 'active';
  canWrite = true;
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
  assert.match(failedComments, /다음 댓글을 불러오지 못했어요/);
  presses.find((p) => textOf(p.children) === '댓글 더 보기 다시 시도').onPress();
  assert.equal(commentPages, 1); assert.equal(fullCommentRefreshes, 0);
  commentsQuery.isFetching = true;
  render(Pick);
  const commentMore = presses.find((p) => textOf(p.children) === '댓글 더 보기 다시 시도');
  assert.equal(commentMore.disabled, true);
  commentMore.onPress(); assert.equal(commentPages, 1, 'Background refresh must not be interrupted by loading more comments');

  const browseCategories = [{ id: 'root', parentId: null, name: '과자', status: 'open', isVisible: true, isPickable: true, sortOrder: 1 }];
  let rankRefreshes = 0;
  const rankingQuery = { data: [
    { itemId: 'leader', name: '첫 번째 과자', thumbnailUrl: null, rank: 1, isTied: false, pickCount: 102, channels: [] },
    { itemId: 'ranked-item', name: '선택된 과자', thumbnailUrl: null, rank: 2, isTied: true, pickCount: 101, channels: [] },
    { itemId: 'tied-item', name: '공동 순위 과자', thumbnailUrl: null, rank: 2, isTied: true, pickCount: 101, channels: [] },
  ], isFetching: false, isError: false, refetch: () => { rankRefreshes++; } };
  const { browseCategoryGroups, categoryLabel } = loadSource('lib/categories/categoryTree.ts');
  const { default: Explore } = loadSource('app/(tabs)/explore.tsx', {
    ...base, 'react-native': { ...native, useWindowDimensions: () => ({ width: 390 }) },
    react: { ...React, useState: () => ['root', () => {}] },
    '@/components/ui': require('./ui-components.cjs').loadUi({ 'react-native': native, '@/components/pick-photo': base['@/components/pick-photo'] }),
    '@/lib/categories/categoryTree': { browseCategoryGroups, categoryLabel },
    '@/lib/categories/browseScope': { browseScope: () => ({ showChips: true, leafIds: null }) },
    '@/components/item-search': { ItemSearch: () => null }, '@/components/explore-search-results': { ExploreSearchResults: () => null },
    '@/hooks/useExploreData': { useExploreCategories: () => ({ data: browseCategories, refetch() {} }), useFoodMenuPickCounts: () => ({ data: new Map(), isError: false, isFetching: false, isRefetching: false, refetch() {} }), useCategoryTopItems: () => rankingQuery,
      useRecentPickedItems: () => ({ data: [], isPending: false, isError: false, isFetching: false, hasNextPage: false, refetch() {} }) },
  });
  const ranking = render(Explore);
  assert.match(ranking, /원픽 TOP 3/);
  assert.match(ranking, /101명이 선택/);
  assert.equal(presses.find((p) => p.accessibilityLabel === '카테고리 원픽 다시 불러오기'), undefined, 'Healthy rankings have no manual retry');
  presses.find((p) => p.accessibilityLabel === '공동 2위 선택된 과자, 101명이 선택, 상세 보기').onPress();
  assert.equal(destination.pathname, '/item/[itemId]');
  assert.equal(destination.params.itemId, 'ranked-item');

  const highSample = rankingQuery.data;
  rankingQuery.data = [{ ...highSample[1], rank: 1, isTied: false, pickCount: 2 }];
  const lowSample = render(Explore);
  assert.match(lowSample, /과자의 원픽/);
  assert.doesNotMatch(lowSample, /TOP 3|공동|명이 선택|사람 수 기준/);
  presses.find((p) => p.accessibilityLabel === '선택된 과자, 상세 보기').onPress();
  assert.equal(destination.params.itemId, 'ranked-item', 'Low-sample cards preserve their detail route');
  rankingQuery.data[0].pickCount = 3;
  const thresholdSample = render(Explore);
  assert.match(thresholdSample, /원픽 TOP 3/);
  assert.match(thresholdSample, /3명이 선택/);
  rankingQuery.data = highSample;

  rankingQuery.isError = true;
  const staleRanking = render(Explore);
  assert.match(staleRanking, /최신 원픽을 확인하지 못했어요/);
  assert.match(staleRanking, /선택된 과자/, 'A refresh error keeps previously loaded cards');
  rankingQuery.data = undefined;
  assert.match(render(Explore), /원픽을 불러오지 못했어요/);
  const beforeRankRetry = rankRefreshes;
  presses.find((p) => p.accessibilityLabel === '카테고리 원픽 다시 불러오기').onPress();
  assert.equal(rankRefreshes, beforeRankRetry + 1);
  rankingQuery.isFetching = true;
  render(Explore);
  const rankRefresh = presses.find((p) => p.accessibilityLabel === '카테고리 원픽 다시 불러오기');
  assert.equal(rankRefresh.disabled, true);
  rankRefresh.onPress(); pullToRefresh.props.onRefresh();
  assert.equal(rankRefreshes, beforeRankRetry + 1, 'Refreshing must not cancel a pending ranking request');
  rankingQuery.isFetching = false; rankingQuery.isRefetching = true;
  render(Explore);
  assert.equal(pullToRefresh.props.refreshing, true);
  pullToRefresh.props.onRefresh(); assert.equal(rankRefreshes, beforeRankRetry + 2);
  rankingQuery.isFetching = false; rankingQuery.isError = false; rankingQuery.data = [];
  assert.match(render(Explore), /아직 선택된 원픽이 없어요/);
  console.log('Interaction checks passed: item/category eligibility, read-model item picks, review prefill, comment failure/retry, duplicate taps, profile recovery and gated ranking interaction/retry.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
