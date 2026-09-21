// Link preview checks: the card copy, the head rewrite and the edge handlers.
// Nothing here contacts Supabase or Cloudflare; the RPC call is stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, requireShim) {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const moduleExports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    {
      exports: moduleExports,
      module: { exports: moduleExports },
      require: requireShim ?? (() => { throw new Error('Unexpected import'); }),
      Response, Request, URL, AbortSignal, console,
      // Resolved per call so a test can swap the stub after the module is loaded.
      fetch: (...args) => globalThis.fetch(...args),
    },
  );
  return moduleExports;
}

const preview = load('src/lib/share/linkPreview.ts');

// --- Card copy -------------------------------------------------------------

const profile = preview.profilePreview({
  username: 'jimin',
  pickCount: 5,
  aiKeywords: ['담백함', '오래 쓰는 것', '무채색'],
  picks: [
    { categoryName: '라면', itemName: '신라면', oneLineReview: '국물이 제일 진해요' },
    { categoryName: '영화', itemName: '괴물' },
    { categoryName: '과자', itemName: '홈런볼' },
  ],
}, 'https://onepick.example');
assert.equal(profile.title, '@jimin의 원픽 5개');
assert.equal(profile.description, '라면 신라면 · 영화 괴물 · 과자 홈런볼 · #담백함 #오래 쓰는 것 #무채색',
  'The card names the actual choices, not just how many there are');
assert.equal(profile.url, 'https://onepick.example/u/jimin');

const emptyProfile = preview.profilePreview({ username: 'New_User', pickCount: 0 }, 'https://onepick.example');
assert.equal(emptyProfile.title, '@New_User의 OnePick');
assert.match(emptyProfile.description, /아직 고른 원픽이 없어요/);
assert.equal(emptyProfile.url, 'https://onepick.example/u/new_user', 'Profile links stay lowercase like shareLinks');

const summaryOnly = preview.profilePreview({ username: 'a', pickCount: 2, aiSummary: '고른 이유가 한결같아요' });
assert.equal(summaryOnly.description, '고른 이유가 한결같아요', 'A published AI summary fills in for missing pick rows');
assert.equal(summaryOnly.url, null, 'Without a canonical origin the card omits og:url rather than emitting a relative one');

const pick = preview.pickPreview({
  pickId: '11111111-2222-3333-4444-555555555555',
  username: 'jimin', categoryName: '라면', itemName: '신라면',
  oneLineReview: '국물이 제일 진해요',
}, 'https://onepick.example');
assert.equal(pick.title, '@jimin의 라면 원픽: 신라면');
assert.equal(pick.description, '“국물이 제일 진해요”');
assert.equal(pick.url, 'https://onepick.example/pick/11111111-2222-3333-4444-555555555555');

const long = preview.profilePreview({ username: 'x', pickCount: 1, aiSummary: '가'.repeat(400) });
assert.ok(long.description.length <= 200 && long.description.endsWith('…'), 'Long copy is clamped for the card');

// --- Head rewrite ----------------------------------------------------------

const marker = (state) => `<meta name="onepick:preview" content="${state}"/>`;
const shell = `<!DOCTYPE html><html lang="ko"><head><title>OnePick</title>${marker('start')}`
  + '<meta property="og:title" content="default"/>' + marker('end')
  + '<style id="expo-reset"></style></head><body><div id="root"></div></body></html>';

const rewritten = preview.replacePreviewRegion(shell, pick);
assert.match(rewritten, /<title>@jimin의 라면 원픽: 신라면<\/title>/, 'The tab title follows the shared route');
assert.match(rewritten, /<meta property="og:title" content="@jimin의 라면 원픽: 신라면"\/>/);
assert.ok(!rewritten.includes('content="default"'), 'The default card is replaced, not duplicated');
assert.equal((rewritten.match(/og:title/g) ?? []).length, 1, 'A crawler must not have to choose between two og:title tags');
assert.ok(rewritten.includes('<style id="expo-reset">') && rewritten.includes('<div id="root">'),
  'Everything outside the marked region is served untouched so the app still boots');

assert.equal(preview.replacePreviewRegion('<html><head><title>x</title></head></html>', pick),
  '<html><head><title>x</title></head></html>',
  'A build without markers keeps its own head instead of losing it');

const injected = preview.escapeAttribute('"><script>alert(1)</script>');
assert.ok(!injected.includes('"') && !injected.includes('<'), 'Item names and reviews cannot break out of an attribute');
const quoted = preview.replacePreviewRegion(shell, preview.pickPreview({
  username: 'a', categoryName: 'b', itemName: '"><script>alert(1)</script>', oneLineReview: 'c',
}));
assert.ok(!quoted.includes('<script>alert(1)</script>'), 'User content is escaped before it reaches the head');

// --- Post-export step ------------------------------------------------------

