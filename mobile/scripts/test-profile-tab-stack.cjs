const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const nativeTabs = read('src/components/app-tabs.tsx');
const webTabs = read('src/components/app-tabs.web.tsx');
const profileLayout = read('src/app/(tabs)/(profile)/_layout.tsx');
const ownProfile = 'src/app/(tabs)/(profile)/profile.tsx';
const publicProfile = 'src/app/(tabs)/(profile)/u/[username].tsx';

assert.ok(fs.existsSync(path.join(root, ownProfile)), 'Own profile lives inside the Profile tab stack');
assert.ok(fs.existsSync(path.join(root, publicProfile)), 'Public profile lives inside the Profile tab stack');
assert.equal(fs.existsSync(path.join(root, 'src/app/(tabs)/profile.tsx')), false, 'Old own-profile route is removed');
assert.equal(fs.existsSync(path.join(root, 'src/app/u/[username].tsx')), false, 'Old public-profile Stack route is removed');

assert.match(profileLayout, /<Stack[^>]*screenOptions=\{\{ headerShown: false \}\}/);
assert.match(profileLayout, /<Stack\.Screen name="u\/\[username\]" options=\{\{ gestureEnabled: false \}\} \/>/,
  'Public profile disables native-stack swipe so only the safe edge handler owns the gesture');
assert.doesNotMatch(profileLayout, /initialRouteName|anchor/,
  'Direct public-profile links must not synthesize /profile underneath the deep link');
assert.match(nativeTabs, /<NativeTabs\.Trigger name="\(profile\)"[^>]*listeners=\{\{ tabPress: \(\) => router\.replace\('\/profile'\) \}\}/,
  'Native Profile tab owns the nested Stack and an explicit tab press returns to the own-profile root');
assert.doesNotMatch(nativeTabs, /<NativeTabs\.Trigger name="profile">/);

assert.match(webTabs,
  /href === '\/profile'\) return pathname === '\/profile' \|\| pathname\.startsWith\('\/profile\/'\) \|\| pathname\.startsWith\('\/u\/'\)/,
  'Web public-profile URLs keep the Profile tab selected');

const publicSource = read(publicProfile);
assert.match(publicSource, /router\.replace\('\/profile'\)/,
  'Own public profile can still return to the Profile tab root');

const home = read('src/app/(tabs)/index.tsx');
const dishPeople = read('src/components/dish-people-picks.tsx');
const pickReplies = read('src/components/pick-replies.tsx');
const itemReview = read('src/components/item-review-card.tsx');
const itemDetail = read('src/app/item/[itemId].tsx');

assert.ok(publicSource.includes('const { username, connections, returnTo } = useLocalSearchParams'));
assert.ok(publicSource.includes('const returnHref = profileReturnHref(returnTo)'));
assert.ok(publicSource.includes('useNavigation()'));
assert.ok(!publicSource.includes("navigation.addListener('beforeRemove'"),
  'Native back/swipe stays owned by the native stack');
assert.ok(publicSource.includes('router.dismissTo(returnHref);'),
  'Safe edge swipe restores the validated origin after its own gesture completes');
assert.match(publicSource, /PanResponder\.create/);
assert.match(publicSource, /onStartShouldSetPanResponder: \(\) => false/);
assert.match(publicSource, /gesture\.x0 <= 32[\s\S]*?gesture\.dx > 12/,
  'Native public-profile edge does not swallow taps before horizontal swipe intent');
