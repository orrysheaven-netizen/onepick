const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const profile = fs.readFileSync(path.join(__dirname, '../src/app/(tabs)/(profile)/profile.tsx'), 'utf8');

const picksIndex = profile.indexOf('visibleProfilePicks.map');
const managementIndex = profile.indexOf('내 프로필 관리');
const publicIndex = profile.indexOf('공개 프로필 보기');
const adminIndex = profile.indexOf('관리자 데이터 관리');
const activityIndex = profile.indexOf('활동 기록');
const requestIndex = profile.indexOf('내 원픽 등록 요청');
const historyIndex = profile.indexOf('<Text style={styles.activitySectionTitle}>원픽 활동</Text>');

assert.ok(picksIndex >= 0, 'core category picks are missing');
assert.ok(managementIndex > picksIndex, 'profile tools must follow the core profile story');
assert.ok(publicIndex > managementIndex, 'public profile action belongs inside profile tools');
// MVP: taste onboarding is not reachable from the profile (Figma [최종결정] 가입 여정).
assert.doesNotMatch(profile, /'\/onboarding'/, 'the profile must not link to taste onboarding');
assert.ok(adminIndex > publicIndex, 'admin tools stay after user-facing profile tools');
assert.ok(activityIndex > adminIndex, 'activity records must be separated from profile tools');
assert.ok(requestIndex > activityIndex, 'item requests belong inside activity records');
assert.ok(historyIndex > requestIndex, 'pick history follows item requests');

assert.doesNotMatch(profile, /PROFILE TOOLS/);
assert.doesNotMatch(profile, /ACTIVITY/);
assert.match(profile, /showRequests \|\| showHistory \? <View style=\{styles\.activitySection\}>/);
assert.match(profile, /showRequests \? <>/);
assert.match(profile, /showHistory \? <>/);
assert.match(profile, /공개 프로필을 확인하거나 공유해요\./);
assert.match(profile, /managementSection: \{[\s\S]*?marginTop: OnePickSpace\.xxxl,[\s\S]*?paddingTop: OnePickSpace\.xxl,[\s\S]*?borderTopWidth: 1/);
assert.match(profile, /activitySection: \{[\s\S]*?marginTop: OnePickSpace\.xxxl,[\s\S]*?paddingTop: OnePickSpace\.xxl,[\s\S]*?borderTopWidth: 1/);
assert.match(profile, /activitySectionTitle: \{ \.\.\.OnePickType\.headline, color: OnePick\.textPrimary \}/);
assert.match(profile, /signOutArea: \{[\s\S]*?marginTop: OnePickSpace\.xxl,[\s\S]*?paddingTop: OnePickSpace\.lg,[\s\S]*?borderTopWidth: 1/);

assert.doesNotMatch(profile, /onboardingButton/);
assert.doesNotMatch(profile, /publicProfileButton/);
assert.doesNotMatch(profile, /publicProfileTitle/);

console.log('Profile secondary zones checks passed: core profile, profile tools, conditional activity records, and sign-out are visually separated.');
