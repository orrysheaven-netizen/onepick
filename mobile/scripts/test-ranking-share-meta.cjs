const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(output, { exports, require: (name) => { throw new Error(name); }, URL, encodeURIComponent, JSON, Number });
  return exports;
}

const { rankingShareMeta, renderRankingBody, injectBody, injectShareMeta, robotsHeader, validCategorySlug, RANKING_MIN_PICKS } = load('functions/_lib/share-meta.ts');
const ids = ['661201d7-ad86-444f-b280-6c964b309c78', '20000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000003'];

assert.equal(validCategorySlug('ramen'), true);
assert.equal(validCategorySlug('gopchang-gim'), true);
assert.equal(validCategorySlug('Ramen'), false, 'Slugs are lower-case only');
assert.equal(validCategorySlug('../x'), false);
assert.equal(validCategorySlug(''), false);

const rows = [
  { item_id: ids[0], name: '신라면 <b>', pick_count: 12, rank: 1, is_tied: false, image: 'https://img.example/a.jpg' },
  { item_id: ids[1], name: '진라면', pick_count: 5, rank: 2, is_tied: true, image: 'http://insecure.example/b.jpg' },
  { item_id: ids[2], name: '너구리', pick_count: 5, rank: 2, is_tied: true, image: null },
  { item_id: 'not-a-uuid', name: 'dropped', pick_count: 1, rank: 4, is_tied: false, image: null },
];
const page = rankingShareMeta({ origin: 'https://onepick.example', slug: 'ramen', categoryName: '라면', categoryPath: '먹을것 › 라면', rows });
assert.ok(page);
assert.equal(page.rows.length, 3, 'Rows without a valid item id are dropped');
assert.equal(page.showRankingDetail, true);
assert.equal(page.meta.title, '라면 원픽 랭킹 | OnePick');
assert.equal(page.meta.url, 'https://onepick.example/ranking/ramen');
assert.equal(page.meta.image, 'https://img.example/a.jpg', 'Leader image becomes the preview image');
assert.equal(page.rows[1].image, null, 'Non-https images are dropped');
assert.match(page.meta.description, /1위 신라면 <b> · 2위 진라면 · 3위 너구리/);

const shell = `<!doctype html><html><head><title>OnePick</title>
<meta name="description" content="default" />
<meta property="og:title" content="default" />
<meta property="og:image" content="https://onepick.example/og-default.png" />
</head><body><div id="root"></div></body></html>`;
const html = injectBody(injectShareMeta(shell, page.meta), renderRankingBody(page));
assert.match(html, /<title>라면 원픽 랭킹 \| OnePick<\/title>/);
assert.match(html, /<div id="root"><main/);
assert.match(html, /공동 2위 진라면 · 5명이 선택/);
assert.match(html, /1위 신라면 &lt;b&gt;/, 'Names are escaped in the body');
assert.doesNotMatch(html, /<b>/);
assert.match(html, new RegExp(`href="/item/${ids[0]}"`));
assert.match(html, /application\/ld\+json/);
const jsonLd = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
assert.equal(jsonLd['@type'], 'ItemList');
assert.equal(jsonLd.itemListElement.length, 3);
assert.equal(jsonLd.itemListElement[0].url, `https://onepick.example/item/${ids[0]}`);

// Below the minimum sample the page lists names without ranks, like Explore.
const thin = rankingShareMeta({ origin: 'https://onepick.example', slug: 'ramen', categoryName: '라면', categoryPath: '', rows: [
  { item_id: ids[0], name: '신라면', pick_count: RANKING_MIN_PICKS - 1, rank: 1, is_tied: false, image: null },
] });
assert.equal(thin.showRankingDetail, false);
assert.equal(thin.categoryPath, '라면');
assert.doesNotMatch(renderRankingBody(thin), /1위/);
assert.match(thin.meta.description, /원픽이 모이면 순위가 표시돼요/);
assert.equal(thin.meta.image, 'https://onepick.example/og-default.png');

const empty = rankingShareMeta({ origin: 'https://onepick.example', slug: 'ramen', categoryName: '라면', categoryPath: '', rows: [] });
assert.match(renderRankingBody(empty), /아직 선택된 원픽이 없어요/);
assert.equal(rankingShareMeta({ origin: 'https://onepick.example', slug: 'Bad Slug', categoryName: '라면', categoryPath: '', rows: [] }), null);
assert.equal(rankingShareMeta({ origin: 'http://onepick.example', slug: 'ramen', categoryName: '라면', categoryPath: '', rows: [] }), null);
assert.equal(rankingShareMeta({ origin: 'https://onepick.example', slug: 'ramen', categoryName: '', categoryPath: '', rows: [] }), null);

assert.equal(robotsHeader('onepick-5cl.pages.dev'), 'noindex', 'Test host mirrors public/_headers');
assert.equal(robotsHeader('abc123.onepick-5cl.pages.dev'), 'noindex');
assert.equal(robotsHeader('onepick.kr'), 'index, follow');
console.log('ranking share meta ok');
