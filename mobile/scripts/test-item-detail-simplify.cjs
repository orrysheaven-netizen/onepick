const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(relativePath, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'src', relativePath), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: (name) => {
      if (name === '@/constants/onepick') return require('./design-tokens.cjs');
      if (name === '@/lib/home/publicFoodScope' && !(name in imports)) return require('./public-food-scope.cjs');
      if (name in imports) return imports[name];
      if (name === 'react' || name === 'react/jsx-runtime') return require(name);
      assert.fail(`Unexpected runtime dependency: ${name}`);
    },
  });
  return exports;
}

const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');

// Restaurant titles name the menu: 가게이름 + 메뉴명.
const { itemTitle } = load('lib/items/itemTitle.ts');
assert.equal(itemTitle('중앙해장', '내장탕', true), '중앙해장 내장탕');
assert.equal(itemTitle('대성집 도가니탕', '도가니탕', true), '대성집 도가니탕', 'Names that already end with the menu are not doubled');
assert.equal(itemTitle('신라면', '라면', false), '신라면', 'Non-restaurant items keep their own name');
assert.equal(itemTitle('중앙해장', null, true), '중앙해장');

// The service marks items under the food root, read from the open categories.
const { categoryRootSlug } = load('lib/categories/categoryTree.ts');
const tree = [
  { id: 'food', parentId: null, slug: 'food' },
  { id: 'soups', parentId: 'food', slug: 'food-soups-rice' },
  { id: 'naejang', parentId: 'soups', slug: 'naejangtang' },
];
assert.equal(categoryRootSlug(tree[2], tree), 'food');
assert.match(source('repositories/supabase/supabaseCategoryRepository.ts'), /rootSlug: categoryRootSlug\(category, categories\)/);
assert.match(source('services/itemService.ts'), /category\.rootSlug === 'food'/);

// Only the number is bold, and "현재" is gone.
const nativeComponent = (tag) => ({ children, style, accessibilityLabel, onPress }) => React.createElement(tag, {
  'data-bold': [].concat(style || []).some((entry) => entry && entry.fontWeight === '800') ? 'true' : undefined,
  'aria-label': accessibilityLabel, onClick: onPress,
}, children);
let count = { data: 12 };
const { ItemPickCount } = load('components/item-pick-count.tsx', {
  'react-native': { Text: nativeComponent('span') },
  '@/hooks/useItemPickCount': { useItemPickCount: () => count },
});
const countHtml = renderToStaticMarkup(React.createElement(ItemPickCount, { itemId: 'i' }));
assert.match(countHtml, /<span data-bold="true">12<\/span>명이 원픽으로 선택/);
assert.doesNotMatch(countHtml, /현재/);

// Detail hero: tiny credit, no guide text, no own-review button, no section header.
const detail = source('app/item/[itemId].tsx');
assert.match(detail, />사진 @\{credit\.username\}</);
assert.doesNotMatch(detail, /사진 등록 · @|아래에서 함께 볼 수 있어요|내 원픽 한줄평 보기\/수정|title="원픽 한줄평"|각 한줄평에서 댓글로 대화해요/);
assert.match(detail, /itemTitle\(item\.name, category\?\.name, isRestaurant\)/);

// Review cards stay compact: review/comment count open the dedicated conversation route; share stays on every card.
const native = {
  Pressable: nativeComponent('button'), Text: nativeComponent('span'), View: nativeComponent('div'),
  StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
};
let session = { user: { id: 'me' }, isLoading: false };
const { ItemReviewCard } = load('components/item-review-card.tsx', {
  'expo-router': { useRouter: () => ({ push() {} }) },
  'react-native': native,
  '@/components/current-pick-flag': { CurrentPickFlag: () => React.createElement('i', { 'aria-label': '현재 원픽' }, 'flag') },
  '@/components/pick-management': {
    PickManagement: ({ mode }) => React.createElement('i', null, `panel:${mode}`),
    PickManagementActions: () => React.createElement('i', null, '수정 · 해제'),
  },  '@/components/pick-share-actions': { PickShareActions: ({ pickId }) => React.createElement('i', null, `share:${pickId}`) },
  '@/lib/profile/profileName': { profileDisplayName: (p) => p.nickname?.trim() || p.username, profileNickname: (p) => p.nickname?.trim() || null }, '@/components/ui': { Avatar: () => null },
  '@/hooks/useAuthSession': { useAuthSession: () => session },
});
const card = (pick, profile) => renderToStaticMarkup(React.createElement(ItemReviewCard, {
  pick, profile, categoryName: '내장탕', itemName: '중앙해장', itemId: 'item-1', focused: false, highlighted: false, onRemoved() {},
}));
const other = card({ id: 'o1', userId: 'someone', status: 'active', oneLineReview: '맛있다', commentCount: 3 }, { username: 'someone' });
assert.doesNotMatch(other, /thread:o1/, "Item detail no longer expands comment threads inline");
assert.match(other, /댓글 3/);
assert.match(other, /share:o1/);
assert.match(other, /@someone/);
assert.match(other, /aria-label="현재 원픽"/, 'A current review gets the Figma flag indicator');
assert.doesNotMatch(other, /✓ 이 집 원픽|✓ 원픽/, 'The current-Pick state is icon-only, not a text badge');
assert.doesNotMatch(other, /댓글 접기|댓글 보기|수정 · 해제|공유 · 신고|원픽 아님/);

const endedOther = card({ id: 'o-old', userId: 'someone', status: 'replaced', oneLineReview: '예전에도 좋았다' }, { username: 'someone' });
assert.match(endedOther, /@someone/);
assert.doesNotMatch(endedOther, /이전 원픽|현재 선택이 종료된|aria-label="현재 원픽"|✓ 이 집 원픽|원픽 아님/, 'Ended reviews stay neutral and do not reveal history state');
assert.match(endedOther, /댓글 0/, 'Ended reviews keep a conversation entry without exposing lifecycle state');

const mine = card({ id: 'm1', userId: 'me', status: 'active', oneLineReview: '내장탕은 무조건 여기' }, { username: 'me' });
assert.match(mine, /내 한줄평/);
assert.match(mine, /aria-label="현재 원픽"/);
assert.doesNotMatch(mine, /@me|내 이전 한줄평|원픽 아님/, 'My own card uses the same neutral label and only a positive current badge');
assert.match(mine, /수정 · 해제/);
assert.match(mine, /share:m1/);
assert.doesNotMatch(mine, /댓글 숨기기|thread:m1/, 'My own review also keeps comments out of the item list');
assert.match(mine, /댓글 0/);

// The session resolves after the first render; ownership affects management, not the conversation entry.
session = { user: null, isLoading: true };
assert.match(card({ id: 'm1', userId: 'me', status: 'active', oneLineReview: 'x' }, { username: 'me' }), /댓글 0/);
session = { user: { id: 'me' }, isLoading: false };
assert.match(card({ id: 'm1', userId: 'me', status: 'active', oneLineReview: 'x' }, { username: 'me' }), /댓글 0/);

const endedMine = card({ id: 'm-old', userId: 'me', status: 'removed', oneLineReview: '예전 이유' }, { username: 'me' });
assert.match(endedMine, /내 한줄평/);
assert.doesNotMatch(endedMine, /내 이전 한줄평|이전 원픽|현재 선택이 종료된|aria-label="현재 원픽"|✓ 이 집 원픽|수정 · 해제/, 'My ended review does not expose history state or current-only management');
assert.match(endedMine, /댓글 0/, 'My ended review keeps a conversation entry');

session = { user: { id: 'me' }, isLoading: true };
assert.doesNotMatch(card({ id: 'm1', userId: 'me', status: 'active', oneLineReview: 'x' }, { username: 'me' }), /수정 · 해제/);

