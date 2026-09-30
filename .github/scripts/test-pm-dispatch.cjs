const assert = require('node:assert/strict');
process.env.APP_SLUG = 'onepick-ai-handoff';

const dispatch = require('./pm-dispatch.cjs');
const { inferTeam, resolveOwner, parseDirective, validPair, firstLine } = dispatch._test;
const sha = 'a'.repeat(40);
const issue = (title, labels = []) => ({ title, labels: labels.map((name) => ({ name })) });

assert.equal(firstLine('PM_DIRECTIVE: x\nbody'), 'PM_DIRECTIVE: x');
assert.deepEqual(
  parseDirective(`PM_DIRECTIVE: team=engineering assignee=auto action=execute pr=12 head=${sha}`, issue('x')),
  { team: 'engineering', assignee: 'auto', action: 'execute', owner: 'codex', area: 'area:app', pr: '12', head: sha },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=qa assignee=lead action=execute pr=none head=none', issue('x')),
  { team: 'qa', assignee: 'lead', action: 'execute', owner: 'codex', area: 'area:qa', pr: 'none', head: 'none' },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=release assignee=claude action=execute pr=none head=none', issue('x')),
  { team: 'release', assignee: 'claude', action: 'execute', owner: 'claude', area: 'area:infra', pr: 'none', head: 'none' },
);
assert.equal(resolveOwner(issue('x', ['owner:codex']), 'auto', 'review'), 'claude');
assert.equal(resolveOwner(issue('x', ['owner:claude']), 'auto', 'review'), 'codex');
assert.equal(resolveOwner(issue('x'), 'auto', 'review'), 'claude');
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=qa-security to=auto action=execute pr=none head=none', issue('x')),
  { team: 'qa', assignee: 'auto', action: 'execute', owner: 'codex', area: 'area:qa', pr: 'none', head: 'none' },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: to=auto action=execute pr=none head=none', issue('x', ['area:data'])),
  { team: 'data', assignee: 'auto', action: 'execute', owner: 'codex', area: 'area:data', pr: 'none', head: 'none' },
);
assert.equal(parseDirective('x PM_DIRECTIVE: team=engineering assignee=auto action=execute pr=none head=none', issue('x')), null);
assert.equal(inferTeam(issue('UX Figma audit')), 'ux');
assert.equal(inferTeam(issue('anything', ['area:infra'])), 'release');
assert.equal(validPair('12', 'none'), false);
assert.equal(validPair('none', 'none'), true);

function mock({ labels = [], title = 'Task', comments = [] } = {}) {
  let nextId = 1000;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const state = {
    issue: { number: 77, state: 'open', title, labels: labels.map((name) => ({ name })) },
    comments: clone(comments),
  };
  const github = {
    paginate: async (fn, args) => (await fn(args)).data,
    rest: {
      issues: {
        listComments: async () => ({ data: clone(state.comments) }),
        createComment: async ({ body }) => {
          const item = { id: nextId++, body, user: { login: 'onepick-ai-handoff[bot]' }, html_url: 'https://example.test/comment' };
          state.comments.push(item);
          return { data: clone(item) };
        },
        get: async () => ({ data: clone(state.issue) }),
        createLabel: async ({ name }) => ({ data: { name } }),
        removeLabel: async ({ name }) => {
          const index = state.issue.labels.findIndex((x) => x.name === name);
          if (index < 0) { const error = new Error('not found'); error.status = 404; throw error; }
          state.issue.labels.splice(index, 1);
          return { data: null };
        },
        addLabels: async ({ labels: add }) => {
          for (const name of add) if (!state.issue.labels.some((x) => x.name === name)) state.issue.labels.push({ name });
          return { data: clone(state.issue.labels) };
        },
        getComment: async ({ comment_id }) => {
          const item = state.comments.find((x) => Number(x.id) === Number(comment_id));
          if (!item) { const error = new Error('not found'); error.status = 404; throw error; }
          return { data: clone(item) };
        },
      },
      pulls: {
        get: async () => ({ data: {
          state: 'open', base: { ref: 'main' },
          head: { repo: { full_name: 'orrysheaven-netizen/onepick' }, sha: 'b'.repeat(40) },
          body: 'Refs #77',
        } }),
      },
    },
  };
  return { state, github };
}

const core = { setFailed(message) { throw new Error(message); }, warning() {} };
const base = { repo: { owner: 'orrysheaven-netizen', repo: 'onepick' } };
const labelNames = (state) => state.issue.labels.map((x) => x.name);

