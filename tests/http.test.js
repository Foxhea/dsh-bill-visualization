import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';
import { persistenceFixture, config } from './fixtures.js';

/** Node HTTP integration using the exact public service methods of the pinned release. */
async function harness(t) {
  const dir=await mkdtemp(join(tmpdir(),'dsh-bill-visualization-http-')); const routes=[],effects=[],events=new Map();
  const ctx={
    sessionPersistence:persistenceFixture(),
    connection:{requestRejection(req){ if(req.headers.origin && req.headers.origin!=='http://allowed.local') return 403; return req.headers.cookie==='fixture-auth=1'?undefined:401; }},
    webServer:{register(route){routes.push(route);return()=>routes.splice(routes.indexOf(route),1);}},
    effect(fn){const dispose=fn();effects.push(dispose);return dispose;},
    on(name,fn){events.set(name,fn);},logger:{warn(){}},
  };
  await apply(ctx,{dataDir:dir,cacheMs:1000});
  const server=createServer((req,res)=>{void routes[0].handler(req,res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));effects.reverse().forEach(f=>f());await rm(dir,{recursive:true,force:true});});
  const url=`http://127.0.0.1:${server.address().port}`;
  const request=(path='',options={})=>fetch(url+'/dsh-bill-visualization'+path,{...options,headers:{cookie:'fixture-auth=1',...options.headers}});
  return {request,url,ctx,events,routes,effects};
}

test('stats, HTML and scripts require authentication; origin fence is enforced', async t=>{
  const h=await harness(t);
  for(const p of ['/stats','','/app.js','/rates']) assert.equal((await fetch(h.url+'/dsh-bill-visualization'+p)).status,401);
  assert.equal((await h.request('/stats',{headers:{origin:'http://evil.local'}})).status,403);
  const stats=await (await h.request('/stats')).json();assert.equal(stats.total.calls,1);assert.equal(stats.total.unpricedCalls,1);
});
test('valid rate write reprices stats; unauthenticated, CSRF, malformed and oversized writes fail', async t=>{
  const h=await harness(t), initial=await (await h.request('/rates')).json();
  const options={method:'PUT',headers:{'content-type':'application/json','x-dsh-bill-visualization':'1'},body:JSON.stringify({...config(),revision:initial.revision})};
  assert.equal((await h.request('/rates',{...options,headers:{}})).status,415);
  assert.equal((await h.request('/rates',{...options,headers:{...options.headers,cookie:''}})).status,401);
  assert.equal((await h.request('/rates',{...options,body:'bad'})).status,400);
  assert.equal((await h.request('/rates',{...options,body:' '.repeat(262145)})).status,413);
  assert.equal((await h.request('/rates',options)).status,200);
  assert.equal((await h.request('/rates',options)).status,409);
  const stats=await (await h.request('/stats')).json();assert.equal(stats.total.unpricedCalls,0);assert.equal(stats.total.estimatedCost,0.00036);
});
test('CSV/JSON exports match stats and invalid date filters are rejected',async t=>{
  const h=await harness(t);
  for(const q of ['?from=bad','?from=2026-02-30','?from=2026-09-10&to=2026-09-01']) assert.equal((await h.request('/stats'+q)).status,400);
  const exported=await(await h.request('/export.json')).json();assert.equal(exported.total.totalTokens,120);
  const csv=await h.request('/export.csv');assert.match(csv.headers.get('content-disposition'),/attachment/);assert.match(await csv.text(),/fixture-model/);
});
test('HTML uses self-hosted assets; registration supplies a plain script and a disposer',async t=>{
  const h=await harness(t), table=[];h.events.get('webserver/index-inject')(table);
  assert.deepEqual(table,[{kind:'script-src',placement:'body',src:'/dsh-bill-visualization/bootstrap.js'}]);
  const html=await h.request();assert.equal(html.status,200);assert.match(html.headers.get('content-security-policy'),/frame-ancestors 'self'/);
  assert.match(await html.text(),/Token Ledger/);assert.equal((await h.request('/missing')).status,404);
  assert.equal((await h.request('/stats',{method:'POST'})).status,405);
  assert.equal((await h.request('/app.js',{method:'HEAD'})).status,200);
  h.effects[0]();assert.equal(h.routes.length,0);h.effects.length=0;
});
test('call log export, dimension filters and budget settings round-trip',async t=>{
  const h=await harness(t), initial=await(await h.request('/rates')).json();
  const calls=await h.request('/export.calls.csv');
  assert.equal(calls.status,200);assert.match(calls.headers.get('content-disposition'),/calls\.csv/);
  const callText=await calls.text();assert.match(callText,/fixture-model/);assert.match(callText,/unpriced/);
  const q=new URLSearchParams({provider:'test',model:'fixture-model',workspace:'/home/test/project'});
  const filtered=await(await h.request('/stats?'+q)).json();
  assert.equal(filtered.total.calls,1);assert.equal(filtered.calls.length,1);assert.equal(filtered.callTotal,1);
  assert.equal((await(await h.request('/stats?provider=nope')).json()).total.calls,0);
  const put={method:'PUT',headers:{'content-type':'application/json','x-dsh-bill-visualization':'1'},
    body:JSON.stringify({...config(),budget:{monthly:50,alertThreshold:0.9},revision:initial.revision})};
  assert.equal((await h.request('/rates',put)).status,200);
  assert.deepEqual((await(await h.request('/rates')).json()).budget,{monthly:50,alertThreshold:0.9});
  const stats=await(await h.request('/stats')).json();assert.deepEqual(stats.budget,{monthly:50,alertThreshold:0.9});
});
