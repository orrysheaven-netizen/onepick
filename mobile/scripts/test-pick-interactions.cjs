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
const textOf = (node) => typeof node === 'string' ? node : Array.isArray(node) ? node.map(textOf).join('') : node?.props ? textOf(node.props.children) : '';

async function main() {
  const { AppError } = loadSource('errors/appError.ts');
  const { ProductService } = loadSource('services/productService.ts', { '@/errors/appError': { AppError } });
  let category = { id: 'category', status: 'open', isVisible: true, isPickable: true };
  let product = { id: 'product', categoryId: 'category', status: 'active', name: '제품' };
  let currentPick = null;
  const service = new ProductService(
    { getById: async () => product },
    { getCurrentPick: async () => currentPick, getRecentPicks: async () => [] },
    {}, { getById: async () => category },
  );
  assert.equal((await service.getProductDetail('product')).canChoose, true);
  for (const status of ['draft', 'paused', 'closed']) {
    category.status = status;
    assert.equal((await service.getProductDetail('product')).canChoose, false);
  }
  category.status = 'open';
  category.isVisible = false;
  assert.equal((await service.getProductDetail('product')).canChoose, false);
  category.isVisible = true; category.isPickable = false;
  assert.equal((await service.getProductDetail('product')).canChoose, false);
  category.isPickable = true;
  for (const status of ['pending', 'hidden', 'merged', 'rejected']) {
    product.status = status;
    assert.equal((await service.getProductDetail('product')).canChoose, false);
  }
  product.status = 'discontinued';
  assert.equal((await service.getProductDetail('product')).canChoose, true);
  currentPick = { id: 'mine', productId: 'product', oneLineReview: '기존 한줄평' };
  let detail = await service.getProductDetail('product', 'owner');
  assert.equal(detail.myPickStatus.oneLineReview, '기존 한줄평');

  const presses = [], inputs = [];
  let destination, params = { productId: 'product' };
  const nativeComponent = (tag) => ({ children }) => React.createElement(tag, null, children);
  const native = {
    View: nativeComponent('div'), Text: nativeComponent('span'), ScrollView: nativeComponent('main'),
    ActivityIndicator: () => null,
    Pressable: (props) => { presses.push(props); return React.createElement('button', null, props.children); },
    TextInput: (props) => { inputs.push(props); return null; },
    StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
  };
  const base = {
    'expo-router': { useRouter: () => ({ push: (route) => { destination = route; }, replace: (route) => { destination = route; }, back() {} }), useLocalSearchParams: () => params },
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: nativeComponent('section') },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'owner' }, isLoading: false }) },
    '@/errors/appError': { AppError },
    '@/hooks/useProductDetail': { useProductDetail: () => ({ data: detail }) },
  };
  const render = (Screen) => { presses.length = 0; inputs.length = 0; return renderToStaticMarkup(React.createElement(Screen)); };
  const { default: Product } = loadSource('app/product/[productId].tsx', base);
  detail = { ...detail, canChoose: false, myPickStatus: { type: 'not_selected' } };
  assert.match(render(Product), /새 원픽을 선택할 수 없어요/);
  assert.ok(!presses.some((p) => textOf(p.children) === '이 제품을 내 원픽으로'));
  detail.myPickStatus = { type: 'selected_this', pickId: 'mine', oneLineReview: '기존 한줄평' };
  render(Product);
  presses.find((p) => textOf(p.children) === '내 원픽 한줄평 보기/수정').onPress();
  assert.equal(destination.params.pickId, 'mine');

  const { default: Choose } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}) },
  });
  assert.match(render(Choose), /지금은 선택할 수 없어요/);
  assert.equal(inputs.length, 0, 'Unavailable products must not show the submission form');
  detail.canChoose = true;
  render(Choose);
  assert.equal(inputs[0].value, '기존 한줄평');
  const { default: MissingProduct } = loadSource('app/pick/choose.tsx', {
    ...base, '@/hooks/useChoosePick': { useChoosePick: () => ({}) },
    '@/hooks/useProductDetail': { useProductDetail: () => ({ isPending: true }) },
  });
  params = {};
  assert.match(render(MissingProduct), /제품을 불러오지 못했어요/);

  let draft = '  댓글 초안  ', attempts = 0, rejectSave, resolveSave;
  let pick = { id: 'pick', userId: 'owner', status: 'active', oneLineReview: '이유' };
  let mutation = { mutateAsync: () => { attempts++; return new Promise((resolve, reject) => { resolveSave = resolve; rejectSave = reject; }); } };
  params = { pickId: 'pick' };
  const { default: Pick } = loadSource('app/pick/[pickId].tsx', {
    ...base,
    react: { ...React, useState: () => [draft, (value) => { draft = value; }] },
    '@/components/pick-share-card': { PickShareCard: () => null },
    '@/components/pick-management': { PickManagement: () => null },
    '@/hooks/usePickDetail': { usePickDetail: () => ({ data: { pick, product, category, profile: { username: 'owner' }, isCurrent: true } }) },
    '@/hooks/usePickComments': { usePickComments: () => ({ data: [] }) },
    '@/hooks/useCreateComment': { useCreateComment: () => mutation },
  });
  render(Pick);
  const submit = presses.find((p) => textOf(p.children) === '댓글 남기기').onPress;
  const unhandled = [];
  const capture = (error) => unhandled.push(error);
  process.on('unhandledRejection', capture);
  try {
    submit(); submit();
    assert.equal(attempts, 1, 'Rapid taps must submit only once');
    rejectSave(new Error('offline'));
    await flush();
    assert.equal(unhandled.length, 0);
    assert.equal(draft, '  댓글 초안  ', 'Failed saves retain the draft');
    submit();
    assert.equal(attempts, 2, 'A failed request can be retried');
    resolveSave({});
    await flush();
    assert.equal(draft, '', 'Successful saves clear the draft');
  } finally { process.removeListener('unhandledRejection', capture); }
  pick.status = 'needs_review';
  assert.match(render(Pick), /확인이 필요한 원픽에는 새 댓글을 남길 수 없습니다/);
  assert.equal(inputs.length, 0);
  pick.status = 'active';
  mutation = { isError: true, error: new AppError('PROFILE_NOT_FOUND') };
  assert.match(render(Pick), /사용자명 만들고 계속/);
  presses.find((p) => textOf(p.children) === '사용자명 만들고 계속').onPress();
  assert.equal(destination.params.action, 'comment_pick');
  assert.equal(destination.params.pickId, 'pick');
  console.log('Interaction checks passed: product/category eligibility, review prefill, comment failure/retry, duplicate taps and profile recovery.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
