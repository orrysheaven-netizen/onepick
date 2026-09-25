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

function loadCardCanvas() {
  const exports = {};
  vm.runInNewContext(transpile('lib/share/cardCanvas.ts'), {
    exports, Uint8Array,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      throw new Error(name);
    },
  });
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
      if (name === './shareLinks') return { createProfileShareUrl: (name_) => 'https://onepick.example/u/' + name_ };
      if (name === './cardCanvas') return loadCardCanvas();
      throw new Error(name);
    },
  };
  vm.runInNewContext(transpile('lib/share/shareProfileCard.web.ts'), context);
  return { exports, drawn };
}

const picks = [
  { categoryName: '라면', itemName: '진라면 매운맛' },
  { categoryName: '영화', itemName: '리틀 포레스트' },
  { categoryName: '음악', itemName: '밤편지' },
  { categoryName: '과자', itemName: '꼬북칩' },
  { categoryName: '드라마', itemName: '나의 아저씨' },
];
const visibleAi = { summary: '식문화에 치우친 취향이에요', isVisible: true, isStale: false };

function silentNavigator() {
  return { anchor: { click() {}, remove() {} }, navigator: {} };
}

async function main() {
  // The AI summary is printed only when it is public, fresh and non-empty.
  const gate = loadWeb(silentNavigator()).exports.cardAiSummary;
  assert.equal(gate(visibleAi), '식문화에 치우친 취향이에요');
  assert.equal(gate({ ...visibleAi, isVisible: false }), null, 'a private evaluation must never reach the image');
  assert.equal(gate({ ...visibleAi, isStale: true }), null, 'a stale evaluation contradicts the Picks beside it');
  assert.equal(gate({ ...visibleAi, summary: '   ' }), null);
  assert.equal(gate(null), null);
  assert.equal(gate(undefined), null);

  const withAi = loadWeb(silentNavigator());
  await withAi.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: visibleAi });
  assert.ok(withAi.drawn.includes('@tester'), 'the username must be printed whole, not clipped');
  assert.ok(withAi.drawn.includes('원픽') && withAi.drawn.includes('one pick'), 'the card must carry the brand lockup');
  assert.ok(withAi.drawn.includes('현재 원픽'), 'section labels stay Korean');
  assert.ok(!withAi.drawn.some((line) => /^[A-Z ]+$/.test(line)), 'no English kicker belongs on the card');
  assert.ok(withAi.drawn.includes('진라면 매운맛'));
  assert.ok(withAi.drawn.includes('꼬북칩'));
  assert.ok(!withAi.drawn.includes('나의 아저씨'), 'only the first four Picks are printed');
  assert.ok(withAi.drawn.includes('외 1개'), 'the remaining Picks must be counted');
  assert.ok(withAi.drawn.some((line) => line.includes('식문화에 치우친')));
  assert.ok(withAi.drawn.includes('https://onepick.example/u/tester'));

  const privateAi = loadWeb(silentNavigator());
  await privateAi.exports.shareProfileCardImage({
    username: 'tester', picks, aiComment: { ...visibleAi, isVisible: false },
  });
  assert.ok(!privateAi.drawn.some((line) => line.includes('식문화에 치우친')), 'a private evaluation must not be drawn');
  assert.ok(!privateAi.drawn.includes('AI 취향평가'));
  assert.ok(privateAi.drawn.includes('진라면 매운맛'), 'the card is still made without an evaluation');

  const empty = loadWeb(silentNavigator());
  await empty.exports.shareProfileCardImage({ username: 'tester', picks: [], aiComment: null });
  assert.ok(empty.drawn.includes('아직 고른 원픽이 없어요'), 'a profile with no Picks still gets a card');
  assert.ok(!empty.drawn.some((line) => line.startsWith('외 ')));

  // File sharing: the link rides in the text too, because some targets drop `url`.
  let shared = null;
  class FileMock {
    constructor(parts, name, options) { this.parts = parts; this.name = name; this.type = options.type; }
  }
  const sharedCase = loadWeb({
    anchor: { click() { throw new Error('download must not run when the file was shared'); }, remove() {} },
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {
      canShare: (payload) => Array.isArray(payload.files),
      share: async (payload) => { shared = payload; },
      clipboard: { writeText: async () => { throw new Error('clipboard must not run when the file was shared'); } },
    },
  });
  assert.equal(await sharedCase.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: visibleAi }), 'shared');
  assert.equal(shared.files[0].name, 'onepick-tester.png');
  assert.equal(shared.files[0].type, 'image/png');
  assert.equal(shared.url, 'https://onepick.example/u/tester');
  assert.ok(shared.text.includes('https://onepick.example/u/tester'), 'the link must survive a target that drops url');
  assert.ok(shared.text.includes('5개'), 'the text counts every current Pick, not only the printed four');

  // Download fallback: the link must still end up in the visitor's hands.
  let downloaded = 0, copied = null;
  const copyCase = loadWeb({
    anchor: { click() { downloaded++; }, remove() {} },
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {
      canShare: () => false,
      share: async () => { throw new Error('share must not run when files cannot be shared'); },
      clipboard: { writeText: async (value) => { copied = value; } },
    },
  });
  assert.equal(await copyCase.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: null }), 'downloaded-with-link');
  assert.equal(downloaded, 1);
  assert.equal(copied, 'https://onepick.example/u/tester');

  // No clipboard: reported as a plain download so the caller can still send the link.
  let plainDownloads = 0;
  const plainCase = loadWeb({
    anchor: { click() { plainDownloads++; }, remove() {} },
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: { canShare: () => false },
  });
  assert.equal(await plainCase.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: null }), 'downloaded');
  assert.equal(plainDownloads, 1);

  const refusedCopy = loadWeb({
    anchor: { click() {}, remove() {} },
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: { canShare: () => false, clipboard: { writeText: async () => { throw new Error('denied'); } } },
  });
  assert.equal(await refusedCopy.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: null }), 'downloaded');

  // A cancelled share is not a failure and must not fall back to a download.
  const abortCase = loadWeb({
    anchor: { click() { throw new Error('a cancelled share must not download'); }, remove() {} },
    File: FileMock,
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    navigator: {
      canShare: () => true,
      share: async () => { const error = new Error('cancelled'); error.name = 'AbortError'; throw error; },
    },
  });
  await assert.rejects(
    () => abortCase.exports.shareProfileCardImage({ username: 'tester', picks, aiComment: null }),
    /cancelled/,
  );

  // Platforms without a canvas report it instead of drawing a broken card.
  const unsupported = {};
  vm.runInNewContext(transpile('lib/share/shareProfileCard.web.ts'), {
    exports: unsupported,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name === './shareLinks') return { createProfileShareUrl: () => 'https://onepick.example/u/tester' };
      if (name === './cardCanvas') return loadCardCanvas();
      throw new Error(name);
    },
  });
  await assert.rejects(
    () => unsupported.shareProfileCardImage({ username: 'tester', picks, aiComment: null }),
    /IMAGE_CARD_UNSUPPORTED/,
  );

  // The native entry point stays a stub, so native falls back to the text share.
  const nativeSource = fs.readFileSync(path.join(__dirname, '../src/lib/share/shareProfileCard.ts'), 'utf8');
  assert.match(nativeSource, /throw new Error\('IMAGE_CARD_UNSUPPORTED'\)/);

  // Screen wiring: a saved card with no copied link still sends the link by text share.
  const screen = fs.readFileSync(path.join(__dirname, '../src/app/u/[username].tsx'), 'utf8');
  assert.match(screen, /needsLink = result === 'downloaded'/);
  assert.match(screen, /if \(!needsLink\) return;\s*\n\s*await shareProfile\(/);
  assert.match(screen, /name === 'AbortError'\) return;/, 'a cancelled share must not fall through to the text share');
  assert.match(screen, /needsLink = true;/, 'an unsupported card must fall back to the text share');
  assert.match(screen, /aiComment: OnePickFeatures\.profileAi \? \(aiCommentQuery\.data \?\? null\) : null/,
    'The screen must exclude even a cached AI evaluation while the rollout flag is off');
  assert.match(screen, /useProfileAiComment\(OnePickFeatures\.profileAi \? query\.data\?\.profile\.id : undefined\)/,
    'The screen keeps hook order stable while disabling automatic AI reads');

  console.log('Profile share-card checks passed: rollout gate, visible/fresh AI only, four Picks plus a count, file share, clipboard and text-share fallbacks.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
