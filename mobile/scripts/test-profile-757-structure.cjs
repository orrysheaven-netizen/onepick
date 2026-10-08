// #757 profile structure (PM confirmed 2026-10-05, user decisions 2026-10-08).
// Replaces the Figma 03 / secondary-zone checks, which described the superseded layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const owner = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const identity = read('src/components/profile-identity.tsx');
const row = read('src/components/profile-current-pick-row.tsx');
const tabs = read('src/components/profile-tabs.tsx');
const records = read('src/components/profile-records.tsx');
const names = read('src/lib/profile/profileName.ts');
const settings = read('src/app/settings.tsx');
const aiComment = read('src/components/profile-ai-comment.tsx');
const avatar = read('src/components/ui/avatar.tsx');
const photo = read('src/components/pick-photo.tsx');

// Shared identity: avatar 64 on the left (user decision 2026-10-08), name, optional handle, stats, bio.
assert.match(identity, /<Avatar name=\{name\} size=\{64\} tone="subtle" \/>/);
assert.match(identity, /name: \{ \.\.\.OnePickType\.pageTitle, color: OnePick\.textPrimary \}/, 'Profile name is Page Title 22');
assert.match(identity, /\{handle \? <Text numberOfLines=\{1\} style=\{styles\.handle\}>\{handle\}<\/Text> : null\}/);
assert.match(identity, /minHeight: MIN_TOUCH_TARGET/, 'Stats keep a 44px touch row');
assert.match(avatar, /type Size = 24 \| 32 \| 40 \| 64 \| 68 \| 72/);
assert.match(photo, /thumb64: \{ width: 64, height: 64, borderRadius: 8 \}/);
for (const source of [owner, publicProfile]) {
  assert.match(source, /<ProfileIdentity/);
  assert.match(source, /profileDisplayName\(/, 'Name goes through the nickname-ready helper');
  assert.match(source, /key: 'picks', label: '원픽'/);
  assert.match(source, /key: 'followers', label: '팔로워'/);
  assert.match(source, /key: 'following', label: '팔로잉'/);
  assert.doesNotMatch(source, /label: '댓글'|statLabel\}>댓글/, 'No 댓글 count on profiles');
  assert.match(source, /visibleProfilePicks\.map\(\(item\) => <ProfileCurrentPickRow/);
  assert.doesNotMatch(source, /minHeight: (724|675)/, 'No fixed-height profile body');
  assert.doesNotMatch(source, /<Chip label="다른 취향"/, 'Chip names are 음식 / 기타 on both profiles');
  assert.match(source, /<Chip label="기타"/);
}

// Nickname-ready names (#804): fall back to the username, no duplicate @username line.
assert.match(names, /return nickname \? nickname : null;/);
assert.match(names, /profileNickname\(profile\) \?\? profile\.username/);
assert.match(names, /profileNickname\(profile\) \? `@\$\{profile\.username\}` : null/);
assert.doesNotMatch(owner, /profile\.nickname|\.nickname\b/, 'Screens read nicknames only through lib/profile/profileName');

// Own profile: settings in the header, 프로필 편집 | 프로필 공유, then 원픽 | 기록 tabs.
const headerIndex = owner.indexOf('<View style={styles.profileHeader}>');
const identityIndex = owner.indexOf('<ProfileIdentity');
const actionsIndex = owner.indexOf('<View style={styles.profileActions}>');
const tabsIndex = owner.indexOf('<ProfileTabs');
const picksIndex = owner.indexOf('visibleProfilePicks.map');
const recordsIndex = owner.indexOf('<ProfileRecords');
assert.ok(headerIndex >= 0 && identityIndex > headerIndex && actionsIndex > identityIndex && tabsIndex > actionsIndex
  && picksIndex > tabsIndex && recordsIndex > picksIndex, 'Header → identity → actions → tabs → 원픽 | 기록');
assert.match(owner, /accessibilityLabel="설정 열기" onPress=\{\(\) => router\.push\('\/settings'\)\}/);
assert.match(owner, /<Button variant="secondary" size="sm" label="프로필 편집"/);
assert.match(owner, /label=\{isSharingProfile \? '공유 중…' : '프로필 공유'\}/);
assert.match(owner, /shareProfile\(\{ username: profile\.username, pickCount: publicMainPicks\.length \}\)/,
  'Owner share uses the same public food-only count as the public profile');
assert.match(owner, /\{profileTab === 'picks' \? <View style=\{styles\.tabBody\}>/, 'Tab row stays even with zero Picks');
assert.match(owner, /hasOpenedEditor \? <View style=\{\[styles\.editor, !isEditingProfile && styles\.hidden\]\}>\s*<ProfileBioEditor/,
  'The editor stays mounted once opened so closing 프로필 편집 keeps an unsaved draft');
assert.match(owner, /hidden: \{ display: 'none' \}/);
assert.match(owner, /const openPublicProfile = \(\) => router\.push\(\{ pathname: '\/u\/\[username\]', params: \{ username: profile\.username, returnTo: '\/profile' \} \}\);/,
  'Own profile keeps a preview of its public view (removal not approved)');
assert.match(owner, /label="공개 프로필 미리 보기"[\s\S]*?onPress=\{openPublicProfile\}/);
const pickDetail = read('src/app/pick/[pickId].tsx');
assert.match(pickDetail, /pathname: '\/item\/\[itemId\]', params: \{ itemId: itemQuery\.data!\.item\.id \}/, 'Pick detail links the menu/item');
assert.match(pickDetail, /itemQuery\.data\.item\.providerId \? <Pressable[\s\S]*?pathname: '\/provider\/\[providerId\]'[\s\S]*?scope: 'provider'/, 'Pick detail links the store when one exists');
assert.match(pickDetail, /linkRow: \{ minHeight: 48/);
assert.match(owner, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(owner, /OnePickFeatures\.profileAi \? <ProfileAiPanel/);
assert.match(owner, /params: \{ username: profile\.username, connections: direction, returnTo: '\/profile' \}/,
  'Own 팔로워/팔로잉 open the follow list and come back to the own profile');
for (const removed of ['내 프로필 관리', '공개 프로필 보기', '관리자 데이터 관리', '활동 기록', 'useMyComments', "'/comments'", 'SignOutButton />\n      </ScrollView>']) {
  assert.ok(!owner.includes(removed), `${removed} left the own profile (#757)`);
}
assert.doesNotMatch(owner, /'\/onboarding'/, 'The profile must not link to taste onboarding');
assert.match(settings, /router\.push\('\/comments'\)[\s\S]*?내가 쓴 댓글/, '내가 쓴 댓글 lives in Settings');
assert.match(settings, /adminAccess\.data === true \? <Pressable[\s\S]*?router\.push\('\/admin\/dashboard'\)[\s\S]*?관리자 데이터 관리/);
assert.match(settings, /<SignOutButton showSettingsLink=\{false\} \/>/, 'Sign-out stays in Settings');

// Tabs: 원픽 | 기록 underline tabs with 44px+ targets; 기록 is owner-only.
assert.match(tabs, /\{ key: 'picks', label: '원픽' \},\s*\{ key: 'records', label: '기록' \}/);
assert.match(tabs, /accessibilityRole="tab" accessibilityState=\{\{ selected \}\}/);
assert.match(tabs, /minHeight: MIN_TOUCH_TARGET \+ 4/);
assert.doesNotMatch(publicProfile, /<ProfileTabs|<ProfileRecords/, 'Public profiles have no tab row and no 기록');
assert.match(records, /const VISIBLE_REQUEST_STATUSES = new Set\(\['pending', 'rejected'\]\);/);
assert.match(records, /label: '반려'/); assert.match(records, /label: '검토 중'/);
assert.match(records, /<Text style=\{styles\.sectionTitle\}>지난 원픽<\/Text>/);

// Pick row (#757): whole row is one button; badge + category line, then name, then review; content height.
assert.match(row, /accessibilityLabel=\{accessibilityLabel\}\s*accessibilityHint="원픽 상세를 열어요"\s*onPress=\{\(\) => onOpenPick\(item\.pick\.id\)\}/);
// Review follow-up: screen readers hear the one-line review and the owner's photo-review notice too.
assert.match(row, /const accessibilityLabel = \[`\$\{label\} 원픽`, item\.pick\.oneLineReview \? `한줄평 \$\{item\.pick\.oneLineReview\}` : null, photoReviewText\]/);
assert.equal((row.match(/<Pressable/g) ?? []).length, 1, 'No nested buttons inside a profile Pick row');
assert.match(row, /\{channel \? <ChannelBadge channel=\{channel\} \/> : null\}\s*\{categoryName \? <Text numberOfLines=\{1\} style=\{styles\.category\}>/);
const metaIndex = row.indexOf('<View style={styles.meta}>');
const nameIndex = row.indexOf('style={styles.name}');
const reviewIndex = row.indexOf('style={styles.review}');
assert.ok(metaIndex >= 0 && nameIndex > metaIndex && reviewIndex > nameIndex);
assert.doesNotMatch(row, /height: (82|94|96)\b/, 'No fixed row or copy height');
assert.match(row, /minHeight: MIN_TOUCH_TARGET/);
assert.doesNotMatch(row, /·|›/, 'No middle dots or glyph chevrons in row copy');

// Public profile: back · name · share header, single follow CTA, no body share card.
assert.match(publicProfile, /<Icon name="back" \/>[\s\S]*?publicHeaderTitle[\s\S]*?accessibilityLabel="프로필 공유"[\s\S]*?<Icon name="share" \/>/);
assert.match(publicProfile, /OnePickFeatures\.profileFollow && !query\.data\.isMine \? <FollowButton/);
assert.doesNotMatch(publicProfile, /styles\.followActions|followShareButton|shareCard|이 취향 컬렉션을 공유해보세요/);
assert.match(publicProfile, /<Button variant="secondary" fullWidth style=\{styles\.joinButton\} label="내 원픽 만들기"/,
  'Logged-out join stays secondary so 팔로우 is the single primary CTA');
const publicHeaderIndex = publicProfile.indexOf('<View style={styles.publicHeader}>');
const publicBodyIndex = publicProfile.indexOf('<View style={styles.publicBody}>');
const publicPicksIndex = publicProfile.indexOf('visibleProfilePicks.map((item) => <ProfileCurrentPickRow');
const publicInfoIndex = publicProfile.indexOf('<ProfileSocialLinks');
const publicTasteIndex = publicProfile.indexOf('<ProfileTasteComposition');
const publicAiIndex = publicProfile.indexOf('<ProfileAiComment');
assert.ok(publicHeaderIndex >= 0 && publicBodyIndex > publicHeaderIndex && publicPicksIndex > publicBodyIndex
  && publicInfoIndex > publicPicksIndex && publicTasteIndex > publicInfoIndex && publicAiIndex > publicTasteIndex,
  'Optional public tools stay below the primary view');
assert.match(publicProfile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(publicProfile, /OnePickFeatures\.profileAi \? <ProfileAiComment/);

assert.match(aiComment, /<SectionHeader title=\{sectionTitle\} \/>/);
assert.match(aiComment, /card: \{ backgroundColor: OnePick\.accentSoft, borderRadius: 20, padding: 16, marginBottom: 18 \}/);

// Runtime: nickname fallback (#804 not shipped yet → username, no handle line).
{
  const ts = require('typescript');
  const vm = require('node:vm');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(names, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, { exports });
  assert.equal(exports.profileDisplayName({ username: 'duck' }), 'duck');
  assert.equal(exports.profileHandle({ username: 'duck' }), null);
  assert.equal(exports.profileDisplayName({ username: 'duck', nickname: '  ' }), 'duck', 'A blank nickname counts as unset');
  assert.equal(exports.profileDisplayName({ username: 'duck', nickname: ' 덕이 ' }), '덕이');
  assert.equal(exports.profileHandle({ username: 'duck', nickname: '덕이' }), '@duck');
}

console.log('#757 profile structure checks passed: shared identity, 원픽 | 기록 tabs, single-button Pick rows, settings moves and the public single follow CTA.');
