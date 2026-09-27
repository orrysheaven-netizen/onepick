const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const ts = require('typescript');
const fonts = require('./prepare-web-fonts.cjs');
const root = path.resolve(__dirname, '..');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`); }
const baseUrl = 'https://raw.githubusercontent.com/IBM/plex/763c36ef9117782905ae010056dfbe8fd2653a25/';
const fixtureFont = Buffer.alloc(48);
fixtureFont.write('wOF2'); fixtureFont.writeUInt32BE(48, 8);
const fixtureLicense = Buffer.from('SIL OPEN FONT LICENSE Version 1.1 test fixture');
const fixture = (file, kind, bytes, extra = {}) => ({ file, kind, size: bytes.length, sha: fonts.gitBlob(bytes), url: baseUrl + file, ...extra });
const entry = fixture('sample.woff2', 'woff2', fixtureFont, { family: 'Test Font', weight: '400' });
const license = fixture('OFL.txt', 'license', fixtureLicense);
const entries = [entry, license];
const response = (bytes, status = 200) => new Response(bytes, { status });
const source = (file) => fs.readFile(path.join(root, file), 'utf8');
async function moduleFrom(file, requireMock = () => { throw new Error('Unexpected import'); }) {
  const exports = {};
  const compiled = ts.transpileModule(await source(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  });
  assert.equal((compiled.diagnostics ?? []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(compiled.outputText, { exports, require: requireMock }, { timeout: 1000 });
  return exports;
}
async function main() {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'onepick-font-test-'));
  try {
    await test('sources are immutable, allowlisted and bounded', () => {
      fonts.SOURCES.forEach(fonts.validate);
      assert.equal(fonts.SOURCES.filter((e) => e.kind === 'license').length, 2);
      assert.deepEqual(fonts.SOURCES.filter((e) => e.family === 'IBM Plex Sans KR').map((e) => e.weight), ['400', '500', '600', '700']);
      assert.ok(fonts.SOURCES.filter((e) => e.kind !== 'license').reduce((sum, e) => sum + e.size, 0) < 1_900_000);
      for (const url of ['http://localhost/font.woff2', 'https://evil.example/font.woff2', baseUrl.replace(/[a-f0-9]{40}/, 'master') + 'font.woff2']) {
        assert.throws(() => fonts.validate({ ...entry, url }));
      }
    });
    await test('CSS is same-origin, optional and has no preload or local font shortcut', () => {
      const css = fonts.stylesheet();
      assert.equal((css.match(/@font-face/g) ?? []).length, 5);
      assert.equal((css.match(/font-display: optional/g) ?? []).length, 5);
      assert.doesNotMatch(css, /https?:|local\(|preload/);
      for (const e of fonts.SOURCES.filter((e) => e.kind !== 'license')) assert.ok(css.includes(fonts.filename(e)));
    });
    await test('integrity and binary format failures are rejected', () => {
      assert.equal(fonts.verify(entry, fixtureFont), fixtureFont);
      assert.throws(() => fonts.verify(entry, Buffer.alloc(48)), /integrity/);
      const invalid = Buffer.alloc(48);
      assert.throws(() => fonts.verify({ ...entry, sha: fonts.gitBlob(invalid) }, invalid), /WOFF2/);
      assert.throws(() => fonts.verify({ ...entry, size: 49 }, fixtureFont), /integrity/);
    });
    await test('download rejects redirects, HTTP errors and excess bytes', async () => {
      await fonts.download(entry, async (url, options) => {
        assert.equal(url, entry.url); assert.equal(options.redirect, 'error'); assert.ok(options.signal);
        return response(fixtureFont);
      });
      await assert.rejects(fonts.download(entry, async () => response('not found', 404)), /HTTP 404/);
      await assert.rejects(fonts.download(entry, async () => response(Buffer.alloc(49))), /exceeds/);
    });
    let calls = 0;
    const fetcher = async (url) => { calls++; return response(url.endsWith('OFL.txt') ? fixtureLicense : fixtureFont); };
    const output = path.join(temporary, 'public');
    await test('cold prepare verifies fonts and license before publishing CSS', async () => {
      await fonts.prepare(output, { entries, fetcher });
      assert.equal(calls, 2); await fonts.check(output, entries);
    });
    await test('verified warm cache works entirely offline', async () => {
      await fonts.prepare(output, { entries, fetcher: async () => { throw new Error('Network must not run'); } });
      await fonts.check(output, entries);
    });
    await test('corrupt cached data is repaired and checked', async () => {
      await fs.writeFile(path.join(output, fonts.ASSET_DIR, fonts.filename(entry)), 'bad');
      await fonts.prepare(output, { entries, fetcher });
      assert.equal(calls, 3); await fonts.check(output, entries);
    });
    await test('failed license download cannot publish CSS', async () => {
      const failed = path.join(temporary, 'failed');
      await assert.rejects(fonts.prepare(failed, { entries, fetcher: async (url) => url.endsWith('OFL.txt') ? response('failed', 503) : response(fixtureFont) }), /HTTP 503/);
      await assert.rejects(fs.stat(path.join(failed, fonts.ASSET_DIR, fonts.cssFilename(entries))), { code: 'ENOENT' });
    });
    await test('export validation detects missing or altered output', async () => {
      await fs.writeFile(path.join(output, fonts.ASSET_DIR, fonts.cssFilename(entries)), 'wrong');
      await assert.rejects(fonts.check(output, entries), /CSS/);
      await fs.rm(path.join(output, fonts.ASSET_DIR, fonts.filename(entry)));
      await assert.rejects(fonts.check(output, entries), { code: 'ENOENT' });
    });
    await test('standard web and release builds prepare and verify copied output', async () => {
      const pkg = JSON.parse(await source('package.json'));
      for (const k of ['preweb', 'prebuild:web', 'prebuild:web:release']) assert.equal(pkg.scripts[k], 'node scripts/prepare-web-fonts.cjs');
      assert.equal(pkg.scripts['postbuild:web'], 'node scripts/prepare-web-fonts.cjs --check dist');
      assert.equal(pkg.scripts['postbuild:web:release'], 'node scripts/prepare-web-fonts.cjs --check dist-release');
      assert.equal(pkg.scripts['check:web:release-env'], 'node scripts/build-web-release.cjs --check');
      const html = await source('public/index.html');
      assert.ok(html.includes(`rel="stylesheet" href="/${fonts.ASSET_DIR}/${fonts.cssFilename()}"`));
      assert.doesNotMatch(html, /fonts\.google|fonts\.gstatic|rel="preload"[^>]*as="font"/);
    });
    await test('font CSS uses a content hash under the existing immutable asset prefix', () => {
      assert.match(fonts.ASSET_DIR, /^assets\//);
      assert.match(fonts.cssFilename(), /^fonts-[a-f0-9]{64}\.css$/);
      assert.notEqual(fonts.cssFilename(entries), fonts.cssFilename([{ ...entry, weight: '500' }, license]));
    });
    const webFamilies = await moduleFrom('src/constants/font-family.web.ts');
    await test('shared Text scales use web families and preserve native defaults', async () => {
      for (const platform of ['web', 'native']) {
        const family = platform === 'web' ? webFamilies : await moduleFrom('src/constants/font-family.ts');
        const tokens = await moduleFrom('src/constants/onepick.ts', (id) => { assert.equal(id, './font-family'); return family; });
        for (const value of Object.values(tokens.OnePickType)) assert.equal(value.fontFamily, platform === 'web' ? webFamilies.BodyFont : undefined);
        assert.equal(tokens.OnePickType.label.fontSize, 13);
        assert.equal(tokens.OnePickType.label.fontWeight, '600');
      }
    });
    await test('ThemedText applies body/English families without overriding code or caller styles', async () => {
      const jsx = (type, props) => ({ type, props });
      const mocks = {
        'react/jsx-runtime': { jsx },
        'react-native': { Text: 'Text', StyleSheet: { create: (s) => s }, Platform: { select: () => undefined } },
        '@/constants/font-family': webFamilies,
        '@/constants/theme': { Fonts: { mono: 'monospace' } },
        '@/hooks/use-theme': { useTheme: () => ({ text: '#141416' }) },
        '@/constants/onepick': { OnePick: { accent: '#141416' } },
      };
      const { ThemedText } = await moduleFrom('src/components/themed-text.tsx', (id) => { assert.ok(id in mocks, id); return mocks[id]; });
      const resolved = (props) => Object.assign({}, ...ThemedText(props).props.style.filter(Boolean));
      assert.equal(resolved({}).fontFamily, webFamilies.BodyFont);
      assert.equal(resolved({ font: 'english' }).fontFamily, webFamilies.EnglishFont);
      assert.equal(resolved({ type: 'code' }).fontFamily, 'monospace');
      assert.equal(resolved({ style: { fontFamily: 'override' } }).fontFamily, 'override');
      assert.equal(ThemedText({ accessibilityLabel: '글꼴 확인' }).props.accessibilityLabel, '글꼴 확인');
    });
    console.log(`Web font checks: ${passed}/13 passed (offline fixtures; not a live app test).`);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
