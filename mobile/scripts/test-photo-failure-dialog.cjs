// Photo upload failures must surface as a dialog on every platform. react-native-web
// turns Alert.alert into a no-op, so the web branch has to use the browser dialog.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const { AppError } = (() => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/errors/appError.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => assert.fail('appError has no dependencies') });
  return exports;
})();
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/photos/photoFailure.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function load(platform, browser) {
  const calls = { alert: [], browser: [], captured: [] };
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    ...(browser ? { window: { alert: (text) => calls.browser.push(text) } } : {}),
    require: (name) => {
      if (name === 'react-native') return { Platform: { OS: platform }, Alert: { alert: (...args) => calls.alert.push(args) } };
      if (name === '@/errors/appError') return { AppError };
      if (name === '@/services') return { observabilityService: { captureError: async (error, context) => { calls.captured.push([error, context]); } } };
      assert.fail(`Unexpected dependency ${name}`);
    },
  });
  return { ...exports, calls };
}

const tooLarge = new AppError('PHOTO_TOO_LARGE');

const web = load('web', true);
web.showPhotoFailure(tooLarge, 'item_photo_upload');
assert.equal(web.calls.alert.length, 0, 'Web must not rely on the no-op Alert.alert');
assert.equal(web.calls.browser.length, 1, 'Web shows exactly one browser dialog');
assert.match(web.calls.browser[0], /^사진을 업로드하지 못했어요\.\n\n/);
assert.match(web.calls.browser[0], /서버의 최대 저장 용량/);
assert.doesNotMatch(web.calls.browser[0], /PHOTO_TOO_LARGE/, 'Error codes never reach the user');
assert.deepEqual(web.calls.captured, [[tooLarge, 'item_photo_upload']], 'The failure is still logged with its context');

const ssr = load('web', false);
assert.doesNotThrow(() => ssr.showPhotoFailure(tooLarge, 'register_pick_photo_choose'), 'No window (static render) must not crash');
assert.equal(ssr.calls.captured.length, 1);

const native = load('ios', false);
native.showPhotoFailure(new AppError('NETWORK_ERROR'), 'request_item_photo_upload');
assert.equal(native.calls.alert.length, 1, 'Native keeps the RN alert');
assert.equal(native.calls.alert[0][0], '사진을 업로드하지 못했어요.');
assert.match(native.calls.alert[0][1], /인터넷 연결/);
assert.equal(JSON.stringify(native.calls.alert[0][2]), JSON.stringify([{ text: '닫기' }]));

const unknown = load('web', true);
unknown.showPhotoFailure(new Error('boom'), 'item_photo_choose');
assert.match(unknown.calls.browser[0], /원인을 확인하지 못했어요/);
assert.equal(unknown.isPhotoFailure(new Error('boom')), false);
assert.equal(unknown.isPhotoFailure(tooLarge), true);

console.log('Photo failure dialog passed: browser dialog on web, RN alert on native, no window safety, plain-language messages and error logging.');
