// Guards #290: the root layout is in the chunk every web route loads, so the
// splash overlay it imports must not drag react-native-reanimated/worklets
// into the web initial path. Native keeps the animated splash.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const importsOf = (source) => [...source.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);

const layout = read('src/app/_layout.tsx');
assert.ok(importsOf(layout).includes('@/components/splash-overlay'), 'Root layout imports the platform-split splash overlay');
assert.ok(!importsOf(layout).includes('@/components/animated-icon'),
  'Root layout must not import animated-icon: its web variant statically imports react-native-reanimated');

const web = read('src/components/splash-overlay.web.tsx');
for (const specifier of importsOf(web)) {
  assert.doesNotMatch(specifier, /react-native-(reanimated|worklets)|animated-icon/,
    'Web splash overlay must stay free of animation runtimes: ' + specifier);
}
assert.match(web, /export function AnimatedSplashOverlay\(\)\s*\{\s*return null;\s*\}/, 'Web has no native splash to fade out');

const native = read('src/components/splash-overlay.tsx');
assert.match(native, /export function AnimatedSplashOverlay\(\)/);
assert.ok(importsOf(native).includes('react-native-reanimated'), 'Native keeps the animated splash fade');
assert.match(native, /SplashScreen\.hideAsync\(\)/, 'Native still hides the OS splash once the overlay lays out');

for (const file of ['src/components/animated-icon.tsx', 'src/components/animated-icon.web.tsx']) {
  assert.doesNotMatch(read(file), /AnimatedSplashOverlay/, file + ' no longer owns the splash overlay');
}

console.log('Web splash overlay checks passed: root layout avoids reanimated/worklets on web.');
