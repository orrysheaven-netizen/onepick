// Checks the exported bundle over HTTP using the same SPA server as preview:web.
// This does not execute app JavaScript, log in, or contact Supabase.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');

async function main() {
  const root = path.resolve(__dirname, '..');
  const dist = path.resolve(root, process.argv[2] || 'dist');
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  assert.equal(config.expo.web.output, 'single', 'Dynamic user content needs the configured SPA fallback');
  const routerPlugin = config.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-router');
  assert.equal(routerPlugin?.[1]?.asyncRoutes?.web, true,
    'SDK 57 web exports must keep Expo Router async routes enabled for route-level code splitting');
  assert.equal(routerPlugin?.[1]?.asyncRoutes?.default, false,
    'Async routes remain web-only so native behavior is unchanged');
  // Cloudflare Pages has a native SPA fallback, but redirects take priority over
  // real assets. A catch-all rewrite would also intercept the app's JS and CSS.
  const redirects = fs.readFileSync(path.join(dist, '_redirects'), 'utf8');
  assert.equal(redirects.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length, 0,
    'Review explicit redirects before enabling them on the Pages test host');
  assert.ok(!fs.existsSync(path.join(dist, '404.html')), 'A root 404.html disables the Pages SPA fallback');
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.equal(headers, fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8'), 'Test-host headers must be copied into the export');
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex\n/);
  assert.match(headers, /https:\/\/:version\.:project\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex\n/);
  // Web photo selection hands blob: object URLs to expo-image-manipulator; blocking them fails every upload as PHOTO_INVALID.
  assert.match(headers, /Content-Security-Policy:[^\n]*\bimg-src [^;\n]*\bblob:/, 'CSP img-src must allow blob: so web photo uploads can decode picked images');
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)].map((match) => match[1]))];
  assert.ok(assets.some((asset) => asset.endsWith('.js')), 'The exported page must load a JavaScript entry');

  // Repeat visits should not re-download the multi-megabyte bundle. Pages joins
  // the Cache-Control of every matching rule with a comma instead of letting a
  // later rule win, so exactly the content-hashed prefixes may declare one.
  const rules = [];
  for (const line of headers.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const [name, ...rest] = line.trim().split(':');
      assert.ok(rules.length, `Header outside any rule: ${line}`);
      rules[rules.length - 1].headers[name.trim().toLowerCase()] = rest.join(':').trim();
    } else {
      rules.push({ pattern: line.trim(), headers: {} });
    }
  }
  const cached = rules.filter((rule) => 'cache-control' in rule.headers);
  assert.deepEqual(cached.map((rule) => rule.pattern), ['/_expo/static/*', '/assets/*'],
    'Only the content-hashed export prefixes may set Cache-Control; a second matching rule would join, not override');
  for (const rule of cached) {
    assert.equal(rule.headers['cache-control'], 'public, max-age=31536000, immutable');
  }
  const longCached = cached.map((rule) => rule.pattern.replace(/\*$/, ''));
  for (const asset of assets) {
    assert.ok(longCached.some((prefix) => asset.startsWith(prefix)),
      `${asset} is served without long-lived caching; every hashed export path must sit under ${longCached.join(' or ')}`);
  }
  // index.html names new hashed assets on each release. It must keep Pages'
  // normal revalidation behavior instead of inheriting a long browser TTL.
  assert.ok(!longCached.some((prefix) => '/index.html'.startsWith(prefix)),
    'The SPA entry document must stay revalidated');

  const metaContent = (needle) => {
    const tag = [...html.matchAll(/<meta\b[^>]*>/g)].map((match) => match[0]).find((candidate) => candidate.includes(needle));
    return tag?.match(/content=["']([^"']+)["']/)?.[1] ?? null;
  };
  assert.match(html, /<title>OnePick \| 나의 원픽으로 취향을 보여주세요<\/title>/,
    'The static app shell needs a useful default title for JS-less crawlers');
  assert.equal(metaContent('name="description"'),
    '카테고리마다 하나의 원픽을 고르고, 한줄평과 함께 나의 취향을 보여주세요.');
  assert.equal(metaContent('property="og:title"'), 'OnePick | 나의 원픽으로 취향을 보여주세요');
  assert.equal(metaContent('property="og:site_name"'), 'OnePick');
  assert.equal(metaContent('property="og:type"'), 'website');
  assert.equal(metaContent('property="og:description"'),
    '카테고리마다 하나의 원픽을 고르고, 한줄평과 함께 나의 취향을 보여주세요.');
  assert.match(metaContent('property="og:image"') ?? '', /^https:\/\/[^\s]+\/og-default\.png$/,
    'Default OG image must be an absolute HTTPS URL');
  assert.equal(metaContent('name="twitter:card"'), 'summary');
  assert.equal(metaContent('name="twitter:image"'), metaContent('property="og:image"'));
  const defaultOgImage = path.join(dist, 'og-default.png');
  assert.ok(fs.existsSync(defaultOgImage), 'Default OG image must be copied into the export');
  assert.ok(fs.statSync(defaultOgImage).size > 10_000, 'Default OG image must be a real image, not an empty placeholder');

  const deploymentPath = path.join(dist, 'deployment.json');
  if (fs.existsSync(deploymentPath)) {
    const deployment = JSON.parse(fs.readFileSync(deploymentPath, 'utf8'));
    assert.deepEqual(
      Object.keys(deployment).sort(),
      ['branch', 'commitSha', 'deploymentUrl'],
      'deployment.json must expose only the expected public deployment identifiers',
    );
    for (const key of ['branch', 'commitSha', 'deploymentUrl']) {
      assert.ok(
        deployment[key] === null || typeof deployment[key] === 'string',
        `deployment.json ${key} must be a string or null`,
      );
    }
    if (deployment.commitSha !== null) {
      assert.match(deployment.commitSha, /^[0-9a-f]{7,64}$/i, 'Cloudflare commit SHA must look like a Git commit');
    }
    if (deployment.deploymentUrl !== null) {
      assert.match(deployment.deploymentUrl, /^https:\/\//, 'Cloudflare deployment URL must be HTTPS');
    }
  }

  const probe = net.createServer();
  await new Promise((resolve, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', resolve); });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, [
    require.resolve('serve/build/main.js'), dist, '--single', '--no-clipboard',
    '--no-request-logging', '--no-port-switching', '--listen', `tcp://127.0.0.1:${port}`,
  ], { cwd: root, env: { ...process.env, CI: '1', NO_UPDATE_CHECK: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', launchError;
  server.stdout.on('data', (chunk) => { output += chunk; });
  server.stderr.on('data', (chunk) => { output += chunk; });
  server.on('error', (error) => { launchError = error; });
  const stopped = new Promise((resolve) => server.once('close', resolve));
  try {
    let ready = false;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw new Error(`Preview server exited: ${output}`);
      try {
        const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
        await response.arrayBuffer();
        if (response.ok) { ready = true; break; }
      } catch { /* Server is still starting. */ }
      await delay(100);
    }
    assert.ok(ready, `Preview server did not start: ${output}`);

    const routes = [
      '/', '/explore', '/comments', '/profile', '/admin',
      '/item/20000000-0000-0000-0000-000000000001',
      '/pick/661201d7-ad86-444f-b280-6c964b309c78',
      '/u/onepick_qa', '/u/new_user_created_after_build',
      '/pick/choose?itemId=new-item',
      '/auth/callback?action=choose_pick&itemId=new-item',
    ];
    for (const route of routes) {
      const response = await fetch(origin + route, { redirect: 'manual', signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200, `Direct route failed: ${route}`);
      assert.match(response.headers.get('content-type'), /text\/html/);
      assert.equal(await response.text(), html, `Route must keep its URL and receive the app shell: ${route}`);
    }
    for (const asset of assets) {
      assert.ok(asset.startsWith('/') && !asset.startsWith('//'), `Unexpected external asset: ${asset}`);
      const response = await fetch(origin + asset, { signal: AbortSignal.timeout(5_000) });
      assert.equal(response.status, 200, asset);
      assert.doesNotMatch(response.headers.get('content-type'), /text\/html/, 'Assets must not receive the SPA fallback');
      const local = fs.readFileSync(path.join(dist, decodeURIComponent(asset)));
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), local, `Exported asset differs: ${asset}`);
    }
    console.log(`Web export checks passed: ${routes.length} direct routes, ${assets.length} real assets, callback query and SPA fallback.`);
  } finally {
    server.kill();
    await stopped;
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
