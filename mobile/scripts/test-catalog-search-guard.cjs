const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const root = path.join(__dirname, '../..');
const file = path.join(root, 'supabase/functions/catalogSearchGuard.ts');
const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
vm.runInNewContext(compiled, { exports, Request, Response, TextEncoder, Uint8Array, crypto: webcrypto });

async function main() {
  const calls = [];
  const client = { rpc: async (name, args) => {
    calls.push([name,args]);
    return { data: true, error: null };
  }};
  const json = (body,status=200) => new Response(JSON.stringify(body),{status});
  const req = new Request('https://edge.test',{headers:{'x-forwarded-for':'203.0.113.10, 10.0.0.1'}});
  assert.equal(await exports.guardCatalogSearch(req,client,'tmdb',json),null);
  assert.equal(calls[0][0],'consume_external_catalog_search');
  assert.equal(calls[0][1].p_provider,'tmdb');
  assert.match(calls[0][1].p_subject_hash,/^[0-9a-f]{64}$/);
  assert.equal(calls[0][1].p_subject_hash.includes('203.0.113.10'),false,'raw address is never stored');

  client.rpc = async () => ({data:false,error:null});
  const limited = await exports.guardCatalogSearch(req,client,'tmdb',json);
  assert.equal(limited.status,429);
  assert.equal((await limited.json()).error,'RATE_LIMITED');

  client.rpc = async () => ({data:null,error:{code:'db'}});
  const failed = await exports.guardCatalogSearch(req,client,'tmdb',json);
  assert.equal(failed.status,503);

  for (const [fileName, provider] of [
    ['movie-catalog/index.ts','tmdb'],
    ['music-catalog/index.ts','musicbrainz'],
    ['game-catalog/index.ts','igdb'],
    ['book-catalog/index.ts','google_books'],
  ]) {
    const source=fs.readFileSync(path.join(root,'supabase/functions',fileName),'utf8');
    assert.match(source,/guardCatalogSearch/);
    assert.ok(source.includes("'" + provider + "'") || source.includes('TMDB_CACHE_PROVIDER'),fileName);
  }
  console.log('Catalog search guard passed: caller hashing, per-provider quota and all public provider search wrappers.');
}
main().catch((error)=>{console.error(error);process.exitCode=1;});
