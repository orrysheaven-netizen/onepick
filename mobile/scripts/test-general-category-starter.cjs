// Metadata checks only. Database behavior is covered by the SQL regression test.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const root=path.resolve(__dirname,'../..');
const manifest=JSON.parse(readFileSync(path.join(root,'docs/general-category-starter.json'),'utf8'));
const sql=readFileSync(path.join(root,'supabase/operations/seed-general-categories.sql'),'utf8');
const payload=JSON.parse(sql.split('$catalog$')[1]);
assert.equal(manifest.checked_on,'2026-09-19');
assert.deepEqual(payload,manifest.items.map(({evidence,...item})=>item));
assert.equal(payload.length,8);
assert.equal(new Set(payload.map(i=>i.key)).size,8);
assert.deepEqual([...new Set(payload.map(i=>i.category))].sort(),['ballpoint-pen','book','ice-cream','notebook']);
for(const category of ['ballpoint-pen','book','ice-cream','notebook']) assert.equal(payload.filter(i=>i.category===category).length,2);
const allowedHosts=new Set(['www.bing.co.kr','minumsa.minumsa.com','bir.co.kr','www.monami.com','www.muji.com','md-product.com']);
for(const item of payload){
  assert.ok(item.name.trim() && item.creator.trim());
  assert.ok(item.key.length<=100);
  const url=new URL(item.url);
  assert.equal(url.protocol,'https:');
  assert.ok(allowedHosts.has(url.hostname));
  assert.equal(url.username,'');assert.equal(url.password,'');
  for(const key of Object.keys(item)) assert.ok(['key','category','name','creator','url','model','original','year','collection'].includes(key));
  if(item.category==='book'){
    assert.match(item.model,/^\d{13}$/);
    assert.equal([...item.model].reduce((sum,d,i)=>sum+Number(d)*(i%2===0?1:3),0)%10,0);
    assert.ok(item.collection && item.original);
  }
}
assert.ok(sql.includes("on conflict (slug) do nothing"));
assert.ok(sql.includes("external_source='onepick_starter'"));
console.log('General category starter: 4 category identities, 8 sourced metadata entries, replay keys, source parity, URL allowlist and 2 ISBN checksums passed. No network or AI calls.');
