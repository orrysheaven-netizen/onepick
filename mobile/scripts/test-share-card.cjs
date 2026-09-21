const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
}

// The canvas primitives are shared with the profile card, so they load as their own module.
function loadCardCanvas() {
  const exports = {};
  vm.runInNewContext(transpile('lib/share/cardCanvas.ts'), { exports, Uint8Array });
  return exports;
}

function loadWeb(globals) {
  const exports = {};
  const drawn = [];
  const ctx = {
    beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {},
    fill() {}, fillRect() {}, stroke() {},
    measureText: (value) => ({ width: Array.from(String(value)).length * 24 }),
    fillText: (value) => drawn.push(String(value)),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx, toDataURL: () => 'data:image/png;base64,QQ==' };
  const context = {
    exports,
    Uint8Array,
    ...globals,
    document: {
      body: { appendChild() {} },
      createElement: (tag) => tag === 'canvas' ? canvas : globals.anchor,
    },
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name === './shareLinks') return { createPickShareUrl: (id) => 'https://onepick.example/pick/' + id };
      if (name === './sharePick') return {};
      if (name === './cardCanvas') return loadCardCanvas();
      throw new Error(name);
    },
  };
  vm.runInNewContext(transpile('lib/share/sharePickCard.web.ts'), context);
  return { exports, drawn };
}

const input = {
  pickId: 'pick-1',
  username: 'friend',
  categoryName: '라면',
  itemName: '얼큰한 너구리',
  oneLineReview: '통통한 면발이 좋아요',
};

async function main() {
  let shared;
  class FileMock {
    constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; }
  }
  const anchor = { click() { throw new Error('download should not run'); }, remove() {} };
  const sharedCase = loadWeb({
    anchor,
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {
      canShare: (data) => Array.isArray(data.files) && data.files[0]?.type === 'image/png',
      share: async (data) => { shared = data; },
    },
  });
  assert.equal(await sharedCase.exports.sharePickCardImage(input), 'shared');
  assert.equal(shared.files.length, 1);
  assert.equal(shared.files[0].type, 'image/png');
  assert.equal(shared.url, 'https://onepick.example/pick/pick-1');
  assert.match(shared.files[0].name, /^onepick-/);
  assert.match(sharedCase.drawn.join('|'), /ONE PICK/);
  assert.match(sharedCase.drawn.join('|'), /얼큰한 너구리/);
  assert.match(sharedCase.drawn.join('|'), /friend/);

  let seedShared;
  const seedCase = loadWeb({
    anchor,
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {
      canShare: () => true,
      share: async (data) => { seedShared = data; },
    },
  });
  assert.equal(await seedCase.exports.sharePickCardImage({ ...input, username: 'moodarchive' }), 'shared');
  assert.doesNotMatch(seedCase.drawn.join('|'), /DEMO DATA/);
  assert.equal(seedShared.text, '@moodarchive의 라면 원픽');

  let downloaded = false;
  const downloadAnchor = { href: '', download: '', rel: '', click() { downloaded = true; }, remove() {} };
  const fallback = loadWeb({
    anchor: downloadAnchor,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {},
  });
  assert.equal(await fallback.exports.sharePickCardImage(input), 'downloaded');
  assert.equal(downloaded, true);
  assert.match(downloadAnchor.download, /^onepick-/);
  assert.match(downloadAnchor.href, /^data:image\/png;base64,/);

  const source = fs.readFileSync(path.join(__dirname, '../src/components/pick-share-card.tsx'), 'utf8');
  assert.match(source, /이미지 카드 공유/);
  assert.match(source, /링크 공유/);
  assert.match(source, /WHY THIS ONE/);
  assert.match(source, /Platform\.OS === 'web'/);
  assert.doesNotMatch(source, /DEMO DATA/);

  console.log('Share-card checks passed: PNG drawing, file sharing, download fallback and dual share UI.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
