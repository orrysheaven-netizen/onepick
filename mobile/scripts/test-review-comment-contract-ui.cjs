const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, imports = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, {
    exports,
    require(name) {
      if (name in imports) return imports[name];
      assert.fail('Unexpected dependency: ' + name);
    },
  });
  return exports;
}

async function main() {
  const { AppError } = load('errors/appError.ts');

  // App preflight must not reject ended reviews. Server/RLS owns the exact
  // same-item+channel or review-author eligibility rule.
  const creates = [];
  let pickReads = 0;
  const { CommentService } = load('services/commentService.ts', {
    '@/errors/appError': { AppError },
  });
  const service = new CommentService(
    { create: async (input) => { creates.push(input); return { id: 'reply', ...input }; } },
    { getById: async () => { pickReads += 1; throw new Error('must not preflight pick status'); } },
    { getById: async () => ({ id: 'owner', username: 'owner' }) },
    {},
  );
  await service.createComment({
    pickId: 'ended-review',
    userId: 'owner',
    body: '  답글입니다  ',
    parentCommentId: 'root-comment',
  });
  assert.equal(pickReads, 0);
  assert.equal(creates.length, 1);
  assert.equal(creates[0].pickId, 'ended-review');
  assert.equal(creates[0].body, '답글입니다');
  assert.equal(creates[0].parentCommentId, 'root-comment');

  // Repository insert carries parent_comment_id for one-level replies.
  let inserted;
  const fakeClient = {
    from: () => ({
      insert(values) {
        inserted = values;
        return {
          select() {
            return {
              single: async () => ({
                data: {
                  id: 'reply',
                  pick_id: values.pick_id,
                  user_id: values.user_id,
                  body: values.body,
                  created_at: '2026-09-29T00:00:00Z',
                  updated_at: '2026-09-29T00:00:00Z',
                  parent_comment_id: values.parent_comment_id,
                },
                error: null,
              }),
            };
          },
        };
      },
    }),
  };
  const { SupabaseCommentRepository } = load('repositories/supabase/supabaseCommentRepository.ts', {
    '@/errors/appError': { AppError },
    '@/errors/mapSupabaseError': { mapSupabaseError: (error) => error },
    '@/repositories/mappers/commentMapper': { mapCommentRow: (row) => row },
  });
  await new SupabaseCommentRepository(fakeClient).create({
    pickId: 'review',
    userId: 'owner',
    body: 'reply',
    parentCommentId: 'root-comment',
  });
  assert.equal(inserted.parent_comment_id, 'root-comment');

  const source = (file) => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  const replies = source('components/pick-replies.tsx');
  assert.doesNotMatch(replies, /usePickDetail/, 'Conversation permission must not re-read Pick lifecycle state');
  assert.match(replies, /const canComment = canWrite && !isSessionLoading && !sessionError/);
  assert.doesNotMatch(replies, /ownReview/, 'Review owners keep their approved top-level comment and reply composer');
  assert.match(replies, /!isReply && canComment && !deleted \?/, 'Eligible review owners may reply under their own comments');
  assert.match(replies, /parentCommentId: replyingTo\?\.id \?\? null/);
  assert.match(replies, /\(entry\.replies \?\? \[\]\)\.map\(\(reply\) => renderComment\(reply, true\)\)/);
  assert.match(replies, /comment\.authorCurrentPickMatchesItem \? <CurrentPickFlag mine=\{author\.id === user\?\.id\} \/> : null/);
  assert.doesNotMatch(replies, /✓ 이 집 원픽|✓ 원픽/);
  assert.match(replies, /삭제된 댓글이에요\./);

  const reviewCard = source('components/item-review-card.tsx');
  assert.match(reviewCard, /params: \{ pickId: pick\.id, itemId \}/,
    'Review conversation links carry item id');

  const itemDetail = source('app/item/[itemId].tsx');
  assert.match(itemDetail, /pickId: params\.pickId,[\s\S]*itemId: params\.itemId/,
    'Comment notification redirect preserves item identity');

  const pickDetail = source('app/pick/[pickId].tsx');
  assert.match(pickDetail, /const routeItemId = typeof params\.itemId === 'string'/);
  assert.match(pickDetail, /usePickDetail\(pickId, user\?\.id, needsPickLookup\)/);
  assert.match(pickDetail, /const itemId = routeItemId \?\? pickQuery\.data\?\.pick\.itemId/);
  assert.match(pickDetail, /focusCommentId=\{notificationKind === 'reply' \? rootCommentId : routeFocusCommentId\}/);
  assert.match(pickDetail, /<CurrentPickFlag mine=\{focused\.pick\.userId === user\?\.id\} \/>/);
  assert.doesNotMatch(pickDetail, /✓ 이 집 원픽|✓ 원픽/);
  assert.match(pickDetail, /itemQuery\.data\.isRestaurant[\s\S]*?pickChannel === OnePickMvp\.publicPickChannel/,
    'Comment prompt is restricted to supported food/offline scope');
  assert.match(pickDetail, /myPickStatus\.type === 'not_selected'/,
    'Comment CTA must not route selected_other into an unconfirmed replacement');
  const commentChoose = source('app/pick/choose.tsx');
  assert.match(commentChoose, /if \(returnPickId && !commentAttempt\.current\)[\s\S]*?await itemQuery\.refetch\(\)/,
    'Comment-entry save rechecks the current Pick before mutation');
  assert.match(commentChoose, /latest\.data\.myPickStatus\.type !== 'not_selected'/,
    'Comment-entry save declines a replacement');
  assert.match(commentChoose, /disabled=\{needsPhotoStep \|\| commentPickConflict \|\| Boolean\(returnPickId/,
    'Comment-entry replacement cannot be submitted from a stale screen');
  assert.match(commentChoose, /const atomicCommentRegistration = Boolean\(returnPickId[\s\S]*?isRestaurant[\s\S]*?pickChannel === OnePickMvp\.publicPickChannel/,
    'Atomic comment registration is scoped to food and the public channel');
  assert.match(commentChoose, /registerCommentPick\.mutateAsync\([\s\S]*?expectedPreviousPickId: null,[\s\S]*?requestId/,
    'Comment-entry registration uses the existing expected-null RPC');
  assert.match(commentChoose, /commentAttempt\.current \?\? \{ id: Crypto\.randomUUID\(\), review: trimmedReview \}/,
    'The request ID and original review remain stable for a lost-response retry');
  assert.match(commentChoose, /oneLineReview: attempt\.review,[\s\S]*?requestId: attempt\.id/,
    'An idempotent retry cannot display a different unsaved review');
  assert.match(commentChoose, /const review = commentAttempt\.current\?\.review \?\? draftReview/,
    'The on-screen draft reflects the original idempotent request');
  assert.match(commentChoose, /const checkingCommentReceipt = Boolean\(returnPickId && commentAttempt\.current && !savedChoice && !commentPickConflict\)/,
    'Lost-response retry is explicitly distinguished from a new Pick or review edit');
  assert.match(commentChoose, /const submitLabel = checkingCommentReceipt \? '저장 결과 다시 확인하기'/,
    'Retry CTA names the receipt recheck rather than editing a prior Pick');
  assert.match(commentChoose, /editable=\{!saving && !commentAttempt\.current\}/,
    'The review input is read-only after the first comment-origin save attempt');
  assert.match(commentChoose, /returnPickId && !commentAttempt\.current && pickStatus\?\.type !== 'not_selected'/,
    'A lost-response retry is not confused with an unconfirmed Pick replacement');
  assert.match(commentChoose, /error\.code === 'PICK_CHANGED_ELSEWHERE'[\s\S]*?setCommentPickConflict\(true\)/,
    'A server conflict permanently blocks retry in this comment flow');
  assert.match(commentChoose, /disabled=\{needsPhotoStep \|\| commentPickConflict/,
    'The save button must be disabled after an atomic server conflict');
  assert.match(commentChoose, /if \(returnPickId && !atomicCommentRegistration\)/,
    'Unsupported comment-origin flows fail closed before reaching change_pick');
  assert.match(commentChoose, /published: result\.published/,
    'Registration receipt distinguishes a pending photo review from a commentable Pick');
  assert.match(commentChoose, /const intent = returnPickId[\s\S]*?action: 'comment_pick', pickId: returnPickId[\s\S]*?action: 'choose_pick'/,
    'Authentication recovery preserves comment intent rather than an unguarded choose_pick');
  assert.match(commentChoose, /const backToComments = \(\) => \{[\s\S]*?router\.dismissTo\(\{ pathname: '\/pick\/\[pickId\]', params: \{ pickId: returnPickId \} \}\)/,
    'Successful comment-origin registration always returns to the exact discussion');
  assert.doesNotMatch(commentChoose, /if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\(\{ pathname: '\/pick\/\[pickId\]'/,
    'Comment return may not blindly pop an unrelated login/history route');

  const myComments = source('components/profile-my-comments.tsx');
  assert.match(myComments, /commentService\.locateComment\(entry\.comment\.id\)/);
  assert.match(myComments, /focusCommentId: entry\.comment\.id/);
  assert.match(myComments, /commentAfterTime: location\.pageCursor\.timestamp/);

  console.log('Review comment contract checks passed: server can_comment, replies, flag UI, item-aware conversation routing and exact my-comment location.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
