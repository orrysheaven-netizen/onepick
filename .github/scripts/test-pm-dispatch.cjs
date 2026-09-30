const assert = require('node:assert/strict');
process.env.APP_SLUG = 'onepick-ai-handoff';

const dispatch = require('./pm-dispatch.cjs');
const { inferTeam, executor, parseDirective, validPair, firstLine } = dispatch._test;
const sha = 'a'.repeat(40);
const issue = (title, labels = []) => ({ title, labels: labels.map((name) => ({ name })) });

assert.equal(firstLine('PM_DIRECTIVE: x\nbody'), 'PM_DIRECTIVE: x');
assert.deepEqual(
  parseDirective(`PM_DIRECTIVE: team=engineering to=auto action=execute pr=12 head=${sha}`, issue('x')),
  { team: 'engineering', target: 'codex', pr: '12', head: sha },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: team=qa-security to=auto action=execute pr=none head=none', issue('x')),
  { team: 'qa-security', target: 'claude', pr: 'none', head: 'none' },
);
assert.deepEqual(
  parseDirective('PM_DIRECTIVE: to=auto action=execute pr=none head=none', issue('x', ['area:data'])),
  { team: 'data', target: 'codex', pr: 'none', head: 'none' },
);
assert.equal(parseDirective('x PM_DIRECTIVE: team=engineering to=auto action=execute pr=none head=none', issue('x')), null);
assert.equal(inferTeam(issue('UX Figma audit')), 'ux');
assert.equal(inferTeam(issue('anything', ['area:infra'])), 'release');
assert.equal(executor('release', 'auto'), 'claude');
assert.equal(validPair('12', 'none'), false);
assert.equal(validPair('none', 'none'), true);

function mock({ labels = [], title = 'Task', comments = [], files = [] } = {}) {
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
        listFiles: async () => ({ data: clone(files) }),
      },
    },
  };
  return { state, github };
}

const core = { setFailed(message) { throw new Error(message); }, warning() {} };
const base = { repo: { owner: 'orrysheaven-netizen', repo: 'onepick' } };
const labelNames = (state) => state.issue.labels.map((x) => x.name);

async function testAssignment() {
  const source = {
    id: 10,
    body: 'PM_DIRECTIVE: team=qa-security to=auto action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/10',
  };
  const { state, github } = mock({ labels: ['size:M'], comments: [source] });
  await dispatch({ github, core, context: { ...base, eventName: 'issue_comment', payload: { issue: { number: 77 }, comment: source } } });
  const labels = labelNames(state);
  assert(labels.includes('owner:claude'));
  assert(labels.includes('team:qa-security'));
  assert(labels.includes('state:ready'));
  assert.equal(state.comments.filter((x) => x.body.includes('phase=execute')).length, 1);
}

async function testBlockedResume() {
  const source = {
    id: 20,
    body: 'PM_DIRECTIVE: team=engineering to=auto action=execute pr=none head=none',
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/20',
  };
  const { state, github } = mock({ labels: ['state:blocked'], comments: [source] });
  await dispatch({ github, core, context: { ...base, eventName: 'issue_comment', payload: { issue: { number: 77 }, comment: source } } });
  assert(!state.comments.some((x) => x.body.includes('onepick-pm-assignment')));
  state.issue.labels = state.issue.labels.filter((x) => x.name !== 'state:blocked');
  await dispatch({ github, core, context: { ...base, eventName: 'issues', payload: { issue: { number: 77 }, action: 'unlabeled', label: { name: 'state:blocked' } } } });
  const labels = labelNames(state);
  assert(labels.includes('owner:codex'));
  assert(labels.includes('team:engineering'));
  assert(labels.includes('state:ready'));
}

async function testReviewBridge() {
  const { state, github } = mock({
    labels: ['size:M', 'owner:codex', 'team:engineering', 'state:active'],
    files: [{ filename: '.github/workflows/example.yml' }],
  });
  const impl = {
    id: 40,
    body: `## 완료 리포트\nPR: #582\nhead: ${'b'.repeat(40)}\n결과: 구현 완료`,
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/40',
  };
  state.comments.push(impl);
  await dispatch({ github, core, context: { ...base, eventName: 'issue_comment', payload: { issue: { number: 77 }, comment: impl } } });
  let labels = labelNames(state);
  assert(labels.includes('owner:claude'));
  assert(labels.includes('team:qa-security'));
  assert(labels.includes('state:ready'));
  assert(!labels.includes('state:active'));
  assert(state.comments.some((x) => x.body.includes('phase=review')));

  state.issue.labels = state.issue.labels.filter((x) => x.name !== 'state:ready');
  state.issue.labels.push({ name: 'state:active' });
  const review = {
    id: 2000,
    body: `## 완료 리포트\nPR: #582\nhead: ${'b'.repeat(40)}\n결과: 독립 검토 완료`,
    user: { login: 'orrysheaven-netizen' },
    html_url: 'https://example.test/2000',
  };
  state.comments.push(review);
  await dispatch({ github, core, context: { ...base, eventName: 'issue_comment', payload: { issue: { number: 77 }, comment: review } } });
  labels = labelNames(state);
  assert(labels.includes('state:review'));
  assert(!labels.includes('state:active'));
  const pm = state.comments.filter((x) => x.body.startsWith('PM_REVIEW_REQUIRED:'));
  assert.equal(pm.length, 1);
  assert(pm[0].body.startsWith('PM_REVIEW_REQUIRED: reason=review-complete'));
}

(async () => {
  await testAssignment();
  await testBlockedResume();
  await testReviewBridge();
  console.log('pm dispatch checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
