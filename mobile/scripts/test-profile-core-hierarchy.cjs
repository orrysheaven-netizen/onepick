const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const owner = read('src/app/(tabs)/profile.tsx');
const publicProfile = read('src/app/u/[username].tsx');
const aiComment = read('src/components/profile-ai-comment.tsx');

const headerIndex = owner.indexOf('<View style={styles.header}>');
const refreshIndex = owner.indexOf("'프로필 새로고침'");
const bioIndex = owner.indexOf('<ProfileBioEditor');
const tasteIndex = owner.indexOf('<ProfileTasteComposition');
const aiIndex = owner.indexOf('<ProfileAiPanel');
const picksIndex = owner.indexOf("profileScope === 'food' ? '음식 원픽' : '다른 취향'");

assert.ok(headerIndex >= 0, 'owner profile header is missing');
assert.ok(refreshIndex > headerIndex && refreshIndex < bioIndex, 'error refresh belongs in the profile header, before profile content');
assert.ok(tasteIndex > bioIndex, 'gated taste composition follows profile info');
assert.ok(aiIndex > tasteIndex, 'gated AI follows taste composition');
assert.ok(picksIndex > aiIndex, 'category picks follow gated AI');

assert.doesNotMatch(owner, /<Text style={styles\.summaryLabel}>현재 원픽<\/Text>/);
assert.doesNotMatch(owner, /<Text style={styles\.summaryNumber}>{currentPicks\.length}개<\/Text>/);
assert.doesNotMatch(owner, /불러온 이전 선택/);
assert.doesNotMatch(owner, /summaryDivider/);
assert.doesNotMatch(owner, /refreshButton/);
assert.match(owner, /profileQuery\.isRefetchError \? <Button variant="ghost" size="sm" accessibilityLabel=\{OnePickFeatures\.profileItemRequests \? '프로필과 원픽 등록 요청 상태 새로고침' : '프로필 새로고침'\}/, 'header retry is an errors-only kit text button');
assert.match(owner, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(owner, /OnePickFeatures\.profileAi \? <ProfileAiPanel/);
assert.match(owner, /<SectionHeader title=\{profileScope === 'food' \? '음식 원픽' : '다른 취향'\} count=\{visibleProfilePicks\.length\}/, 'owner collection count follows the selected taste tab');
assert.doesNotMatch(owner, /sectionTitle:/, 'owner profile no longer carries its own section title style');

assert.match(publicProfile, /<Text style={styles\.summaryLabel}>현재 원픽<\/Text><Text style={styles\.summaryNumber}>{mainPicks\.length}개<\/Text>/);
assert.match(publicProfile, /<SectionHeader title=\{profileScope === 'food' \? '음식 원픽' : '다른 취향'\} count=\{visibleProfilePicks\.length\}/, 'public collection uses the same taste-tab section header as the owner profile');
assert.match(publicProfile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(publicProfile, /OnePickFeatures\.profileAi \? <ProfileAiComment/);
assert.doesNotMatch(publicProfile, /sectionTitle:/);

assert.match(aiComment, /<SectionHeader title=\{sectionTitle\} \/>/, 'AI section title uses the same kit header as the collection sections');
assert.doesNotMatch(aiComment, /sectionTitle:/);
assert.match(aiComment, /card: \{ backgroundColor: OnePick\.accentSoft, borderRadius: 20, padding: 16, marginBottom: 18 \}/, 'AI card is an accent-soft card on the shared radius');

console.log('Profile core hierarchy checks passed: error-only header refresh, feature gates, single owner count, and consistent section hierarchy.');
