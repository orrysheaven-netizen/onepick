const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, imports = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, URL, ...globals, require: (name) => {
    if (name === '@/constants/onepick') return require('./design-tokens.cjs');
    if (name === '@/components/ui/dialog-labels') return require('./dialog-labels.cjs');
    if (name in imports) return imports[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    assert.fail(`Unexpected import: ${name}`);
  } });
  return exports;
}
const lib = load('lib/socialLinks.ts');
const normalize = lib.normalizeSocialLink;
const valid = [
  ['instagram', '@Hello.World', 'https://www.instagram.com/hello.world'],
  ['instagram', 'instagram.com/one_pick/?igsh=tracking', 'https://www.instagram.com/one_pick'],
  ['youtube', '@channel_name', 'https://www.youtube.com/@channel_name'],
  ['youtube', 'https://youtube.com/@%ED%95%9C%EA%B8%80%EC%B1%84%EB%84%90?si=tracking', 'https://www.youtube.com/@한글채널'],
  ['youtube', 'https://youtube.com/channel/UC' + 'a'.repeat(22), 'https://www.youtube.com/channel/UC' + 'a'.repeat(22)],
  ['x', 'https://twitter.com/Test_user', 'https://x.com/test_user'],
  ['threads', 'https://www.threads.net/@hello?x=tracking', 'https://www.threads.com/@hello'],
  ['naver_blog', 'https://m.blog.naver.com/test_blog', 'https://blog.naver.com/test_blog'],
];
valid.forEach(([platform, input, expected]) => assert.equal(normalize(platform, input), expected));
const invalid = [
  'javascript:alert(1)', 'data:text/html,hello', 'http://instagram.com/name',
  'https://instagram.com.evil.test/name', 'https://instagram.com@evil.test/name',
  'https://name:password@instagram.com/name', 'https://instagram.com:8443/name',
  'https://evil.test/name', '//instagram.com/name', 'https://instagram.com/',
  'https://instagram.com/p/post', 'https://instagram.com/accounts',
  'https://instagram.com/name/extra', 'https://instagram.com/name%2Fextra',
  'https://instagram.com/name%0A', 'https://instagram.com/name\\extra',
  'name with spaces', '', 'a'.repeat(513), '.name', 'name..test',
];
invalid.forEach((input) => assert.throws(() => normalize('instagram', input)));
assert.throws(() => normalize('youtube', 'https://youtube.com/watch?v=abc'));
assert.throws(() => normalize('x', 'a'.repeat(16)));
assert.equal(lib.parseSocialLink({ platform: 'unknown', url: 'https://example.test' }), null);
assert.equal(lib.parseSocialLink({ platform: 'instagram', url: 'javascript:alert(1)' }), null);
let userId = 'owner', failure = null, calls = [], rows = [], saved;
const chain = {
  select: () => chain,
  eq: (key, value) => { calls.push([key, value]); return chain; },
  order: async () => ({ data: rows, error: failure }),
  upsert: (row, options) => { saved = row; calls.push(['upsert', row, options]); return chain; },
  single: async () => ({ data: saved, error: failure }),
  delete: () => { calls.push(['delete']); return chain; },
  then: (resolve, reject) => Promise.resolve({ error: failure }).then(resolve, reject),
};
const client = {
  auth: { getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }) },
  from: (table) => { calls.push(['table', table]); return chain; },
};
class AppError extends Error {}
const { SocialLinksService } = load('services/socialLinksService.ts', {
  '@/lib/supabase/client': { supabase: client }, '@/lib/socialLinks': lib,
  '@/errors/appError': { AppError }, '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
});
async function main() {
  const service = new SocialLinksService(client);
  rows = [{ platform: 'instagram', url: 'https://www.instagram.com/hello' }, { platform: 'x', url: 'javascript:alert(1)' }];
  assert.equal((await service.list('owner')).length, 1, 'Invalid stored URLs are never shown');
  assert.ok(calls.some(([key, value]) => key === 'user_id' && value === 'owner'));
  const result = await service.save('owner', 'instagram', '@Hello');
  assert.equal(result.url, 'https://www.instagram.com/hello');
  assert.equal(saved.user_id, 'owner');
  assert.equal(calls.find(([key]) => key === 'upsert')[2].onConflict, 'user_id,platform');
  calls = []; userId = 'other';
  await assert.rejects(() => service.save('owner', 'x', '@hello'), /AUTH_REQUIRED/);
  await assert.rejects(() => service.remove('owner', 'x'), /AUTH_REQUIRED/);
  assert.equal(calls.length, 0, 'Account switch cannot mutate previous account');
  userId = null;
  await assert.rejects(() => service.save('owner', 'x', '@hello'), /AUTH_REQUIRED/);
  userId = 'owner'; calls = [];
  await service.remove('owner', 'instagram');
  assert.ok(calls.some(([key, value]) => key === 'user_id' && value === 'owner'));
  assert.ok(calls.some(([key, value]) => key === 'platform' && value === 'instagram'));
  failure = new Error('offline');
  await assert.rejects(() => service.list('owner'), /offline/);
  await assert.rejects(() => service.save('owner', 'x', '@hello'), /offline/);
  await assert.rejects(() => service.remove('owner', 'x'), /offline/);
  const hookOptions = [];
  const hooks = load('hooks/useSocialLinks.ts', {
    '@tanstack/react-query': { useQuery: (options) => { hookOptions.push(options); return options; }, useMutation: () => {}, useQueryClient: () => ({}) },
    '@/services/socialLinksService': { socialLinksService: service },
  });
  hooks.useSocialLinks('profile', 'viewer1'); hooks.useSocialLinks('profile', 'viewer2'); hooks.useSocialLinks('profile');
  assert.equal(new Set(hookOptions.map((item) => JSON.stringify(item.queryKey))).size, 3, 'Caches are viewer-specific');
  if (!process.argv.includes('--unit-only')) {
    const React = require('react');
    const { renderToStaticMarkup } = require('react-dom/server');
    const part = (tag) => ({ children }) => React.createElement(tag, null, children);
    const auth = { user: { id: 'viewer' }, isLoading: false, error: null };
    const query = { data: [lib.parseSocialLink(rows[0])], isPending: false, isError: false };
    let buttons = [], opened;
    const { ProfileSocialLinks } = load('components/profile-social-links.tsx', {
      'react-native': {
        View: part('div'), Text: part('span'), ActivityIndicator: () => null, TextInput: () => null,
        Pressable: (props) => { buttons.push(props); return React.createElement('button', null, props.children); },
        StyleSheet: { create: (styles) => styles }, Linking: {}, Platform: { OS: 'web' },
      },
      '@/hooks/useAuthSession': { useAuthSession: () => auth },
      '@/hooks/useSocialLinks': { useSocialLinks: () => query, useChangeSocialLink: () => ({ isPending: false }) },
      '@/lib/socialLinks': lib,
    }, { window: { open: (...args) => { opened = args; } } });
    const render = () => renderToStaticMarkup(React.createElement(ProfileSocialLinks, { profileUserId: 'owner', editable: true }));
    let html = render();
    assert.match(html, /Instagram/); assert.doesNotMatch(html, /SNS 수정|SNS 연결/);
    buttons.find((button) => button.accessibilityRole === 'link').onPress();
    assert.equal(opened[0], 'https://www.instagram.com/hello');
    assert.equal(opened[2], 'noopener,noreferrer');
    auth.user = { id: 'owner' }; buttons = [];
    assert.match(render(), /SNS 수정/);
    auth.error = new Error('session'); assert.equal(render(), '', 'Session errors hide cached links and editors');
    auth.error = null; auth.user = null; query.data = [];
    assert.equal(render(), '', 'Empty public profile has no SNS clutter');
    query.isError = true; assert.match(render(), /불러오지 못했어요/);
    for (const file of ['app/(tabs)/(profile)/profile.tsx', 'app/(tabs)/(profile)/u/[username].tsx']) {
      assert.match(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), /<ProfileSocialLinks/, 'Both profile screens expose SNS links');
    }
  }
  console.log(process.argv.includes('--unit-only')
    ? 'Social link unit checks passed: canonical URLs, unsafe links, ownership, CRUD failures and viewer caches. UI checks skipped.'
    : 'Social link checks passed: canonical URLs, unsafe links, ownership, CRUD failures, viewer caches and profile UI.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
