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
assert.match(profile, /<Avatar name=\{profileDisplayName\(query\.data\.profile\)\} size=\{68\} tone="subtle" imageUrl=\{profileAvatarUrl\(query\.data\.profile\.profileImageUrl\)\} \/>/);
assert.match(profile, /<View style=\{styles\.followActions\}>[\s\S]*?<FollowButton[\s\S]*?fullWidth \/>[\s\S]*?<Button[\s\S]*?variant="secondary"[\s\S]*?label="공유"/,
  'Figma 40 keeps Follow/Following and Share in one core action row');
assert.match(profile, /<Chip label="음식"/);
assert.match(profile, /<Chip label="다른 취향"/);
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
const shareIndex = profile.indexOf('styles.shareCard');
assert.ok(bodyIndex >= 0, 'Figma 40 public body must exist');
assert.ok(joinIndex > bodyIndex, 'logged-out join CTA stays below the primary Figma 40 body');
assert.ok(safetyIndex > bodyIndex, 'safety controls stay below the primary Figma 40 body');
assert.ok(shareIndex > bodyIndex, 'share card stays below the primary Figma 40 body');

assert.match(profile, /action: 'follow_profile'/);
assert.match(profile, /OnePickFeatures\.profileFollow && !query\.data\.isMine/);
assert.match(profile, /autoFollow=\{autoFollow && Boolean\(user\)\}/);
assert.match(profile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/);
assert.match(profile, /<ReportAction/);
assert.match(profile, /<BlockUserButton/);
assert.match(profile, /<Text style=\{styles\.publicHeaderMenu\}>공유<\/Text>/);
assert.match(profile, /accessibilityLabel="프로필 공유"/);
assert.match(profile, /followShareButton: \{ width: 67 \}/);

assert.match(follow, /fullWidth\?: boolean/);
assert.match(follow, /buttonFullWidth: \{ width: '100%', height: 52, minHeight: 52/);
assert.match(follow, /setConfirmingUnfollow\(true\)/, '팔로잉 press opens a confirmation state');
assert.match(follow, />팔로우 취소<\/Text>/, 'confirmation exposes an explicit unfollow action');
assert.match(follow, /accessibilityLabel="팔로우 취소 확인 닫기"/, 'confirmation exposes a cancel action');
assert.match(photo, /size\?: 62 \| 64 \| 86/);
assert.match(photo, /thumb62: \{ width: 62, height: 62, borderRadius: 12 \}/);
assert.match(avatar, /type Size = 24 \| 32 \| 40 \| 64 \| 68 \| 72/);

console.log('Figma 40 public profile checks passed: primary identity/follow/tabs/rows match the approved structure while join, safety, share and follow-resume contracts stay retained below it.');
