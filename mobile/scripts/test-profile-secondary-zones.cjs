const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/profile.tsx'), 'utf8');

const picksIndex = profile.indexOf("profileScope === 'food' ? '음식 원픽' : '다른 취향'");
const managementIndex = profile.indexOf('내 프로필 관리');
const onboardingIndex = profile.indexOf('취향 고르기 이어가기');
const publicIndex = profile.indexOf('공개 프로필 보기');
const adminIndex = profile.indexOf('관리자 데이터 관리');
const activityIndex = profile.indexOf('활동 기록');
const requestIndex = profile.indexOf('내 원픽 등록 요청');
const historyIndex = profile.indexOf('<Text style={styles.activitySectionTitle}>원픽 활동</Text>');

assert.ok(picksIndex >= 0, 'core category picks are missing');
assert.ok(managementIndex > picksIndex, 'profile tools must follow the core profile story');
assert.ok(onboardingIndex > managementIndex, 'taste continuation belongs inside profile tools');
assert.ok(publicIndex > onboardingIndex, 'public profile action belongs inside profile tools');
assert.ok(adminIndex > publicIndex, 'admin tools stay after user-facing profile tools');
assert.equal(activityIndex, -1, 'No operational/history panel');
assert.equal(requestIndex, -1); assert.equal(historyIndex, -1);
assert.doesNotMatch(profile, /useMyItemRequests|useMyPickHistory|showRequests|showHistory/);
assert.doesNotMatch(profile, /onboardingButton/);
assert.doesNotMatch(profile, /publicProfileButton/);
assert.doesNotMatch(profile, /publicProfileTitle/);

console.log('Profile secondary zones checks passed: core profile, profile tools, conditional activity records, and sign-out are visually separated.');
