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
    require: (name) => {
      if (name in imports) return imports[name];
      assert.fail(name);
    },
  });
  return exports;
}

async function main() {
  let invokeName, invokeBody, rpcName, rpcArgs;
  let functionData = {
    itemId: 'item-a',
    suggestions: [
      { categoryId: 'cat-a', label: '테크 › 키보드', reason: '제품명이 키보드 제품과 직접 연결됩니다.', confidence: 'high' },
    ],
    categories: [
      { categoryId: 'cat-a', label: '테크 › 키보드' },
      { categoryId: 'cat-b', label: '쓰는것 › 노트' },
    ],
    needsNewCategory: false,
    reused: false,
  };
  let rpcData = { type: 'classified', itemId: 'item-a', categoryId: 'cat-a' };
  const supabase = {
    functions: {
      invoke: async (name, options) => {
        invokeName = name; invokeBody = options.body;
        return { data: functionData, error: null };
      },
    },
    rpc: async (name, args) => {
      rpcName = name; rpcArgs = args;
      return { data: rpcData, error: null };
    },
  };

  const { itemCategoryAiService } = load('services/itemCategoryAiService.ts', {
    '@/lib/supabase/client': { supabase },
  });

  const suggested = await itemCategoryAiService.suggest('item-a');
  assert.equal(invokeName, 'suggest-item-categories');
  assert.equal(invokeBody.itemId, 'item-a');
  assert.equal(suggested.suggestions[0].categoryId, 'cat-a');
  assert.equal(suggested.categories.length, 2);
  assert.equal(suggested.needsNewCategory, false);

  const applied = await itemCategoryAiService.apply('item-a', 'cat-a');
  assert.equal(rpcName, 'classify_pending_item');
  assert.equal(rpcArgs.p_item_id, 'item-a');
  assert.equal(rpcArgs.p_category_id, 'cat-a');
  assert.equal(applied.type, 'classified');

  rpcData = { type: 'existing_item', itemId: 'existing', categoryId: 'cat-a' };
  const existing = await itemCategoryAiService.apply('item-a', 'cat-a');
  assert.equal(existing.type, 'existing_item');
  assert.equal(existing.itemId, 'existing');

  functionData = { itemId: 'item-a', suggestions: [{ categoryId: '', label: '', reason: '', confidence: 'high' }], categories: [] };
  await assert.rejects(() => itemCategoryAiService.suggest('item-a'), /ITEM_CATEGORY_AI_INVALID/);

  console.log('Item category AI checks passed: suggestions are parsed, category writes require explicit apply, and invalid payloads fail closed.');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
