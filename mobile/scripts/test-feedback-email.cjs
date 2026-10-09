const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  const result = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.length, 0);
  vm.runInNewContext(result.outputText, { exports, require: (name) => {
    if (name in imports) return imports[name];
    if (name === 'react/jsx-runtime') return require(name);
    assert.fail(name);
  } });
  return exports;
}

async function main() {
  const email = load('lib/feedback/email.ts');
  assert.equal(email.normalizeFeedbackEmail('  OnePick+test@example.com  '), 'OnePick+test@example.com');
  assert.equal(email.normalizeFeedbackEmail('  '), null);
  assert.equal(email.feedbackMailto(null), null);
  for (const invalid of ['mailto:a@example.com', 'a@example.com,b@example.com', 'a@example.com?bcc=b@example.com',
    'a@example.com\r\nBcc: b@example.com', 'a..b@example.com', '.a@example.com', 'a@-example.com', 'a@example', 'a'.repeat(65)+'@example.com']) {
    assert.throws(() => email.normalizeFeedbackEmail(invalid));
  }
  const url = email.feedbackMailto('a?b&c#d%40@example.com');
  assert.equal((url.match(/\?/g) || []).length, 1, 'mail headers cannot be injected through local part');
  assert.equal(decodeURIComponent(url.slice(7).split('?')[0]), 'a?b&c#d%40@example.com');
  assert.equal(new URL(url).searchParams.get('subject'), '원픽 의견');

  let response = { data: { feedback_email: 'test@example.com' }, error: null }, payload;
  const builder = { select: () => builder, eq: (key, value) => { assert.equal(key, 'id'); assert.equal(value, true); return builder; },
    update: (value) => { payload = value; return builder; }, single: async () => response };
  const client = { from: (table) => { assert.equal(table, 'home_settings'); return builder; } };
  const repo = load('repositories/supabase/feedbackEmailRepository.ts', {
    '@/lib/supabase/client': { supabase: client }, '@/lib/feedback/email': email,
  }).createFeedbackEmailRepository(client);
  assert.equal(await repo.get(), 'test@example.com');
  await repo.set(' test@example.com ');
  assert.deepEqual(Object.keys(payload), ['feedback_email']);
  assert.equal(payload.feedback_email, 'test@example.com');
  response = { data: null, error: new Error('zero rows (RLS)') };
  await assert.rejects(() => repo.set('a@example.com'), /zero rows/);

  let state = [], index = 0, input, presses, saved = [], fail = true;
  const busy = { current: false };
  const query = { data: null, isPending: false, isError: false };
  const mutation = { isPending: false, mutateAsync: async (value) => { saved.push(value); if (fail) throw Error('offline'); query.data = value; return value; } };
  const component = ({ children }) => React.createElement('div', null, children);
  const tokens = { textSecondary: '#55596A', textPrimary: '#141416', accentSoft: '#FFF0DC' };
  const imports = {
    react: { useRef: () => busy, useState: (initial) => { const i = index++; if (!(i in state)) state[i] = initial; return [state[i], v => { state[i] = v; }]; } },
    'react-native': { Text: component, View: component, ActivityIndicator: () => null, StyleSheet: { create: s => s },
      TextInput: props => { input = props; return null; }, Pressable: props => { presses.push(props); return component(props); } },
    '@/components/admin/admin-shell': { adminStyles: {} }, '@/constants/onepick': { OnePick: tokens },
    '@/hooks/useAuthSession': { useAuthSession: () => ({ user: { id: 'admin' } }) },
    '@/hooks/useFeedbackEmail': { useFeedbackEmail: () => query, useSaveFeedbackEmail: () => mutation },
    '@/lib/feedback/email': email,
  };
  const { FeedbackEmailForm, FeedbackEmailPanel } = load('components/admin/data/feedback-email-panel.tsx', imports);
  assert.equal(FeedbackEmailPanel().key, 'admin', 'account key isolates draft state');
  const render = () => { index = 0; presses = []; return renderToStaticMarkup(React.createElement(FeedbackEmailForm)); };
  render(); assert.equal(input.value, '');
  input.onChangeText('invalid'); render(); presses[0].onPress();
  assert.match(render(), /올바르게 입력/); assert.equal(saved.length, 0);
  input.onChangeText('test@example.com'); render(); presses[0].onPress(); presses[0].onPress();
  await new Promise(setImmediate);
  assert.equal(saved.length, 1); assert.match(render(), /입력한 주소를 유지/); assert.equal(input.value, 'test@example.com');
  fail = false; presses[0].onPress(); await new Promise(setImmediate);
  assert.match(render(), /저장했어요/); assert.equal(query.data, 'test@example.com');
  input.onChangeText(''); render(); presses[0].onPress(); await new Promise(setImmediate);
  assert.match(render(), /비웠어요/); assert.equal(query.data, null);
  mutation.isPending = true; render(); assert.equal(input.editable, false); assert.equal(presses[0].disabled, true);
  mutation.isPending = false; query.data = undefined; query.isError = true; input = null;
  assert.match(render(), /불러오지 못했어요/); assert.equal(input, null);

  let opened, button;
  state = []; index = 0;
  const home = load('components/home-feedback-button.tsx', {
    react: imports.react,
    'react-native': { View: component, Text: component, Linking: { openURL: async value => { opened = value; throw Error('no mail app'); } } },
    '@/components/ui': { Button: props => { button = props; return null; } },
    '@/constants/onepick': { OnePick: tokens }, '@/hooks/useFeedbackEmail': imports['@/hooks/useFeedbackEmail'],
    '@/lib/feedback/email': email,
  });
  const renderHome = () => { index = 0; return renderToStaticMarkup(React.createElement(home.HomeFeedbackButton)); };
  assert.equal(renderHome(), ''); query.data = 'test@example.com'; query.isError = false;
  renderHome(); button.onPress(); await new Promise(setImmediate);
  assert.equal(opened, email.feedbackMailto('test@example.com'));
  assert.match(renderHome(), /메일 앱을 열지 못했어요/);
  console.log('Feedback email checks passed: validation, URI encoding, zero-row update, draft/retry/clear, duplicate submit, session key, public action/failure.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
