const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const profile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const username = read('src/app/auth/username.tsx');

// A visitor arriving from a shared link must have a way in that is not "follow this stranger".
const joinIndex = profile.indexOf('styles.joinCard');
assert.ok(joinIndex >= 0, 'the public profile must offer a join call to action');
assert.match(
  profile,
  /\{!user \? <View style=\{styles\.joinCard\}>/,
  'the join call to action must render only for a logged-out visitor',
);
assert.match(
  profile,
  /router\.push\(\{ pathname: '\/auth\/login', params: \{ action: 'join_from_profile' \} \}\)/,
  'the join call to action must carry the join_from_profile intent',
);

// The visitor should read the collection before being asked to sign up.
const picksIndex = profile.indexOf('profilePicks.map((item) => <ProfileCurrentPickRow');
const safetyIndex = profile.indexOf('styles.safetyCard');
assert.ok(picksIndex >= 0, 'the picks must stay on the public profile');
assert.ok(joinIndex > picksIndex, 'the join call to action must follow the category picks');
assert.ok(joinIndex < safetyIndex, 'the join call to action comes before the member-only safety card');
assert.match(profile, /<Button variant="secondary" fullWidth style=\{styles\.joinButton\} label="내 원픽 만들기"/,
  'join stays secondary so the follow CTA is the single primary (#757)');

// A follow is a resumable action: login/username creation returns to the same profile
// and the app performs the follow without requiring a second tap.
assert.match(profile, /action: 'follow_profile'/, 'the shared profile must preserve a dedicated follow intent');
assert.match(profile, /armFollowProfileIntent\(targetUsername\)/, 'an explicit provider tap arms the one-time continuation');
assert.match(profile, /consumeFollowProfileIntent\(username\)/, 'the returned profile consumes the continuation once');
assert.match(profile, /autoFollow=\{autoFollow && Boolean\(user\)\}/, 'only the consumed continuation may automatically resume the follow');
assert.doesNotMatch(profile, /follow === '1'/, 'a crafted/shareable URL must not trigger auto-follow');
assert.match(profile, /로그인하면 바로 팔로우되고 이 프로필로 돌아와요/, 'the login sheet must explain the preserved intent');
assert.doesNotMatch(
  username,
  /const ONBOARDING_INTENTS = new Set<AuthIntent\['action'\]>\(\[[^\]]*'follow_profile'/,
  'a pending follow must not be diverted to onboarding after username creation',
);

// MVP sign-up (Figma [최종결정] 가입 여정): every intent, join_from_profile included, returns
// to the original task after the username step instead of entering taste onboarding.
assert.doesNotMatch(username, /'\/onboarding'/, 'username creation must not divert to taste onboarding');
assert.match(username, /router\.replace\(getPostAuthRoute\(intent\)\)/, 'username creation returns to the original task');

console.log('Public profile join checks passed: a logged-out visitor gets a sign-up entry after the picks, and a new account from it returns to the feed without onboarding.');
