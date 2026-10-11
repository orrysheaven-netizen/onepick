const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const userId = 'f1220000-0000-4000-8000-000000000001';
const name = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0') + '.jpg';
const own = (n) => userId + '/' + name(n);
class AppError extends Error { constructor(code) { super(code); this.code = code; } }
const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/profileImageService.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function fixture(options = {}) {
  const calls = { uploads: 0, lists: 0, removes: [], rpcs: [], auth: 0 };
  const bucket = {
    upload: async () => {
      calls.uploads++;
      return { error: calls.uploads === 1 ? options.firstError ?? { statusCode: '403' } : options.retryError ?? null };
    },
    list: async (folder, config) => {
      calls.lists++;
      assert.equal(folder, userId);
      assert.equal(config.limit, 20);
      return { data: Array.from({ length: options.count ?? 20 }, (_, i) => ({ id: 'object-' + i, name: name(i + 1) })), error: options.listError ?? null };
    },
    remove: async (paths) => {
      calls.removes.push([...paths]);
      return { data: options.race ? [] : paths.map((name) => ({ name })), error: options.removeError ?? null };
    },
  };
  const query = {
    select: () => query, eq: () => query,
    single: async () => ({ data: { profile_image_url: options.current ?? own(1) }, error: options.profileError ?? null }),
  };
  const client = {
    storage: { from: (bucketName) => { assert.equal(bucketName, 'profile-images'); return bucket; } },
    from: (table) => { assert.equal(table, 'profiles'); return query; },
    auth: { getUser: async () => {
      calls.auth++;
      return { data: { user: { id: options.switchAfter && calls.auth > options.switchAfter ? 'other-user' : userId } }, error: null };
    } },
    rpc: async (name, args) => { calls.rpcs.push([name, args]); return { error: null }; },
  };
  const imports = {
    'base64-arraybuffer': { decode: () => new ArrayBuffer(1) },
    'expo-crypto': { randomUUID: () => name(99).slice(0, -4) },
    'expo-image-manipulator': { ImageManipulator: {}, SaveFormat: {} },
    'expo-image-picker': { launchImageLibraryAsync: async () => ({ canceled: false, assets: [{ uri: 'file:photo' }] }) },
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: () => new AppError('INTERNAL_ERROR') },
    '@/lib/profile/profileImage': { profileImagePathFromUrl: (url) => url, profileImagePublicUrl: (p) => 'https://storage/' + p },
    '@/lib/supabase/client': { supabase: client },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, require: (id) => {
    assert.ok(id in imports, 'Unexpected dependency ' + id); return imports[id];
  } });
  const service = new exports.ProfileImageService(client);
  service.prepare = async () => 'base64';
  return { calls, run: () => service.chooseAndSave(userId, options.previous ?? null) };
}
async function main() {
  const normal = fixture({ firstError: false });
  await normal.run();
  assert.equal(normal.calls.uploads, 1);
  assert.equal(normal.calls.lists, 0);
  assert.equal(normal.calls.removes.length, 0);

  const full = fixture();
  await full.run();
  assert.equal(full.calls.uploads, 2);
  assert.deepEqual(full.calls.removes, [[own(2)]], 'free exactly one unused slot; preserve current');
  assert.equal(full.calls.rpcs.length, 1);
  assert.equal(full.calls.rpcs[0][0], 'set_profile_image');

  const changedCurrent = fixture({ current: own(2), previous: own(1) });
  await changedCurrent.run();
  assert.deepEqual(changedCurrent.calls.removes[0], [own(3)], 'exclude both cached and latest current image');

  for (const options of [{ count: 19 }, { listError: {} }, { profileError: {} }]) {
    const f = fixture(options);
    await assert.rejects(f.run(), { code: 'PHOTO_UPLOAD_FAILED' });
    assert.equal(f.calls.removes.length, 0);
    assert.equal(f.calls.uploads, 1);
  }
  for (const options of [{ race: true }, { removeError: {} }]) {
    const f = fixture(options);
    await assert.rejects(f.run(), { code: 'PHOTO_UPLOAD_FAILED' });
    assert.equal(f.calls.uploads, 1, 'no retry if no slot was actually freed');
    assert.equal(f.calls.rpcs.length, 0);
  }
  const deniedAgain = fixture({ retryError: { statusCode: '403' } });
  await assert.rejects(deniedAgain.run(), { code: 'PHOTO_UPLOAD_FAILED' });
  assert.equal(deniedAgain.calls.uploads, 2, 'no unbounded retry loop');
  assert.equal(deniedAgain.calls.removes.length, 1);

  for (const statusCode of ['413', '500']) {
    const f = fixture({ firstError: { statusCode } });
    await assert.rejects(f.run(), { code: statusCode === '413' ? 'PHOTO_TOO_LARGE' : 'PHOTO_UPLOAD_FAILED' });
    assert.equal(f.calls.lists, 0, 'non-RLS errors never trigger cleanup');
    assert.equal(f.calls.removes.length, 0);
  }
  const switched = fixture({ switchAfter: 1 });
  await assert.rejects(switched.run(), { code: 'AUTH_REQUIRED' });
  assert.equal(switched.calls.uploads, 0, 'account is checked again after the picker');
  const switchedDuringCleanup = fixture({ switchAfter: 3 });
  await assert.rejects(switchedDuringCleanup.run(), { code: 'AUTH_REQUIRED' });
  assert.equal(switchedDuringCleanup.calls.removes.length, 0, 'account is rechecked before deletion');
  console.log('Profile image recovery runtime checks passed.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
