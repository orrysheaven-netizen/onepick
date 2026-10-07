// Loads the real dialog copy contract (src/components/ui/dialog-labels.ts) for regression checks,
// so screens rendered through a per-test module map share the production "닫기"/"취소" labels.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const exportsObject = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/ui/dialog-labels.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText,
  { exports: exportsObject },
);

module.exports = exportsObject;
