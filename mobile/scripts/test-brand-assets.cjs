const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file));
const originals = {
  'public/brand/onepick-logo-horizontal.svg': 'b12dd2b60544b001bf520e45b43bc067ec16c8abf103d965ee8d7066a89d22e8',
  'public/brand/onepick-logo-horizontal-white.svg': '131eff84afb46e11ac1517a73bf7e0e6e26b829e7934889270302c9a86cce8e7',
  // The originals above minus the Korean 원픽 glyph paths (10-04: screens show the English wordmark only).
  'public/brand/onepick-wordmark.svg': 'c50a2ebcb4a428b644199253dcfee19fbdc5579515bdc9bb65bf53353e57df6d',
  'public/brand/onepick-wordmark-white.svg': '77a1f384551eda31e2d26511e8251ecc66d63cddc460f68d6b8a9d9ddcbec08b',
  'public/brand/onepick-logo-stacked.svg':'29af26405914dbf8430bdbc8e27cc3717fb876c8ffc3fe02dfd6986ca7f66db0',
  'public/brand/onepick-app-icon.svg': '9870ade641a67244f66e29a563989030e8a8724e8827a860266679652f1b8ce9',
  'public/brand/onepick-app-icon-dark.svg': '918bfcaaec038b69615851f8beaaf05f7d4513f31b822582d97f16589b135b5f',
  'public/onepick-favicon.svg': '4979dd666b4e735131f1acbfb2e525dca80a50cf11bc9125ef542f8b6b3ca5bc',
};
for (const [file, hash] of Object.entries(originals)) {
  const bytes = read(file);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `${file}: preserve approved original`);
  assert.doesNotMatch(bytes.toString(), /<(?:text|script|foreignObject)\b|\bon\w+=/i);
}
for (const [file, size] of [
  ['public/icons/onepick-app-icon-192.png', 192],
  ['public/icons/onepick-app-icon-512.png', 512],
  ['public/apple-touch-icon-180.png', 180],
]) {
  const png = read(file);
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
  assert.ok([2, 3].includes(png[25]), 'RGB or opaque indexed PNG required');
  for (let offset = 8; offset < png.length;) {
    assert.notEqual(png.toString('ascii', offset + 4, offset + 8), 'tRNS', 'No transparent palette entries');
    offset += 12 + png.readUInt32BE(offset);
  }
}
const ico = read('public/favicon.ico');
assert.equal(ico.readUInt16LE(2), 1);
assert.equal(ico.readUInt16LE(4), 3);
assert.deepEqual([0, 1, 2].map((i) => ico[6 + i * 16]).sort((a, b) => a - b), [16, 32, 48]);
const manifest = JSON.parse(read('public/manifest.webmanifest'));
assert.equal(manifest.name, '원픽 onepick');
assert.equal(manifest.theme_color, '#FFFFFF');
assert.equal(manifest.background_color, '#FFFFFF');
assert.equal(manifest.display, 'standalone');
for (const icon of manifest.icons) {
  assert.ok(fs.existsSync(path.join(root, 'public', icon.src)));
}
assert.equal(manifest.icons.filter((i) => i.purpose === 'maskable').length, 1);
const html = read('public/index.html').toString();
for (const asset of ['/favicon.ico', '/onepick-favicon.svg', '/apple-touch-icon-180.png', '/manifest.webmanifest']) {
  assert.ok(html.includes(`href="${asset}"`));
}
assert.match(html, /name="theme-color" content="#FFFFFF"/);
assert.doesNotMatch(html, /href="https:\/\/fonts\./, 'Do not weaken or bypass the existing font CSP');
const logo = read('src/components/onepick-brand.tsx').toString();
assert.match(logo, /onepick-wordmark-white\.svg/);
assert.doesNotMatch(logo, /onepick-logo-horizontal/, 'Screen headers use the English-only wordmark');
assert.match(logo, /accessibilityLabel="원픽 홈"/);
assert.doesNotMatch(logo, /<Text\b|fontFamily|fontWeight/, 'Use outlined logo assets, not live typography');
const tokens = read('src/constants/onepick.ts').toString();
assert.match(tokens, /brand: '#FF8A00'/);
assert.match(tokens, /onBrand: '#141416'/);
assert.match(tokens, /accent: '#141416'/, 'Mixed-use legacy links must remain readable');
const app = JSON.parse(read('app.json')).expo;
assert.equal(app.icon, './assets/images/icon.png', 'Native icon configuration is outside this web rollout');
assert.equal(app.ios.icon, './assets/expo.icon');
assert.ok(!app.web.favicon, 'Do not overwrite the supplied multi-size public/favicon.ico');
console.log('Brand asset checks passed: six exact SVG hashes, opaque PNGs, ICO sizes, manifest, header and safe token wiring.');
