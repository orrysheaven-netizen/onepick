const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../src/app/settings.tsx'), 'utf8');
const signOut = fs.readFileSync(path.join(__dirname, '../src/components/sign-out-button.tsx'), 'utf8');
const blockedScreen = fs.readFileSync(path.join(__dirname, '../src/app/blocked-users.tsx'), 'utf8');
const confirm = fs.readFileSync(path.join(__dirname, '../src/lib/confirmAction.ts'), 'utf8');

assert.match(source, /OnePickType\.pageTitle/, 'settings must use the shared type scale');
assert.match(source, /OnePickSpace\.gutter/, 'settings must use the shared 16px gutter');
assert.match(source, /OnePick\.borderDefault/, 'settings must use semantic borders');
assert.match(source, /trackColor=\{\{ true: OnePick\.actionPrimary, false: OnePick\.borderDefault \}\}/, 'switch must use semantic action/border roles');
assert.match(source, /useDeleteAccount/, 'account deletion behavior must remain intact');
assert.match(blockedScreen, /useBlockedUsers/, 'blocked-user behavior must remain intact');
// Figma 68-2: ‹ 설정 header, 알림 · 안전 및 안내 · 계정 rows; blocked users open their own screen (68-3/68-4).
for (const label of ['안전 및 안내', '차단한 사용자', '개인정보 YouTube API 안내', 'YouTube API 이용조건', '모든 기기에서 로그아웃', '계정 삭제']) {
  assert.ok(source.includes(label), `settings row ${label}`);
}
assert.match(source, /router\.push\('\/blocked-users'\)/, '차단한 사용자 opens the blocked-users screen');
assert.match(source, /confirmAction\('모든 기기에서 로그아웃할까요\?'/, 'sign-out asks once before running');
assert.match(source, /confirmAction\(\s*'계정을 삭제할까요\?'[\s\S]*되돌릴 수 없습니다/, 'account deletion asks once and says it cannot be undone');
assert.match(source, /if \(!confirmed\) return;\s*try \{\s*await deleteAccount\.mutateAsync\(\)/, 'deletion runs only after confirmation');
assert.match(confirm, /Platform\.OS === 'web'[\s\S]*window\.confirm/, 'web confirmation uses the browser dialog (Alert.alert is a no-op there)');
assert.match(blockedScreen, /setToast\(`\$\{name\} 차단을 해제했어요\.`\)/, 'unblock shows the 68-3 toast');
assert.ok(blockedScreen.includes('차단을 해제해도 팔로우는 다시 연결되지 않아요.'), 'follow is not restored note');
assert.ok(blockedScreen.includes('차단한 사용자가 없어요.') && blockedScreen.includes('다른 사용자의 프로필에서 차단하면 여기에서 해제할 수 있어요.'), '68-4 empty state');
assert.doesNotMatch(source, /fontWeight:\s*['"](?:800|900)['"]/, 'settings must not use 800/900 weights');

console.log('Settings Foundations checks passed: visual tokens changed without changing account/safety behavior.');

assert.doesNotMatch(source, /SignOutButton/, 'settings shows sign-out as its own row, not the profile button stack');
assert.match(signOut, /showSettingsLink \? <Pressable[\s\S]*router\.push\('\/settings'\)/, 'other screens may still expose the settings shortcut');
