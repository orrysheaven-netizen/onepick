// Home → 사람들의 원픽 더보기 (10-04): the full feed shows 20, loads the next 20 near the
// bottom one request at a time, keeps every loaded row, shows each Pick once and stops at the end.
// Also checks the shared current-Pick flag colors (mine orange, anyone else dark gray).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected import: ${name}`);
  } });
  return exports;
}

const constants = load('constants/onepick.ts', { './font-family': load('constants/font-family.web.ts') });

// 1. The hook keeps all pages (no maxPages window) and de-duplicates by pickId.
let infiniteOptions;
const hooks = load('hooks/useHomeData.ts', {
  '@tanstack/react-query': { useInfiniteQuery: (options) => { infiniteOptions = options; return {}; }, useQuery: () => ({}), keepPreviousData: {} },
  '@/lib/query/queryKeys': { queryKeys: { home: { data: (id) => ['home', id ?? 'anon'], menuRanking: () => [] } } },
  '@/services/homeServiceInstance': { homeService: {} },
});
hooks.useFullPickFeed('viewer', true, 'offline', 'food');
assert.equal(infiniteOptions.maxPages, undefined, 'The full feed never drops rows it already showed');
assert.ok(infiniteOptions.queryKey.includes('full-feed'), 'Separate cache from Home');
assert.equal(infiniteOptions.getNextPageParam({ nextCursor: null }), undefined, 'No cursor means the feed is finished');
const page = (ids) => ({ picks: ids.map((id) => ({ pickId: id })) });
assert.deepEqual(infiniteOptions.select({ pages: [page(['a', 'b']), page(['b', 'c'])] }).map((p) => p.pickId), ['a', 'b', 'c'],
  'A Pick that moves between pages appears once');

// 2. The screen: first 20, next 20 on reaching the end, one request at a time, end message.
const component = (tag) => ({ children }) => React.createElement(tag, null, children);
let list;
const presses = [];
const native = {
  Text: component('span'), View: component('div'), ActivityIndicator: () => React.createElement('i', null, 'loading'),
  FlatList: (props) => { list = props; return React.createElement('main', null, props.ListHeaderComponent,
    props.data.length ? props.data.map((item) => React.createElement('div', { key: item.pickId }, props.renderItem({ item })))
      : props.ListEmptyComponent, props.ListFooterComponent); },
  Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
  StyleSheet: { create: (styles) => styles },
};
const rows = (from, count) => Array.from({ length: count }, (_, i) => ({ pickId: `p${from + i}`, userId: `u${from + i}`, username: `user${from + i}`, itemId: `i${from + i}` }));
const feed = { data: rows(0, 20), hasNextPage: true, isFetching: false, isFetchingNextPage: false, isFetchNextPageError: false,
  isPending: false, isError: false, calls: 0, fetchNextPage(options) { assert.equal(options.cancelRefetch, false); this.calls++; }, refetch() {} };
const auth = { user: { id: 'u3' }, isLoading: false, error: null };
const rowProps = [];
const { default: FullFeed } = load('app/feed.tsx', {
  'expo-router': { useRouter: () => ({ push() {}, back() {}, replace() {}, canGoBack: () => true }) },
  'react-native': native,
  'react-native-safe-area-context': { SafeAreaView: component('section') },
  '@/components/home-pick-row': { HomePickRow: (props) => { rowProps.push(props); return React.createElement('p', null, '@' + props.pick.username); } },
  '@/components/ui': { StateCard: ({ title, text }) => React.createElement('aside', null, title, text) },
  '@/constants/onepick': constants,
  '@/hooks/useAuthSession': { useAuthSession: () => auth },
  '@/hooks/useHomeData': { useFullPickFeed: (...args) => { assert.deepEqual(args.slice(2), ['offline', 'food']); return feed; } },
  '@/lib/home/homeCategoryFilters': { HOME_FEED_ROOT_SLUG: 'food' },
});
const render = () => { rowProps.length = 0; presses.length = 0; return renderToStaticMarkup(React.createElement(FullFeed)); };

let html = render();
assert.equal(list.data.length, 20, 'First page shows 20');
assert.equal(rowProps.find((p) => p.pick.userId === 'u3').mine, true, 'The viewer’s own current Pick gets the orange flag');
assert.equal(rowProps.find((p) => p.pick.userId === 'u4').mine, false);
list.onEndReached(); assert.equal(feed.calls, 1, 'Near the bottom loads the next page');
feed.isFetching = true; feed.isFetchingNextPage = true; html = render();
list.onEndReached(); list.onEndReached(); assert.equal(feed.calls, 1, 'No duplicate request while one is in flight');
assert.match(html, /loading/);
feed.isFetching = false; feed.isFetchingNextPage = false; feed.data = rows(0, 40); html = render();
assert.equal(list.data.length, 40, 'Second page appends the next 20');
feed.isFetchNextPageError = true; html = render();
list.onEndReached(); assert.equal(feed.calls, 1, 'A failed page waits for an explicit retry');
assert.match(html, /다음 원픽을 불러오지 못했어요/);
feed.isFetchNextPageError = false; feed.hasNextPage = false; feed.data = rows(0, 45); html = render();
list.onEndReached(); assert.equal(feed.calls, 1, 'Stops when the server has no more');
assert.match(html, /지금 볼 수 있는 원픽을 모두 확인했어요/);
assert.doesNotMatch(html, />댓글<|>공유</, 'No extra UI beyond the rows');

// 3. Shared flag colors.
const flagStyles = [];
const flagNative = { View: (props) => { flagStyles.push(props); return null; }, StyleSheet: { create: (s) => s, flatten: (s) => s } };
const { CurrentPickFlag } = load('components/current-pick-flag.tsx', { 'react-native': flagNative, '@/constants/onepick': constants });
const colorOf = (el) => el.props.children[0].props.style[1].backgroundColor;
assert.equal(colorOf(CurrentPickFlag({ mine: true })), '#FF8500');
assert.equal(colorOf(CurrentPickFlag({})), '#555555');
assert.equal(CurrentPickFlag({ mine: true }).props.accessibilityLabel, '내 현재 원픽');

console.log('Full feed checks passed: 20 per page, next 20 near the bottom, no duplicate requests or rows, stop at the end, flag colors.');