// Share actions: icon per card, 신고 only behind ⋯ and never on my own Pick.
const shareSource = source('components/pick-share-actions.tsx');
assert.match(shareSource, /accessibilityLabel="이 원픽 공유"/);
assert.match(shareSource, /<Icon name="more" color=\{OnePick\.textSecondary\} \/>/, '더보기 is the shared 24px More icon, not a ⋯ glyph');
assert.match(shareSource, /menuOpen && canReport && user \? <View style=\{styles\.menu\}>\s*<ReportAction/);
assert.match(shareSource, /user\.id !== props\.authorUserId/);

const currentFlagSource = source('components/current-pick-flag.tsx');
assert.match(currentFlagSource, /accessibilityLabel=\{mine \? '내 현재 원픽' : '현재 원픽'\}/);
assert.match(currentFlagSource, /width: 24/);
assert.match(currentFlagSource, /height: 24/);
assert.match(currentFlagSource, /source=\{mine \? flags\.mine : flags\.other\}/, 'Shared flag: my current Pick orange, anyone else dark gray (Figma 752:4349)');
assert.doesNotMatch(currentFlagSource, /✓ 이 집 원픽|✓ 원픽/, 'Shared flag stays icon-only');

const reviewCardSource = source('components/item-review-card.tsx');
assert.doesNotMatch(reviewCardSource, /PickReplies/, 'Item review cards never mount comment threads inline');
assert.match(reviewCardSource, /pathname: '\/pick\/\[pickId\]'/, 'Review body and count use the dedicated conversation route');
assert.match(reviewCardSource, /params: \{ pickId: pick\.id, itemId, \.\.\.homeScopeParams\(routeScope\) \}/, 'Conversation route carries item identity for ended reviews');
assert.match(reviewCardSource, /pick\.commentCount \?\? 0/, 'Review cards show the server-provided comment count');
assert.match(reviewCardSource, /<CurrentPickFlag mine=\{isMine\} \/>/, 'Review rows use the shared Figma flag');

const conversationSource = source('app/pick/[pickId].tsx');
assert.match(conversationSource, /useItemDetail\(itemId, user\?\.id, pickId/, 'Conversation detail resolves the review through item_review_page');
assert.match(conversationSource, /focusCommentId=\{notificationKind === 'reply' \? rootCommentId : routeFocusCommentId\}/, 'Reply notifications and exact comment links forward focus into the thread');
assert.match(conversationSource, /notificationKind === 'reply' && !replyTargetLoaded/, 'Reply read receipt waits for the located comment to load');
assert.match(conversationSource, /canWrite=\{Boolean\(focused\.pick\.canComment\)\}/, 'Conversation writing follows item_review_page can_comment');
assert.match(conversationSource, /<CurrentPickFlag mine=\{focused\.pick\.userId === user\?\.id\} \/>/,'Conversation detail uses the shared icon-only current-Pick flag');
assert.doesNotMatch(conversationSource, /✓ 이 집 원픽|✓ 원픽/, 'Conversation detail has no current-Pick text badge');

// PickReplies keeps its existing CRUD/composer behavior.
const repliesSource = source('components/pick-replies.tsx');
assert.match(repliesSource, /useState\(!compact\)/);
assert.match(repliesSource, /canComment && !composing \?/);
assert.match(repliesSource, /const canComment = canWrite && !isSessionLoading && !sessionError/);
assert.match(repliesSource, /comment\.authorCurrentPickMatchesItem \? <CurrentPickFlag mine=\{author\.id === user\?\.id\} \/> : null/,
  'Visible comment authors get the flag only when the server says their current Pick matches this item/channel');
assert.doesNotMatch(repliesSource, /✓ 이 집 원픽|✓ 원픽/, 'Comment authors use no current-Pick text badge');

console.log('Item detail simplify passed: compact review rows, server comment counts, dedicated conversations, share and management actions.');
