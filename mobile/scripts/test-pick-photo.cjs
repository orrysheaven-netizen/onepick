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
  }).outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react') return React;
      if (name === 'react/jsx-runtime') return require(name);
      assert.fail(name);
    },
  });
  return exports;
}

const component = (tag) => (props) => React.createElement(tag, props, props.children);
const { PickPhoto } = load('components/pick-photo.tsx', {
  'expo-image': {
    Image: ({ source, accessibilityLabel, cachePolicy, recyclingKey, contentFit }) => React.createElement('img', {
      src: source.uri,
      alt: accessibilityLabel,
      'data-cache-policy': cachePolicy,
      'data-recycling-key': recyclingKey,
      'data-content-fit': contentFit,
    }),
  },
  'expo-router': { useRouter: () => ({ push: () => {} }) },
  'react-native': {
    View: component('div'),
    Text: component('span'),
    Pressable: ({ style: _style, ...props }) => React.createElement('button', props, props.children),
    StyleSheet: { create: (styles) => styles },
  },
});

const missing = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '신라면' }));
assert.match(missing, /신라면/);
assert.match(missing, />신</);
assert.match(missing, /사진 준비 중/);
assert.doesNotMatch(missing, /사진 없음/);

const remote = renderToStaticMarkup(React.createElement(PickPhoto, { uri: 'https://example.test/ramen.jpg', label: '신라면' }));
assert.match(remote, /https:\/\/example\.test\/ramen\.jpg/);
assert.doesNotMatch(remote, /사진 준비 중/);
assert.match(remote, /data-cache-policy="memory-disk"/);
assert.match(remote, /data-recycling-key="https:\/\/example\.test\/ramen\.jpg"/);
assert.match(remote, /data-content-fit="contain"/);

const large = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '센과 치히로의 행방불명', large: true }));
assert.match(large, /센과 치히로의 행방불명/);
assert.match(large, /사진 준비 중/);

const addable = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '신라면', itemId: 'a1111111-1111-4111-8111-111111111111' }));
assert.match(addable, /사진 등록/, 'An addable item shows the add-photo button');
assert.doesNotMatch(addable, /사진 없음|사진 준비 중/, 'The add state is the button alone, without an empty-state caption');

console.log('PickPhoto checks passed: real images stay intact and missing images use intentional product placeholders.');

const tallRemote = renderToStaticMarkup(React.createElement(PickPhoto, { uri: 'https://example.test/tall.jpg', label: 'Tall', tall: true }));
assert.match(tallRemote, /data-content-fit="cover"/);
