const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '../..');
const source = fs.readFileSync(
  path.join(root, 'supabase/functions/_shared/externalCatalogGuard.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, {
  exports, Request, TextEncoder, Uint8Array, crypto: webcrypto,
  require: (name) => name === '@supabase/supabase-js' ? {} : require(name),
});

async function main() {
  const calls = [];
  const client = {
    auth: {
      getUser: async () => ({
        data: { user: { id: 'caller-user', is_anonymous: false } },
        error: null,
      }),
    },
    rpc: async (name, args) => {
      calls.push([name,args]);
      return { data: true, error: null };
    },
  };
  const req = new Request('https://edge.test', {
    headers: {
      Authorization: 'Bearer user-jwt',
      'cf-connecting-ip': '203.0.113.10',
    },
  });

  assert.equal(
    await exports.reserveExternalCatalogCaller(client,'tmdb',req),
    true,
  );
  assert.equal(calls[0][0],'reserve_external_catalog_caller');
  assert.equal(calls[0][1].p_provider,'tmdb');
  assert.equal(calls[0][1].p_user_id,'caller-user');
  assert.match(calls[0][1].p_ip_hash,/^[0-9a-f]{64}$/);
  assert.equal(
    calls[0][1].p_ip_hash.includes('203.0.113.10'),
    false,
    'raw caller IP is never sent to quota storage',
  );

  const anonymousCalls = [];
  const anonymousClient = {
    auth: { getUser: async () => assert.fail('no token means no auth lookup') },
    rpc: async (name,args) => {
      anonymousCalls.push([name,args]);
      return { data: true, error: null };
    },
  };
  const anonymousReq = new Request('https://edge.test', {
    headers: { 'x-forwarded-for': '198.51.100.8, 10.0.0.1' },
  });
  assert.equal(
    await exports.reserveExternalCatalogCaller(
      anonymousClient,'google_books',anonymousReq
    ),
    true,
  );
  assert.equal(anonymousCalls[0][1].p_user_id,null);
  assert.match(anonymousCalls[0][1].p_ip_hash,/^[0-9a-f]{64}$/);

  client.rpc = async () => ({ data:false, error:null });
  assert.equal(
    await exports.reserveExternalCatalogCaller(client,'igdb',req),
    false,
    'over-quota caller is rejected before provider work',
  );

  for (const [fileName, provider] of [
    ['movie-catalog/index.ts','tmdb'],
    ['music-catalog/index.ts','musicbrainz'],
    ['game-catalog/index.ts','igdb'],
    ['book-catalog/index.ts','google_books'],
  ]) {
    const catalog = fs.readFileSync(
      path.join(root,'supabase/functions',fileName),
      'utf8',
    );
    assert.match(catalog,/body\.action === 'search'/,fileName);
    assert.ok(
      catalog.includes("reserveExternalCatalogCaller(client, '" + provider + "', req)"),
      fileName + ' must reserve caller quota before its search handler',
    );
  }

  console.log('External catalog caller guard passed: optional user + hashed IP quotas wrap all public search providers.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
