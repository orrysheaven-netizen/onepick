const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(relativePath) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function load(relativePath, imports = {}) {
  const exports = {};
  vm.runInNewContext(transpile(relativePath), {
    exports,
    require: (name) => {
      if (name in imports) return imports[name];
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

const shop = load('lib/shops/shopUrl.ts');

// Affiliate parameters, www, casing and a deep path all collapse to one address.
// This is what keeps one shop from splitting into several items.
const canonical = 'https://test-roastery.com';
assert.equal(shop.normalizeShopUrl('https://www.Test-Roastery.com/shop?ref=kakao&utm_source=blog'), canonical);
assert.equal(shop.normalizeShopUrl('test-roastery.com'), canonical);
assert.equal(shop.normalizeShopUrl('http://TEST-ROASTERY.com:8080/about#intro'), canonical);
assert.equal(shop.normalizeShopUrl('  https://test-roastery.com/  '), canonical);

// Userinfo must not let a link read as one host while resolving to another.
assert.equal(shop.normalizeShopUrl('https://real-shop.example@evil.example/path'), 'https://evil.example');

// Hosts many shops share keep one path segment; without it no shop is named.
assert.equal(
  shop.normalizeShopUrl('https://smartstore.naver.com/MyBeans/products/99?ref=x'),
  'https://smartstore.naver.com/mybeans',
);
assert.equal(shop.normalizeShopUrl('https://smartstore.naver.com/'), null);
assert.notEqual(
  shop.normalizeShopUrl('https://smartstore.naver.com/otherbeans'),
  shop.normalizeShopUrl('https://smartstore.naver.com/mybeans'),
);

// Shops on a platform that hands out subdomains are already distinct by host.
assert.equal(shop.normalizeShopUrl('https://mybeans.cafe24.com/index.html'), 'https://mybeans.cafe24.com');

for (const rejected of ['ftp://example.com', 'javascript:alert(1)', 'https://192.168.0.1/shop', 'https://localhost:3000', '   ', null, undefined]) {
  assert.equal(shop.normalizeShopUrl(rejected), null, `rejected: ${rejected}`);
}

// Marketplaces are not specialty shops.
for (const mart of ['https://www.coupang.com', 'https://shopping.naver.com', 'https://market.kurly.com', 'https://oliveyoung.co.kr']) {
  assert.equal(shop.isMarketplaceShopUrl(shop.normalizeShopUrl(mart)), true, `mart: ${mart}`);
}
// A shop inside a shared host carries a path, so it is one shop, not the platform.
assert.equal(shop.isMarketplaceShopUrl('https://smartstore.naver.com/mybeans'), false);
assert.equal(shop.isMarketplaceShopUrl(shop.normalizeShopUrl('https://test-roastery.com')), false);
assert.equal(shop.isMarketplaceShopUrl(null), false);

assert.equal(shop.shopDisplayLabel('https://www.Test-Roastery.com/shop?ref=1'), 'test-roastery.com');
assert.equal(shop.shopDisplayLabel('https://smartstore.naver.com/MyBeans'), 'smartstore.naver.com/mybeans');
assert.equal(shop.shopDisplayLabel(null), null);

assert.equal(shop.isSpecialtyShopCategorySlug('specialty-shop'), true);
assert.equal(shop.isSpecialtyShopCategorySlug('specialty-shop-coffee-beans'), true);
assert.equal(shop.isSpecialtyShopCategorySlug('ramen'), false);
assert.equal(shop.isSpecialtyShopCategorySlug(null), false);

// A one-line review is a reason, not an advertisement.
for (const promotional of [
  '여기서 사세요 https://myshop.com',
  'www.myshop.com 에서 싸게 샀어요',
  'myshop.co.kr 추천',
  '쿠폰코드 WELCOME10 쓰면 더 싸요',
  '할인코드 SAVE20',
  '추천인 코드 AB12CD 입력하면 할인',
  'promo code SAVE20',
]) {
  assert.equal(shop.reviewContainsPromotion(promotional), true, `promotional: ${promotional}`);
}

// Ordinary Korean sentences must survive, including ones that mention a
// discount without carrying a code.
for (const ordinary of [
  '세일 주기가 제일 예측 가능해서',
  '쿠폰 없어도 원래 싸다',
  '할인 3000원 받았어요',
  '로스팅이 신선하다. 정말 좋다',
  '프로모션 기간에 샀다',
  '배송이 빠르고 포장이 꼼꼼해요',
  '재구매 3번째입니다',
  '',
]) {
  assert.equal(shop.reviewContainsPromotion(ordinary), false, `ordinary: ${ordinary}`);
}

// The report reason the specialty-shop work adds must be accepted end to end.
const safety = fs.readFileSync(path.join(__dirname, '../src/types/domain/safety.ts'), 'utf8');
assert.match(safety, /'self_promotion'/);
const reportAction = fs.readFileSync(path.join(__dirname, '../src/components/report-action.tsx'), 'utf8');
assert.match(reportAction, /value: 'self_promotion'/);
const safetyService = fs.readFileSync(path.join(__dirname, '../src/services/safetyService.ts'), 'utf8');
assert.match(safetyService, /'self_promotion',/);

// SHOP_URL_DUPLICATE is raised with SQLSTATE 23505, which the generic branch
// maps to PICK_CONFLICT. The message lookup must win, so it has to be known.
const mapping = fs.readFileSync(path.join(__dirname, '../src/errors/mapSupabaseError.ts'), 'utf8');
for (const code of ['REVIEW_PROMOTIONAL', 'SHOP_URL_REQUIRED', 'SHOP_URL_INVALID', 'SHOP_URL_NOT_SPECIALTY', 'SHOP_URL_DUPLICATE']) {
  assert.match(mapping, new RegExp(`'${code}'`), `known code: ${code}`);
}
const mapError = load('errors/mapSupabaseError.ts', {
  './appError': load('errors/appError.ts'),
});
assert.equal(mapError.mapSupabaseError({ code: '23505', message: 'SHOP_URL_DUPLICATE' }).code, 'SHOP_URL_DUPLICATE');
assert.equal(mapError.mapSupabaseError({ code: '23505', message: 'some other conflict' }).code, 'PICK_CONFLICT');

console.log('specialty shop checks passed');
