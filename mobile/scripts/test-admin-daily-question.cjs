const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { QueryClient } = require('@tanstack/react-query');
const { load } = require('./mvp-screen-harness.cjs');
const tree = load('lib/categories/categoryTree.ts');
const { AppError } = load('errors/appError.ts');
const cat = (id, parentId, extra = {}) => ({ id, parentId, name: id, slug: id, status: 'open', isVisible: true, isPickable: true, sortOrder: 0, ...extra });
const categories = [cat('food', null, { isPickable: false }), cat('ramen', 'food'), cat('noodles', 'food', { isPickable: false }),
  cat('cold-noodles', 'noodles'), cat('closed', 'food', { status: 'closed' }), cat('hidden', 'food', { isVisible: false }), cat('movie', null)];
const plain = (v) => JSON.parse(JSON.stringify(v));
async function main() {
  let admin = false, saved = [], selected = null, reads = 0;
  const repository = {
    isAdmin: async () => admin,
    getCategories: async () => { reads++; return categories; },
    getHomeDailyQuestionCategoryId: async () => selected,
    setHomeDailyQuestionCategoryId: async (id) => { saved.push(id); selected = id; return id; },
  };
  const { AdminService } = load('services/adminService.ts', {
    '@/errors/appError': { AppError }, '@/lib/categories/categoryTree': tree,
    '@/lib/items/itemIdentity': load('lib/items/itemIdentity.ts'),
  });
  const service = new AdminService(repository, {});
  await assert.rejects(() => service.getHomeDailyQuestionSettings(), (e) => e.code === 'FORBIDDEN');
  await assert.rejects(() => service.setHomeDailyQuestionCategoryId('ramen'), (e) => e.code === 'FORBIDDEN');
  assert.equal(reads, 0); assert.equal(saved.length, 0);
  admin = true;
  for (const id of ['missing', 'food', 'noodles', 'closed', 'hidden', 'movie', '']) {
    await assert.rejects(() => service.setHomeDailyQuestionCategoryId(id), /HOME_DAILY_QUESTION_CATEGORY_INVALID/);
  }
  assert.equal(saved.length, 0);
  assert.equal(await service.setHomeDailyQuestionCategoryId('cold-noodles'), 'cold-noodles');
  assert.equal((await service.getHomeDailyQuestionSettings()).categoryId, 'cold-noodles');
  assert.equal(await service.setHomeDailyQuestionCategoryId(null), null);

  const { mapSupabaseError } = load('errors/mapSupabaseError.ts', { './appError': { AppError } });
  const imports = { '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError } };
  for (const name of ['brand', 'category', 'item']) imports[`@/repositories/mappers/${name}Mapper`] = load(`repositories/mappers/${name}Mapper.ts`);
  const { SupabaseAdminRepository } = load('repositories/supabase/supabaseAdminRepository.ts', imports);
  let payload, backendError = null;
  const chain = { select: (columns) => { assert.equal(columns, 'daily_question_category_id'); return chain; },
    eq: (column, value) => { assert.equal(column, 'id'); assert.equal(value, true); return chain; },
    update: (value) => { payload = value; return chain; },
    single: async () => ({ data: { daily_question_category_id: payload?.daily_question_category_id ?? null }, error: backendError }) };
  const repo = new SupabaseAdminRepository({ from: (table) => { assert.equal(table, 'home_settings'); return chain; } });
  assert.equal(await repo.getHomeDailyQuestionCategoryId(), null);
  assert.equal(await repo.setHomeDailyQuestionCategoryId('ramen'), 'ramen');
  assert.deepEqual(plain(payload), { daily_question_category_id: 'ramen' }, 'No unrelated settings are written');
  backendError = { code: '42501', message: 'permission denied' };
  await assert.rejects(() => repo.setHomeDailyQuestionCategoryId(null), 'MFA/RLS failures cannot appear successful');

  const { queryKeys } = load('lib/query/queryKeys.ts');
  const client = new QueryClient();
  const hooks = load('hooks/useAdminHomeSettings.ts', {
    '@tanstack/react-query': { useMutation: (o) => o, useQuery: (o) => o, useQueryClient: () => client },
    '@/services': { adminService: service }, '@/lib/query/queryKeys': { queryKeys },
  });
  assert.equal(hooks.useAdminDailyQuestionSettings().enabled, false);
  assert.notDeepEqual(plain(hooks.useAdminDailyQuestionSettings('a').queryKey), plain(hooks.useAdminDailyQuestionSettings('b').queryKey));
  for (const key of [queryKeys.home.dailyQuestion(), queryKeys.home.data('viewer'), ['admin', 'home-daily-question', 'a'], ['admin', 'home-daily-question', 'b']]) client.setQueryData(key, {});
  await hooks.useUpdateAdminDailyQuestion('a').onSuccess('ramen');
  assert.equal(client.getQueryData(['admin', 'home-daily-question', 'a']).categoryId, 'ramen', 'Saved selection survives a failed background refetch');
  assert.equal(client.getQueryState(queryKeys.home.dailyQuestion()).isInvalidated, true);
  assert.equal(client.getQueryState(queryKeys.home.data('viewer')).isInvalidated, true);
  assert.equal(client.getQueryState(['admin', 'home-daily-question', 'a']).isInvalidated, true);
  assert.equal(client.getQueryState(['admin', 'home-daily-question', 'b']).isInvalidated, false);
  client.clear();

  let states = [], cursor = 0, picker, buttons = [], writes = [], rejectSave = true, retries = 0;
  const busy = { current: false };
  const query = { data: { categoryId: null, categories }, isPending: false, isError: false, isFetching: false, refetch: () => { retries++; } };
  const mutation = { isPending: false, mutateAsync: async (id) => { writes.push(id); if (rejectSave) throw Error('offline'); query.data.categoryId = id; return id; } };
  const host = ({ children }) => React.createElement('div', null, children);
  const { AdminDailyQuestionSettings } = load('components/admin-daily-question-settings.tsx', {
    react: { useState: (initial) => { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], (v) => { states[i] = v; }]; }, useRef: () => busy },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { Text: host, View: host, ActivityIndicator: () => null, StyleSheet: { create: (s) => s } },
    '@/components/admin/category-picker': { AdminCategoryPicker: (props) => { picker = props; return null; } },
    '@/components/ui': { Button: (props) => { buttons.push(props); return host({ children: props.label }); } },
    '@/constants/onepick': require('./design-tokens.cjs'),
    '@/hooks/useAdminHomeSettings': { useAdminDailyQuestionSettings: () => query, useUpdateAdminDailyQuestion: () => mutation },
    '@/lib/categories/categoryTree': tree,
  });
  const render = (userId = 'a') => { cursor = 0; buttons = []; return renderToStaticMarkup(React.createElement(AdminDailyQuestionSettings, { userId })); };
  const button = (label) => { const b = buttons.find((p) => p.label === label); assert.ok(b, label); return b; };
  render(); assert.deepEqual(plain(picker.selectable.map((c) => c.id)), ['ramen', 'cold-noodles']);
  assert.equal(button('질문 설정을 저장해요').disabled, true);
  picker.onChange('ramen'); render(); button('질문 설정을 저장해요').onPress(); button('질문 설정을 저장해요').onPress();
  await new Promise(setImmediate); assert.equal(writes.length, 1, 'Rapid taps do not double-write');
  assert.match(render(), /선택한 메뉴를 유지/); assert.equal(picker.value, 'ramen');
  rejectSave = false; button('질문 설정을 저장해요').onPress(); await new Promise(setImmediate);
  assert.match(render(), /저장했어요/); assert.equal(picker.value, 'ramen');
  button('질문을 숨겨요').onPress(); render(); button('질문 설정을 저장해요').onPress(); await new Promise(setImmediate);
  assert.match(render(), /홈 질문을 숨겼어요/); assert.equal(writes.at(-1), null);
  mutation.isPending = true; render(); assert.equal(picker.disabled, true); assert.equal(button('저장하고 있어요').disabled, true);
  mutation.isPending = false; query.isError = true; render(); assert.equal(button('질문 설정을 저장해요').disabled, true);
  button('다시 불러와요').onPress(); assert.equal(retries, 1);
  query.isFetching = true; render(); assert.equal(button('다시 불러와요').disabled, true);
  query.isFetching = false; query.isError = false; query.data.categoryId = 'closed'; states = []; render();
  assert.equal(button('질문 설정을 저장해요').disabled, true); assert.equal(button('질문을 숨겨요').disabled, false);
  render(null); assert.equal(picker.disabled, true);
  console.log('Admin daily question checks passed: authorization, menu scope, least-privilege write, errors, cache isolation, save/hide/retry and duplicate-submit protection.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
