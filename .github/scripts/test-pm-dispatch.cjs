const assert = require('node:assert/strict');
const dispatch = require('./pm-dispatch.cjs');
const { inferTeam, executor, parseDirective, validPair, firstLine } = dispatch._test;

const issue = (title, labels = []) => ({ title, labels: labels.map((name) => ({ name })) });
const sha = 'a'.repeat(40);

assert.equal(firstLine('PM_DIRECTIVE: x\nbody'), 'PM_DIRECTIVE: x');
assert.equal(firstLine('## 완료 리포트\r\nbody'), '## 완료 리포트');

assert.deepEqual(
  parseDirective(`PM_DIRECTIVE: team=engineering to=auto action=execute pr=12 head=${sha}`, issue('x')),
  { team: 'engineering', target: 'codex', pr: '12', head: sha },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=qa-security to=auto action=execute pr=none head=none', issue('x')),
  { team: 'qa-security', target: 'claude', pr: 'none', head: 'none' },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=release to=codex action=execute pr=none head=none', issue('x')),
  { team: 'release', target: 'codex', pr: 'none', head: 'none' },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: to=auto action=execute pr=none head=none', issue('[Baseline/Data] check', ['area:data'])),
  { team: 'data', target: 'codex', pr: 'none', head: 'none' },
);

assert.equal(parseDirective('x PM_DIRECTIVE: team=engineering to=auto action=execute pr=none head=none', issue('x')), null);
assert.equal(parseDirective('PM_DIRECTIVE: team=unknown to=auto action=execute pr=none head=none', issue('x')), null);

assert.equal(inferTeam(issue('UX Figma audit')), 'ux');
assert.equal(inferTeam(issue('anything', ['area:qa'])), 'qa-security');
assert.equal(inferTeam(issue('anything', ['area:security'])), 'qa-security');
assert.equal(inferTeam(issue('anything', ['area:infra'])), 'release');
assert.equal(inferTeam(issue('[Product] MVP 범위')), 'product');
assert.equal(inferTeam(issue('ordinary app work')), 'engineering');

assert.equal(executor('product', 'auto'), 'codex');
assert.equal(executor('ux', 'auto'), 'codex');
assert.equal(executor('engineering', 'auto'), 'codex');
assert.equal(executor('data', 'auto'), 'codex');
assert.equal(executor('qa-security', 'auto'), 'claude');
assert.equal(executor('release', 'auto'), 'claude');
assert.equal(executor('engineering', 'claude'), 'claude');

assert.equal(validPair('none', 'none'), true);
assert.equal(validPair('12', sha), true);
assert.equal(validPair('12', 'none'), false);
assert.equal(validPair('none', sha), false);

console.log('pm dispatch routing checks passed');
