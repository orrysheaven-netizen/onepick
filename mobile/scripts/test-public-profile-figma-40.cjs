const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

const profile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const follow = read('src/components/follow-button.tsx');
const photo = read('src/components/pick-photo.tsx');
const avatar = read('src/components/ui/avatar.tsx');

assert.match(profile, /<View style=\{styles\.publicHeader\}>/);
assert.match(profile, /<View style=\{styles\.publicBody\}>/);
assert.match(profile, /publicBody: \{ minHeight: 675, paddingTop: 10, gap: OnePickSpace\.md \}/);
assert.match(profile, /<Avatar name=\{query\.data\.profile\.username\} size=\{68\} tone="subtle" \/>/);
assert.match(profile, /<View style=\{styles\.followActions\}>[\s\S]*?<FollowButton[\s\S]*?fullWidth \/>[\s\S]*?<Button[\s\S]*?variant="secondary"[\s\S]*?label="공유"/,
  'Figma 40 keeps Follow/Following and Share in one core action row');
assert.match(profile, /<Chip label="음식"/);
assert.match(profile, /<Chip label="기타"/, 'Same tab name as my profile (Figma 68-1)');
assert.match(profile, /profileScopeChip: \{ paddingHorizontal: 13 \}/);
assert.match(profile, /visibleProfilePicks\.map\(\(item\) => <PublicProfilePickRow/);
assert.match(profile, /publicPickRow:[\s\S]*?height: 94/);
assert.match(profile, /publicPickCopy: \{ flex: 1, minWidth: 0, height: 82, gap: 3 \}/);
assert.match(profile, /<PickPhoto[\s\S]*?size=\{62\}/);
assert.match(profile, /publicPickBadge:[\s\S]*?paddingHorizontal: 9[\s\S]*?borderRadius: OnePickRadius\.full/);
assert.doesNotMatch(profile, /<ProfilePickGroups/);
assert.doesNotMatch(profile, /<SectionHeader/);
assert.doesNotMatch(profile, /summaryCard/);

const bodyIndex = profile.indexOf('<View style={styles.publicBody}>');
const joinIndex = profile.indexOf('styles.joinCard');
const safetyIndex = profile.indexOf('styles.safetyCard');
assert.ok(bodyIndex >= 0, 'Figma 40 public body must exist');
assert.ok(joinIndex > bodyIndex, 'logged-out join CTA stays below the primary Figma 40 body');
assert.ok(safetyIndex > bodyIndex, 'safety controls stay below the primary Figma 40 body');
assert.doesNotMatch(profile, /styles\.shareCard|프로필 공유하기/, 'Share lives only beside 팔로우 (Figma 40)');

assert.match(profile, /action: 'follow_profile'/);
assert.match(profile, /OnePickFeatures\.profileFollow && !query\.data\.isMine/);
assert.match(profile, /autoFollow=\{autoFollow && Boolean\(user\)\}/);
assert.match(profile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/);
assert.match(profile, /<ReportAction/);
assert.match(profile, /<BlockUserButton/);
assert.doesNotMatch(profile, /publicHeaderMenu/, 'The header has no share action (Figma 40-1)');
assert.match(profile, /<Text style=\{styles\.publicHeaderBackGlyph\}>‹<\/Text>/, 'The header shows ‹');
assert.match(profile, /accessibilityLabel="프로필 공유"/);
assert.match(profile, /followShareButton: \{ width: 67 \}/);

assert.match(follow, /fullWidth\?: boolean/);
assert.match(follow, /buttonFullWidth: \{ width: '100%', height: 52, minHeight: 52/);
assert.match(follow, /setConfirmingUnfollow\(true\)/, '팔로잉 press opens a confirmation state');
assert.match(follow, />팔로우 취소<\/Text>/, 'confirmation exposes an explicit unfollow action');
assert.match(follow, /accessibilityLabel="팔로우 취소하지 않기"/, 'confirmation exposes a cancel action');
assert.match(photo, /size\?: 62 \| 64 \| 86/);
assert.match(photo, /thumb62: \{ width: 62, height: 62, borderRadius: 12 \}/);
assert.match(avatar, /type Size = 24 \| 32 \| 40 \| 64 \| 68 \| 72/);

console.log('Figma 40 public profile checks passed: primary identity/follow/tabs/rows match the approved structure while join, safety and follow-resume contracts stay retained below it.');
