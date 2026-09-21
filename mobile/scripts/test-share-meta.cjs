const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: (name) => { throw new Error(name); }, URL, encodeURIComponent });
  return exports;
}

const { pickShareMeta, profileShareMeta, injectShareMeta, validShareUuid, validShareUsername } = load('functions/_lib/share-meta.ts');
const id = '661201d7-ad86-444f-b280-6c964b309c78';
assert.equal(validShareUuid(id), true);
assert.equal(validShareUuid('find'), false);
const meta = pickShareMeta({
  origin: 'https://onepick.example/',
  pickId: id,
  itemName: '인터스텔라 <script>',
  username: 'onepick_qa',
  categoryName: '영화',
  review: '우주 & 가족 <좋아요>',
  image: 'https://image.example/poster.jpg',
});
assert.equal(meta.type, 'article');
assert.match(meta.title, /인터스텔라/);
assert.equal(meta.url, 'https://onepick.example/pick/' + id);
const shell = `<!doctype html><html><head><title>OnePick</title>
<meta name="description" content="default" />
<meta property="og:type" content="website" />
<meta property="og:title" content="default" />
<meta property="og:description" content="default" />
<meta property="og:image" content="https://onepick.example/og-default.png" />
<meta name="twitter:title" content="default" />
<meta name="twitter:description" content="default" />
<meta name="twitter:image" content="https://onepick.example/og-default.png" />
</head><body></body></html>`;
const html = injectShareMeta(shell, meta);
assert.match(html, /og:type" content="article"/);
assert.match(html, /property="og:url"/);
assert.match(html, /rel="canonical"/);
assert.doesNotMatch(html, /<script>/);
assert.match(html, /우주 &amp; 가족 &lt;좋아요&gt;/);
const fallbackImage = pickShareMeta({ origin: 'https://onepick.example', pickId: id, itemName: '책', username: 'reader', categoryName: '책', review: '', image: 'http://unsafe.example/a.jpg' });
assert.equal(fallbackImage.image, 'https://onepick.example/og-default.png');
assert.match(fallbackImage.description, /책에서 고른/);
assert.equal(pickShareMeta({ origin: 'https://onepick.example', pickId: 'bad', itemName: 'x', username: 'u', categoryName: 'c', review: '', image: '' }), null);
assert.equal(pickShareMeta({ origin: 'javascript:alert(1)', pickId: id, itemName: 'x', username: 'user_name', categoryName: 'c', review: '', image: '' }), null);
assert.equal(pickShareMeta({ origin: 'http://onepick.example', pickId: id, itemName: 'x', username: 'user_name', categoryName: 'c', review: '', image: '' }), null);
assert.equal(pickShareMeta({ origin: 'https://onepick.example', pickId: id, itemName: 'x', username: '<bad>', categoryName: 'c', review: '', image: '' }), null);
assert.equal(validShareUsername('onepick_qa'), true);
assert.equal(validShareUsername('<bad>'), false);
const profileMeta = profileShareMeta({
  origin: 'https://onepick.example',
  username: 'onepick_qa',
  pickCount: 12,
  representativeItems: ['인터스텔라', '아리랑', '<script>게임</script>', '네번째'],
  image: '',
});
assert.equal(profileMeta.type, 'profile');
assert.equal(profileMeta.url, 'https://onepick.example/u/onepick_qa');
assert.match(profileMeta.title, /@onepick_qa/);
assert.match(profileMeta.description, /현재 원픽 12개/);
assert.match(profileMeta.description, /인터스텔라/);
const profileHtml = injectShareMeta(shell, profileMeta);
assert.match(profileHtml, /og:type" content="profile"/);
assert.doesNotMatch(profileHtml, /<script>/);
assert.equal(profileShareMeta({ origin: 'http://onepick.example', username: 'onepick_qa', pickCount: 1, representativeItems: [], image: '' }), null);
console.log('H-1B meta checks passed: Pick/Profile validation, escaping, fallback image, canonical URL and dynamic OG tags.');
