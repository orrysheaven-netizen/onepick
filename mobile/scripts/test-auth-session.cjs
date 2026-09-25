const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { QueryClient } = require('@tanstack/react-query');

function loadSource(relativePath, imports = {}) {
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  vm.runInNewContext(result.outputText, {
    exports,
    URL,
    URLSearchParams,
    require: (name) => {
      assert.ok(name in imports, 'Unexpected runtime dependency: ' + name);
      return imports[name];
    },
  });
  return exports;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

function sessionHarness() {
  const values = [], reads = [];
  let index = 0, deps, cleanup, listener, unsubscribed = 0;
  const { useAuthSession } = loadSource('hooks/useAuthSession.ts', {
    react: {
      useState: (initial) => {
        const slot = index++;
        if (!(slot in values)) values[slot] = initial;
        return [values[slot], (value) => { values[slot] = typeof value === 'function' ? value(values[slot]) : value; }];
      },
      useCallback: (fn) => fn,
      useEffect: (effect, nextDeps) => {
        if (!deps || nextDeps.some((value, i) => value !== deps[i])) {
          cleanup?.(); deps = nextDeps; cleanup = effect();
        }
      },
    },
    '@/services': { authService: {
      subscribe: (fn) => { listener = fn; return () => { unsubscribed++; }; },
      getCurrentUser: () => { const read = deferred(); reads.push(read); return read.promise; },
    } },
  });
  return {
    render: () => { index = 0; return useAuthSession(); },
    emit: (user) => listener(user), reads,
    unmount: () => cleanup(),
    get unsubscribed() { return unsubscribed; },
  };
}

async function main() {
  const h = sessionHarness();
  assert.equal(h.render().isLoading, true);
  h.emit({ id: 'new-account' });
  h.reads[0].resolve({ id: 'old-account' });
  await flush();
  assert.equal(h.render().user.id, 'new-account', 'An old lookup must not replace a newer auth event');
  h.emit(null);
  assert.equal(h.render().user, null);
  h.unmount();
  assert.equal(h.unsubscribed, 1);

  const failed = sessionHarness();
  failed.render();
  failed.reads[0].reject(new Error('offline'));
  await flush();
  assert.equal(failed.render().isLoading, false);
  assert.equal(failed.render().error.message, 'offline');
  failed.render().retry();
  assert.equal(failed.render().isLoading, true);
  assert.equal(failed.unsubscribed, 1);
  failed.reads[1].resolve({ id: 'recovered' });
  await flush();
  assert.equal(failed.render().user.id, 'recovered');
  assert.equal(failed.render().error, null);
  failed.unmount();

  const abandoned = sessionHarness();
  abandoned.render(); abandoned.unmount();
  abandoned.reads[0].resolve({ id: 'too-late' });
  await flush();
  assert.equal(abandoned.render().user, null);

  const { AppError } = loadSource('errors/appError.ts');
  let sessionResult = { data: { session: null }, error: { message: 'storage failed' } }, signOutOptions, oauthOptions;
  let browserCalls = 0, exchangeCalls = 0, setSessionCalls = 0, oauthError = null;
  const platform = { OS: 'ios' };
  const { SupabaseAuthRepository } = loadSource('repositories/supabase/supabaseAuthRepository.ts', {
    'expo-web-browser': { openAuthSessionAsync: async () => { browserCalls++; return { type: 'cancel' }; } },
    'react-native': { Platform: platform },
    '@/errors/appError': { AppError },
  });
  const repository = new SupabaseAuthRepository({ auth: {
    getSession: async () => sessionResult,
    signOut: async (options) => { signOutOptions = options; return { error: null }; },
    signInWithOAuth: async (options) => { oauthOptions = options; return { data: { url: 'https://example.com/auth' }, error: oauthError }; },
    exchangeCodeForSession: async (code) => {
      exchangeCalls++;
      return { data: { user: { id: code === 'pkce-code' ? 'signed-in' : 'unexpected', email: null } }, error: null };
    },
    setSession: async () => { setSessionCalls++; return { data: { user: { id: 'should-not-sign-in', email: null } }, error: null }; },
  } });
  await assert.rejects(() => repository.getCurrentUser(), (error) => error.code === 'AUTH_FAILED');
  sessionResult = { data: { session: null }, error: null };
  assert.equal(await repository.getCurrentUser(), null);
  await repository.signOut();
  assert.equal(signOutOptions.scope, 'global');
  assert.equal(await repository.signInWithProvider('kakao', 'onepick://auth/callback'), null);
  assert.equal(oauthOptions.provider, 'kakao');
  assert.equal(oauthOptions.options.redirectTo, 'onepick://auth/callback');
  assert.equal(oauthOptions.options.queryParams.scope, 'profile_nickname');
  assert.equal(oauthOptions.options.scopes, undefined, 'Additive scopes must not reintroduce email and photos');
  assert.equal(oauthOptions.options.skipBrowserRedirect, true);

  assert.equal(await repository.signInWithProvider('apple', 'onepick://auth/callback'), null);
  assert.equal(oauthOptions.provider, 'apple');
  assert.equal(oauthOptions.options.queryParams, undefined, 'Apple scopes come from the configured Supabase provider');
  assert.equal(browserCalls, 2, 'Native OAuth uses the auth session browser for every provider');

  assert.equal(await repository.signInWithKakao('onepick://auth/callback'), null);
  assert.equal(oauthOptions.provider, 'kakao', 'Legacy Kakao entry point delegates to the shared provider flow');
  assert.equal(browserCalls, 3);

  platform.OS = 'web';
  const callback = 'https://example.com/auth/callback?action=request_item&itemName=ramen';
  assert.equal(await repository.signInWithKakao(callback), null);
  assert.equal(oauthOptions.options.redirectTo, callback);
  assert.equal(oauthOptions.options.skipBrowserRedirect, false, 'Web lets Supabase navigate in the current tab');
  assert.equal(browserCalls, 3, 'Web never opens an authentication popup');
  await assert.rejects(
    () => repository.completeOAuthFromUrl(callback + '#access_token=test-access&refresh_token=test-refresh'),
    (error) => error.code === 'AUTH_FAILED',
    'Token-bearing callback fragments must never establish a session',
  );
  assert.equal(setSessionCalls, 0, 'OAuth completion never calls setSession with URL tokens');
  const completed = await repository.completeOAuthFromUrl(callback + '&code=pkce-code');
  assert.equal(completed.id, 'signed-in');
  assert.equal(exchangeCalls, 1, 'PKCE callback code is exchanged exactly once');
  await assert.rejects(() => repository.completeOAuthFromUrl(callback + '&error=access_denied'), (error) => error.code === 'AUTH_FAILED');
  assert.equal(setSessionCalls, 0, 'Provider rejection must not establish a session');
  oauthError = { message: 'unavailable' };
  await assert.rejects(() => repository.signInWithKakao(callback), (error) => error.code === 'AUTH_FAILED');
  assert.equal(browserCalls, 3);

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['profiles', 'mine', 'owner'], { private: true });
  let shouldFail = true;
  const { useSignOut } = loadSource('hooks/useSignOut.ts', {
    '@tanstack/react-query': {
      useQueryClient: () => client,
      useMutation: ({ mutationFn, onSuccess }) => ({ mutateAsync: async () => { await mutationFn(); await onSuccess(); } }),
    },
    '@/services': { authService: { signOut: async () => { if (shouldFail) throw new Error('offline'); } } },
  });
  await assert.rejects(() => useSignOut().mutateAsync(), /offline/);
  assert.equal(client.getQueryData(['profiles', 'mine', 'owner']).private, true);
  const late = deferred();
  const pending = client.fetchQuery({ queryKey: ['home', 'owner'], queryFn: () => late.promise }).catch(() => {});
  shouldFail = false;
  await useSignOut().mutateAsync();
  late.resolve({ userId: 'owner' });
  await pending;
  assert.equal(client.getQueryCache().getAll().length, 0, 'Late user data must not repopulate a cleared cache');

  const { queryKeys } = loadSource('lib/query/queryKeys.ts');
  const { usePublicProfile } = loadSource('hooks/usePublicProfile.ts', {
    '@tanstack/react-query': { useQuery: (options) => options },
    '@/lib/query/queryKeys': { queryKeys },
    '@/services': { profileService: {} },
  });
  const keys = [undefined, 'owner', 'visitor'].map((id) => JSON.stringify(usePublicProfile('Owner', id).queryKey));
  assert.equal(new Set(keys).size, 3);
  console.log('Auth checks passed: session races, Kakao/Apple OAuth routing, failure/retry, global logout, cache clearing and viewer isolation.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
