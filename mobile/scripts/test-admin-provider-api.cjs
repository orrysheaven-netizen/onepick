const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(fetchFn) {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/admin-api.ts'), 'utf8');
  const outputText = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exportsObject = {};
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'aal2-token' } }, error: null }),
      signOut: async () => ({ error: null }),
      signInWithOAuth: async () => ({ data: {}, error: null }),
      exchangeCodeForSession: async () => ({ data: {}, error: null }),
      mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal2' }, error: null }) },
    },
    rpc: async () => ({ data: true, error: null }),
  };
  vm.runInNewContext(outputText, {
    exports: exportsObject,
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'pk' } },
    fetch: fetchFn,
    URLSearchParams,
    require: (name) => {
      if (name === '@/lib/supabase/client') return { supabase };
      if (name === '@/lib/items/itemIdentity') return { canonicalItemName: (value) => value };
      if (name === '@/lib/admin/adminSession') return {
        getAdminAccessToken: async () => 'aal2-token',
      };
      assert.fail('Unexpected dependency: ' + name);
    },
  });
  return exportsObject;
}

function createFetch() {
  const calls = [];
  return {
    calls,
    fetch: async (url, init = {}) => {
      calls.push({ url, init });
      return { status: 200, ok: true, json: async () => [] };
    },
  };
}

async function main() {
  {
    const mock = createFetch();
    const api = load(mock.fetch);
    await api.createOnlineProvider({
      categoryId: 'cat-1',
      name: '  성심당   공식몰 ',
      storeType: 'official_site',
      officialUrl: ' https://example.com/store ',
      brandId: null,
    });
    const call = mock.calls[0];
    assert.equal(call.url, 'https://example.supabase.co/rest/v1/rpc/admin_upsert_online_provider_item');
    const body = JSON.parse(call.init.body);
    assert.equal(body.p_name, '성심당 공식몰');
    assert.equal(body.p_store_type, 'official_site');
    assert.equal(body.p_official_url, 'https://example.com/store');
    assert.equal(body.p_platform, null);
    assert.equal(body.p_store_key, null);
    assert.equal(body.p_category_id, 'cat-1');
  }

  {
    const mock = createFetch();
    const api = load(mock.fetch);
    await assert.rejects(
      async () => api.createOnlineProvider({
        categoryId: 'cat-1',
        name: '스토어',
        storeType: 'platform_store',
        officialUrl: 'https://shopping.example/store',
        platform: 'smartstore',
        storeKey: 'wrong:merchant',
      }),
      /smartstore:/,
    );
    assert.equal(mock.calls.length, 0, 'invalid platform identity must not reach the network');
  }

  {
    const mock = createFetch();
    const api = load(mock.fetch);
    await api.createOnlineProvider({
      categoryId: 'cat-2',
      name: '공식 스마트스토어',
      storeType: 'platform_store',
      officialUrl: 'https://shopping.example/store',
      platform: 'SmartStore',
      storeKey: 'SmartStore:Merchant-A',
      brandId: 'brand-1',
    });
    const body = JSON.parse(mock.calls[0].init.body);
    assert.equal(body.p_platform, 'smartstore');
    assert.equal(body.p_store_key, 'smartstore:merchant-a');
    assert.equal(body.p_brand_id, 'brand-1');
  }

  {
    const mock = createFetch();
    const api = load(mock.fetch);
    await api.getOnlineProviders({ query: ' 공식 몰 ' });
    assert.match(mock.calls[0].url, /\/rest\/v1\/providers\?/);
    assert.match(mock.calls[0].url, /kind=eq.online_store/);
    const providerUrl = new URL(mock.calls[0].url);
    assert.equal(providerUrl.searchParams.get('name'), 'ilike.*공식 몰*');
  }

  {
    const mock = createFetch();
    const api = load(mock.fetch);
    await api.setProviderStatus('provider-1', 'hidden');
    await api.setProviderBrand('provider-1', null);
    assert.equal(mock.calls[0].url, 'https://example.supabase.co/rest/v1/rpc/admin_set_provider_status');
    assert.deepEqual(JSON.parse(mock.calls[0].init.body), { p_provider_id: 'provider-1', p_status: 'hidden' });
    assert.equal(mock.calls[1].url, 'https://example.supabase.co/rest/v1/rpc/admin_set_provider_brand');
    assert.deepEqual(JSON.parse(mock.calls[1].init.body), { p_provider_id: 'provider-1', p_brand_id: null });
  }

  console.log('Admin provider API checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
