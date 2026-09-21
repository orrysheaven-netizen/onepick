// Writes the default link preview tags into an exported index.html.
//
// Expo's `web.output: "single"` renders the page shell from its own template,
// so `app/+html.tsx` never runs and there is no build hook for the document
// head. The export therefore carries no Open Graph tags at all: a shared link
// pasted into a chat app renders as a bare URL. This step adds them once, right
// after the export, for both `dist` and `dist-release`.
//
// The tags sit between two `onepick:preview` markers so the Cloudflare Pages
// Function can swap that one region for the profile or Pick a link points at.
//
// Usage: node scripts/apply-link-preview-head.cjs [dist]
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadPreviewModule() {
  const source = fs.readFileSync(path.join(__dirname, '../src/lib/share/linkPreview.ts'), 'utf8');
  const moduleExports = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
    { exports: moduleExports, module: { exports: moduleExports } },
  );
  return moduleExports;
}

function applyPreviewHead(html, preview, origin) {
  const { PREVIEW_MARKER_NAME, defaultPreview, renderPreviewTags, replacePreviewRegion } = preview;
  const content = defaultPreview(origin);
  // Re-running over an already-processed export must not stack a second region.
  if (html.includes(`name="${PREVIEW_MARKER_NAME}"`)) return replacePreviewRegion(html, content);

  const region = `<meta name="${PREVIEW_MARKER_NAME}" content="start"/>`
    + renderPreviewTags(content)
    + `<meta name="${PREVIEW_MARKER_NAME}" content="end"/>`;
  const withRegion = html.replace(/<\/title>/i, `</title>${region}`);
  if (withRegion === html) throw new Error('Exported index.html has no <title> to anchor the preview tags to');
  return withRegion
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${content.title}</title>`)
    .replace(/<html\s+lang="[^"]*"/i, '<html lang="ko"');
}

function main() {
  const root = path.resolve(__dirname, '..');
  const dist = path.resolve(root, process.argv[2] || 'dist');
  const file = path.join(dist, 'index.html');
  const origin = process.env.EXPO_PUBLIC_SHARE_BASE_URL;
  const html = applyPreviewHead(fs.readFileSync(file, 'utf8'), loadPreviewModule(), origin);
  fs.writeFileSync(file, html);
  console.log(`Applied default link preview tags to ${path.relative(root, file)}${origin ? '' : ' (site-relative URLs)'}.`);
}

if (require.main === module) main();

module.exports = { applyPreviewHead, loadPreviewModule };
