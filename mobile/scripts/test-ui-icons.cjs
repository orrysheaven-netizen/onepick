// Foundations icon rule (Toss UX guide item 5, 2026-10-06):
// - primary action icons are 24px (icon/size/md), supporting marks 16px (icon/size/sm) — no per-screen sizes
// - UI icons are drawn assets from the shared Icon set, never text glyphs (‹ › × ⋯ ✓ …)
// - native SVG assets are generated from the same geometry as the web inline SVG
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const tokens = require('./design-tokens.cjs');
const { expected } = require('./generate-ui-icons.cjs');

const root = path.resolve(__dirname, '../src');
const { OnePick, OnePickIcon } = tokens;

assert.deepEqual({ sm: OnePickIcon.sm, md: OnePickIcon.md }, { sm: 16, md: 24 }, 'two shared icon sizes only');

// 1. Generated native assets match icon-paths.ts.
for (const [file, content] of Object.entries(expected())) {
  const target = path.join(__dirname, '../public/icons/ui', file);
  assert.ok(fs.existsSync(target), `${file} missing — run node scripts/generate-ui-icons.cjs`);
  assert.equal(fs.readFileSync(target, 'utf8'), content, `${file} is stale — run node scripts/generate-ui-icons.cjs`);
}

// 2. Web Icon renders inline SVG at token sizes with the requested color.
function load(file, imports) {
  const exportsObject = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports: exportsObject, require: (name) => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === '@/constants/onepick') return tokens;
    if (name in imports) return imports[name];
    throw new Error(`Unexpected import: ${name}`);
  } });
  return exportsObject;
}
const paths = load('components/ui/icon-paths.ts', {});
const { Icon } = load('components/ui/icon.web.tsx', { './icon-paths': paths });
const html = (props) => renderToStaticMarkup(React.createElement(Icon, props));
assert.match(html({ name: 'back' }), /<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#141416" stroke-width="1.8"/, 'md = 24, text/primary by default');
assert.match(html({ name: 'chevronRight', size: 'sm', color: OnePick.textTertiary }), /<svg width="16" height="16"[^>]*stroke="#8A909C"/, 'sm = 16 with the given color');
assert.match(html({ name: 'back' }), /aria-hidden="true"/, 'icons are decorative; the control carries the label');
assert.match(html({ name: 'home', filled: true, color: OnePick.actionPrimary }), /<path d="[^"]+" fill="#141416"/, 'active Home fills with the icon color');
assert.match(html({ name: 'clear', size: 'sm', color: OnePick.textTertiary }), /<circle[^>]*fill="#8A909C"[^>]*><\/circle><path[^>]*stroke="#FFFFFF"/, 'clear is two-tone: tertiary circle, white ×');
for (const name of paths.ICON_NAMES) assert.ok(html({ name }).includes(`data-icon="${name}"`), name);

// 3. No text-glyph UI icons remain in app/components. Admin is included; category-path punctuation inside copy is allowed.
const GLYPH_ICON = /<Text[^>]*>\s*[‹›×✕⋯⇪⌄⌃✓✔＋]\s*<\/Text>|\{isCollapsed \? '⌄'/;
const offenders = [];
function visit(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (entry.isDirectory()) { visit(full); continue; }
    if (!/\.tsx$/.test(entry.name)) continue;
    const source = fs.readFileSync(full, 'utf8');
    if (GLYPH_ICON.test(source)) offenders.push(rel);
  }
}
visit(root);
assert.deepEqual(offenders, [], 'UI icons come from <Icon>, not Unicode glyphs in <Text>');

// 4. No ad-hoc icon sizes for the primary tab bar: the web tab bar uses the shared md icon.
const tabs = fs.readFileSync(path.join(root, 'components/app-tabs.web.tsx'), 'utf8');
assert.match(tabs, /<Icon name=\{TAB_ICON\[name\]\} size="md"/, 'tab icons are 24px shared icons');
assert.doesNotMatch(tabs, /<svg width="23"/, 'no 23px tab icons');

const nativeTabs = fs.readFileSync(path.join(root, 'components/app-tabs.tsx'), 'utf8');
assert.match(nativeTabs, /sf=\{\{ default: 'house', selected: 'house\.fill' \}\}/, 'native Home keeps the platform symbol');
assert.match(nativeTabs, /sf="square\.grid\.2x2"/, 'native Explore keeps the platform symbol');
assert.match(nativeTabs, /sf=\{\{ default: 'bell', selected: 'bell\.fill' \}\}/, 'native Notifications keeps the platform symbol');
assert.match(nativeTabs, /sf=\{\{ default: 'person', selected: 'person\.fill' \}\}/, 'native Profile keeps the platform symbol');

console.log('UI icon checks passed: 16/24 size tokens, generated assets in sync, web Icon rendering, no glyph icons.');
