// Shared loader for tests whose module-under-test imports '@/lib/items/pickChannel'.
// The module has no imports of its own, so the real rules run in every harness.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exports_ = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/items/pickChannel.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_, URL });
module.exports = exports_;
