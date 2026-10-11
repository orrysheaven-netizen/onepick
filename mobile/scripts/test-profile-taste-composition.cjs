const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const service = read('src/services/profileTasteCompositionService.ts');
const component = read('src/components/profile-taste-composition.tsx');
const profile = read('src/app/(tabs)/(profile)/profile.tsx');
const publicProfile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const aiPanel = read('src/components/profile-ai-panel.tsx');
const aiComment = read('src/components/profile-ai-comment.tsx');
const queryKeys = read('src/lib/query/queryKeys.ts');
const invalidation = read('src/lib/query/invalidatePickData.ts');
const overrides = read('src/lib/supabase/database.overrides.ts');

assert.match(service, /supabase\.rpc\('profile_taste_composition',\s*\{\s*p_profile_id:\s*profileId/);
assert.match(overrides, /profile_taste_composition:\s*\{[\s\S]*Args:\s*\{\s*p_profile_id:\s*string\s*\};[\s\S]*Returns:\s*Json/);
assert.match(component, /const MINIMUM_PICKS = 5;/);
assert.match(component, /취향을 모으는 중 · 원픽/);
assert.match(component, /dimension\.percentage\.toFixed\(1\)/);
assert.match(component, /variant\?: 'self' \| 'public'/);
assert.match(aiPanel, /구성 → 해석/);
assert.match(aiPanel, /비율을 점수로 쓰지 않고/);
assert.match(aiPanel, /원픽과 한줄평의 공통점·대비를 직접 읽어요/);
assert.match(aiComment, /sectionDescription\?: string/);
assert.match(aiComment, /구성 → 해석/);
assert.match(queryKeys, /profileTaste:\s*\{/);
assert.match(queryKeys, /composition: \(profileId: string, viewerId\?: string\)/);
assert.match(invalidation, /queryKeys\.profileTaste\.all/);

const actionsIndex = profile.indexOf('<View style={styles.profileActions}>');
const infoIndex = profile.indexOf('<ProfileBioEditor');
const picksIndex = profile.indexOf('profilePicks.map');
const tasteIndex = profile.indexOf('<ProfileTasteComposition');
const aiIndex = profile.indexOf('<ProfileAiPanel');

assert.ok(picksIndex >= 0, 'Primary category Picks are missing');
assert.ok(infoIndex > actionsIndex, 'profile editing opens from 프로필 편집 (#757)');
assert.ok(tasteIndex > picksIndex, 'optional profile tools stay below the primary collection');
assert.ok(aiIndex > tasteIndex, 'gated AI taste evaluation remains retained after taste composition');
assert.match(profile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition profileId=\{profile\.id\} viewerId=\{user\.id\}/);
assert.match(profile, /OnePickFeatures\.profileAi \? <ProfileAiPanel/);

const publicBodyIndex = publicProfile.indexOf('<View style={styles.publicBody}>');
const publicPicksIndex = publicProfile.indexOf('profilePicks.map((item) => <ProfileCurrentPickRow');
const publicInfoIndex = publicProfile.indexOf('<ProfileSocialLinks');
const publicTasteIndex = publicProfile.indexOf('<ProfileTasteComposition');
const publicAiIndex = publicProfile.indexOf('<ProfileAiComment');
const publicSafetyIndex = publicProfile.indexOf('사용자 관리');

assert.ok(publicBodyIndex >= 0, 'public Figma 40 primary body is missing');
assert.ok(publicPicksIndex > publicBodyIndex, 'public category Picks belong inside the Figma 40 primary body');
assert.ok(publicInfoIndex > publicPicksIndex, 'optional public profile info follows the primary collection');
assert.ok(publicTasteIndex > publicInfoIndex, 'public taste composition remains retained after public profile info');
assert.ok(publicAiIndex > publicTasteIndex, 'public AI taste evaluation remains retained after taste composition');
assert.ok(publicSafetyIndex > publicAiIndex, 'public safety controls stay below optional analysis tools');
assert.match(publicProfile, /viewerId=\{user\?\.id\}/);
assert.match(publicProfile, /variant="public"/);
assert.match(publicProfile, /sectionTitle="AI 취향평가"/);
assert.match(publicProfile, /sectionDescription="AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요\."/);
assert.match(publicProfile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(publicProfile, /OnePickFeatures\.profileAi \? <ProfileAiComment/);
assert.match(publicProfile, /useProfileAiComment\(OnePickFeatures\.profileAi \? query\.data\?\.profile\.id : undefined\)/);
assert.match(publicProfile, /aiComment: OnePickFeatures\.profileAi \? \(aiCommentQuery\.data \?\? null\) : null/);

console.log('Profile taste composition regression checks passed for owner/public rollout gates and retained component/service contracts.');
