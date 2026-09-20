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
const refreshIndex = owner.indexOf('accessibilityLabel="프로필과 제품 등록 요청 상태 새로고침"');
const bioIndex = owner.indexOf('<ProfileBioEditor');
const tasteIndex = owner.indexOf('<ProfileTasteComposition');
const aiIndex = owner.indexOf('<ProfileAiPanel');
const picksIndex = owner.indexOf('카테고리별 원픽');

assert.ok(headerIndex >= 0, 'owner profile header is missing');
assert.ok(refreshIndex > headerIndex && refreshIndex < bioIndex, 'refresh belongs in the profile header, before profile content');
assert.ok(tasteIndex > bioIndex, 'taste composition follows profile info');
assert.ok(aiIndex > tasteIndex, 'AI follows taste composition');
assert.ok(picksIndex > aiIndex, 'category picks follow AI');

assert.match(owner, /<Text style={styles\.summaryLabel}>현재 원픽<\/Text>/);
assert.match(owner, /<Text style={styles\.summaryNumber}>{currentPicks\.length}개<\/Text>/);
assert.doesNotMatch(owner, /불러온 이전 선택/);
assert.doesNotMatch(owner, /summaryDivider/);
assert.doesNotMatch(owner, /refreshButton/);
assert.match(owner, /<Button variant="ghost" size="sm" accessibilityLabel="프로필과 제품 등록 요청 상태 새로고침"/, 'header refresh is a quiet kit text button');
assert.match(owner, /<SectionHeader title="카테고리별 원픽" count=\{currentPicks\.length\}/, 'owner collection uses the kit section header (title scale)');
assert.doesNotMatch(owner, /sectionTitle:/, 'owner profile no longer carries its own section title style');

assert.match(publicProfile, /<Text style={styles\.summaryLabel}>현재 원픽<\/Text><Text style={styles\.summaryNumber}>{query\.data\.currentPicks\.length}개<\/Text>/);
assert.match(publicProfile, /sectionTitle: \{ color: OnePick\.text, fontSize: 19, fontWeight: '900' \}/);

assert.match(aiComment, /sectionTitle: \{ color: OnePick\.text, fontSize: 19, fontWeight: '900' \}/);
assert.match(aiComment, /borderRadius: 18, padding: 16, marginBottom: 18/);

console.log('Profile core hierarchy checks passed: header refresh, focused summary, and consistent section hierarchy.');
