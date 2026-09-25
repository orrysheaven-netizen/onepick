const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function createSupabase({ session = null, isAdmin = true, aalLevel = 'aal2', adminError = null, assuranceError = null } = {}) {
  const calls = { signOut: 0, exchangeCode: [], setSession: [], signInWithOAuth: [], rpc: [] };
  return {
    calls,
    get session() { return session; },
    set session(next) { session = next; },
    auth: {
      getSession: async () => ({ data: { session }, error: null }),
      signOut: async () => { calls.signOut++; session = null; return { error: null }; },
      exchangeCodeForSession: async (code) => { calls.exchangeCode.push(code); if (!session) session = { access_token: 'exchanged-token', refresh_token: 'r' }; return { data: {}, error: null }; },
      setSession: async (input) => { calls.setSession.push(input); if (!session) session = { access_token: input.access_token, refresh_token: input.refresh_token }; return { data: {}, error: null }; },
      signInWithOAuth: async (options) => { calls.signInWithOAuth.push(options); return { data: { url: 'https://example.com/authorize' }, error: null }; },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => assuranceError
          ? { data: null, error: assuranceError }
          : { data: { currentLevel: aalLevel }, error: null },
      },
    },
    rpc: async (name) => {
      calls.rpc.push(name);
      assert.equal(name, 'current_user_is_admin', 'Only the membership RPC is expected here');
      return adminError ? { data: null, error: adminError } : { data: isAdmin, error: null };
    },
  };
}

function createFetch(responseFactory) {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const { status = 200, body = {} } = responseFactory(url, init) ?? {};
    return { status, ok: status >= 200 && status < 300, json: async () => body };
  };
  return { fetch: fetchFn, calls };
}

function load(supabase, fetchFn, browser = {}) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8');
  const outputText = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  const context = {
    exports: exportsObject,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-publishable-key' } },
    fetch: fetchFn,
    URLSearchParams,
    location: browser.location,
    history: browser.history,
    require: (name) => {
      if (name === '@/lib/supabase/client') return { supabase };
      // Pure, dependency-free formatting helper (no session/storage of its own) -- admin-api.ts's
      // manual item creation uses it, so it is allowed alongside the shared-session guard above.
      if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (value) => value };
      if (name === '@/lib/items/pickChannel') return require('./pick-channel.cjs');
      // The single shared access-token helper admin-api.ts and admin-moderation-api.ts both use.
      // Mirrors the real implementation exactly, against this same mocked `supabase` client, so
      // the assertions below still exercise real getSession()/error behavior, not a stub.
      if (name === '@/lib/admin/adminSession') {
        return {
          getAdminAccessToken: async () => {
            const { data, error } = await supabase.auth.getSession();
            if (error || !data.session) throw new Error('관리자 로그인이 필요합니다.');
            return data.session.access_token;
          },
        };
      }
      assert.fail('Unexpected runtime dependency: ' + name);
    },
  };
  vm.runInNewContext(outputText, context);
  return exportsObject;
}