assert.match(publicSource, /onMoveShouldSetPanResponder/);
assert.match(publicSource, /testID="public-profile-swipe-edge"/);
assert.match(publicSource, /\{Platform\.OS !== 'web' \? \(\s*<View\s+testID="public-profile-swipe-edge"/,
  'Native: the profile owns its edge zone (native-stack swipe is off for this route)');
assert.match(publicSource, /onPanResponderTerminationRequest: \(\) => false/);
assert.match(publicSource, /swipeEdgeZone:[\s\S]*?position: 'absolute'[\s\S]*?zIndex: 100[\s\S]*?width: 32/);
assert.match(publicSource, /if \(gesture\.dx < 72 \|\| gesture\.vx <= 0\) return;\s*swipeBackRef\.current\(\);/);
assert.match(publicSource, /const swipeBack = \(\) => \{\s*if \(connectionDirection\) \{ closeConnections\(\); return; \}/,
  'Follower/following list swipes back to its profile (user decision 2026-10-06)');
assert.match(publicSource, /if \(returnHref\) router\.dismissTo\(returnHref\);[\s\S]*?else goBack\(\);/,
  'Swipe without returnTo follows header back: pop app history, else fall back Home');
assert.match(publicSource, /style=\{styles\.swipeEdgeZone\}[\s\S]*?\.\.\.swipeBackResponder\.panHandlers/);
assert.match(publicSource, /useSwipeBackHandler\(swipeBack, \{ confirmUnsaved: false \}\);/,
  'Web: the root-layout edge runs the profile swipe target while it is focused');

// App-wide web swipe-back (user decision 2026-10-06: every screen with somewhere to go back to).
const rootLayout = read('src/app/_layout.tsx');
const webEdge = read('src/components/swipe-back-edge.web.tsx');
const nativeEdge = read('src/components/swipe-back-edge.tsx');
assert.match(webEdge, /WEB_EDGE_HIT_WIDTH = 8/,
  'Web hit strip stays clear of header back buttons while preserving edge-swipe start');
assert.match(webEdge, /width: WEB_EDGE_HIT_WIDTH/);
const swipeLib = read('src/lib/navigation/swipeBack.ts');
assert.match(rootLayout, /<\/Stack>\s*<SwipeBackEdge \/>/, 'Root layout mounts one edge above every screen');
assert.match(nativeEdge, /return null;/, 'Native keeps the native stack swipe; no global JS edge');
assert.match(webEdge, /const hasRealBackTarget = canPopFocusedStack\(rootState as never\) && router\.canGoBack\(\)/,
  'Web swipe is disabled for cold/deep links with no real previous screen');
assert.match(webEdge, /onPanResponderTerminationRequest: \(\) => false/);
assert.match(webEdge, /touchAction: 'pan-y'/);
assert.match(webEdge, /gesture\.dx < SWIPE_RELEASE_DX \|\| gesture\.vx <= 0/);
assert.match(webEdge, /confirmUnsaved && hasUnsavedTypedText\(\) && !window\.confirm\(UNSAVED_SWIPE_MESSAGE\)/,
  'Leaving with typed text asks first (user decision 2026-10-06)');
assert.match(webEdge, /if \(routerRef\.current\.canGoBack\(\)\) routerRef\.current\.back\(\);/);
assert.match(webEdge, /'\/admin', '\/auth\/callback'/);
assert.match(swipeLib, /SWIPE_EDGE_WIDTH = 32[\s\S]*SWIPE_START_DX = 12[\s\S]*SWIPE_MAX_START_DY = 24[\s\S]*SWIPE_RELEASE_DX = 72/);
assert.match(swipeLib, /node\.type === 'stack' && index > 0/);
assert.match(read('src/app/pick/new.tsx'),
  /useSwipeBackHandler\(goBack, \{ confirmUnsaved: false, hasInternalBackTarget \}\)/,
  'Registration swipes one step back, like the header, only when it has an internal target');
assert.match(webEdge,
  /hasInternalBackTarget = getSwipeBackHandler\(\)\?\.hasInternalBackTarget === true[\s\S]*\(hasInternalBackTarget \|\| hasRealBackTarget\)/,
  'Only a real internal back target can enable web swipe without a router pop target');
assert.match(read('src/app/pick/new.tsx'),
  /providerContextRoot = step === 1 && Boolean\(entryProviderId\)[\s\S]*hasInternalBackTarget = step === 1 \? \(\(!linkEntry && !providerContextRoot\) \|\| requesting\) : step !== 6[\s\S]*useSwipeBackHandler\(goBack, \{ confirmUnsaved: false, hasInternalBackTarget \}\)/,
  'Registration link-first/provider roots stay no-op internally while real fallback states can swipe back');
assert.match(swipeLib,
  /previousInternalTarget[\s\S]*options\?\.hasInternalBackTarget[\s\S]*notify\(\)/,
  'Changing an internal back target notifies the mounted web edge to re-render');
assert.ok(publicSource.includes("router.replace(returnHref ?? '/');"),
  'Cold public-profile links still fall back Home when there is no app history');
assert.match(home, /params: \{ username, returnTo: '\/' \}/,
  'Home -> public profile records Home as the return target');
assert.match(publicSource, /value\.startsWith\('\/auth\/'\)/);
assert.match(publicSource, /value\.startsWith\('\/admin\/'\)/);
assert.match(publicSource, /value\.startsWith\('\/u\/'\)/,
  'Untrusted returnTo cannot bounce through auth/admin/another public profile');
assert.match(dishPeople, /params: \{ username: pick\.username, returnTo \}/);
assert.match(pickReplies, /returnTo: `\/pick\/\$\{pickId\}`/);
assert.match(itemReview, /returnTo: `\/item\/\$\{itemId\}`/);
assert.match(itemDetail, /returnTo: `\/item\/\$\{item\.id\}`/);

const authIntent = read('src/lib/auth/authIntent.ts');
assert.match(authIntent, /case 'follow_profile': return \{ pathname: '\/u\/\[username\]'/,
  'Login-resume follow intent keeps the existing public-profile deep link');

console.log('Profile tab stack checks passed: /profile and /u/:username retain URLs while the bottom tab stays mounted.');
