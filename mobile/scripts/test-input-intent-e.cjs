const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const register = read('src/app/pick/new.tsx');
const onboarding = read('src/app/onboarding.tsx');
const home = read('src/app/(tabs)/index.tsx');
const profile = read('src/app/(tabs)/profile.tsx');
const publicProfile = read('src/app/u/[username].tsx');
const username = read('src/app/auth/username.tsx');
const draft = read('src/lib/pick/pickDraftSession.ts');

assert.match(register, /useLocalSearchParams<NewPickParams>/, 'registration state is addressable from the URL');
assert.match(register, /history\.pushState\(\{ onepickStep: next \}/,
  'moving between registration steps creates browser history without remounting the form');
assert.match(register, /addEventListener\?\.\('popstate', onPopState\)/,
  'browser back restores the previous registration step');
assert.match(register, /storeKind/);
assert.match(register, /menuCategoryId/);
assert.match(register, /readPickReviewDraft/);
assert.match(register, /writePickReviewDraft/);
assert.match(register, /clearPickReviewDraft/);
assert.doesNotMatch(register, /AI 평가|AI 취향/, 'registration completion does not expose the deferred AI evaluation');
assert.match(draft, /sessionStorage/, 'one-line review uses session storage instead of URL params');

assert.match(onboarding, /pathname: '\/pick\/new', params: \{ categoryId: current\.id, onboarding: '1' \}/,
  'onboarding enters the Figma 75 registration flow');
assert.match(onboarding, /원픽을 정했어요/);
assert.match(onboarding, /다음 카테고리/);
assert.doesNotMatch(onboarding, /AI 평가 보기|AI 취향 평가/, 'onboarding keeps AI evaluation out of the initial MVP');

assert.match(home, /styles\.progressBanner/);
assert.match(home, /취향 고르기를 이어가세요/);
assert.match(home, /이어서 고르기 ›/);
assert.doesNotMatch(home, /AI 평가 보기|params: \{ ai: '1' \}/, 'home continuation does not reveal the deferred AI evaluation');

assert.match(publicProfile, /action: 'follow_profile'/);
assert.match(publicProfile, /autoFollow=\{follow === '1' && Boolean\(user\)\}/);
assert.match(publicProfile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/);
assert.match(publicProfile, /님을 팔로우했어요/);
assert.match(username, /로그인 완료 · @\{intent\.username\}님 팔로우를 이어서 해요/);
assert.match(profile, /router\.push\('\/onboarding'\)/, 'empty own profile starts onboarding instead of bouncing to home');
assert.match(profile, /OnePickFeatures\.profileAi \? <ProfileAiPanel/, 'profile AI remains behind its existing feature flag');
const choose = read('src/app/pick/choose.tsx');
assert.doesNotMatch(choose, /AI 평가|AI 취향/, 'saved-pick completion does not expose the deferred AI evaluation');

console.log('E intent recovery checks passed: existing-screen continuation, browser history, session draft and follow intent are wired without AI evaluation CTA.');
