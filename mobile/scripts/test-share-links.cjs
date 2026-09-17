const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/share/shareLinks.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function load(platform, base, browser) {
  const exports = {};
  vm.runInNewContext(code, {
    exports, process: { env: { EXPO_PUBLIC_SHARE_BASE_URL: base } },
    ...(browser ? { window: browser } : {}),
    require: (name) => { assert.equal(name, 'react-native'); return { Platform: { OS: platform } }; },
  });
  return exports;
}

const browser = { location: { origin: 'https://preview.example', pathname: '/auth/callback', search: '?code=private', hash: '#access_token=private' } };
const web = load('web', '', browser);
assert.equal(web.createPickShareUrl('pick-id'), 'https://preview.example/pick/pick-id');
assert.equal(web.createProfileShareUrl(' Alice_1 '), 'https://preview.example/u/alice_1');
assert.equal(web.createPickShareUrl('a/b?c#d'), 'https://preview.example/pick/a%2Fb%3Fc%23d');
browser.location.origin = 'http://localhost:4173';
assert.equal(web.createPickShareUrl('new'), 'http://localhost:4173/pick/new', 'Origin must be read when sharing, without copying auth query/hash data');

for (const platform of ['web', 'ios', 'android']) {
  const canonical = load(platform, ' https://onepick.example/// ', browser);
  assert.equal(canonical.createPickShareUrl('pick'), 'https://onepick.example/pick/pick');
  assert.equal(canonical.createProfileShareUrl('OWNER'), 'https://onepick.example/u/owner');
}
for (const platform of ['ios', 'android']) {
  const native = load(platform, undefined, browser);
  assert.equal(native.createPickShareUrl('pick'), 'onepick://pick/pick');
  assert.equal(native.createProfileShareUrl('Owner'), 'onepick://u/owner');
}
assert.equal(load('web').createPickShareUrl('pick'), 'onepick://pick/pick', 'Server evaluation must not access a missing window');
console.log('Share checks passed: browser origin, canonical override, URL encoding, native fallback and no auth parameters.');
