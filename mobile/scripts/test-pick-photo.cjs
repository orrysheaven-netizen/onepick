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

// Brand logo: the image when a menu has no photo, a corner badge when it has one.
const logo = 'https://example.test/brand.png';
const logoOnly = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '클래식 밀크티', logoUri: logo }));
assert.match(logoOnly, /src="https:\/\/example\.test\/brand\.png"/, 'A missing photo falls back to the brand logo');
assert.match(logoOnly, /alt="클래식 밀크티 브랜드 로고"/);
assert.doesNotMatch(logoOnly, /사진 준비 중/);
const feedLogo = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '클래식 밀크티', logoUri: logo, feed: true }));
assert.match(feedLogo, /brand\.png/, 'Feed cards use the logo too');
assert.doesNotMatch(feedLogo, /이미지 준비 중/);
const photoAndLogo = renderToStaticMarkup(React.createElement(PickPhoto, { uri: 'https://example.test/tea.jpg', label: '클래식 밀크티', logoUri: logo, feed: true }));
assert.match(photoAndLogo, /tea\.jpg/, 'The menu photo stays the main image');
assert.match(photoAndLogo, /alt="브랜드 로고"/, 'The logo becomes a corner badge on the photo');
const addableLogo = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '클래식 밀크티', logoUri: logo, itemId: 'a1111111-1111-4111-8111-111111111111' }));
assert.match(addableLogo, /brand\.png/);
assert.match(addableLogo, /사진 등록/, 'The logo does not hide the add-photo button');
const noLogo = renderToStaticMarkup(React.createElement(PickPhoto, { uri: 'https://example.test/tea.jpg', label: '밀크티' }));
assert.doesNotMatch(noLogo, /브랜드 로고/, 'No badge without a brand logo');

console.log('PickPhoto checks passed: real images stay intact, brand logos fill in for missing photos, and other missing images use intentional product placeholders.');

// Every frame fits the whole photo: restaurant photos come in any shape.
for (const frame of [{}, { feed: true }, { square: true }, { large: true }]) {
  const html = renderToStaticMarkup(React.createElement(PickPhoto, { uri: 'https://example.test/wide.jpg', label: 'Wide', ...frame }));
  assert.match(html, /data-content-fit="contain"/, `${JSON.stringify(frame)} frame must not crop the photo`);
  assert.doesNotMatch(html, /data-content-fit="cover"/);
}
// Web drops `height: undefined`, so full-width square frames must never inherit
// the thumbnail's fixed 86px height (it turned them into short wide strips).
const flatten = (style) => Array.isArray(style)
  ? Object.assign({}, ...style.filter(Boolean).map(flatten))
  : Object.fromEntries(Object.entries(style || {}).filter(([, value]) => value !== undefined));
const frames = [];
const { PickPhoto: MeasuredPhoto } = load('components/pick-photo.tsx', {
  'expo-image': { Image: () => null },
  'expo-router': { useRouter: () => ({ push: () => {} }) },
  'react-native': {
    View: ({ style, children }) => { frames.push(flatten(style)); return React.createElement('div', null, children); },
    Text: component('span'),
    Pressable: ({ style: _style, ...props }) => React.createElement('button', props, props.children),
    StyleSheet: { create: (styles) => styles },
  },
});
for (const [frame, expected] of [[{ large: true }, { width: '100%', aspectRatio: 1 }], [{ square: true }, { width: '100%', aspectRatio: 1 }], [{}, { width: 86, height: 86 }], [{ feed: true }, { width: 86, height: 86 }]]) {
  frames.length = 0;
  renderToStaticMarkup(React.createElement(MeasuredPhoto, { uri: 'https://example.test/wide.jpg', label: 'Wide', ...frame }));
  const outer = frames[0];
  for (const [key, value] of Object.entries(expected)) assert.equal(outer[key], value, `${JSON.stringify(frame)} frame ${key}`);
  if (expected.aspectRatio) assert.equal(outer.height, undefined, `${JSON.stringify(frame)} frame must not carry a fixed height`);
}
const feedMissing = renderToStaticMarkup(React.createElement(PickPhoto, { uri: null, label: '을지면옥', feed: true }));
assert.match(feedMissing, /을지면옥 이미지 준비 중/);
