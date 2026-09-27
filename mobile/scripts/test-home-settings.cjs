const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { QueryClient } = require('@tanstack/react-query');
function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}
async function main() {
  const { AppError } = load('errors/appError.ts');
  const { AdminService } = load('services/adminService.ts', {
    '@/errors/appError': { AppError }, '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
    '@/lib/items/itemIdentity': load('lib/items/itemIdentity.ts'),
  });
  let admin = false, minimum = 3, writes = 0;
  const service = new AdminService({ isAdmin: async () => admin,
    getHomeMinimumPickCount: async () => minimum,
    setHomeMinimumPickCount: async (count) => { writes++; minimum = count; return count; },
  }, {});
  await assert.rejects(() => service.getHomeMinimumPickCount(), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.setHomeMinimumPickCount(5), (e) => e.code === 'FORBIDDEN');
  admin = true;
  for (const count of [0, -1, 3.5, NaN, Infinity, 100001]) await assert.rejects(() => service.setHomeMinimumPickCount(count), /HOME_THRESHOLD_INVALID/);
  assert.equal(writes, 0);
  assert.equal(await service.setHomeMinimumPickCount(5), 5);
  assert.equal(await service.getHomeMinimumPickCount(), 5);

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const cache = new QueryClient();
  cache.setQueryData(queryKeys.home.data(), {});
  cache.setQueryData(queryKeys.home.data('viewer'), {});
  const hooks = load('hooks/useAdminHomeSettings.ts', {
    '@tanstack/react-query': { useMutation: (options) => options, useQuery: (options) => options, useQueryClient: () => cache },
    '@/services': { adminService: service }, '@/lib/query/queryKeys': { queryKeys },
  });
  assert.equal(hooks.useAdminHomeSettings().enabled, false);
  await hooks.useUpdateAdminHomeSettings('admin').onSuccess(5);
  for (const user of [undefined, 'viewer']) assert.equal(cache.getQueryState(queryKeys.home.data(user)).isInvalidated, true);
  assert.equal(cache.getQueryData(['admin', 'home-settings', 'admin']), 5);
  cache.clear();

  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError },
    '@/repositories/supabase/itemChannels': { fetchItemChannels: async () => new Map() },
    '@/repositories/supabase/itemProviders': { fetchItemProviderIds: async () => new Map() } };
  for (const name of ['category', 'comment', 'pick', 'item', 'profile']) imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  const { SupabaseReadRepository } = load('repositories/supabase/supabaseReadRepository.ts', imports);
  const repo = new SupabaseReadRepository({ rpc: () => assert.fail('Use public counts, regardless of viewer'), storage: { from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }) } },
    { rpc: (name) => { assert.equal(name, 'home_showcase_page'); return { single: async () => ({ data: { minimum_pick_count: 3,
      items: [{ item_id: 'one', category_id: 'cat', category_name: '라면', name: '제품', pick_count: 3, image_path: 'full.jpg', thumbnail_path: null }],
    } }) }; } });
  const showcase = await repo.getHomeShowcase();
  assert.equal(showcase.minimumPickCount, 3); assert.equal(showcase.items[0].pickCount, 3);
  assert.equal(showcase.items[0].thumbnailUrl, 'full.jpg');

  let state = [], index = 0, input, presses = [], failSave = true, saved = [];
  const busy = { current: false };
  const query = { data: 3, isPending: false, isError: false };
  const mutation = { isPending: false, mutateAsync: async (count) => { saved.push(count); if (failSave) throw new Error('offline'); query.data = count; return count; } };
  const component = ({ children }) => React.createElement('div', null, children);
  const { AdminHomeSettings } = load('components/admin-home-settings.tsx', {
    react: { useRef: () => busy, useState: (initial) => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], (value) => { state[i] = value; }]; } },
    'react-native': { Text: component, View: component, ActivityIndicator: () => null, StyleSheet: { create: (s) => s },
      TextInput: (props) => { input = props; return null; }, Pressable: (props) => { presses.push(props); return component(props); } },
    '@/hooks/useAdminHomeSettings': { useAdminHomeSettings: () => query, useUpdateAdminHomeSettings: () => mutation },
  });
  const render = () => { index = 0; presses = []; return renderToStaticMarkup(React.createElement(AdminHomeSettings, { userId: 'admin' })); };
  render(); assert.equal(input.value, '3');
  input.onChangeText('0'); render(); presses[0].onPress();
  assert.match(render(), /정수로 입력/); assert.equal(saved.length, 0);
  input.onChangeText('5'); render(); presses[0].onPress(); presses[0].onPress();
  await new Promise(setImmediate);
  assert.equal(saved.length, 1, 'Rapid taps do not send duplicate writes');
  assert.match(render(), /입력값을 유지/); assert.equal(input.value, '5');
  failSave = false; presses[0].onPress(); await new Promise(setImmediate);
  assert.match(render(), /5명 이상으로 저장/); assert.equal(input.value, '5');
  mutation.isPending = true; render(); assert.equal(input.editable, false); assert.equal(presses[0].disabled, true);
  console.log('Home settings checks passed: admin gate, integer bounds, public aggregate mapping, all-home invalidation, save/retry and duplicate-submit protection.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
