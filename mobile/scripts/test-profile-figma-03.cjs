const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/profile.tsx'), 'utf8');
const photo = fs.readFileSync(path.join(__dirname, '../src/components/pick-photo.tsx'), 'utf8');
const avatar = fs.readFileSync(path.join(__dirname, '../src/components/ui/avatar.tsx'), 'utf8');

assert.match(profile, /03|profileHeader/);
assert.match(profile, /<Avatar name=\{displayName\} size=\{72\} tone="subtle" imageUrl=\{profileAvatarUrl\(profile\.profileImageUrl\)\}/);
assert.match(profile, /accessibilityLabel="프로필 사진 바꾸기" onPress=\{\(\) => router\.push\('\/settings\/profile-photo'\)\}/, 'My avatar opens the photo screen (2026-10-11)');
assert.match(profile, /<Chip label="음식"[\s\S]*?visualStyle=\{styles\.profileScopeChip\}/);
assert.match(profile, /<Chip label="기타"[\s\S]*?visualStyle=\{styles\.profileScopeChip\}/);
assert.match(profile, /useMyComments\(listUserId\)/);
assert.match(profile, /<Text style=\{styles\.statLabel\}>원픽<\/Text>/);
assert.match(profile, /<Text style=\{styles\.statLabel\}>댓글<\/Text>/);
assert.match(profile, /<PickPhoto[\s\S]*?size=\{64\}/);
assert.match(profile, /profileBody: \{ minHeight: 724, paddingTop: 10, gap: OnePickSpace\.md \}/);
assert.match(profile, /currentPickRow:[\s\S]*?height: 96/);
assert.match(profile, /currentPickCopy: \{ flex: 1, minWidth: 0, height: 82, gap: 2 \}/);
assert.match(profile, /profileScopeChip: \{ paddingHorizontal: 14 \}/);
assert.match(profile, /currentPickBadge:[\s\S]*?paddingHorizontal: 9/);
assert.doesNotMatch(profile, /Platform\.OS === 'web' \|\| profileQuery\.isRefetchError/, 'healthy web refresh must not occupy the Figma 03 header');
assert.match(profile, /Platform\.OS === 'web' && !profileQuery\.isRefetchError \? <Button variant="ghost" size="sm"/, 'healthy web refresh is preserved below the primary viewport');
assert.doesNotMatch(profile, /<ProfilePickGroups/);

const bodyIndex = profile.indexOf('<View style={styles.profileBody}>');
const managementIndex = profile.indexOf('<View style={styles.managementSection}>');
assert.ok(bodyIndex >= 0 && managementIndex > bodyIndex, 'management utilities must remain below the Figma 03 primary profile body');

assert.match(photo, /size\?: 62 \| 64 \| 86/);
assert.match(photo, /thumb64: \{ width: 64, height: 64, borderRadius: 8 \}/);
assert.match(avatar, /type Size = 24 \| 32 \| 40 \| 64 \| 68 \| 72/);
assert.match(avatar, /tone\?: 'accent' \| 'subtle'/);
assert.match(avatar, /subtle: \{ backgroundColor: OnePick\.bgSubtle \}/);

console.log('Figma 03 Profile checks passed: primary viewport matches the approved profile structure while management remains below it.');
