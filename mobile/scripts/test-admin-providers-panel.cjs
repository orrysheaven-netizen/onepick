const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real component's async handlers without a browser, credentials,
// timers or a live database. This is a deterministic hook/host harness, not E2E.
const source = fs.readFileSync(process.argv[2] || path.join(__dirname, '../src/components/admin/data/providers-panel.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  reportDiagnostics: true,
});
assert.deepEqual(compiled.diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error), [], 'Panel must parse');

const copy = (value) => JSON.parse(JSON.stringify(value));
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const category = {
  id: 'category-a', parent_id: null, name: '테스트 카테고리', slug: 'test-category', status: 'open',
  is_visible: true, is_pickable: true, sort_order: 1, ranking_min_sample: 1, image_url: null,
};
const brands = [{ id: 'brand-a', name: '테스트 브랜드', is_active: true }];
const provider = {
  id: 'provider-a', kind: 'online_store', name: '기존 공식몰', status: 'active', brand_id: null, brand: null,
  online_store_id: 'store-a', created_at: '', updated_at: '',
  store: { id: 'store-a', store_type: 'official_site', host: 'store.example', official_url: 'https://store.example', platform: null, store_key: 'site:store.example' },
};

function backend(overrides = {}) {
  const state = { rows: [copy(provider)] };
  const calls = {};
  const defaults = {
    getOnlineProviders: async () => copy(state.rows),
    getCategories: async () => [copy(category)],
    getBrands: async () => copy(brands),
    createOnlineProvider: async (input) => {
      state.rows.push({ ...copy(provider), id: 'provider-b', name: input.name });
      return [{ provider_id: 'provider-b', online_store_id: 'store-b', item_id: 'item-b', category_id: input.categoryId }];
    },
    setProviderStatus: async (id, status) => {
      const row = state.rows.find((item) => item.id === id);
      row.status = status;
      return copy(row);
    },
    setProviderBrand: async (id, brandId) => {
      const row = state.rows.find((item) => item.id === id);
      row.brand_id = brandId;
      row.brand = brandId ? { name: brands.find((item) => item.id === brandId).name } : null;
      return copy(row);
    },
  };
  const api = Object.fromEntries(Object.keys(defaults).map((name) => {
    calls[name] = [];
    return [name, async (...args) => {
      calls[name].push(copy(args));
      return (overrides[name] || defaults[name])(...args);
    }];
  }));
  return { api, calls, state };
}

