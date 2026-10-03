const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const screen = read('src/app/pick/[pickId].tsx');
const replies = read('src/components/pick-replies.tsx');

assert.match(screen, /<ReviewRow[\s\S]*?review=\{/);
assert.match(screen, /currentPick=\{Boolean\(focused\.pick\.isCurrent\)\}/);
assert.doesNotMatch(screen, /이전 한줄평|다음 한줄평/, 'MVP conversation stays on one selected review');

assert.match(replies, /<CommentRow/);
assert.match(replies, /reply=\{isReply\}/);
assert.match(replies, /time=\{formatRelativeTime\(comment\.createdAt\)\}/);
assert.match(replies, /showReply=\{!isReply && canComment\}/);
assert.match(replies, /onProfilePress=\{author \?/);
assert.match(replies, /댓글을 삭제할까요\? 답글이 있으면 대화 자리는 남습니다\./, 'CRUD confirmation remains intact');
assert.match(replies, /ReportAction/, 'comment reporting remains intact');
assert.match(replies, /focusCommentId/, 'notification focus remains intact');
assert.match(replies, /fetchNextPage/, 'pagination remains intact');

console.log('Figma 72 shared-row checks passed: one-review focus, ReviewRow/CommentRow, relative time and preserved thread controls.');
