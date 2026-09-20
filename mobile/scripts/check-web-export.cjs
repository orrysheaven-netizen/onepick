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
  // Cloudflare Pages has a native SPA fallback, but redirects take priority over
  // real assets. A catch-all rewrite would also intercept the app's JS and CSS.
  const redirects = fs.readFileSync(path.join(dist, '_redirects'), 'utf8');
  assert.equal(redirects.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith('#')).length, 0,
    'Review explicit redirects before enabling them on the Pages test host');
  assert.ok(!fs.existsSync(path.join(dist, '404.html')), 'A root 404.html disables the Pages SPA fallback');
  const headers = fs.readFileSync(path.join(dist, '_headers'), 'utf8');
  assert.equal(headers, fs.readFileSync(path.join(root, 'public', '_headers'), 'utf8'), 'Test-host headers must be copied into the export');
  assert.match(headers, /https:\/\/:project\.pages\.dev\/\*\s+X-Robots-Tag: noindex/);
  assert.match(headers, /https:\/\/:version\.:project\.pages\.dev\/\*\s+X-Robots-Tag: noindex/);
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["']([^"']+\.(?:js|css))(?:\?[^"']*)?["']/g)].map((match) => match[1]))];
  assert.ok(assets.some((asset) => asset.endsWith('.js')), 'The exported page must load a JavaScript entry');

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
      '/', '/explore', '/profile', '/admin',
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
