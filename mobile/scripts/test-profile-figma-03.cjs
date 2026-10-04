const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/profile.tsx'), 'utf8');
const photo = fs.readFileSync(path.join(__dirname, '../src/components/pick-photo.tsx'), 'utf8');
const avatar = fs.readFileSync(path.join(__dirname, '../src/components/ui/avatar.tsx'), 'utf8');

// Figma 68-1 (10-04): no header row; ID beside a 64 profile image, 설정 top-right, no nickname line.
assert.doesNotMatch(profile, /styles\.profileHeader/);
assert.match(profile, /<Avatar name=\{profile\.username\} size=\{64\} tone="subtle" \/>/);
assert.match(profile, /<Text numberOfLines=\{1\} style=\{styles\.identityName\}>\{profile\.username\}<\/Text>/);
assert.match(profile, /accessibilityLabel="설정 열기"[\s\S]*?<Text style=\{styles\.settingsText\}>설정<\/Text>/);
assert.doesNotMatch(profile, /displayName|bioName/, 'There is no nickname, so the ID is not repeated as a name line');
assert.match(profile, /<Chip label="음식"[\s\S]*?visualStyle=\{styles\.profileScopeChip\}/);
assert.match(profile, /<Chip label="기타"[\s\S]*?visualStyle=\{styles\.profileScopeChip\}/);
assert.match(profile, /useMyComments\(listUserId\)/);
assert.match(profile, /<Text style=\{styles\.statLabel\}>원픽 <Text style=\{styles\.statNumber\}>\{currentPicks\.length\}<\/Text><\/Text>/);
assert.match(profile, /<Text style=\{styles\.statLabel\}>댓글 <Text style=\{styles\.statNumber\}>\{commentCountLabel\} ›<\/Text><\/Text>/);
// Row ⋯ → 한줄평 수정 / 원픽 해제 through the shared management panel.
assert.match(profile, /accessibilityLabel=\{`\$\{title\} 원픽 관리`\}/);
assert.match(profile, />한줄평 수정</);
assert.match(profile, />원픽 해제</);
assert.match(profile, /<PickManagement pick=\{item\.pick\}/);
assert.match(profile, /<PickPhoto[\s\S]*?size=\{64\}/);
assert.match(profile, /profileBody: \{ minHeight: 724, paddingTop: OnePickSpace\.lg, gap: OnePickSpace\.lg \}/);
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
