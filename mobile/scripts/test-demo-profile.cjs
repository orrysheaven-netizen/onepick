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

const seed = load('lib/seedProfiles.ts');
assert.equal(seed.isSeedProfileId('d0e00001-1111-4111-8111-111111111111'), true);
assert.equal(seed.isSeedProfileId(' D0E00005-5555-4555-8555-555555555555 '), true);
assert.equal(seed.isSeedProfileId('11111111-1111-4111-8111-111111111111'), false);
assert.equal(seed.isSeedProfileId(null), false);

let pickPayload;
const sharePick = load('lib/share/sharePick.ts', {
  'react-native': { Platform: { OS: 'ios' }, Share: { share: async (payload) => { pickPayload = payload; return payload; } } },
  './shareLinks': { createPickShareUrl: () => 'https://onepick.example/pick/seed' },
});
sharePick.sharePick({
  pickId: 'pick', username: 'moodarchive', categoryName: '라면',
  itemName: '신라면', oneLineReview: '테스트 이유',
});
assert.deepEqual({ ...pickPayload }, { url: 'https://onepick.example/pick/seed' }, 'Seed Picks share only their link, with no demo label');

let profilePayload;
const shareProfile = load('lib/share/shareProfile.ts', {
  'react-native': { Platform: { OS: 'ios' }, Share: { share: async (payload) => { profilePayload = payload; return payload; } } },
  './shareLinks': { createProfileShareUrl: () => 'https://onepick.example/u/moodarchive' },
});
shareProfile.shareProfile({ username: 'moodarchive', pickCount: 3 });
assert.doesNotMatch(profilePayload.title, /DEMO/i);
assert.doesNotMatch(profilePayload.message, /DEMO/i);
assert.match(profilePayload.title, /^@moodarchive/);

const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
assert.doesNotMatch(source('app/(tabs)/index.tsx'), />DEMO</);
assert.doesNotMatch(source('components/item-review-card.tsx'), /DEMO · 테스트 데이터/);
assert.doesNotMatch(source('app/u/[username].tsx'), /DEMO · 테스트 데이터/);
assert.match(source('app/u/[username].tsx'), /user && !isSeed/);
assert.match(source('components/pick-share-actions.tsx'), /isSeedProfileId\(props\.authorUserId\)/);
assert.doesNotMatch(source('components/pick-share-actions.tsx'), /DEMO DATA/);

console.log('Seed profile checks passed: stable-id detection, ordinary handles and unlabelled sharing/UI.');
