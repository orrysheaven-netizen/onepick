const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, imports = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;

  vm.runInNewContext(output, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      assert.fail('Unexpected import: ' + name);
    },
  });
  return exports;
}

const part = (tag) => ({ children }) => React.createElement(tag, null, children);
const textOf = (node) =>
  typeof node === 'string'
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join('')
      : node?.props
        ? textOf(node.props.children)
        : '';

let buttons = [];
const native = {
  ActivityIndicator: () => React.createElement('span', null, 'loading'),
  Pressable: (props) => {
    buttons.push(props);
    return React.createElement('button', { disabled: props.disabled }, props.children);
  },
  StyleSheet: { create: (styles) => styles },
  Text: part('span'),
  View: part('div'),
};

let aiStatus;
let aiComment = null;
const aiHooks = {
  useProfileAiStatus: () => ({ data: aiStatus, isPending: false }),
  useProfileAiComment: () => ({ data: aiComment, isPending: false }),
  useGenerateProfileAi: () => ({ isPending: false, isError: false, mutate() {} }),
  useSetProfileAiVisibility: () => ({ isPending: false, mutate() {} }),
};

const { ProfileAiPanel } = load('components/profile-ai-panel.tsx', {
  'react-native': native,
  '@/components/profile-ai-comment': { ProfileAiComment: () => null },
  '@/hooks/useProfileAi': aiHooks,
});

function renderAi(status, currentPickCount) {
  aiStatus = status;
  aiComment = null;
  buttons = [];
  const html = renderToStaticMarkup(
    React.createElement(ProfileAiPanel, { profileId: 'qa-profile', currentPickCount }),
  );
  const button = (label) => buttons.find((props) => textOf(props.children).includes(label));
  return { html, button };
}

const nineStatus = {
  currentPickCount: 9,
  minimumPicks: 10,
  recommendedPicks: 10,
  hasReview: false,
  reviewPickCount: 0,
  changedCount: 0,
  minimumChanges: 5,
  retryAfterSeconds: 0,
  canGenerate: false,
  reason: 'NEED_FIRST_PICKS',
  generatedAt: null,
  isVisible: false,
  isStale: false,
};

let rendered = renderAi(nineStatus, 9);
assert.match(rendered.html, /AI 취향평가/);
assert.match(rendered.html, /구성 → 해석/);
assert.match(rendered.html, /9\/10 · 원픽 1개만 더 고르면 AI 평가가 열려요/);
assert.ok(rendered.button('AI 평가 보기'), '9-pick state keeps the AI CTA visible');
assert.equal(rendered.button('AI 평가 보기').disabled, true, '9-pick AI review CTA must stay disabled');

const tenFirstStatus = {
  currentPickCount: 10,
  minimumPicks: 10,
  recommendedPicks: 10,
  hasReview: false,
  reviewPickCount: 0,
  changedCount: 0,
  minimumChanges: 5,
  retryAfterSeconds: 0,
  canGenerate: true,
  reason: 'READY_FIRST',
  generatedAt: null,
  isVisible: false,
  isStale: false,
};

rendered = renderAi(tenFirstStatus, 10);
assert.match(rendered.html, /10\/10개를 채웠으니 AI 평가를 받을 수 있어요/);
assert.ok(rendered.button('AI 평가 보기'), '10-pick state must show the first AI review CTA');
assert.equal(rendered.button('AI 평가 보기').disabled, false, '10-pick AI review CTA must be enabled');

const legacyUpgradeStatus = {
  currentPickCount: 10,
  minimumPicks: 10,
  recommendedPicks: 10,
  hasReview: true,
  reviewPickCount: 5,
  changedCount: 5,
  minimumChanges: 5,
  retryAfterSeconds: 0,
  canGenerate: true,
  reason: 'READY_TEN_PICK_UPGRADE',
  generatedAt: '2026-09-19T00:00:00.000Z',
  isVisible: false,
  isStale: true,
};

rendered = renderAi(legacyUpgradeStatus, 10);
assert.match(rendered.html, /10개의 원픽이 모였어요\. 더 풍부한 AI 평가로 한 번 바로 갱신할 수 있어요/);
assert.ok(rendered.button('AI가 다시 본 나'), 'legacy review below ten picks must keep its one-time upgrade CTA');
assert.equal(rendered.button('AI가 다시 본 나').disabled, false, 'legacy 10-pick upgrade CTA must be enabled');

let tasteValue;
const { ProfileTasteComposition } = load('components/profile-taste-composition.tsx', {
  'react-native': native,
  '@/hooks/useProfileTasteComposition': {
    useProfileTasteComposition: () => ({ data: tasteValue, isPending: false, isError: false }),
  },
});

