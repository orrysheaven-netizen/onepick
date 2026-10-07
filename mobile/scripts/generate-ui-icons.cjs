// Writes public/icons/ui/<name>.svg from src/components/ui/icon-paths.ts so the
// native Icon (expo-image) draws exactly what the web Icon (inline SVG) draws.
// Run after changing icon-paths.ts: `node scripts/generate-ui-icons.cjs`.
// `--check` exits non-zero when the files on disk are out of date (used by tests).
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { OnePick, OnePickIcon } = require('./design-tokens.cjs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'public', 'icons', 'ui');

function loadShapes() {
  const source = fs.readFileSync(path.join(root, 'src/components/ui/icon-paths.ts'), 'utf8');
  const exportsObject = {};
  vm.runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: exportsObject, module: { exports: exportsObject } },
  );
  return exportsObject;
}

function render(name, shapes, { filled = false, color: baseColor = OnePick.textPrimary, viewBox }) {
  const twoTone = name === 'clear';
  // The clear mark is fixed two-tone on native (no tint): text/tertiary circle + white ×.
  const color = twoTone ? OnePick.textTertiary : baseColor;
  const body = shapes.map((shape) => {
    if (shape.type === 'path') {
      const attrs = [`d="${shape.d}"`];
      if (twoTone) attrs.push(`stroke="${OnePick.onAction}"`);
      if (filled) attrs.push(`fill="${color}"`);
      return `<path ${attrs.join(' ')}/>`;
    }
    if (shape.type === 'circle') {
      const attrs = [`cx="${shape.cx}"`, `cy="${shape.cy}"`, `r="${shape.r}"`];
      if (shape.filled || filled) attrs.push(`fill="${color}"`);
      if (shape.filled) attrs.push('stroke="none"');
      return `<circle ${attrs.join(' ')}/>`;
    }
    const attrs = [`x="${shape.x}"`, `y="${shape.y}"`, `width="${shape.w}"`, `height="${shape.h}"`, `rx="${shape.rx}"`];
    if (filled) attrs.push(`fill="${color}"`);
    return `<rect ${attrs.join(' ')}/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${viewBox}" height="${viewBox}" viewBox="0 0 ${viewBox} ${viewBox}" fill="none" stroke="${color}" stroke-width="${OnePickIcon.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
}

function expected() {
  const { ICON_SHAPES, ICON_VIEWBOX } = loadShapes();
  const files = {};
  for (const [name, shapes] of Object.entries(ICON_SHAPES)) files[`${name}.svg`] = render(name, shapes, { viewBox: ICON_VIEWBOX });
  files['home-filled.svg'] = render('home', ICON_SHAPES.home, { viewBox: ICON_VIEWBOX, filled: true });
  return files;
}

function main() {
  const files = expected();
  const check = process.argv.includes('--check');
  const stale = [];
  fs.mkdirSync(outDir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    const target = path.join(outDir, file);
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
    if (current === content) continue;
    if (check) stale.push(file);
    else fs.writeFileSync(target, content);
  }
  if (check && stale.length) {
    console.error(`public/icons/ui is out of date: ${stale.join(', ')}. Run node scripts/generate-ui-icons.cjs`);
    process.exitCode = 1;
  } else if (!check) {
    console.log(`Wrote ${Object.keys(files).length} UI icons to public/icons/ui`);
  }
}

if (require.main === module) main();
module.exports = { expected, render };
