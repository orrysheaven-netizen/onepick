const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relative) {
  return fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
}

const aiPanel = read('src/components/profile-ai-panel.tsx');
const taste = read('src/components/profile-taste-composition.tsx');
const adminShell = read('src/components/admin/admin-shell.tsx');
const qaPage = read('src/app/admin/profile-taste-qa.tsx');

assert.match(aiPanel, /previewStatus\?: ProfileAiStatus/);
assert.match(aiPanel, /useProfileAiStatus\(preview \? undefined : profileId\)/);
assert.match(aiPanel, /useProfileAiComment\(preview \? undefined : profileId\)/);
assert.match(aiPanel, /if \(!preview\) generate\.mutate\(\)/);
assert.match(aiPanel, /QA PREVIEW · 버튼은 실제 요청을 보내지 않아요/);

assert.match(taste, /previewValue\?: ProfileTasteCompositionValue/);
assert.match(taste, /useProfileTasteComposition\(previewValue \? undefined : profileId, viewerId\)/);
assert.match(taste, /const value = previewValue \?\? composition\.data/);

assert.match(adminShell, /\/admin\/profile-taste-qa/);
assert.match(adminShell, /취향 QA/);

assert.match(qaPage, /5개 · AI 평가 대기/);
assert.match(qaPage, /currentPickCount: 5/);
assert.match(qaPage, /reason: 'NEED_FIRST_PICKS'/);
assert.match(qaPage, /10개 · 최초 AI 평가/);
assert.match(qaPage, /currentPickCount: 10/);
assert.match(qaPage, /reason: 'READY_FIRST'/);
assert.match(qaPage, /width=\{390\}/);
assert.match(qaPage, /width=\{640\}/);
assert.match(qaPage, /previewValue=\{FIVE_COMPOSITION\}/);
assert.match(qaPage, /previewValue=\{TEN_COMPOSITION\}/);
assert.match(qaPage, /previewStatus=\{FIVE_STATUS\}/);
assert.match(qaPage, /previewStatus=\{TEN_STATUS\}/);
assert.match(qaPage, /실제 사용자 데이터와 네트워크 호출 없이/);
assert.match(qaPage, /AI 생성 요청이나 DB 변경을 실행하지 않습니다/);

console.log('Admin profile taste QA checks passed: guarded route, non-network previews, and 390/640px boundary fixtures.');
