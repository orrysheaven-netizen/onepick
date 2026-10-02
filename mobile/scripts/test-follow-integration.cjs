const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const profile = read('src/app/(tabs)/(profile)/u/[username].tsx');
const constants = read('src/constants/onepick.ts');
const safety = read('src/hooks/useSafety.ts');
const follow = read('src/components/follow-button.tsx');
const connections = read('src/components/follow-connections-view.tsx');

assert.match(constants, /profileFollowConnections: true/,
  'Public follow counts/list use their own approved exposure gate');
assert.match(constants, /followCounts: false/,
  'Legacy own-profile counts remain independently hidden');

assert.match(profile, /useLocalSearchParams<\{ username\?: string; connections\?: string \}>/);
assert.match(profile, /usePublicFollowCounts\([\s\S]*?query\.data\?\.profile\.id[\s\S]*?user\?\.id \?\? null/);
assert.match(profile, /connections === 'followers' \|\| connections === 'following'/);
assert.match(profile, /const publicPickCount = publicMainPicks\.length \+ labPicks\.length/);
assert.match(profile, /원픽 \{publicPickCount\}/);
assert.doesNotMatch(profile, /원픽 \{query\.data\.currentPicks\.length\}/,
  'Hidden FOOD online/recipe Picks must not inflate the public profile count');
assert.match(profile, /팔로워 \{publicFollowCounts\.data\?\.followerCount \?\? '—'\}/);
assert.match(profile, /팔로잉 \{publicFollowCounts\.data\?\.followingCount \?\? '—'\}/);
assert.match(profile, /onPress=\{\(\) => openConnections\('followers'\)\}/);
assert.match(profile, /onPress=\{\(\) => openConnections\('following'\)\}/);

assert.match(profile, /pathname: '\/u\/\[username\]'[\s\S]*?connections: direction/,
  '40 → 41 keeps the canonical public-profile URL and adds relationship state only');
assert.match(profile, /query\.data && OnePickFeatures\.profileFollowConnections && connectionDirection[\s\S]*?<FollowConnectionsView/);
assert.match(profile, /initialDirection=\{connectionDirection\}/);
assert.match(profile, /onBack=\{closeConnections\}/);
assert.match(profile, /router\.replace\(\{ pathname: '\/u\/\[username\]'[\s\S]*?username: query\.data\.profile\.username/,
  'Direct connection deep links fall back to the owner profile, not Home');
assert.match(profile, /onOpenProfile=\{\(targetUsername\) => router\.push\(\{ pathname: '\/u\/\[username\]'/,
  'Tapping a connection opens that user profile');

assert.match(profile, /const \[loginTargetUsername, setLoginTargetUsername\] = useState<string \| null>\(null\)/);
assert.match(profile, /onRequireLogin=\{openFollowLogin\}/,
  'Signed-out connection-row Follow reuses the profile login handoff');
assert.match(profile, /const targetUsername = loginTargetUsername \?\? query\.data\.profile\.username/);
assert.match(profile, /armFollowProfileIntent\(targetUsername\)/);
assert.match(profile, /router\.replace\(getPostAuthRoute\(intent, !result\.profile\)\)/);

assert.match(connections, /usePublicFollowCounts\(profileId, viewerUserId \?\? null\)/);
assert.match(connections, /useFollowConnections\(profileId, direction, viewerUserId \?\? null\)/);
assert.match(connections, /viewerUserId !== item\.userId/);
assert.match(connections, /initialFollowing=\{item\.viewerIsFollowing\}/);
assert.match(connections, /item\.bio \?/);

assert.match(safety, /invalidateQueries\(\{ queryKey: queryKeys\.follows\.all \}\)/,
  'Block/unblock invalidates public follow count/list visibility caches');

assert.match(follow, /const isSelf = viewerUserId === profileUserId/);
assert.match(follow, /if \(isSelf\) return null/);
assert.ok(
  follow.indexOf('const [confirmingUnfollow') < follow.indexOf('if (isSelf) return null'),
  'Hooks remain unconditional before the self-row early return',
);
assert.match(follow, /setConfirmingUnfollow\(true\)/);
assert.match(follow, />팔로우 취소<\/Text>/);

console.log('Follow integration checks passed: public counts, 41 list state, login resume, block invalidation and confirmed unfollow.');