function harness(api) {
  const slots = [];
  let cursor = 0, dirty = true, alive = true, tree, lateUpdates = 0;
  let pendingEffects = [];
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((item, index) => !Object.is(item, b[index]));
  const hooks = {
    useState(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, (next) => {
        if (!alive) { lateUpdates++; return; }
        const value = typeof next === 'function' ? next(slots[index].value) : next;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { current: initial };
      return slots[index];
    },
    useMemo(create, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { deps, value: create() };
      return slots[index].value;
    },
    useEffect(setup, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps, setup, cleanup };
        pendingEffects.push(() => {
          cleanup?.();
          slots[index].cleanup = setup();
        });
      }
    },
  };
  const jsx = (type, props = {}) => ({ type, props });
  function expand(node) {
    if (Array.isArray(node)) return node.map(expand);
    if (!node || typeof node !== 'object') return node;
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return { ...node, props: { ...node.props, children: expand(node.props.children) } };
  }
  const exported = {};
  vm.runInNewContext(compiled.outputText, {
    exports: exported, Error,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return {
        ActivityIndicator: 'ActivityIndicator', Pressable: 'Pressable', Text: 'Text', TextInput: 'TextInput', View: 'View',
        StyleSheet: { create: (value) => value },
      };
      if (name === '@/lib/admin-api') return api;
      if (name === '@/components/admin/admin-shell') return { adminStyles: {} };
      if (name === '@/constants/onepick') return { OnePick: {} };
      if (name === '@/lib/categories/categoryTree') return {
        categoryLabel: (item) => item.name,
        selectableCategories: (items) => items.filter((item) => item.status === 'open' && item.isVisible && item.isPickable),
      };
      assert.fail(`Unexpected dependency: ${name}`);
    },
  });
  function render() {
    cursor = 0;
    dirty = false;
    tree = expand(exported.ProvidersPanel());
    const effects = pendingEffects;
    pendingEffects = [];
    effects.forEach((effect) => effect());
  }
  function walk(node) {
    if (Array.isArray(node)) return node.flatMap((child) => walk(child));
    if (!node || typeof node !== 'object') return [];
    return [node, ...walk(node.props.children)];
  }
  function text(node) {
    if (Array.isArray(node)) return node.map((child) => text(child)).join('');
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    return node?.props ? text(node.props.children) : '';
  }
  function button(label, scope = tree) {
    const result = walk(scope).find((node) => node.type === 'Pressable'
      && (node.props.accessibilityLabel === label || text(node) === label));
    assert.ok(result, `Button not found: ${label}`);
    return result.props;
  }
  function input(label) {
    const result = walk(tree).find((node) => node.type === 'TextInput' && node.props.accessibilityLabel === label);
    assert.ok(result, `Input not found: ${label}`);
    return result.props;
  }
  function row(id = 'provider-a') {
    // Also support the pre-fix component for before/after regression checks.
    const byId = walk(tree).find((node) => node.props.testID === `provider-${id}`);
    if (byId) return byId;
    const name = id === 'provider-a' ? provider.name : '두 번째 공식몰';
    return walk(tree).filter((node) => node.type === 'View' && text(node).includes(name)
      && walk(node).some((child) => child.type === 'Pressable' && text(child) === '숨김'))
      .sort((a, b) => walk(a).length - walk(b).length)[0];
  }
  return {
    text: (node = tree) => text(node), button, input, row,
    get lateUpdates() { return lateUpdates; },
    async flush() {
      // Drain promise chains and their queued renders, not wall-clock timers.
      for (let i = 0; i < 30; i++) {
        if (alive && dirty) render();
        await Promise.resolve();
      }
    },
    async type(label, value) {
      const field = input(label);
      assert.notEqual(field.editable, false, `Input disabled: ${label}`);
      field.onChangeText(value);
      await this.flush();
    },
    async press(label, scope) {
      const action = button(label, scope);
      assert.ok(!action.disabled, `Button disabled: ${label}`);
      // Do not await a potentially unresolved request; flush controls completion.
      action.onPress();
      await this.flush();
    },
    replayEffects() {
      slots.filter((slot) => slot.setup).forEach((slot) => {
        slot.cleanup?.();
        slot.cleanup = slot.setup();
      });
    },
    unmount() {
      alive = false;
      slots.forEach((slot) => slot.cleanup?.());
    },
  };
}

async function fillForm(h) {
  await h.type('판매처 이름', '새 공식몰');
  await h.type('판매처 공식 URL', 'https://new-store.example');
  await h.press(category.name);
}
const cases = [];
const test = (name, run) => cases.push({ name, run });

test('initial failure retries providers, categories and brands without reloading the page', async () => {
  let attempt = 0;
  const b = backend({ getCategories: async () => { if (++attempt === 1) throw new Error('CATEGORY_READ_FAILED'); return [copy(category)]; } });
  const h = harness(b.api);
  await h.flush();
  assert.match(h.text(), /CATEGORY_READ_FAILED/);
  assert.doesNotMatch(h.text(), /조건에 맞는 온라인 판매처가 없습니다|선택 가능한 카테고리가 없습니다/);
  assert.equal(h.button('판매처 등록').disabled, true);
  await h.press('판매처 관리 다시 불러오기');
  assert.match(h.text(), /테스트 카테고리/);
  assert.doesNotMatch(h.text(), /CATEGORY_READ_FAILED/);
  for (const name of ['getOnlineProviders', 'getCategories', 'getBrands']) assert.equal(b.calls[name].length, 2, name);
  assert.equal(h.button('판매처 등록').disabled, false);
});