const { applyPreviewHead } = require('./apply-link-preview-head.cjs');
const exported = '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><title>OnePick</title>'
  + '<style id="expo-reset"></style></head><body><div id="root"></div></body></html>';
const applied = applyPreviewHead(exported, preview, 'https://onepick.example');
assert.match(applied, /<html lang="ko"/, 'Expo exports lang="en"; the app copy is Korean');
assert.match(applied, /<meta property="og:url" content="https:\/\/onepick\.example\/"\/>/);
assert.equal(applyPreviewHead(applied, preview, 'https://onepick.example'), applied,
  'Re-running over an applied export must not stack a second region');
assert.throws(() => applyPreviewHead('<html><head></head></html>', preview),
  /no <title>/, 'A shell shaped differently fails the build instead of shipping without a card');

// --- Edge handlers ---------------------------------------------------------

const handlers = load('functions/_preview.ts', (name) => {
  assert.equal(name, '../src/lib/share/linkPreview');
  return preview;
});

const env = {
  EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
};

function htmlResponse() {
  return new Response(shell, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function context({ params, next = htmlResponse, url = 'https://onepick.example/u/jimin', environment = env }) {
  return { request: new Request(url), env: environment, params, next: async () => next() };
}

async function run(name, body) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return body();
  };
  try {
    return { response: await name(), calls };
  } finally {
    globalThis.fetch = original;
  }
}

(async () => {
  const row = [{
    username: 'jimin', pick_count: 5, ai_summary: null, ai_keywords: null,
    picks: [{ categoryName: '라면', itemName: '신라면' }],
  }];
  const ok = await run(
    () => handlers.onProfileRequest(context({ params: { username: 'jimin' } })),
    () => new Response(JSON.stringify(row), { headers: { 'content-type': 'application/json' } }),
  );
  const okHtml = await ok.response.text();
  assert.match(okHtml, /<meta property="og:title" content="@jimin의 원픽 5개"\/>/);
  assert.match(okHtml, /<meta property="og:url" content="https:\/\/onepick\.example\/u\/jimin"\/>/,
    'The card is canonical to the origin the link was opened on, not a build-time guess');
  assert.equal(ok.calls.length, 1);
  assert.equal(ok.calls[0].url, 'https://project.supabase.co/rest/v1/rpc/link_preview_profile');
  assert.equal(JSON.parse(ok.calls[0].init.body).p_username, 'jimin');
  assert.equal(ok.calls[0].init.headers.apikey, env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    'The renderer reads as anon, so RLS decides what a preview may show');

  const failed = await run(
    () => handlers.onProfileRequest(context({ params: { username: 'jimin' } })),
    () => { throw new Error('upstream down'); },
  );
  assert.equal(await failed.response.text(), shell, 'A failed lookup serves the default card, never an error page');

  const missing = await run(
    () => handlers.onProfileRequest(context({ params: { username: 'ghost' } })),
    () => new Response('[]', { headers: { 'content-type': 'application/json' } }),
  );
  assert.equal(await missing.response.text(), shell, 'An unknown or suspended profile falls back to the default card');

  const unconfigured = await run(
    () => handlers.onProfileRequest(context({ params: { username: 'jimin' }, environment: {} })),
    () => { throw new Error('must not be called'); },
  );
  assert.equal(await unconfigured.response.text(), shell);
  assert.equal(unconfigured.calls.length, 0, 'Without configuration the handler does not reach for the network');

  const asset = await run(
    () => handlers.onProfileRequest(context({
      params: { username: 'jimin' },
      next: () => new Response('body{}', { headers: { 'content-type': 'text/css' } }),
    })),
    () => { throw new Error('must not be called'); },
  );
  assert.equal(await asset.response.text(), 'body{}');
  assert.equal(asset.calls.length, 0, 'Non-HTML responses pass straight through');

  const badId = await run(
    () => handlers.onPickRequest(context({ params: { pickId: 'not-a-uuid' }, url: 'https://onepick.example/pick/x' })),
    () => { throw new Error('must not be called'); },
  );
  assert.equal(await badId.response.text(), shell);
  assert.equal(badId.calls.length, 0, 'A malformed id is rejected before PostgREST turns it into a cast error');

  const pickRow = [{ username: 'jimin', category_name: '라면', item_name: '신라면', one_line_review: '국물이 진해요' }];
  const pickOk = await run(
    () => handlers.onPickRequest(context({
      params: { pickId: '11111111-2222-3333-4444-555555555555' },
      url: 'https://onepick.example/pick/11111111-2222-3333-4444-555555555555',
    })),
    () => new Response(JSON.stringify(pickRow), { headers: { 'content-type': 'application/json' } }),
  );
  assert.match(await pickOk.response.text(), /<meta property="og:title" content="@jimin의 라면 원픽: 신라면"\/>/);

  console.log('Link preview checks passed: card copy, head rewrite, escaping, post-export step and edge fallbacks.');
})();
