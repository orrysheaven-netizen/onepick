const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { load } = require('./mvp-screen-harness.cjs');

let state = [], cursor = 0, buttons = [], input, categoryReads = 0, queryRetries = 0, categoryRetries = 0, opened;
const query = { data: undefined, isWaiting: false, isPending: false, isError: false, isFetching: false,
  refetch: () => { queryRetries++; } };
const categories = { data: undefined, isPending: true, isError: false, isFetching: true,
  refetch: () => { categoryRetries++; } };
const host = ({ children }) => React.createElement('div', null, children);
const { HomeHeader } = load('components/home-header.tsx', {
  react: {
    useState: (initial) => { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (next) => { state[i] = next; }]; },
    useMemo: (fn) => fn(),
  },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': {
    View: host, Text: host, ScrollView: host, KeyboardAvoidingView: host,
    ActivityIndicator: () => null,
    Modal: ({ visible, children }) => visible ? host({ children }) : null,
    Pressable: (props) => { buttons.push(props); return host(props); },
    TextInput: (props) => { input = props; return null; },
    StyleSheet: { create: (styles) => styles, absoluteFill: {} }, Platform: { OS: 'web' },
  },
  'expo-image': { Image: () => null },
  '@/components/onepick-brand': { OnePickBrand: () => null },
  '@/components/ui': {
    Icon: () => null,
    Button: (props) => { buttons.push(props); return host({ children: props.label }); },
  },
  '@/components/ui/touch': { MIN_TOUCH_TARGET: 44 },
  '@/constants/onepick': require('./design-tokens.cjs'),
  '@/hooks/useExploreData': { useExploreCategories: () => { categoryReads++; return categories; } },
  '@/hooks/useItemSearch': { useItemSearch: (submitted) => ({ ...query, hasSearchText: Boolean(submitted) }) },
});
const render = () => { cursor = 0; buttons = []; return renderToStaticMarkup(React.createElement(HomeHeader, { onOpenItem: (id) => { opened = id; } })); };
const button = (label) => buttons.find((props) => props.accessibilityLabel === label || props.label === label);
const press = (label) => { const props = button(label); assert.ok(props, label); assert.ok(!props.disabled, label); props.onPress(); };

render();
assert.equal(categoryReads, 0, 'A closed search dialog makes no category request');
// #762: no theme selector button or theme popup in the header; search is the only action.
assert.equal(button('테마 선택, 현재 맛집'), undefined, 'No theme selector button');
assert.equal(button('테마 선택 닫기'), undefined, 'No theme popup');
assert.doesNotMatch(render(), /테마|맛집/, 'No theme text rendered');
assert.ok(button('메뉴 검색'), 'Search button remains');
press('메뉴 검색');
assert.doesNotMatch(render(), /검색하고 있어요|불러오지 못했어요/);
assert.equal(categoryReads, 1, 'The category query starts when search opens');
input.onChangeText('  라면  '); render(); press('검색하기');
query.data = [{ id: 'item-1', name: '테스트매장', categoryId: 'ramen', thumbnailUrl: null }];
assert.match(render(), /검색하고 있어요/);
assert.equal(button('테스트매장 상세 보기'), undefined, 'Fast item results wait for the cold category tree');

categories.isPending = false; categories.isFetching = false; categories.isError = true;
assert.match(render(), /검색 결과를 불러오지 못했어요/);
assert.equal(button('테스트매장 상세 보기'), undefined, 'A category failure cannot silently omit the menu name');
assert.doesNotMatch(render(), /메뉴를 찾지 못했어요/, 'A category failure is not an empty result');
press('다시 검색하기');
assert.equal(categoryRetries, 1); assert.equal(queryRetries, 0, 'Retry only the failed query');
categories.isFetching = true; render();
assert.equal(button('다시 검색하기').disabled, true, 'An in-flight retry cannot be submitted twice');
categories.isError = false; categories.isFetching = false;
categories.data = [{ id: 'ramen', name: '라면' }];
assert.match(render(), /테스트매장<\/div> 라면/, 'Recovered results include the menu name');

categories.isError = true;
assert.match(render(), /테스트매장<\/div> 라면/, 'A background category refresh failure preserves cached names');
assert.equal(button('다시 검색하기'), undefined);
press('테스트매장 상세 보기');
assert.equal(opened, 'item-1');
const readsBeforeClose = categoryReads;
render(); assert.equal(categoryReads, readsBeforeClose, 'Opening an item closes the search dialog');

// Open again with a warm tree; the deterministic hook state retains the submitted
// term so these assertions focus on independent query outcomes, not unmount semantics.
press('메뉴 검색'); query.isError = true; categories.isError = false;
assert.match(render(), /검색 결과를 불러오지 못했어요/);
press('다시 검색하기');
assert.equal(queryRetries, 1); assert.equal(categoryRetries, 1);
categories.data = undefined; categories.isError = true;
render(); press('다시 검색하기');
assert.equal(queryRetries, 2); assert.equal(categoryRetries, 2, 'Both failed dependencies are retried');
query.isError = false; categories.isError = false; categories.data = [{ id: 'ramen', name: '라면' }];
query.data = [];
assert.match(render(), /라면.*메뉴를 찾지 못했어요/, 'A successful empty search retains its normal empty state');
query.isPending = true;
assert.match(render(), /검색하고 있어요/, 'A warm category tree does not bypass pending item search');
assert.doesNotMatch(render(), /메뉴를 찾지 못했어요/);

console.log('Home search loading checks passed: deferred categories, cold/warm results, errors, retries, empty state and item navigation.');
