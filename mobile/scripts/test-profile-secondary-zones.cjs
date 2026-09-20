const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/profile.tsx'), 'utf8');

const picksIndex = profile.indexOf('카테고리별 원픽');
const managementIndex = profile.indexOf('내 프로필 관리');
const onboardingIndex = profile.indexOf('취향 고르기 이어가기');
const publicIndex = profile.indexOf('공개 프로필 보기');
const adminIndex = profile.indexOf('관리자 데이터 관리');
const activityIndex = profile.indexOf('활동 기록');
const requestIndex = profile.indexOf('내 제품 등록 요청');
const historyIndex = profile.indexOf('<Text style={styles.activitySectionTitle}>이전 원픽 기록</Text>');

assert.ok(picksIndex >= 0, 'core category picks are missing');
assert.ok(managementIndex > picksIndex, 'profile tools must follow the core profile story');
assert.ok(onboardingIndex > managementIndex, 'taste continuation belongs inside profile tools');
assert.ok(publicIndex > onboardingIndex, 'public profile action belongs inside profile tools');
assert.ok(adminIndex > publicIndex, 'admin tools stay after user-facing profile tools');
assert.ok(activityIndex > adminIndex, 'activity records must be separated from profile tools');
assert.ok(requestIndex > activityIndex, 'item requests belong inside activity records');
assert.ok(historyIndex > requestIndex, 'pick history follows item requests');

assert.match(profile, /PROFILE TOOLS/);
assert.match(profile, /ACTIVITY/);
assert.match(profile, /managementSection: \{ marginTop: 30, paddingTop: 22, borderTopWidth: 1/);
assert.match(profile, /activitySection: \{ marginTop: 30, paddingTop: 22, borderTopWidth: 1/);
assert.match(profile, /activitySectionTitle: \{ color: '#202124', fontSize: 15, fontWeight: '800' \}/);
assert.match(profile, /signOutArea: \{ marginTop: 26, paddingTop: 18, borderTopWidth: 1/);

assert.doesNotMatch(profile, /onboardingButton/);
assert.doesNotMatch(profile, /publicProfileButton/);
assert.doesNotMatch(profile, /publicProfileTitle/);

console.log('Profile secondary zones checks passed: core profile, profile tools, activity records, and sign-out are visually separated.');
