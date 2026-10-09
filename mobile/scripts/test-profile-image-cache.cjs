const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(relative, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: (name) => {
    assert.ok(name in imports, 'Unexpected dependency: ' + name);
    return imports[name];
  } });
  return exports;
}
const keys = load('src/lib/query/queryKeys.ts', {});
let updates = 0;
let filter;
let updater;
const client = {
  setQueriesData: (options, callback) => {
    assert.equal(options.queryKey[0], 'profiles');
    updates++;
    updater = callback;
  },
  invalidateQueries: async (options) => { assert.ok(options?.predicate); filter = options.predicate; },
};
const { useProfileImage } = load('src/hooks/useProfileImage.ts', {
  '@tanstack/react-query': { useQueryClient: () => client, useMutation: (options) => options },
  '@/lib/query/queryKeys': keys,
  '@/services/profileImageService': { profileImageService: {} },
});
async function main() {
  const hook = useProfileImage('me', null);
  await hook.change.onSuccess(null);
  assert.equal(updates, 0, 'picker cancellation does not refetch');
  for (const url of ['https://project.supabase.co/photo.jpg', null]) {
    await hook.change.onSuccess({ userId: 'me', profileImageUrl: url });
    const mine = { profile: { id: 'me', profileImageUrl: 'old' }, other: 42 };
    const theirs = { profile: { id: 'other', profileImageUrl: 'their-photo' } };
    assert.equal(updater(mine).profile.profileImageUrl, url);
    assert.equal(updater(mine).other, 42);
    assert.equal(updater(theirs), theirs, 'another profile is not overwritten');
    assert.equal(updater(undefined), undefined);
    for (const family of ['profiles', 'home', 'explore', 'follows', 'comments', 'items', 'picks', 'providers'])
      assert.equal(filter({ queryKey: [family, 'example'] }), true);
    assert.equal(filter({ queryKey: ['notifications', 'me', 'list'] }), true);
    for (const key of [['categories'], ['movie-catalog'], ['admin'], ['auth'], ['profile-ai'],
      ['notifications', 'me', 'count'], ['notifications', 'me', 'preferences']])
      assert.equal(filter({ queryKey: key }), false, key.join('/'));
  }
  assert.equal(hook.clear.onSuccess, hook.change.onSuccess, 'clear uses the same cache update');
  // A failed 바꾸기 notice must not survive a later successful 삭제하기 (and the reverse):
  // starting either action resets the other mutation's error state.
  const resets = { change: 0, clear: 0 };
  hook.change.reset = () => resets.change++;
  hook.clear.reset = () => resets.clear++;
  hook.change.onMutate();
  assert.deepEqual(resets, { change: 0, clear: 1 }, 'starting 바꾸기 clears the 삭제하기 error');
  hook.clear.onMutate();
  assert.deepEqual(resets, { change: 1, clear: 1 }, 'starting 삭제하기 clears the 바꾸기 error');
  console.log('Profile image cache checks passed: change/clear, cancellation, other profiles, bounded invalidation and cross-action error reset.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