test('empty successful results are distinct from failed initial loads', async () => {
  const b = backend({ getOnlineProviders: async () => [] });
  const h = harness(b.api);
  await h.flush();
  assert.match(h.text(), /조건에 맞는 온라인 판매처가 없습니다/);
  assert.doesNotMatch(h.text(), /다시 불러오기/);
});

test('a slow earlier search cannot replace a newer search result', async () => {
  const first = deferred(), second = deferred();
  const b = backend({ getOnlineProviders: async (input) => input?.query === 'first' ? first.promise
    : input?.query === 'second' ? second.promise : [copy(provider)] });
  const h = harness(b.api);
  await h.flush();
  await h.type('판매처 검색', 'first'); await h.press('검색');
  await h.type('판매처 검색', 'second'); await h.press('검색');
  second.resolve([{ ...copy(provider), name: '최신 검색 결과' }]); await h.flush();
  first.resolve([{ ...copy(provider), name: '오래된 검색 결과' }]); await h.flush();
  assert.match(h.text(), /최신 검색 결과/);
  assert.doesNotMatch(h.text(), /오래된 검색 결과/);
});

test('a stale search rejection does not replace current success with an error', async () => {
  const first = deferred();
  const b = backend({ getOnlineProviders: async (input) => input?.query === 'first' ? first.promise : [copy(provider)] });
  const h = harness(b.api);
  await h.flush();
  await h.type('판매처 검색', 'first'); await h.press('검색');
  await h.type('판매처 검색', 'second'); await h.press('검색');
  first.reject(new Error('STALE_SEARCH_ERROR')); await h.flush();
  assert.doesNotMatch(h.text(), /STALE_SEARCH_ERROR/);
  assert.match(h.text(), /기존 공식몰/);
});

test('all writes share a synchronous lock and fields cannot change during save', async () => {
  const write = deferred();
  const b = backend({ setProviderStatus: async () => write.promise });
  b.state.rows.push({ ...copy(provider), id: 'provider-b', name: '두 번째 공식몰' });
  const h = harness(b.api);
  await h.flush(); await fillForm(h);
  const hide = h.button('숨김', h.row()).onPress;
  const brand = h.button(brands[0].name, h.row()).onPress;
  const create = h.button('판매처 등록').onPress;
  hide(); hide(); brand(); create(); // Same render, before any state is committed.
  await h.flush();
  assert.equal(b.calls.setProviderStatus.length, 1);
  assert.equal(b.calls.setProviderBrand.length, 0);
  assert.equal(b.calls.createOnlineProvider.length, 0);
  assert.equal(h.button('판매처 등록').disabled, true);
  assert.equal(h.button('검색').disabled, true);
  assert.equal(h.button('숨김', h.row('provider-b')).disabled, true);
  assert.equal(h.input('판매처 이름').editable, false);
  write.resolve({ ...copy(provider), status: 'hidden' }); await h.flush();
  assert.equal(h.button('판매처 등록').disabled, false);
});

test('pre-write searches cannot undo a confirmed status change even if refresh fails', async () => {
  const oldRead = deferred();
  let reads = 0;
  const b = backend({ getOnlineProviders: async () => {
    if (++reads === 1) return [copy(provider)];
    if (reads === 2) return oldRead.promise;
    throw new Error('REFRESH_FAILED');
  } });
  const h = harness(b.api);
  await h.flush(); await h.press('검색'); await h.press('숨김', h.row());
  oldRead.resolve([copy(provider)]); await h.flush();
  assert.equal(h.button('숨김', h.row()).accessibilityState?.selected, true);
  assert.match(h.text(), /변경은 저장되었습니다.*목록 조회에 실패/);
});