async function main() {
  // --- checkAdminSession: signed-out short-circuits before any admin/MFA check ---
  {
    const supabase = createSupabase({ session: null });
    const { checkAdminSession } = load(supabase, async () => assert.fail('signed-out must never call fetch'));
    assert.equal(await checkAdminSession(), 'signed-out');
    assert.equal(supabase.calls.rpc.length, 0, 'Membership must not be checked without a session');
  }

  // --- checkAdminSession: non-admin is rejected and signed out, regardless of AAL ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, isAdmin: false, aalLevel: 'aal2' });
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'));
    await assert.rejects(() => checkAdminSession(), /관리자 권한이 없는/);
    assert.equal(supabase.calls.signOut, 1, 'Non-admin session must be signed out');
    assert.equal(supabase.session, null, 'Session must actually be cleared');
  }

  // --- checkAdminSession: RPC failure also signs out and surfaces an error ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, adminError: { message: 'db down' } });
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'));
    await assert.rejects(() => checkAdminSession(), /확인하지 못했습니다/);
    assert.equal(supabase.calls.signOut, 1);
  }

  // --- checkAdminSession: allowlisted admin at AAL1 is sent to MFA, session kept alive ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, isAdmin: true, aalLevel: 'aal1' });
    const { checkAdminSession } = load(supabase, async () => assert.fail('needs-mfa must not reach any dashboard fetch'));
    assert.equal(await checkAdminSession(), 'needs-mfa');
    assert.equal(supabase.calls.signOut, 0, 'An AAL1 admin must not be signed out -- they need the session to complete MFA');
    assert.ok(supabase.session, 'Session must remain so the challenge screen can use it');
  }

  // --- checkAdminSession: an assurance-level lookup failure throws without nuking the session ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, isAdmin: true, assuranceError: { message: 'unavailable' } });
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'));
    await assert.rejects(() => checkAdminSession(), /추가 인증 상태/);
    assert.equal(supabase.calls.signOut, 0, 'A transient AAL lookup failure is not the same as being denied -- do not force a fresh Kakao login');
  }

  // --- checkAdminSession: allowlisted admin at AAL2 is signed in ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, isAdmin: true, aalLevel: 'aal2' });
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'));
    assert.equal(await checkAdminSession(), 'signed-in');
  }

  // --- Completing MFA in place (same shared session, no re-login) flips needs-mfa -> signed-in,
  //     and the very next admin request immediately uses the elevated token. ---
  {
    const supabase = createSupabase({ session: { access_token: 'aal1-token', refresh_token: 'r' }, isAdmin: true, aalLevel: 'aal1' });
    const { fetch: fetchFn, calls } = createFetch(() => ({ status: 200, body: { users_total: 1 } }));
    const { checkAdminSession, getDashboardMetrics } = load(supabase, fetchFn);
    assert.equal(await checkAdminSession(), 'needs-mfa');

    // Simulate AdminMfaService.verify() succeeding on the SAME shared client:
    // it elevates the session in place, exactly like challengeAndVerify does.
    supabase.session = { access_token: 'aal2-token', refresh_token: 'r' };
    supabase.auth.mfa.getAuthenticatorAssuranceLevel = async () => ({ data: { currentLevel: 'aal2' }, error: null });

    assert.equal(await checkAdminSession(), 'signed-in');
    const metrics = await getDashboardMetrics();
    assert.equal(metrics.users_total, 1);
    assert.equal(calls[0].init.headers.Authorization, 'Bearer aal2-token', 'The dashboard call must use the just-elevated token, not a stale AAL1 one');
  }

  // --- adminRequest sources a fresh access token from the shared session on every call ---
  {
    let token = 'token-a';
    const supabase = createSupabase({ isAdmin: true });
    supabase.auth.getSession = async () => ({ data: { session: token ? { access_token: token, refresh_token: 'r' } : null }, error: null });
    const { fetch: fetchFn, calls } = createFetch(() => ({ status: 200, body: { ok: true, id: 'x', status: 'merged', merged_into_item_id: 'target' } }));
    const { mergePendingItem } = load(supabase, fetchFn);

    await mergePendingItem('source', 'target');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer token-a');
    assert.equal(JSON.parse(calls[0].init.body).p_source_item_id, 'source');
    assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/admin_merge_pending_item');

    token = 'token-b, refreshed';
    await mergePendingItem('source2', 'target2');
    assert.equal(calls[1].init.headers.Authorization, 'Bearer token-b, refreshed', 'A refreshed shared-client token must be picked up without any admin-api-local refresh logic');
  }

  // --- createBrand/createItem reject empty or overlong names locally, before any request ---
  {
    const supabase = createSupabase({ isAdmin: true });
    const { fetch: fetchFn, calls } = createFetch(() => assert.fail('an invalid name must never reach the network'));
    const { createBrand, createItem } = load(supabase, fetchFn);

    // createBrand/createItem validate synchronously (before returning any promise), so the
    // check must itself be async -- assert.rejects only applies its error/regex match when the
    // function it calls returns a promise, not when it throws before ever returning one.
    await assert.rejects(async () => createBrand({ name: '   ' }), /1자 이상/, 'A blank brand name must be rejected');
    await assert.rejects(async () => createBrand({ name: '가'.repeat(81) }), /80자 이하/, 'A brand name over 80 chars must be rejected');
    await assert.rejects(
      async () => createItem({ categoryId: 'c1', categorySlug: 'ramen', name: '가'.repeat(101) }),
      /100자 이하/,
      'An item name over 100 chars must be rejected',
    );
    assert.equal(calls.length, 0, 'No request should have been sent for any rejected name');
  }

  // --- createBrand collapses internal whitespace into the stored name and its derived normalized_name ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' }, isAdmin: true });
    const { fetch: fetchFn, calls } = createFetch(() => ({ status: 200, body: [{ id: 'b1' }] }));
    const { createBrand } = load(supabase, fetchFn);

    await createBrand({ name: '  농심   라면  ' });
    const body = JSON.parse(calls[0].init.body);
    assert.equal(body.name, '농심 라면', 'Internal whitespace runs must collapse to a single space');
    assert.equal(body.normalized_name, '농심라면');
  }

  // --- After sign-out, admin requests fail locally without ever reaching the network ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' } });
    const { fetch: fetchFn, calls } = createFetch(() => assert.fail('signed-out must never call fetch'));
    const { signOutAdmin, getDashboardMetrics } = load(supabase, fetchFn);
    await signOutAdmin();
    assert.equal(supabase.calls.signOut, 1);
    await assert.rejects(() => getDashboardMetrics(), /관리자 로그인이 필요합니다/);
    assert.equal(calls.length, 0);
  }

  // --- signOutAdmin ends all shared Supabase Auth sessions, not only this browser session ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' } });
    let signOutOptions;
    supabase.auth.signOut = async (options) => { signOutOptions = options; supabase.session = null; return { error: null }; };
    const { signOutAdmin } = load(supabase, async () => assert.fail('should not fetch'));
    await signOutAdmin();
    assert.equal(signOutOptions.scope, 'global');
  }

