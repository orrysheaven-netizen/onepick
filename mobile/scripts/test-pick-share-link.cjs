const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(os, navigator, share) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/share/sharePick.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports, navigator,
    require: (name) => {
      if (name === 'react-native') return { Platform: { OS: os }, Share: share ?? { share: async () => ({ action: 'sharedAction' }), dismissedAction: 'dismissedAction' } };
      if (name === './shareLinks') return { createPickShareUrl: (id) => `https://onepick.test/pick/${id}` };
      assert.fail(`Unexpected import: ${name}`);
    },
  });
  return exports.sharePick;
}

const input = { pickId: 'p1', username: 'onepick_qa', categoryName: '내장탕', itemName: '중앙해장', oneLineReview: '내장탕은 여기' };

async function main() {
  // Desktop browsers without a share sheet: the link goes to the clipboard instead of failing.
  const copied = [];
  assert.equal(await load('web', { clipboard: { writeText: async (text) => { copied.push(text); } } })(input), 'copied');
  assert.deepEqual(copied, ['https://onepick.test/pick/p1']);

  // A share sheet is used when present; closing it is not an error.
  const shared = [];
  assert.equal(await load('web', { share: async (data) => { shared.push(data); } })(input), 'shared');
  assert.equal(shared[0].url, 'https://onepick.test/pick/p1');
  assert.match(shared[0].text, /@onepick_qa님의 내장탕 원픽: 중앙해장/);
  const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
  assert.equal(await load('web', { share: async () => { throw abort; } })(input), 'dismissed');

  // A share sheet that fails for another reason falls back to copying.
  const fallback = [];
  assert.equal(await load('web', { share: async () => { throw new Error('NotAllowed'); }, clipboard: { writeText: async (text) => { fallback.push(text); } } })(input), 'copied');
  assert.equal(fallback.length, 1);

  await assert.rejects(load('web', {})(input), /SHARE_UNSUPPORTED/);

  let nativePayload;
  const native = load('ios', undefined, { share: async (payload) => { nativePayload = payload; return { action: 'sharedAction' }; }, dismissedAction: 'dismissedAction' });
  assert.equal(await native(input), 'shared');
  assert.match(nativePayload.message, /https:\/\/onepick\.test\/pick\/p1$/);
  const dismissed = load('ios', undefined, { share: async () => ({ action: 'dismissedAction' }), dismissedAction: 'dismissedAction' });
  assert.equal(await dismissed(input), 'dismissed');

  console.log('Pick share link passed: web share sheet, clipboard fallback, cancel handling and native share.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
