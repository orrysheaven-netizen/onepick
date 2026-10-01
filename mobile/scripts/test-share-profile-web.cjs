const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(
  fs.readFileSync(path.join(__dirname, '../src/lib/share/shareProfile.ts'), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function load({ platform = 'web', navigatorValue, shareResult = { action: 'sharedAction' } } = {}) {
  const exports = {};
  const calls = { native: [], browser: [], copied: [] };
  const Share = {
    dismissedAction: 'dismissedAction',
    share: async (payload) => { calls.native.push(payload); return shareResult; },
  };
  const nav = navigatorValue ?? {
    share: async (payload) => { calls.browser.push(payload); },
    clipboard: { writeText: async (value) => { calls.copied.push(value); } },
  };
  vm.runInNewContext(code, {
    exports,
    navigator: nav,
    require: (name) => {
      if (name === 'react-native') return { Platform: { OS: platform }, Share };
      if (name === './shareLinks') return { createProfileShareUrl: (username) => `https://onepick.example/u/${username.toLowerCase()}` };
      throw new Error('Unexpected dependency: ' + name);
    },
  });
  return { shareProfile: exports.shareProfile, calls, nav };
}

(async () => {
  {
    const { shareProfile, calls } = load();
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 4 }), 'shared');
    assert.equal(calls.browser.length, 1);
    assert.equal(calls.browser[0].url, 'https://onepick.example/u/owner');
    assert.match(calls.browser[0].text, /음식 원픽 4개/);
    assert.equal(calls.copied.length, 0);
  }

  {
    const copied = [];
    const { shareProfile } = load({
      navigatorValue: { clipboard: { writeText: async (value) => copied.push(value) } },
    });
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 2 }), 'copied');
    assert.deepEqual(copied, ['https://onepick.example/u/owner']);
  }

  {
    const copied = [];
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    const { shareProfile } = load({
      navigatorValue: {
        share: async () => { throw abort; },
        clipboard: { writeText: async (value) => copied.push(value) },
      },
    });
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 2 }), 'dismissed');
    assert.equal(copied.length, 0, 'cancelling the native browser share sheet must not copy unexpectedly');
  }

  {
    const copied = [];
    const { shareProfile } = load({
      navigatorValue: {
        share: async () => { throw new Error('share failed'); },
        clipboard: { writeText: async (value) => copied.push(value) },
      },
    });
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 2 }), 'copied');
    assert.deepEqual(copied, ['https://onepick.example/u/owner']);
  }

  {
    const { shareProfile } = load({ navigatorValue: {} });
    await assert.rejects(() => shareProfile({ username: 'Owner', pickCount: 1 }), /SHARE_UNSUPPORTED/);
  }

  {
    const { shareProfile, calls } = load({ platform: 'ios' });
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 3 }), 'shared');
    assert.equal(calls.native[0].url, 'https://onepick.example/u/owner');
    assert.match(calls.native[0].message, /https:\/\/onepick\.example\/u\/owner/);
  }

  {
    const { shareProfile, calls } = load({ platform: 'android' });
    assert.equal(await shareProfile({ username: 'Owner', pickCount: 3 }), 'shared');
    assert.equal(calls.native[0].url, undefined, 'Android receives the link inside message text');
    assert.match(calls.native[0].message, /https:\/\/onepick\.example\/u\/owner/);
  }

  console.log('Profile share checks passed: browser share, clipboard fallback, cancel handling, native iOS/Android payloads.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
