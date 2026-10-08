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


// Exercise event handlers across rerenders; source matching alone cannot verify
// that actions stay hidden until a tap or that every dismissal closes the menu.
function menuFixture(imageUrl) {
  let open;
  const calls = { change: 0, clear: 0 };
  const photo = { isPending: false, error: null,
    change: { mutate: () => calls.change++ }, clear: { mutate: () => calls.clear++ } };
  const jsx = (type, props) => ({ type, props });
  const imports = {
    react: { useState: (initial) => {
      if (open === undefined) open = initial;
      return [open, (value) => { open = typeof value === 'function' ? value(open) : value; }];
    } },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    'react-native': { ActivityIndicator: 'ActivityIndicator', Modal: 'Modal', Pressable: 'Pressable', Text: 'Text', View: 'View',
      StyleSheet: { create: (styles) => styles, absoluteFill: {} } },
    '@/components/ui': { Avatar: 'Avatar', Button: 'Button' },
    '@/constants/onepick': { OnePick: {}, OnePickSpace: {}, OnePickType: {} },
    '@/errors/appError': { AppError: class extends Error {} },
    '@/hooks/useProfileImage': { useProfileImage: () => photo },
  };
  const output = ts.transpileModule(control, { fileName: 'profile-photo-control.tsx',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require: (name) => {
    assert.ok(name in imports, `Unexpected menu dependency: ${name}`);
    return imports[name];
  } });
  const render = () => exports.ProfilePhotoControl({ userId: 'me', name: '나', imageUrl });
  const flatten = (node) => !node || typeof node !== 'object' ? []
    : [node, ...[node.props?.children].flat(Infinity).flatMap(flatten)];
  const find = (predicate) => flatten(render()).find(predicate);
  return { calls, photo, modal: () => find((n) => n.type === 'Modal'),
    tap: () => find((n) => n.type === 'Pressable' && n.props.accessibilityLabel === '프로필 사진 바꾸기'),
    button: (label) => find((n) => n.type === 'Button' && n.props.label === label),
    backdrop: () => find((n) => n.props.accessibilityLabel === '프로필 사진 메뉴 닫기') };
}
const emptyPhoto = menuFixture(null);
assert.equal(emptyPhoto.modal().props.visible, false);
emptyPhoto.tap().props.onPress();
assert.equal(emptyPhoto.calls.change, 1, 'no photo launches picker immediately');
assert.equal(emptyPhoto.modal().props.visible, false, 'no-photo tap does not open the menu');

const existingPhoto = menuFixture('https://project.supabase.co/photo.jpg');
assert.equal(existingPhoto.modal().props.visible, false, 'menu starts hidden');
existingPhoto.tap().props.onPress();
assert.equal(existingPhoto.modal().props.visible, true);
assert.equal(existingPhoto.calls.change, 0, 'opening menu does not launch picker');
for (const close of [() => existingPhoto.button('닫기').props.onPress(),
  () => existingPhoto.backdrop().props.onPress(), () => existingPhoto.modal().props.onRequestClose()]) {
  close();
  assert.equal(existingPhoto.modal().props.visible, false);
  existingPhoto.tap().props.onPress();
}
existingPhoto.button('사진 바꾸기').props.onPress();
assert.equal(existingPhoto.calls.change, 1);
assert.equal(existingPhoto.modal().props.visible, false);
existingPhoto.tap().props.onPress();
existingPhoto.button('사진 삭제하기').props.onPress();
assert.equal(existingPhoto.calls.clear, 1);
assert.equal(existingPhoto.modal().props.visible, false);
existingPhoto.photo.isPending = true;
assert.equal(existingPhoto.tap().props.disabled, true, 'pending save prevents another tap');
console.log('Profile photo menu runtime checks passed: empty/existing photos, all dismissals, change, delete, pending.');
