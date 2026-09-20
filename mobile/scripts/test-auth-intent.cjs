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
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
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
  const chooseYouTube = { action: 'choose_youtube', externalYouTubeId: 'UC1234567890123456789012', categoryId: ids[1] };
  const comment = { action: 'comment_pick', pickId: ids[0] };
  const register = { action: 'register_pick', categoryId: ids[0], itemId: ids[1] };
  const request = { action: 'request_item', itemName: '  신라면   더 레드  ', categoryId: ids[0] };

  assert.equal(getPostAuthRoute(getAuthIntent(register)).pathname, '/pick/register');
  same(getAuthIntent({ action: 'register_pick', categoryId: '../../bad', itemId: [ids[0]] }), { action: 'register_pick' });
  same(getPostAuthRoute(getAuthIntent(choose)), { pathname: '/pick/choose', params: { itemId: ids[0], categoryId: ids[1] } });
  same(getPostAuthRoute(getAuthIntent(chooseMovie)), { pathname: '/pick/find', params: { categoryId: ids[1], externalMovieId: '157336' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseMovie, externalId: '../../bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(chooseGame)), { pathname: '/pick/game', params: { categoryId: ids[1], externalGameId: '1942' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseGame, externalGameId: 'bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(chooseYouTube)), { pathname: '/pick/youtube', params: { categoryId: ids[1], externalYouTubeId: 'UC1234567890123456789012' } });
  assert.equal(getPostAuthRoute(getAuthIntent({ ...chooseYouTube, externalYouTubeId: 'bad' })), '/');
  same(getPostAuthRoute(getAuthIntent(comment)), { pathname: '/pick/[pickId]', params: { pickId: ids[0] } });
  same(getAuthIntent(request), { action: 'request_item', itemName: '신라면 더 레드', categoryId: ids[0] });
  same(getPostAuthRoute(getAuthIntent(request)), {
    pathname: '/pick/request',
    params: { itemName: '신라면 더 레드', categoryId: ids[0] },
  });
  same(getAuthIntent({ action: 'request_item', itemName: '  신라면  ', categoryId: '../../bad' }), {
    action: 'request_item', itemName: '신라면',
  });
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'request_item', itemName: ['신라면'] })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'request_item', itemName: ' '.repeat(101) })), '/');
  assert.equal(getPostAuthRoute(getAuthIntent({ action: 'profile' })), '/profile');

  for (const params of [
    {}, { action: 'choose_pick' }, { ...choose, categoryId: '' },
    { ...comment, pickId: [ids[0], ids[1]] }, { action: ['profile'] },
    { action: 'https://example.com' }, { ...comment, pickId: '../../auth/login' },
  ]) assert.equal(getPostAuthRoute(getAuthIntent(params)), '/');

  for (const original of [choose, chooseMovie, chooseGame, chooseYouTube, register, request, comment, { action: 'profile' }, { action: 'home' }]) {
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
  assert.equal(mutationInput.provider, 'google');
  assert.equal(destination, '/profile');
  await login(comment, { profile: null }, 3);
  assert.equal(mutationInput.provider, 'naver');
  same(destination, getPostAuthRoute(comment, true));
  same(callbackParams, comment);
  await login(choose, { profile: {} });
  same(destination, getPostAuthRoute(choose));
  await login(request, { profile: {} });
  same(destination, getPostAuthRoute(getAuthIntent(request)));
  same(callbackParams, getAuthIntent(request));
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
  mutationResult = { profile: null };
  renderToStaticMarkup(React.createElement(Callback));
  await flush();
  same(destination, getPostAuthRoute(getAuthIntent(request), true));
  callbackFailed = true; presses.length = 0;
  assert.match(renderToStaticMarkup(React.createElement(Callback)), /다시 로그인하기/);
  await flush();
  presses[0]();
  same(destination, { pathname: '/auth/login', params: getAuthIntent(request) });
  console.log('Auth return checks passed: Kakao/Google/Naver preserve choose/comment/profile/home/item-request intents, onboarding, cancellation and callback retry.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
