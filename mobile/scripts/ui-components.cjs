// Loads the real UI kit (src/components/ui) for regression checks that render screens
// through a per-test module map. Pass that map so the kit shares the test's
// react-native and PickPhoto stubs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const uiDir = path.join(__dirname, '../src/components/ui');

function loadUi(imports = {}) {
  const cache = new Map();
  const load = (file) => {
    if (cache.has(file)) return cache.get(file);
    const exportsObject = {};
    cache.set(file, exportsObject);
    const source = fs.readFileSync(path.join(uiDir, file), 'utf8');
    vm.runInNewContext(
      ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText,
      {
        exports: exportsObject,
        require: (name) => {
          if (name === 'react' || name === 'react/jsx-runtime') return require(name);
          // Regression checks target the web build (like app-tabs.web.tsx), so the shared
          // Icon resolves to its inline-SVG variant instead of the expo-image native one.
          if (name === './icon') return load('icon.web.tsx');
          if (name.startsWith('./')) return load(fs.existsSync(path.join(uiDir, name + '.tsx')) ? name + '.tsx' : name + '.ts');
          if (name === '@/constants/onepick') return require('./design-tokens.cjs');
          if (name in imports) return imports[name];
          throw new Error('UI kit needs a stub for ' + name);
        },
      },
    );
    return exportsObject;
  };
  return load('index.ts');
}

module.exports = { loadUi };
