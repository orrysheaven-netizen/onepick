const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const base = 'https://project.supabase.co';
function load(relative, suffix = '', env = base + '/') {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, relative), 'utf8') + suffix, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: () => ({}),
    process: { env: { EXPO_PUBLIC_SUPABASE_URL: env } } });
  return exports;
}
const own = 'f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
const prefix = '/storage/v1/object/public/profile-images/';
const invalid = [null, undefined, '', '../x.jpg', own.toUpperCase(), own + '?x=1',
  own.replace('.jpg', '.JPG'), own.replace('/', '/nested/'), 'https://tracker.example/x.jpg',
  'a'.repeat(36) + '/' + 'b'.repeat(36) + '.jpg',
  '-'.repeat(36) + '/' + '-'.repeat(36) + '.jpg'];
for (const file of ['src/repositories/mappers/profileMapper.ts',
  'src/repositories/supabase/supabaseFollowRepository.ts',
  'src/repositories/supabase/supabaseReadRepository.ts']) {
  // Expose the module-local converter only in this test VM.
  const suffix = file.endsWith('profileMapper.ts') ? '' : '\nexport { profileImagePublicUrl };';
  const fn = load(file, suffix).profileImagePublicUrl;
  assert.equal(fn(own), base + prefix + own, file);
  for (const value of invalid) assert.equal(fn(value), null, file + ': ' + value);
  assert.equal(load(file, suffix, '').profileImagePublicUrl(own), null);
}
const file = 'src/lib/profile/profileImage.ts';
const reverse = load(file).profileImagePathFromUrl;
assert.equal(reverse(base + prefix + own), own);
for (const value of [null, '', own, 'https://tracker.example' + prefix + own,
  'https://project.supabase.co.evil.example' + prefix + own,
  'https://tracker.example/?next=' + base + prefix + own,
  base + prefix + own + '?download=1', base + prefix + invalid[9]])
  assert.equal(reverse(value), null, 'reverse rejects: ' + value);
assert.equal(load(file, '', '').profileImagePathFromUrl(base + prefix + own), null);
console.log('Profile path checks passed: canonical UUIDs across all converters and same-project reverse URLs.');
