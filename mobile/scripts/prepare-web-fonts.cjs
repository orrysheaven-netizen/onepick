// Build-time only. Browsers receive these verified assets from the app's origin.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const IBM = 'https://raw.githubusercontent.com/IBM/plex/763c36ef9117782905ae010056dfbe8fd2653a25/packages/plex-sans-kr';
const GOOGLE = 'https://raw.githubusercontent.com/google/fonts/23e54b51ddffbc7713c583748e3bd86f62b1fa4a/ofl/outfit';
const SOURCES = [
  { file: 'ibm-400.woff2', family: 'IBM Plex Sans KR', weight: '400', kind: 'woff2', size: 438540, sha: '9d9830af74c8fd1a113a716cc4b5bb0d1ec85eeb', url: `${IBM}/fonts/complete/woff2/hinted/IBMPlexSansKR-Regular.woff2` },
  { file: 'ibm-500.woff2', family: 'IBM Plex Sans KR', weight: '500', kind: 'woff2', size: 439816, sha: '289bb2363e13a54f0e3f766205744e234761790c', url: `${IBM}/fonts/complete/woff2/hinted/IBMPlexSansKR-Medium.woff2` },
  { file: 'ibm-600.woff2', family: 'IBM Plex Sans KR', weight: '600', kind: 'woff2', size: 434484, sha: 'd8395197f4e4f163cb3ae310ba544564a7f79830', url: `${IBM}/fonts/complete/woff2/hinted/IBMPlexSansKR-SemiBold.woff2` },
  { file: 'ibm-700.woff2', family: 'IBM Plex Sans KR', weight: '700', kind: 'woff2', size: 370492, sha: 'ca72e851b9a8f80f4dccfa5fe5c3da53dc704249', url: `${IBM}/fonts/complete/woff2/hinted/IBMPlexSansKR-Bold.woff2` },
  { file: 'outfit-variable.ttf', family: 'Outfit', weight: '100 900', kind: 'ttf', size: 110884, sha: '466d6245f9582df39bf73da91a8b3c938fd061cd', url: `${GOOGLE}/Outfit%5Bwght%5D.ttf` },
  { file: 'IBM-OFL.txt', kind: 'license', size: 4456, sha: 'c35c4c618fab33da8695177b3a6cefe0810b7b28', url: `${IBM}/LICENSE.txt` },
  { file: 'Outfit-OFL.txt', kind: 'license', size: 4389, sha: '723cd447edee83ed3bb07c3343f478d352aa7440', url: `${GOOGLE}/OFL.txt` },
];
const ASSET_DIR = 'fonts/onepick';
const gitBlob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const filename = (entry) => `${entry.sha}-${entry.file}`;

function validate(entry) {
  const url = new URL(entry.url);
  if (!/^[a-zA-Z0-9._-]+$/.test(entry.file) || !/^[a-f0-9]{40}$/.test(entry.sha)
    || !Number.isInteger(entry.size) || entry.size < 1 || entry.size > 2_000_000
    || url.origin !== 'https://raw.githubusercontent.com' || url.search || url.hash
    || !/^\/(?:IBM\/plex|google\/fonts)\/[a-f0-9]{40}\//.test(url.pathname)
    || !['woff2', 'ttf', 'license'].includes(entry.kind)) throw new Error('Invalid pinned font source');
}
function verify(entry, bytes) {
  validate(entry);
  if (bytes.length !== entry.size || gitBlob(bytes) !== entry.sha) throw new Error(`Font integrity mismatch: ${entry.file}`);
  if (entry.kind === 'woff2' && (bytes.length < 48 || bytes.toString('ascii', 0, 4) !== 'wOF2' || bytes.readUInt32BE(8) !== bytes.length)) throw new Error(`Invalid WOFF2: ${entry.file}`);
  if (entry.kind === 'ttf' && (bytes.length < 12 || bytes.readUInt32BE(0) !== 0x00010000)) throw new Error(`Invalid TTF: ${entry.file}`);
  if (entry.kind === 'license' && !bytes.toString('utf8').includes('SIL OPEN FONT LICENSE')) throw new Error(`Missing OFL: ${entry.file}`);
  return bytes;
}
function stylesheet(entries = SOURCES) {
  entries.forEach(validate);
  return '/* Generated from pinned, unmodified upstream assets. See docs/brand-web-fonts.md. */\n'
    + entries.filter((e) => e.kind !== 'license').map((e) => {
      if (!/^[A-Za-z ]+$/.test(e.family) || !/^\d{3}( \d{3})?$/.test(e.weight)) throw new Error('Invalid font descriptor');
      return `@font-face {\n  font-family: '${e.family}';\n  font-style: normal;\n  font-weight: ${e.weight};\n  font-display: optional;\n  src: url('./${filename(e)}') format('${e.kind === 'ttf' ? 'truetype' : 'woff2'}');\n}\n`;
    }).join('');
}
async function download(entry, fetcher = fetch) {
  validate(entry);
  const response = await fetcher(entry.url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
  if (!response.ok || !response.body) throw new Error(`Font download failed: ${entry.file} (HTTP ${response.status})`);
  const chunks = [];
  let count = 0;
  for await (const chunk of response.body) {
    count += chunk.length;
    if (count > entry.size) throw new Error(`Font download exceeds pinned size: ${entry.file}`);
    chunks.push(Buffer.from(chunk));
  }
  return verify(entry, Buffer.concat(chunks));
}
async function prepare(root, { entries = SOURCES, fetcher = fetch } = {}) {
  entries.forEach(validate);
  const directory = path.join(root, ASSET_DIR);
  await fs.mkdir(directory, { recursive: true });
  // A verified warm build needs no external network requests.
  for (const entry of entries) {
    const target = path.join(directory, filename(entry));
    try { verify(entry, await fs.readFile(target)); continue; }
    catch (error) { if (error.code && error.code !== 'ENOENT') throw error; }
    const bytes = await download(entry, fetcher);
    const temporary = `${target}.${process.pid}.tmp`;
    try { await fs.writeFile(temporary, bytes); await fs.rename(temporary, target); }
    finally { await fs.rm(temporary, { force: true }); }
  }
  // Publish CSS only after all fonts AND licenses have passed verification.
  const css = path.join(directory, 'fonts.css');
  const temporary = `${css}.${process.pid}.tmp`;
  try { await fs.writeFile(temporary, stylesheet(entries)); await fs.rename(temporary, css); }
  finally { await fs.rm(temporary, { force: true }); }
}
async function check(root, entries = SOURCES) {
  for (const entry of entries) verify(entry, await fs.readFile(path.join(root, ASSET_DIR, filename(entry))));
  if (await fs.readFile(path.join(root, ASSET_DIR, 'fonts.css'), 'utf8') !== stylesheet(entries)) throw new Error('Font CSS does not match pinned sources');
}
async function main() {
  const args = process.argv.slice(2);
  const mobile = path.resolve(__dirname, '..');
  if (args.length === 0) {
    await prepare(path.join(mobile, 'public'));
    await check(path.join(mobile, 'public'));
    console.log('Verified same-origin web fonts and licenses.');
  } else if (args.length === 2 && args[0] === '--check' && ['public', 'dist', 'dist-release'].includes(args[1])) {
    await check(path.join(mobile, args[1]));
    console.log('Exported web fonts and licenses verified.');
  } else throw new Error('Usage: prepare-web-fonts.cjs [--check public|dist|dist-release]');
}
module.exports = { SOURCES, ASSET_DIR, gitBlob, filename, validate, verify, stylesheet, download, prepare, check };
if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });
