// Profile photo upload (2026-10-11): stored value is an owned-storage path, never a remote URL.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const src = (relative) => fs.readFileSync(path.join(__dirname, '../src', relative), 'utf8');
function loadAvatarLib(env) {
  const exports = {};
  const { outputText } = ts.transpileModule(src('lib/profile/profileAvatar.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  vm.runInNewContext(outputText, { exports, process: { env } });
  return exports;
}

const uid = '3f2b8c1e-0000-4000-8000-000000000001';
const lib = loadAvatarLib({ EXPO_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co/' });

assert.equal(lib.PROFILE_AVATAR_BUCKET, 'profile-avatars');
assert.equal(lib.profileAvatarUrl(`${uid}/abc-1.jpg`), `https://proj.supabase.co/storage/v1/object/public/profile-avatars/${uid}/abc-1.jpg`);
assert.equal(lib.profileAvatarUrl(null), null);
assert.equal(lib.profileAvatarUrl('https://tracker.example/pixel.jpg'), null, 'remote URLs never load');
assert.equal(lib.profileAvatarUrl(`${uid}/../x.jpg`), null, 'no path tricks');
assert.equal(lib.profileAvatarUrl(`${uid}/a.png`), null, 'JPEG only, matching the bucket');
assert.equal(lib.isProfileAvatarPath(`${uid}/a.jpg`, uid), true);
assert.equal(lib.isProfileAvatarPath(`${uid}/a.jpg`, '3f2b8c1e-0000-4000-8000-000000000002'), false, 'own folder only');
assert.equal(loadAvatarLib({}).profileAvatarUrl(`${uid}/a.jpg`), null, 'missing config shows the initial');

const fresh = lib.newProfileAvatarPath(uid, 1760000000000, () => 0.123456789);
assert.ok(lib.isProfileAvatarPath(fresh, uid), `generated path matches the DB shape: ${fresh}`);
assert.notEqual(lib.newProfileAvatarPath(uid, 1, () => 0.1), lib.newProfileAvatarPath(uid, 1, () => 0.2), 'never overwrites');

// Same regex as the migration's check constraint and upload gate.
const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261011050000_profile_avatar_upload.sql'), 'utf8');
assert.equal((migration.match(/\^\[0-9a-f-\]\{36\}\/\[A-Za-z0-9_-\]\{1,80\}\\\.jpg\$/g) ?? []).length, 3, 'DB shape check in constraint, trigger and upload gate');
assert.match(src('lib/profile/profileAvatar.ts'), /\[0-9a-f-\]\{36\}\\\/\[A-Za-z0-9_-\]\{1,80\}\\\.jpg\$/, 'app shape matches the DB');

// Avatar: photo when present, initial on missing or failed photo.
const avatar = src('components/ui/avatar.tsx');
assert.match(avatar, /imageUrl\?: string \| null/);
assert.match(avatar, /onError=\{\(\) => setFailedUrl\(photo\)\}/, 'a broken photo falls back to the initial');

// Upload flow: square JPEG, new object first, profile second, old object last.
const upload = src('lib/profile/profileAvatarUpload.ts');
assert.match(upload, /allowsEditing: true, aspect: \[1, 1\]/);
assert.match(upload, /context\.crop\(/, 'web has no crop UI, so the image is center-cropped in code');
assert.match(upload, /format: SaveFormat\.JPEG/);
assert.match(upload, /upsert: false/);
const order = ['bucket.upload(path', ".update({ profile_image_url: path })", 'bucket.remove([previousPath])'].map((needle) => upload.indexOf(needle));
assert.ok(order.every((index) => index > 0) && order[0] < order[1] && order[1] < order[2], 'upload → point → remove old');
assert.match(upload, /await bucket\.remove\(\[path\]\)/, 'a failed save removes the new upload');

// Entry points.
const screen = src('app/settings/profile-photo.tsx');
assert.match(screen, /label=\{path \? '사진 바꾸기' : '사진 등록하기'\}/);
assert.match(screen, /label="프로필 사진 삭제하기"/);
assert.match(screen, /label="닫기"/, 'dialog secondary action follows the 닫기 rule');
assert.doesNotMatch(screen, /·/, 'no middle dot in UI copy');
assert.match(src('app/settings.tsx'), /router\.push\('\/settings\/profile-photo'\)/);
console.log('Profile avatar checks passed.');
