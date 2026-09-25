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
  { exports: exportsObject, module: { exports: exportsObject }, require: (id) => {
    if (id !== './font-family') throw new Error(`Unexpected token dependency: ${id}`);
    // Node checks use the native/default variant, matching Metro's platform split.
    const familySource = fs.readFileSync(path.join(__dirname, '../src/constants/font-family.ts'), 'utf8');
    const families = {};
    vm.runInNewContext(ts.transpileModule(familySource, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: families });
    return families;
  } },
);

module.exports = exportsObject;