async function dispatchComment(state, github, source) {
  await dispatch({ github, core, context: { ...base, eventName: 'issue_comment', payload: { issue: { number: 77 }, comment: source } } });
}

async function testLeadAssignment() {
  const source = {
    id: 10,
    body: 'PM_DIRECTIVE: team=qa assignee=auto action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/10',
  };
  const { state, github } = mock({ labels: ['size:M'], comments: [source] });
  await dispatchComment(state, github, source);
  const labels = labelNames(state);
  assert(labels.includes('owner:codex'));
  assert(labels.includes('team:qa'));
  assert(labels.includes('area:qa'));
  assert(labels.includes('state:ready'));
  assert(state.comments.some((x) => x.body.includes('assignee=auto resolved=codex action=execute')));
}

async function testClaudeDelegation() {
  const source = {
    id: 11,
    body: 'PM_DIRECTIVE: team=engineering assignee=claude action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/11',
  };
  const { state, github } = mock({ labels: ['area:security'], comments: [source] });
  await dispatchComment(state, github, source);
  const labels = labelNames(state);
  assert(labels.includes('owner:claude'));
  assert(labels.includes('team:engineering'));
  assert(labels.includes('area:app'));
  assert(labels.includes('area:security'));
}

async function testAutoReviewOppositeOwner() {
  const source = {
    id: 12,
    body: 'PM_DIRECTIVE: team=qa assignee=auto action=review pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/12',
  };
  const { state, github } = mock({ labels: ['owner:codex', 'state:review'], comments: [source] });
  await dispatchComment(state, github, source);
  const labels = labelNames(state);
  assert(labels.includes('owner:claude'));
  assert(labels.includes('team:qa'));
  assert(labels.includes('state:ready'));
  assert(!labels.includes('state:review'));
}

async function testBlockedResume() {
  const source = {
    id: 20,
    body: 'PM_DIRECTIVE: team=engineering assignee=auto action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/20',
  };
  const { state, github } = mock({ labels: ['state:blocked'], comments: [source] });
  await dispatchComment(state, github, source);
  assert(!state.comments.some((x) => x.body.includes('onepick-pm-assignment')));
  state.issue.labels = state.issue.labels.filter((x) => x.name !== 'state:blocked');
  await dispatch({ github, core, context: { ...base, eventName: 'issues', payload: { issue: { number: 77 }, action: 'unlabeled', label: { name: 'state:blocked' } } } });
  assert(labelNames(state).includes('state:ready'));
}

async function testActiveDoesNotReassign() {
  const source = {
    id: 21,
    body: 'PM_DIRECTIVE: team=product assignee=lead action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/21',
  };
  const { state, github } = mock({ labels: ['state:active', 'owner:claude'], comments: [source] });
  await dispatchComment(state, github, source);
  assert(labelNames(state).includes('state:active'));
  assert(!state.comments.some((x) => x.body.includes('onepick-pm-assignment')));
}

async function testCompletionReturnsToPmWithoutInventingReview() {
  const impl = {
    id: 40,
    body: '## 완료 리포트\n결과: 구현 완료',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/40',
  };
  const { state, github } = mock({ labels: ['size:M', 'owner:codex', 'state:active'], comments: [impl] });
  await dispatchComment(state, github, impl);
  const labels = labelNames(state);
  assert(labels.includes('state:review'));
  assert(labels.includes('owner:codex'));
  assert(!labels.includes('state:active'));
  assert(!state.comments.some((x) => x.body.includes('phase=review')));
  const pm = state.comments.filter((x) => x.body.startsWith('PM_REVIEW_REQUIRED:'));
  assert.equal(pm.length, 1);
  assert(pm[0].body.startsWith('PM_REVIEW_REQUIRED: reason=stage-complete pr=none head=none'));
}

async function testUntrustedIgnored() {
  const source = {
    id: 50,
    body: 'PM_DIRECTIVE: team=data assignee=lead action=execute pr=none head=none',
    user: { login: 'someone-else' },
    html_url: 'https://example.test/50',
  };
  const { state, github } = mock({ comments: [source] });
  await dispatchComment(state, github, source);
  assert.equal(state.comments.length, 1);
}

(async () => {
  await testLeadAssignment();
  await testClaudeDelegation();
  await testAutoReviewOppositeOwner();
  await testBlockedResume();
  await testActiveDoesNotReassign();
  await testCompletionReturnsToPmWithoutInventingReview();
  await testUntrustedIgnored();
  console.log('pm dispatch checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
