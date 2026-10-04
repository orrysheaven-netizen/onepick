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
  assert.match(replies, /parentCommentId: replyingTo\?\.id \?\? null/);
  assert.match(replies, /\(entry\.replies \?\? \[\]\)\.map\(\(reply\) => renderComment\(reply, true\)\)/);
  assert.match(replies, /comment\.authorCurrentPickMatchesItem \? <CurrentPickFlag \/> : null/);
  assert.doesNotMatch(replies, /✓ 이 집 원픽|✓ 원픽/);
  assert.match(replies, /삭제된 댓글입니다\./);

  // 10-04: threads expand inline on the item detail; /pick/[pickId] only hands off.
  const reviewCard = source('components/item-review-card.tsx');
  assert.match(reviewCard, /<PickReplies pickId=\{pick\.id\} canWrite=\{Boolean\(pick\.canComment\)\}/,
    'Inline threads follow the viewer-scoped can_comment of the review');
  assert.match(reviewCard, /focusCommentId=\{threadFocus\?\.commentId\}/, 'Inline threads accept a focused comment');

  const itemDetail = source('app/item/[itemId].tsx');
  assert.doesNotMatch(itemDetail, /<Redirect href=\{\{ pathname: '\/pick\/\[pickId\]'/,
    'Comment notifications stay on the item detail instead of bouncing to a conversation screen');
  assert.match(itemDetail, /commentId: notificationKind === 'reply' \? rootCommentId : routeFocusCommentId/);
  assert.match(itemDetail, /initiallyExpanded=\{openThread && pick\.id === focusPickId\}/);

  const pickDetail = source('app/pick/[pickId].tsx');
  assert.match(pickDetail, /const routeItemId = typeof params\.itemId === 'string'/);
  assert.match(pickDetail, /usePickDetail\(pickId, user\?\.id, needsPickLookup\)/);
  assert.match(pickDetail, /const itemId = routeItemId \?\? pickQuery\.data\?\.pick\.itemId/);
  assert.match(pickDetail, /pathname: '\/item\/\[itemId\]', params: \{ itemId, pickId, thread: '1'/);
  assert.doesNotMatch(pickDetail, /✓ 이 집 원픽|✓ 원픽/);

  const myComments = source('components/profile-my-comments.tsx');
  assert.match(myComments, /commentService\.locateComment\(entry\.comment\.id\)/);
  assert.match(myComments, /focusCommentId: entry\.comment\.id/);
  assert.match(myComments, /commentAfterTime: location\.pageCursor\.timestamp/);

  console.log('Review comment contract checks passed: server can_comment, replies, flag UI, item-aware inline threads and exact my-comment location.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
