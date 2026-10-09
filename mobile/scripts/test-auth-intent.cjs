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
    URL,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      if (name === '@/components/ui') return require('./icon-stub.cjs');
      throw new Error('Unexpected runtime dependency: ' + name);
    },
  });
  return exports;
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
const ids = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'];
const intents = loadSource('lib/auth/authIntent.ts');
const { getAuthIntent, getPostAuthRoute } = intents;
const same = (a, b) => assert.equal(JSON.stringify(a), JSON.stringify(b));

async function main() {
  const choose = { action: 'choose_pick', itemId: ids[0], categoryId: ids[1] };
  const chooseMovie = { action: 'choose_movie', externalId: '157336', categoryId: ids[1] };
  const chooseGame = { action: 'choose_game', externalGameId: '1942', categoryId: ids[1] };
  const chooseBook = { action: 'choose_book', externalBookId: 'abc_DEF-123', categoryId: ids[1] };
  const chooseYouTube = { action: 'choose_youtube', externalYouTubeId: 'UC1234567890123456789012', categoryId: ids[1] };
  const comment = { action: 'comment_pick', pickId: ids[0] };
  const register = { action: 'register_pick', categoryId: ids[0], itemId: ids[1] };
  const request = { action: 'request_item', itemName: '  신라면   더 레드  ', categoryId: ids[0] };
  const requestWithSource = { ...request, sourceUrl: 'https://shop.example/items/ramen' };
  const linkSuggestion = { action: 'suggest_link_category', linkUrl: 'https://naver.me/example', linkName: '  대성집  ' };
  const storePrefill = { action: 'store_pick', providerId: ids[0], categoryId: ids[1], menuName: '  라멘  ' };

  assert.equal(getPostAuthRoute(getAuthIntent(register)).pathname, '/pick/register');
  same(getAuthIntent(storePrefill), { action: 'store_pick', providerId: ids[0], categoryId: ids[1], menuName: '라멘' });
  same(getPostAuthRoute(getAuthIntent(storePrefill)), {
    pathname: '/pick/new', params: { providerId: ids[0], categoryId: ids[1], menuName: '라멘' },
  });
  same(getAuthIntent({ ...storePrefill, providerId: '../../bad', categoryId: ['bad'], menuName: ' '.repeat(41) }), { action: 'store_pick' });
  same(getAuthIntent({ action: 'register_pick', categoryId: '../../bad', itemId: [ids[0]] }), { action: 'register_pick' });
  same(getPostAuthRoute(getAuthIntent(choose)), { pathname: '/pick/choose', params: { itemId: ids[0], categoryId: ids[1] } });
  same(getPostAuthRoute(getAuthIntent(chooseMovie)), { pathname: '/pick/find', params: { categoryId: ids[1], externalMovieId: '157336' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseMovie, externalId: '../../bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(chooseGame)), { pathname: '/pick/game', params: { categoryId: ids[1], externalGameId: '1942' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseGame, externalGameId: 'bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(chooseBook)), { pathname: '/pick/book', params: { categoryId: ids[1], externalBookId: 'abc_DEF-123' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseBook, externalBookId: 'bad/id' })), '/');
  same(getPostAuthRoute(getAuthIntent(chooseYouTube)), { pathname: '/pick/youtube', params: { categoryId: ids[1], externalYouTubeId: 'UC1234567890123456789012' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseYouTube, externalYouTubeId: 'bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(comment)), { pathname: '/pick/[pickId]', params: { pickId: ids[0], afterAuth: '1' } });
  same(getAuthIntent(request), { action: 'request_item', itemName: '신라면 더 레드', categoryId: ids[0] });
  same(getPostAuthRoute(getAuthIntent(request)), {
    pathname: '/pick/request',
    params: { itemName: '신라면 더 레드', categoryId: ids[0] },
  });
  same(getPostAuthRoute(getAuthIntent(requestWithSource)), {
    pathname: '/pick/request',
    params: {
      itemName: '신라면 더 레드',
      categoryId: ids[0],
      sourceUrl: 'https://shop.example/items/ramen',
    },
  });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...requestWithSource, sourceUrl: 'http://shop.example/item' })).params?.sourceUrl, undefined);
  assert.equal(getPostAuthRoute(getAuthIntent({ ...requestWithSource, channel: 'online' })).params?.channel, 'online', 'Online seller requests resume in the online flow');
  assert.equal(getPostAuthRoute(getAuthIntent({ ...requestWithSource, channel: 'delivery' })).params?.channel, undefined, 'Unknown channels are dropped');
  same(getAuthIntent({ action: 'request_item', itemName: '  신라면  ', categoryId: '../../bad' }), {
    action: 'request_item', itemName: '신라면',
  });
  same(getAuthIntent(linkSuggestion), {
    action: 'suggest_link_category', linkUrl: 'https://naver.me/example', linkName: '대성집',
  });
  same(getPostAuthRoute(getAuthIntent(linkSuggestion)), {
    pathname: '/pick/link', params: { url: 'https://naver.me/example', name: '대성집' },
  });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...linkSuggestion, linkUrl: 'http://naver.me/example' })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'request_item', itemName: ['신라면'] })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'request_item', itemName: ' '.repeat(101) })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'profile' })), '/profile');
  same(getAuthIntent({ action: 'my_comments' }), { action: 'my_comments' });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'my_comments' })), '/comments');
  same(getAuthIntent({ action: 'notifications' }), { action: 'notifications' });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'notifications' })), '/notifications');
  same(getAuthIntent({ action: 'join_from_profile' }), { action: 'join_from_profile' });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'join_from_profile' })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: ['join_from_profile'] })), '/');
  same(getAuthIntent({ action: 'join_from_profile', username: 'someone' }), { action: 'join_from_profile' },
    'the join intent must not carry the profile that was being read');

  for (const params of [
    {}, { action: 'choose_pick' }, { ...choose, categoryId: '' },
    { ...comment, pickId: [ids[0], ids[1]] }, { action: ['profile'] },
    { action: 'https://example.com' }, { ...comment, pickId: '../../auth/login' },
  ]) assert.equal(getPostAuthRoute(getAuthIntent(params)), '/');

  for (const original of [choose, chooseMovie, chooseGame, chooseBook, chooseYouTube, register, storePrefill, request, requestWithSource, linkSuggestion, comment, { action: 'profile' }, { action: 'notifications' }, { action: 'home' }, { action: 'join_from_profile' }]) {
    const onboarding = getPostAuthRoute(getAuthIntent(original), true);
    assert.equal(onboarding.pathname, '/auth/username');
    same(getPostAuthRoute(getAuthIntent(onboarding.params)), getPostAuthRoute(getAuthIntent(original)));
  }
  assert.equal(Object.hasOwn(getAuthIntent({ ...comment, access_token: 'not-forwarded' }), 'access_token'), false);

  let params = {}, destination, callbackParams, mutationResult, mutationInput;
  const presses = [], analytics = [];
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    View: nativeComponent('div'), Text: nativeComponent('span'), ActivityIndicator: () => null,
    Pressable: ({ children, onPress }) => { presses.push(onPress); return React.createElement('button', null, children); },
    StyleSheet: { create: (styles) => styles },
  };
  const baseImports = {
    'expo-router': { useRouter: () => ({ replace: (route) => { destination = route; }, back() {} }), useLocalSearchParams: () => params },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('section') },
    '@/lib/auth/authIntent': intents,
    '@/services': { observabilityService: { captureProductEvent: async (event) => { analytics.push(event); } } },
  };
  const { default: Login } = loadSource('app/auth/login.tsx', {
    ...baseImports,
    '@/components/onepick-brand': { OnePickBrand: () => null },
    'expo-linking': { createURL: (_path, options) => { callbackParams = options.queryParams; return 'onepick://auth/callback'; } },
    '@/errors/appError': { AppError: Error },
    '@/hooks/useSocialSignIn': { useSocialSignIn: () => ({
      isPending: false, isError: false, isSuccess: false,
      mutateAsync: async (input) => { mutationInput = input; return mutationResult; },
    }) },
    '@/types/domain/auth': {},
  });
  const login = async (input, result, buttonIndex = 1) => {
    params = input; mutationResult = result; mutationInput = undefined; destination = undefined; presses.length = 0;
    renderToStaticMarkup(React.createElement(Login));
    await presses[buttonIndex]();
    await flush();
  };
  await login({}, { profile: {} });
  assert.equal(mutationInput.provider, 'kakao');
  assert.equal(mutationInput.redirectTo, 'onepick://auth/callback');
  assert.equal(destination, '/');
  assert.equal(analytics.at(-1).eventName, 'auth_started');
  assert.equal(analytics.at(-1).path, '/auth/login');
  await login({ action: 'profile' }, { profile: {} }, 2);
  assert.equal(mutationInput.provider, 'apple');
  assert.equal(destination, '/profile');
  assert.equal(presses.length, 3, 'Only back, Kakao and Apple are offered');
  await login({ action: 'notifications' }, { profile: {} });
  assert.equal(destination, '/notifications');
  same(callbackParams, { action: 'notifications' });
  await login(comment, { profile: null }, 2);
  assert.equal(mutationInput.provider, 'apple');
  same(destination, getPostAuthRoute(comment, true));
  same(callbackParams, comment);
  await login(choose, { profile: {} });
  same(destination, getPostAuthRoute(choose));
  await login(storePrefill, { profile: {} });
  same(destination, getPostAuthRoute(getAuthIntent(storePrefill)));
  same(callbackParams, getAuthIntent(storePrefill));
  await login(request, { profile: {} });
  same(destination, getPostAuthRoute(getAuthIntent(request)));
  same(callbackParams, getAuthIntent(request));
  await login(linkSuggestion, { profile: {} });
  same(destination, getPostAuthRoute(getAuthIntent(linkSuggestion)));
  same(callbackParams, getAuthIntent(linkSuggestion));
  await login(comment, null);
  assert.equal(destination, undefined, 'Cancelling OAuth stays on login');

  let callbackFailed = false;
  const { default: Callback } = loadSource('app/auth/callback.tsx', {
    ...baseImports,
    react: { ...React, useEffect: (effect) => effect() },
    'expo-linking': { useURL: () => 'onepick://auth/callback' },
    '@/hooks/useCompleteOAuth': { useCompleteOAuth: () => ({
      isError: callbackFailed,
      mutateAsync: async () => { if (callbackFailed) throw new Error('failed'); return mutationResult; },
    }) },
  });
  params = request; mutationResult = { profile: {} };
  renderToStaticMarkup(React.createElement(Callback));
  await flush();
  same(destination, getPostAuthRoute(getAuthIntent(request)));
  assert.equal(analytics.at(-1).eventName, 'auth_completed');
  assert.equal(analytics.at(-1).source, 'request_item');
  params = { action: 'notifications' }; mutationResult = { profile: {} };
  renderToStaticMarkup(React.createElement(Callback));
  await flush();
  assert.equal(destination, '/notifications');
  params = request;
  mutationResult = { profile: null };
  renderToStaticMarkup(React.createElement(Callback));
  await flush();
  same(destination, getPostAuthRoute(getAuthIntent(request), true));
  callbackFailed = true; presses.length = 0;
  assert.match(renderToStaticMarkup(React.createElement(Callback)), /다시 로그인하기/);
  await flush();
  presses[0]();
  same(destination, { pathname: '/auth/login', params: getAuthIntent(request) });
  const callbackSource = fs.readFileSync(path.join(__dirname, '../src/app/auth/callback.tsx'), 'utf8');
  assert.match(callbackSource, /\[completeOAuth, params, router, url\]/,
    'OAuth callback must react to the complete validated intent, not a partial parameter subset');
  console.log('Auth return checks passed: Kakao/Apple preserve choose/comment/profile/notifications/home/item-request/link intents, onboarding, cancellation and callback retry.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
