const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// The stored value is only ever the owner's own path; anything else never renders.
const mapper = (() => {
  const output = ts.transpileModule(read('src/repositories/mappers/profileMapper.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: () => ({}), process: { env: { EXPO_PUBLIC_SUPABASE_URL: 'https://project.supabase.co/' } } });
  return exports;
})();
const own = 'f1220000-0000-4000-8000-000000000001/0b6f8a52-3c1e-4d7a-9f10-2a3b4c5d6e7f.jpg';
assert.equal(mapper.profileImagePublicUrl(own), `https://project.supabase.co/storage/v1/object/public/profile-images/${own}`);
assert.equal(mapper.profileImagePublicUrl('https://tracker.example/pixel.jpg'), null, 'remote URLs never render');
assert.equal(mapper.profileImagePublicUrl('../other/x.jpg'), null);
assert.equal(mapper.profileImagePublicUrl(null), null);

const service = read('src/services/profileImageService.ts');
assert.match(service, /const path = `\$\{profileUserId\}\/\$\{Crypto\.randomUUID\(\)\}\.jpg`;/, 'uploads into my own folder as <uuid>.jpg');
assert.match(service, /rpc\('set_profile_image', \{ p_path: path \}\)/);
assert.match(service, /rpc\('set_profile_image', \{ p_path: null \}\)/, '사진 삭제 clears through the same RPC');
assert.match(service, /storage\.from\(BUCKET\)\.remove\(\[path\]\)/, 'a failed save drops the orphan upload');
assert.match(service, /user\.id !== profileUserId\) throw new AppError\('AUTH_REQUIRED'\)/, 'an account switch cannot edit the new account');
assert.match(service, /const MAX_SIDE = 512;/);

const control = read('src/components/profile-photo-control.tsx');
assert.match(control, /onPress=\{\(\) => \(imageUrl \? setOpen\(\(value\) => !value\) : choose\(\)\)\}/, 'no photo → picker; photo → 사진 선택 / 사진 삭제');
assert.match(control, /label="사진 바꾸기"/);
assert.match(control, /label="사진 삭제하기"/);
assert.match(control, /<Modal visible=\{open && !!imageUrl\}/, 'actions only appear in a photo-tap modal');
assert.match(control, /onRequestClose=\{\(\) => setOpen\(false\)\}/, 'native back dismisses the menu');
assert.match(control, /label="닫기"/);
assert.match(control, /<Avatar name=\{name\} size=\{64\}/, 'profile photo matches the approved 64px identity');
assert.doesNotMatch(control, /아바타/);

const avatar = read('src/components/ui/avatar.tsx');
assert.match(avatar, /imageUrl\s*\n?\s*\? <Image source=\{\{ uri: imageUrl \}\}/, 'Avatar shows the photo, else the initial');

console.log('Profile photo checks passed: own-path-only URLs, upload/set/clear flow, tap menu and Avatar photo.');
