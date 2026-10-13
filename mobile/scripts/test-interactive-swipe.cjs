const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('src/lib/navigation/webSwipeGesture.ts');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(js, {
  exports,
  require: (name) => {
    if (name === './swipeBack') return {
      SWIPE_START_DX: 12,
      SWIPE_MAX_START_DY: 24,
      SWIPE_RELEASE_DX: 72,
    };
    throw new Error('Unexpected import: ' + name);
  },
});
const { beginWebSwipeGesture, moveWebSwipeGesture, endWebSwipeGesture } = exports;

// The scene follows the finger without waiting for release.
let state = beginWebSwipeGesture(8, 100);
let move = moveWebSwipeGesture(state, 38, 100);
assert.equal(move.kind, 'horizontal');
assert.equal(move.progress, 30);
state = move.state;
move = moveWebSwipeGesture(state, 98, 103);
assert.equal(move.kind, 'horizontal');
assert.equal(move.progress, 90);
assert.equal(endWebSwipeGesture(move.state, 98, 103).complete, true);

// A paused finger beyond threshold still completes: no velocity prerequisite.
assert.equal(endWebSwipeGesture(move.state, 98, 103).complete, true);

// Reverse by >24px after a valid pull; restore rather than unexpectedly pop.
state = move.state;
assert.equal(endWebSwipeGesture(state, 65, 103).complete, false);

// A short swipe restores without navigation.
state = beginWebSwipeGesture(5, 50);
move = moveWebSwipeGesture(state, 42, 50);
assert.equal(endWebSwipeGesture(move.state, 42, 50).complete, false);

// Vertical scrolling never turns into horizontal navigation.
state = beginWebSwipeGesture(8, 100);
move = moveWebSwipeGesture(state, 12, 132);
assert.equal(move.kind, 'vertical');
move = moveWebSwipeGesture(move.state, 180, 133);
assert.equal(move.kind, 'vertical');
assert.equal(endWebSwipeGesture(move.state, 180, 133).complete, false);

// iOS touchstart cancellation can replay a short back-button tap.
state = beginWebSwipeGesture(9, 48);
assert.equal(endWebSwipeGesture(state, 11, 50).replayTap, true);
assert.equal(endWebSwipeGesture(state, 80, 50).replayTap, false);

// Existing locked navigation tests remain unchanged: the 8px pointer zone,
// actual-back-target gate and per-screen registered back handler are preserved.
const edge = read('src/components/swipe-back-edge.web.tsx');
const frame = read('src/components/app-frame.web.tsx');
assert.match(edge, /WEB_EDGE_HIT_WIDTH = 8/);
assert.match(edge, /IOS_TOUCH_EDGE_WIDTH = 20/);
assert.match(edge, /getSwipeBackHandler\(\)\?\.hasInternalBackTarget === true/);
assert.match(edge, /onPanResponderMove:[\s\S]*?getSwipeSceneController\(\)\?\.drag\(gesture\.dx\)/);
assert.match(edge, /addEventListener\('touchstart', onTouchStart, \{ capture: true, passive: false \}\)/);
assert.match(edge, /event\.touches\.length !== 1/);
assert.match(edge, /documentGestureActive\.current/);
assert.match(edge, /tracked\(event\.changedTouches\)/);
assert.match(edge, /hasUnsavedTypedText\(\)/);
assert.match(frame, /maxWidth: OnePick\.maxWidth/);
assert.match(frame, /overflow: 'hidden'/);
assert.match(frame, /<Animated\.View[\s\S]*?transform: \[\{ translateX \}\]/);
assert.match(frame, /finish: \(navigate\)/);
assert.match(frame, /setTimeout\(reset, 60\)/);

console.log('Interactive swipe checks passed: drag, threshold, reversal, vertical, tap, scene and locked gates.');
