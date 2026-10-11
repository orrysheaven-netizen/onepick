// Shared loader for tests whose module-under-test imports '@/lib/home/publicFoodScope' (#762).
// Its only import is the OnePick constants, so the real Home scope rules run in every harness.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const constants = require('./design-tokens.cjs');

const exports_ = {};
const require_ = (name) => {
  if (name === '@/constants/onepick') return constants;
  throw new Error('Unexpected publicFoodScope dependency: ' + name);
};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/lib/home/publicFoodScope.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exports_, require: require_ });
module.exports = exports_;
