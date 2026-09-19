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

const demo = load('lib/demoProfile.ts');
assert.equal(demo.isDemoUsername('demo_01'), true);
assert.equal(demo.isDemoUsername(' DEMO_05 '), true);
assert.equal(demo.isDemoUsername('onepick_qa'), false);
assert.equal(demo.isDemoUsername(null), false);
assert.equal(demo.demoSharePrefix('demo_02'), '[DEMO DATA] ');
assert.equal(demo.demoSharePrefix('real_user'), '');

let pickPayload;
const sharePick = load('lib/share/sharePick.ts', {
  'react-native': { Share: { share: async (payload) => { pickPayload = payload; return payload; } } },
  './shareLinks': { createPickShareUrl: () => 'https://onepick.example/pick/demo' },
  '../demoProfile': demo,
});
sharePick.sharePick({
  pickId: 'pick', username: 'demo_01', categoryName: '라면',
  itemName: '신라면', oneLineReview: '테스트 이유',
});
assert.match(pickPayload.title, /^\[DEMO DATA\]/);
assert.match(pickPayload.message, /^\[DEMO DATA\]/);

let profilePayload;
const shareProfile = load('lib/share/shareProfile.ts', {
  'react-native': { Share: { share: async (payload) => { profilePayload = payload; return payload; } } },
  './shareLinks': { createProfileShareUrl: () => 'https://onepick.example/u/demo_01' },
  '../demoProfile': demo,
});
shareProfile.shareProfile({ username: 'demo_01', pickCount: 3 });
assert.match(profilePayload.title, /^\[DEMO DATA\]/);
assert.match(profilePayload.message, /^\[DEMO DATA\]/);

const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
assert.match(source('app/(tabs)/index.tsx'), /demoBadge/);
assert.match(source('components/item-review-card.tsx'), /DEMO · 테스트 데이터/);
assert.match(source('app/u/[username].tsx'), /DEMO · 테스트 데이터/);
assert.match(source('app/u/[username].tsx'), /user && !isDemo/);
assert.match(source('components/pick-share-card.tsx'), /user\.id !== props\.authorUserId && !isDemo/);
assert.match(source('components/pick-share-card.tsx'), /DEMO DATA/);

console.log('Demo profile checks passed: detection, UI labels, share labels and safety-action exclusion.');
