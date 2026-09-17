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
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';
async function main() {
  let state = [], index = 0, presses = [], inputs = [], destination, payload, calls = 0;
  const fakeReact = { ...React, useState: (initial) => {
    const slot = index++;
    if (!(slot in state)) state[slot] = typeof initial === 'function' ? initial() : initial;
    return [state[slot], (value) => { state[slot] = typeof value === 'function' ? value(state[slot]) : value; }];
  } };
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    Text: nativeComponent('span'), View: nativeComponent('div'), ScrollView: nativeComponent('main'),
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    TextInput: (props) => { inputs.push(props); return null; }, ActivityIndicator: () => null, Image: () => null, Switch: () => null,
    StyleSheet: { create: (styles) => styles },
  };
  const { AppError } = load('errors/appError.ts');
  const identity = load('lib/items/itemIdentity.ts');
  const category = { id: 'new', name: '새 카테고리', slug: 'new', status: 'open', isVisible: true, isPickable: true };
  const item = { id: 'item', name: '찾은 제품', categoryId: category.id, status: 'active' };
  let searchCategory, results = [item], auth = { user: { id: 'owner' }, isLoading: false };
  const common = {
    react: fakeReact, 'react-native': native,
    'expo-router': { useRouter: () => ({ replace: (route) => { destination = route; }, push: (route) => { destination = route; } }), useLocalSearchParams: () => ({}) },
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('section') },
    '@/components/pick-photo': { PickPhoto: () => null }, '@/errors/appError': { AppError },
    '@/hooks/useAuthSession': { useAuthSession: () => auth },
  };
  const { default: Register } = load('app/pick/register.tsx', { ...common,
    '@/lib/items/itemIdentity': identity,
    '@/hooks/useMyProfile': { useMyProfile: () => ({ data: { currentPicks: [] } }) },
    '@/hooks/useItemDetail': { useItemDetail: () => ({}) },
    '@/hooks/useItemSearch': { useItemSearch: (_, id) => { searchCategory = id; return { data: results }; } },
    '@/hooks/useRegisterPick': {
      useRegistrationCategories: () => ({ data: [category] }), useChoosePhoto: () => ({}), useImportItemPhoto: () => ({}),
      useRegisterPick: () => ({ reset() {}, mutateAsync: async (input) => { calls++; payload = input; return input.itemId ? { type: 'pick', pick: { id: 'saved' } } : { type: 'pending_item', item: { ...item, name: input.itemName, status: 'pending' } }; } }),
    },
  });
  const render = (Screen = Register) => { index = 0; presses = []; inputs = []; return renderToStaticMarkup(React.createElement(Screen)); };
  const press = (text) => { const item = presses.find((p) => textOf(p.children).includes(text)); assert.ok(item, text); assert.ok(!item.disabled, text); return item.onPress(); };
  render(); assert.equal(searchCategory, undefined, 'Initial search spans every category');
  inputs.find((p) => p.accessibilityLabel === '제품명').onChangeText('찾은'); render(); press('이 제품 선택');
  assert.match(render(), /새 카테고리 · 카테고리가 자동/);
  inputs.find((p) => p.accessibilityLabel === '원픽 한줄평').onChangeText('선택 이유'); render();
  press('원픽 등록하기'); press('원픽 등록하기');
  await new Promise(setImmediate);
  assert.equal(calls, 1, 'Repeated taps submit once'); assert.equal(payload.categoryId, 'new'); assert.equal(destination.params.pickId, 'saved');
  state = []; calls = 0; results = []; render();
  inputs.find((p) => p.accessibilityLabel === '제품명').onChangeText('새로운 제품'); render(); press('목록에 없어요'); render(); press('새 카테고리'); render(); press('입력한 이름으로 요청');
  render(); assert.ok(!inputs.some((p) => p.accessibilityLabel === '원픽 한줄평'), 'Requests do not require a Pick review');
  press('제품 등록 요청하기'); await new Promise(setImmediate);
  assert.equal(payload.itemId, undefined); assert.equal(payload.categoryId, 'new'); assert.match(render(), /제품 등록을 요청했어요/);

  let dashboard = { isError: true, error: new AppError('FORBIDDEN') };
  const { default: Admin } = load('app/admin/index.tsx', { ...common,
    '@/components/admin-home-settings': { AdminHomeSettings: () => null },
    '@/lib/categories/categoryTree': load('lib/categories/categoryTree.ts'),
    '@/hooks/useAdmin': { useAdminDashboard: () => dashboard, useAdminActions: () => ({}) },
  });
  state = []; assert.match(render(Admin), /관리자 권한이 필요/); assert.equal(inputs.length, 0);
  dashboard = { data: { categories: [], items: [], pending: [], brands: [] } };
  state = []; assert.match(render(Admin), /카테고리 추가/); assert.ok(inputs.some((p) => p.accessibilityLabel === '카테고리 식별자'));
  auth = { user: null }; state = []; render(Admin); assert.equal(inputs.length, 0, 'Anonymous users never see administrator forms');
  console.log('Screen checks passed: item-first selection, automatic category, pending confirmation, duplicate taps and admin access states.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