// --- signOutAdmin surfaces a fixed error instead of provider details ---
  {
    const supabase = createSupabase({ session: { access_token: 'tok', refresh_token: 'r' } });
    supabase.auth.signOut = async () => ({ error: { message: 'provider_internal_secret_detail' } });
    const { signOutAdmin } = load(supabase, async () => assert.fail('should not fetch'));
    await assert.rejects(
      () => signOutAdmin(),
      (error) => error.message === '관리자 로그아웃에 실패했습니다.'
        && !error.message.includes('provider_internal_secret_detail'),
    );
  }

  // --- OAuth provider errors are removed from the URL and never shown verbatim to admins ---
  {
    const supabase = createSupabase({ session: null });
    let replaced;
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'), {
      location: {
        origin: 'https://admin.onepick.example',
        pathname: '/admin',
        search: '?error=access_denied&error_description=provider_internal_secret_detail',
        hash: '',
      },
      history: { replaceState: (_data, _unused, url) => { replaced = url; } },
    });
    await assert.rejects(
      () => checkAdminSession(),
      (error) => error.message === '관리자 로그인을 완료하지 못했습니다.'
        && !error.message.includes('provider_internal_secret_detail'),
    );
    assert.equal(replaced, '/admin', 'OAuth error details must be removed from the URL');
  }

  // --- beginKakaoAdminSignIn delegates to the shared client's OAuth flow, not a hand-built authorize URL ---
  {
    const supabase = createSupabase();
    const { beginKakaoAdminSignIn } = load(supabase, async () => assert.fail('should not fetch'), {
      location: { origin: 'https://admin.onepick.example', pathname: '/admin', search: '', hash: '' },
    });
    await beginKakaoAdminSignIn();
    const options = supabase.calls.signInWithOAuth[0];
    assert.equal(options.provider, 'kakao');
    assert.equal(options.options.redirectTo, 'https://admin.onepick.example/admin');
    assert.equal(options.options.queryParams.scope, 'profile_nickname');
  }

  // --- Token-bearing fragments are ignored and cannot establish an admin session ---
  {
    const supabase = createSupabase({ session: null, isAdmin: true, aalLevel: 'aal2' });
    let replaced;
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'), {
      location: {
        origin: 'https://admin.onepick.example',
        pathname: '/admin',
        search: '',
        hash: '#access_token=attacker&refresh_token=attacker',
      },
      history: { replaceState: (_data, _unused, url) => { replaced = url; } },
    });
    assert.equal(await checkAdminSession(), 'signed-out');
    assert.equal(supabase.calls.setSession.length, 0, 'URL tokens must never reach setSession');
    assert.equal(replaced, '/admin', 'Rejected token fragments are removed from the URL');
  }

  // --- The PKCE `?code=` return leg is exchanged on the shared client and the URL is cleaned up ---
  {
    const supabase = createSupabase({ session: null, isAdmin: true, aalLevel: 'aal2' });
    let replaced;
    const { checkAdminSession } = load(supabase, async () => assert.fail('should not fetch'), {
      location: { origin: 'https://admin.onepick.example', pathname: '/admin', search: '?code=auth-code-123', hash: '' },
      history: { replaceState: (_data, _unused, url) => { replaced = url; } },
    });
    assert.equal(await checkAdminSession(), 'signed-in');
    assert.deepEqual(supabase.calls.exchangeCode, ['auth-code-123']);
    assert.equal(replaced, '/admin', 'The code must not linger in the URL bar');
  }

  console.log('Admin session checks passed: unified shared-session gating, AAL1/AAL2 transitions, non-admin rejection, sign-out, token refresh and OAuth completion.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
