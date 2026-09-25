const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/lib/safety/blockedUserLabel.ts'), 'utf8');
const result = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
const moduleExports = {};
vm.runInNewContext(result.outputText, { exports: moduleExports, module: { exports: moduleExports } });

assert.equal(moduleExports.HIDDEN_BLOCK_USERNAME_SNAPSHOT, 'private-user');
assert.equal(moduleExports.blockedUserDisplayName('private-user'), '비공개 사용자');
assert.equal(moduleExports.blockedUserDisplayName('private_user'), '@private_user');
assert.equal(moduleExports.blockedUserDisplayName('visible_qa'), '@visible_qa');

const migration = fs.readFileSync(
  path.join(root, '../supabase/migrations/20260926101000_use_unambiguous_block_username_sentinel.sql'),
  'utf8',
);
assert.match(migration, /then 'private-user'/);
assert.doesNotMatch('private-user', /^[a-z0-9_]{3,20}$/);
assert.match('private_user', /^[a-z0-9_]{3,20}$/);

console.log('Blocked user privacy label checks passed: impossible sentinel and visible username stay distinct.');
