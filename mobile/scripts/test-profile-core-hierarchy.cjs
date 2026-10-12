const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const owner = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const aiComment = read('src/components/profile-ai-comment.tsx');

const headerIndex = owner.indexOf('<View style={styles.profileHeader}>');
const primaryIndex = owner.indexOf('<View style={styles.profileBody}>');
const identityIndex = owner.indexOf('<View style={styles.identity}>');
const picksIndex = owner.indexOf('visibleProfilePicks.map');
const managementIndex = owner.indexOf('<View style={styles.managementSection}>');
const bioIndex = owner.indexOf('<ProfileBioEditor');
const tasteIndex = owner.indexOf('<ProfileTasteComposition');
const aiIndex = owner.indexOf('<ProfileAiPanel');

assert.ok(headerIndex >= 0, 'owner Figma 03 profile header is missing');
assert.ok(primaryIndex > headerIndex, 'Figma 03 primary profile body follows the header');
assert.ok(identityIndex > primaryIndex, 'identity and stats belong at the start of the primary profile body');
assert.ok(picksIndex > identityIndex, 'current Picks follow identity, bio and taste chips');
assert.ok(managementIndex > picksIndex, 'management utilities stay below the Figma 03 primary profile story');
assert.ok(bioIndex > headerIndex && bioIndex < primaryIndex, 'bio editing is available from the compact header menu');
assert.ok(tasteIndex > bioIndex, 'gated taste composition remains retained after profile editing');
assert.ok(aiIndex > tasteIndex, 'gated AI remains retained after taste composition');

assert.doesNotMatch(owner, /<Text style={styles\.summaryLabel}>현재 원픽<\/Text>/);
assert.doesNotMatch(owner, /<Text style={styles\.summaryNumber}>{currentPicks\.length}개<\/Text>/);
assert.doesNotMatch(owner, /불러온 이전 선택/);
assert.doesNotMatch(owner, /summaryDivider/);
assert.doesNotMatch(owner, /refreshButton/);
assert.match(owner, /profileQuery\.isRefetchError \? <Button variant="ghost" size="sm"/, 'header retry remains an error-only kit text button');
assert.match(owner, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(owner, /OnePickFeatures\.profileAi \? <ProfileAiPanel/);
assert.match(owner, /<Text style={styles\.statNumber}>{currentPicks\.length}<\/Text>/, 'Figma 03 owner count uses the complete current Pick collection');
assert.match(owner, /<Chip label="음식"/);
assert.match(owner, /<Chip label="기타"/);
assert.match(owner, /visibleProfilePicks\.map\(\(item\) => <ProfileCurrentPickRow/, 'Figma 03 collection is a direct row list');
assert.doesNotMatch(owner, /sectionTitle:/, 'owner profile no longer carries its own section title style');
assert.match(owner, /shareProfile\(\{ username: profile\.username, pickCount: publicMainPicks\.length \}\)/, 'owner profile share uses the same public food-only count as the public profile');

const publicHeaderIndex = publicProfile.indexOf('<View style={styles.publicHeader}>');
const publicBodyIndex = publicProfile.indexOf('<View style={styles.publicBody}>');
const publicPicksIndex = publicProfile.indexOf('visibleProfilePicks.map((item) => <PublicProfilePickRow');
const publicInfoIndex = publicProfile.indexOf('<ProfileSocialLinks');
const publicTasteIndex = publicProfile.indexOf('<ProfileTasteComposition');
const publicAiIndex = publicProfile.indexOf('<ProfileAiComment');

assert.ok(publicHeaderIndex >= 0, 'public Figma 40 header is missing');
assert.ok(publicBodyIndex > publicHeaderIndex, 'public Figma 40 body follows the header');
assert.ok(publicPicksIndex > publicBodyIndex, 'public Figma 40 uses direct current-Pick rows');
assert.ok(publicInfoIndex > publicPicksIndex, 'optional public profile tools stay below the Figma 40 primary view');
assert.ok(publicTasteIndex > publicInfoIndex, 'public taste composition remains retained after the primary view');
assert.ok(publicAiIndex > publicTasteIndex, 'public AI remains retained after taste composition');
assert.match(publicProfile, /<Chip label="음식"/);
assert.match(publicProfile, /<Chip label="다른 취향"/);
assert.match(publicProfile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(publicProfile, /OnePickFeatures\.profileAi \? <ProfileAiComment/);
assert.doesNotMatch(publicProfile, /<SectionHeader/);
assert.doesNotMatch(publicProfile, /summaryCard/);

assert.match(aiComment, /<SectionHeader title=\{sectionTitle\} \/>/, 'AI section title uses the same kit header as the collection sections');
assert.doesNotMatch(aiComment, /sectionTitle:/);
assert.match(aiComment, /card: \{ backgroundColor: OnePick\.accentSoft, borderRadius: 20, padding: 16, marginBottom: 18 \}/, 'AI card is an accent-soft card on the shared radius');

console.log('Profile core hierarchy checks passed: Figma 03 owner and Figma 40 public primary views lead, with optional tools retained below.');
