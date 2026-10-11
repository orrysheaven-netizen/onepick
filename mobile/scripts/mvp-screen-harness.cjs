// Evaluate actual screen TSX with deterministic hooks and host components.
// This complements the React/SSR suite; it is not a browser or React renderer.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relative, imports = {}) {
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, relative);
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected import: ${name}`);
    return imports[name];
  } });
  return exports;
}
const names = (values) => Object.fromEntries(values.split(' ').map((name) => [name, name]));
const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
function screen(relative, imports, platform = 'ios') {
  const states = [];
  const refs = [];
  let cursor = 0, refCursor = 0, effects = [], nodes = [], texts = [];
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!(i in states)) states[i] = typeof initial === 'function' ? initial() : initial;
      return [states[i], (next) => { states[i] = typeof next === 'function' ? next(states[i]) : next; }];
    },
    useMemo: (fn) => fn(),
    useCallback: (fn) => fn,
    useRef(initial) {
      const i = refCursor++;
      if (!(i in refs)) refs[i] = { current: initial };
      return refs[i];
    },
    useEffect: (fn) => { effects.push(fn); },
  };
  const Screen = load(relative, {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'react-native': { ...names('Text View Pressable ScrollView FlatList RefreshControl ActivityIndicator Image Modal TextInput'), PanResponder: { create: (handlers) => ({ panHandlers: handlers }) }, Platform: { OS: platform }, StyleSheet: { create: (value) => value, absoluteFill: {} } },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-image': { Image: 'Image' },
    '@/components/ui': names('Avatar BrandMark Button Chip SectionHeader StateCard'),
    ...imports,
  }).default;
  function visit(node) {
    if (node == null || typeof node === 'boolean') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (typeof node !== 'object') { texts.push(String(node)); return; }
    if (typeof node.type === 'function') { visit(node.type(node.props)); return; }
    nodes.push(node);
    const props = node.props;
    for (const key of ['label', 'title', 'description', 'text']) {
      if (typeof props[key] === 'string') texts.push(props[key]);
    }
    visit(props.children);
    visit(props.refreshControl);
    if (node.type === 'FlatList') {
      visit(props.ListHeaderComponent);
      props.data.forEach((item, index) => visit(props.renderItem({ item, index })));
      if (!props.data.length) visit(props.ListEmptyComponent);
      visit(props.ListFooterComponent);
    }
  }
  return {
    render() { cursor = 0; refCursor = 0; effects = []; nodes = []; texts = []; visit(Screen()); return texts.join('\n'); },
    flushEffects() { const pending = effects; effects = []; pending.forEach((fn) => fn()); },
    all(type) { return nodes.filter((node) => node.type === type).map((node) => node.props); },
    find(type, predicate = () => true) { return this.all(type).find(predicate); },
    text() { return texts.join('\n'); },
  };
}
module.exports = { load, screen, names };

