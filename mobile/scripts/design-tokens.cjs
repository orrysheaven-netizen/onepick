// Real design tokens for regression checks: screens import `@/constants/onepick`,
// and the per-test module maps hand this module back instead of a stub.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/constants/onepick.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
  { exports: exportsObject, module: { exports: exportsObject } },
);

module.exports = exportsObject;
