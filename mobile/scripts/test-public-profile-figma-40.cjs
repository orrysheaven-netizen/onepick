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
assert.match(profile, /publicBody: \{ paddingTop: OnePickSpace\.sm, gap: OnePickSpace\.lg \}/, '#757: no fixed-height public body');
assert.match(profile, /<ProfileIdentity\s+name=\{profileDisplayName\(query\.data\.profile\)\}\s+handle=\{profileHandle\(query\.data\.profile\)\}/,
  'Figma 40-1: avatar 64 + nickname-ready name + @handle once a nickname exists');
assert.match(profile, /OnePickFeatures\.profileFollow && !query\.data\.isMine \? <FollowButton[\s\S]*?fullWidth \/> : null\}/,
  '#757: Follow/Following is the single primary CTA; share lives in the header');
assert.doesNotMatch(profile, /followActions|followShareButton|label="공유"/);
assert.match(profile, /<Chip label="음식"/);
assert.match(profile, /<Chip label="기타"/);
assert.match(profile, /profileScopeChip: \{ paddingHorizontal: 13 \}/);
assert.match(profile, /visibleProfilePicks\.map\(\(item\) => <ProfileCurrentPickRow/);
assert.doesNotMatch(profile, /publicPickRow:|publicPickCopy:|publicPickBadge/, 'Rows come from the shared component');
assert.doesNotMatch(profile, /<ProfilePickGroups/);
assert.doesNotMatch(profile, /<SectionHeader/);
assert.doesNotMatch(profile, /summaryCard|shareCard/);

const bodyIndex = profile.indexOf('<View style={styles.publicBody}>');
const joinIndex = profile.indexOf('styles.joinCard');
const safetyIndex = profile.indexOf('styles.safetyCard');
assert.ok(bodyIndex >= 0, 'Figma 40 public body must exist');
assert.ok(joinIndex > bodyIndex, 'logged-out join CTA stays below the primary Figma 40 body');
assert.ok(safetyIndex > bodyIndex, 'safety controls stay below the primary Figma 40 body');

assert.match(profile, /action: 'follow_profile'/);
assert.match(profile, /OnePickFeatures\.profileFollow && !query\.data\.isMine/);
assert.match(profile, /autoFollow=\{autoFollow && Boolean\(user\)\}/);
assert.match(profile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/);
assert.match(profile, /<ReportAction/);
assert.match(profile, /<BlockUserButton/);
assert.match(profile, /accessibilityLabel="프로필 공유" disabled=\{isSharing\}[\s\S]*?<Icon name="share" \/>/, 'Header share is the shared 24px icon');

assert.match(follow, /fullWidth\?: boolean/);
assert.match(follow, /buttonFullWidth: \{ width: '100%', height: 52, minHeight: 52/);
assert.match(follow, /setConfirmingUnfollow\(true\)/, '팔로잉 press opens a confirmation state');
assert.match(follow, />팔로우 취소<\/Text>/, 'confirmation exposes an explicit unfollow action');
assert.match(follow, /accessibilityLabel="팔로우 취소 확인 닫기"/, 'confirmation exposes a cancel action');
assert.match(photo, /size\?: 62 \| 64 \| 86/);
assert.match(avatar, /type Size = 24 \| 32 \| 40 \| 64 \| 68 \| 72/);

console.log('Figma 40 public profile checks passed: #757 identity, single follow CTA, header share and shared rows, with join, safety and follow-resume contracts retained below.');