test('successful create followed by failed refresh retries only the read', async () => {
  let reads = 0;
  const b = backend({ getOnlineProviders: async () => {
    if (++reads === 2) throw new Error('REFRESH_FAILED');
    return [copy(provider)];
  } });
  const h = harness(b.api);
  await h.flush(); await fillForm(h); await h.press('판매처 등록');
  assert.equal(b.calls.createOnlineProvider.length, 1);
  assert.match(h.text(), /변경은 저장되었습니다.*목록 조회에 실패/);
  assert.equal(h.input('판매처 이름').value, '');
  await h.press('목록 다시 불러오기');
  assert.equal(b.calls.createOnlineProvider.length, 1, 'Read retries must not repeat writes');
  assert.equal(reads, 3);
  assert.doesNotMatch(h.text(), /목록 조회에 실패/);
});

test('failed create preserves form state, reports failure and does not retry writes', async () => {
  const b = backend({ createOnlineProvider: async () => { throw new Error('ADMIN_REQUIRED'); } });
  const h = harness(b.api);
  await h.flush(); await fillForm(h); await h.press('판매처 등록');
  assert.equal(h.input('판매처 이름').value, '새 공식몰');
  assert.equal(h.input('판매처 공식 URL').value, 'https://new-store.example');
  assert.match(h.text(), /ADMIN_REQUIRED/);
  assert.doesNotMatch(h.text(), /저장했습니다/);
  assert.equal(b.calls.createOnlineProvider.length, 1);
  assert.equal(b.calls.getOnlineProviders.length, 1);
  assert.equal(h.button('판매처 등록').disabled, false);
});

test('brand link/unlink and hidden/pending/active transitions preserve RPC arguments', async () => {
  const b = backend();
  const h = harness(b.api);
  await h.flush();
  await h.press(brands[0].name, h.row());
  assert.equal(h.button(brands[0].name, h.row()).accessibilityState?.selected, true);
  await h.press('미지정', h.row());
  assert.equal(h.button('미지정', h.row()).accessibilityState?.selected, true);
  for (const label of ['숨김', '대기', '활성']) await h.press(label, h.row());
  assert.deepEqual(b.calls.setProviderBrand, [['provider-a', 'brand-a'], ['provider-a', null]]);
  assert.deepEqual(b.calls.setProviderStatus, [['provider-a', 'hidden'], ['provider-a', 'pending'], ['provider-a', 'active']]);
});

test('unmount during a search ignores its completion', async () => {
  const pending = deferred();
  let reads = 0;
  const b = backend({ getOnlineProviders: async () => ++reads === 1 ? [copy(provider)] : pending.promise });
  const h = harness(b.api);
  await h.flush(); await h.press('검색'); h.unmount();
  pending.resolve([copy(provider)]); await h.flush();
  assert.equal(h.lateUpdates, 0);
});

test('unmount during a write does not publish messages or start a refresh', async () => {
  const pending = deferred();
  const b = backend({ createOnlineProvider: async () => pending.promise });
  const h = harness(b.api);
  await h.flush(); await fillForm(h); await h.press('판매처 등록'); h.unmount();
  pending.resolve([{ provider_id: 'provider-b', online_store_id: 'store-b', item_id: 'item-b', category_id: 'category-a' }]);
  await h.flush();
  assert.equal(h.lateUpdates, 0);
  assert.equal(b.calls.getOnlineProviders.length, 1);
});

test('effect setup/cleanup replay cannot publish an obsolete initial load', async () => {
  const first = deferred();
  let reads = 0;
  const b = backend({ getOnlineProviders: async () => ++reads === 1 ? first.promise : [{ ...copy(provider), name: '새 초기 결과' }] });
  const h = harness(b.api);
  await h.flush(); h.replayEffects(); await h.flush();
  first.resolve([{ ...copy(provider), name: '낡은 초기 결과' }]); await h.flush();
  assert.match(h.text(), /새 초기 결과/);
  assert.doesNotMatch(h.text(), /낡은 초기 결과/);
});

(async () => {
  let failures = 0;
  for (const { name, run } of cases) {
    try { await run(); console.log(`PASS ${name}`); }
    catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack}`); }
  }
  console.log(`${cases.length - failures}/${cases.length} admin provider panel checks passed.`);
  if (failures) process.exitCode = 1;
})();
