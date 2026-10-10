// Registration Footer vs SafeAreaView spacing contract.
// Offline regression: numeric inset edge cases plus all four CTA render branches.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const file = path.join(root, 'src/lib/pick/registrationFooterLayout.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});
assert.equal((compiled.diagnostics ?? []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
const compiledExports = {};
vm.runInNewContext(compiled.outputText, { exports: compiledExports }, { filename: file, timeout: 1000 });
const { registrationFooterPadding } = compiledExports;

const referenceBottom = 34;
for (const [deviceBottom, expectedPadding] of [
  [0, 34], [8, 26], [20, 14], [24, 10], [34, 0], [42, 0], [-5, 34], [NaN, 34],
]) {
  const padding = registrationFooterPadding(referenceBottom, deviceBottom);
  assert.equal(padding, expectedPadding, `device inset ${deviceBottom}`);
  const effectiveInset = Number.isFinite(deviceBottom) ? Math.max(0, deviceBottom) : 0;
  assert.ok(padding + effectiveInset >= referenceBottom, 'bottom edge clearance');
  assert.ok(padding >= 0, 'never use negative padding');
}

const screen = fs.readFileSync(path.join(root, 'src/app/pick/new.tsx'), 'utf8');
assert.match(screen, /<SafeAreaView style={styles.safe} edges={\['top', 'bottom'\]}>/, 'SafeAreaView owns physical safe-area inset');
assert.match(screen, /registrationFooterPadding\(OnePickLayout.safeAreaBottom, deviceBottomInset\)/);
assert.match(screen, /useSafeAreaInsets\(\)/);
const footerOccurrences = screen.match(/<View style={\[styles.footer, { paddingBottom: footerBottomPadding }\]}>/g) ?? [];
assert.equal(footerOccurrences.length, 4, 'link/store, menu, photo, review footers use the same padding');
assert.doesNotMatch(screen, /<View style={styles.footer}>/, 'no step bypasses inset-aware footer');
assert.match(screen, /minHeight: 52/, 'existing button height remains unchanged');
console.log('Registration footer safe-area contract: PASS');
