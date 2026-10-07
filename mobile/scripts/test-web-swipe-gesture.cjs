const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const file = path.join(__dirname, '../src/lib/navigation/webSwipeGesture.ts');
const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const moduleExports = {};
vm.runInNewContext(output, {
  exports: moduleExports,
  require: (name) => {
    if (name === './swipeBack') return {
      SWIPE_START_DX: 12,
      SWIPE_MAX_START_DY: 24,
      SWIPE_RELEASE_DX: 72,
    };
    throw new Error(`Unexpected dependency: ${name}`);
  },
});

const { beginWebSwipeGesture, moveWebSwipeGesture, endWebSwipeGesture } = moduleExports;

// Reserved iOS edge: horizontal drag is owned immediately and can complete.
let state = beginWebSwipeGesture(8, 100, true);
let move = moveWebSwipeGesture(state, 40, 104);
assert.equal(move.kind, 'horizontal');
assert.equal(move.progress, 32);
state = move.state;
let end = endWebSwipeGesture(state, 90, 105);
assert.equal(end.complete, true);
assert.equal(end.replayTap, false);

// Reserved edge: vertical intent cancels swipe and stays vertical thereafter.
state = beginWebSwipeGesture(8, 100, true);
move = moveWebSwipeGesture(state, 11, 122);
assert.equal(move.kind, 'vertical');
assert.equal(move.state.claimed, false);
assert.equal(move.state.verticalScroll, true);
state = move.state;
move = moveWebSwipeGesture(state, 12, 145);
assert.equal(move.kind, 'vertical');
end = endWebSwipeGesture(move.state, 12, 145);
assert.equal(end.complete, false);
assert.equal(end.replayTap, false);

// Short reserved-edge touch is replayable as a tap.
state = beginWebSwipeGesture(10, 80, true);
end = endWebSwipeGesture(state, 14, 83);
assert.equal(end.complete, false);
assert.equal(end.replayTap, true);

// A drag that crosses the threshold but ends by moving left must not navigate.
state = beginWebSwipeGesture(6, 50, true);
move = moveWebSwipeGesture(state, 100, 52);
assert.equal(move.kind, 'horizontal');
state = move.state;
end = endWebSwipeGesture(state, 80, 52);
assert.equal(end.complete, false);

// Non-reserved touch waits for clear horizontal intent.
state = beginWebSwipeGesture(20, 40, false);
move = moveWebSwipeGesture(state, 28, 42);
assert.equal(move.kind, 'waiting');
move = moveWebSwipeGesture(move.state, 40, 43);
assert.equal(move.kind, 'horizontal');

console.log('Web swipe gesture state checks passed: horizontal, vertical, tap replay and reversal.');