function renderTaste(value, variant = 'self') {
  tasteValue = value;
  return renderToStaticMarkup(
    React.createElement(ProfileTasteComposition, {
      profileId: value.profileId,
      viewerId: 'viewer',
      variant,
    }),
  );
}

const fiveComposition = {
  profileId: 'f9900000-0000-4000-8000-000000000005',
  totalPickCount: 5,
  mappedPickCount: 5,
  unmappedPickCount: 0,
  dimensions: [
    {
      code: 'culture', name: '문화', pickCount: 2, categoryCount: 2, percentage: 40,
      categories: [
        { categoryId: 'drama', categoryName: '드라마', categorySlug: 'drama', pickCount: 1 },
        { categoryId: 'youtube', categoryName: '유튜브', categorySlug: 'youtube', pickCount: 1 },
      ],
    },
    {
      code: 'food', name: '음식', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'snacks', categoryName: '과자', categorySlug: 'snacks', pickCount: 1 }],
    },
    {
      code: 'tech', name: '기술', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'smartphone', categoryName: '스마트폰', categorySlug: 'smartphone', pickCount: 1 }],
    },
    {
      code: 'living', name: '생활', pickCount: 1, categoryCount: 1, percentage: 20,
      categories: [{ categoryId: 'notebook', categoryName: '노트', categorySlug: 'notebook', pickCount: 1 }],
    },
  ],
};

let tasteHtml = renderTaste(fiveComposition);
assert.match(tasteHtml, /내 취향 구성/);
assert.match(tasteHtml, /원픽 5개 반영/);
assert.match(tasteHtml, /40\.0%/);
assert.match(tasteHtml, /문화/);
assert.match(tasteHtml, /드라마/);
assert.match(tasteHtml, /유튜브/);
assert.doesNotMatch(tasteHtml, /취향을 모으는 중/);

const tenComposition = {
  profileId: 'f9900000-0000-4000-8000-000000000010',
  totalPickCount: 10,
  mappedPickCount: 10,
  unmappedPickCount: 0,
  dimensions: [
    {
      code: 'culture', name: '문화', pickCount: 3, categoryCount: 3, percentage: 30,
      categories: [
        { categoryId: 'game', categoryName: '게임', categorySlug: 'game', pickCount: 1 },
        { categoryId: 'drama', categoryName: '드라마', categorySlug: 'drama', pickCount: 1 },
        { categoryId: 'youtube', categoryName: '유튜브', categorySlug: 'youtube', pickCount: 1 },
      ],
    },
    {
      code: 'food', name: '음식', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'snacks', categoryName: '과자', categorySlug: 'snacks', pickCount: 1 },
        { categoryId: 'ramen', categoryName: '라면', categorySlug: 'ramen', pickCount: 1 },
      ],
    },
    {
      code: 'tech', name: '기술', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'smartphone', categoryName: '스마트폰', categorySlug: 'smartphone', pickCount: 1 },
        { categoryId: 'headphones', categoryName: '헤드폰·이어폰', categorySlug: 'headphones-earphones', pickCount: 1 },
      ],
    },
    {
      code: 'living', name: '생활', pickCount: 2, categoryCount: 2, percentage: 20,
      categories: [
        { categoryId: 'notebook', categoryName: '노트', categorySlug: 'notebook', pickCount: 1 },
        { categoryId: 'pen', categoryName: '볼펜', categorySlug: 'ballpoint-pen', pickCount: 1 },
      ],
    },
    {
      code: 'style', name: '스타일', pickCount: 1, categoryCount: 1, percentage: 10,
      categories: [{ categoryId: 'perfume', categoryName: '향수', categorySlug: 'perfume', pickCount: 1 }],
    },
  ],
};

tasteHtml = renderTaste(tenComposition);
assert.match(tasteHtml, /원픽 10개 반영/);
assert.match(tasteHtml, /30\.0%/);
assert.match(tasteHtml, /20\.0%/);
assert.match(tasteHtml, /10\.0%/);
assert.match(tasteHtml, /스타일/);
assert.match(tasteHtml, /향수/);

const publicTasteHtml = renderTaste(tenComposition, 'public');
assert.match(publicTasteHtml, />취향 구성</);
assert.doesNotMatch(publicTasteHtml, /내 취향 구성/);

console.log('Profile taste boundary UI checks passed: 9-pick wait, 10-pick first review, legacy upgrade, and matching taste composition rendering.');
