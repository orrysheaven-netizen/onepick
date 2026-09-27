const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => readFileSync(path.join(root, relative), 'utf8');

const service = read('src/services/profileTasteCompositionService.ts');
const component = read('src/components/profile-taste-composition.tsx');
const profile = read('src/app/(tabs)/profile.tsx');
const publicProfile = read('src/app/u/[username].tsx');
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

const infoIndex = profile.indexOf('<ProfileBioEditor');
const tasteIndex = profile.indexOf('<ProfileTasteComposition');
const aiIndex = profile.indexOf('<ProfileAiPanel');
const picksIndex = profile.indexOf("profileScope === 'food' ? '음식 원픽' : '다른 취향'");

assert.ok(infoIndex >= 0, 'profile info section is missing');
assert.ok(tasteIndex > infoIndex, 'gated taste composition must follow profile info');
assert.ok(aiIndex > tasteIndex, 'gated AI taste evaluation must follow taste composition');
assert.ok(picksIndex > aiIndex, 'category picks must follow gated AI taste evaluation');
assert.match(profile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition profileId=\{profile\.id\} viewerId=\{user\.id\}/);
assert.match(profile, /OnePickFeatures\.profileAi \? <ProfileAiPanel/);

const publicInfoIndex = publicProfile.indexOf('<ProfileSocialLinks');
const publicTasteIndex = publicProfile.indexOf('<ProfileTasteComposition');
const publicAiIndex = publicProfile.indexOf('<ProfileAiComment');
const publicPicksIndex = publicProfile.indexOf("profileScope === 'food' ? '음식 원픽' : '다른 취향'");
const publicSafetyIndex = publicProfile.indexOf('사용자 관리');

assert.ok(publicInfoIndex >= 0, 'public profile info section is missing');
assert.ok(publicTasteIndex > publicInfoIndex, 'public taste composition must follow profile info');
assert.ok(publicAiIndex > publicTasteIndex, 'public AI taste evaluation must follow taste composition');
assert.ok(publicPicksIndex > publicAiIndex, 'public category picks must follow AI taste evaluation');
assert.ok(publicSafetyIndex > publicPicksIndex, 'public safety controls must not interrupt the core profile story');
assert.match(publicProfile, /viewerId=\{user\?\.id\}/);
assert.match(publicProfile, /variant="public"/);
assert.match(publicProfile, /sectionTitle="AI 취향평가"/);
assert.match(publicProfile, /sectionDescription="AI는 공개된 원픽과 한줄평을 직접 읽어 공통점과 대비를 해석한 결과예요\."/);
assert.match(publicProfile, /OnePickFeatures\.tasteComposition \? <ProfileTasteComposition/);
assert.match(publicProfile, /OnePickFeatures\.profileAi \? <ProfileAiComment/);
assert.match(publicProfile, /useProfileAiComment\(OnePickFeatures\.profileAi \? query\.data\?\.profile\.id : undefined\)/);
assert.match(publicProfile, /aiComment: OnePickFeatures\.profileAi \? \(aiCommentQuery\.data \?\? null\) : null/);

console.log('Profile taste composition regression checks passed for owner/public rollout gates and retained component/service contracts.');
