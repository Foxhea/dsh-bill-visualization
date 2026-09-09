import test from 'node:test';
import assert from 'node:assert/strict';
import { UsageReader } from '../src/reader.js';
import { header, route, message, persistenceFixture } from './fixtures.js';

test('reads paginated SessionHandle and closes the read-only handle', async () => {
  const events=[route(),...Array.from({length:1200},(_,i)=>message(i+1))];
  const p=persistenceFixture([{header:header(),events}]), reader=new UsageReader(p,{cacheMs:0});
  assert.equal((await reader.scan()).sessions[0].calls.length,1200);
  assert.deepEqual(p.state.reads,[[0,512],[512,512],[1024,512]]); assert.equal(p.state.closes,1);
});
test('unchanged revisions do not reread; changed revisions replace counters instead of double counting', async () => {
  const p=persistenceFixture(), reader=new UsageReader(p,{cacheMs:0});
  await reader.scan(); await reader.scan(); assert.equal(p.state.opens,1);
  p.state.entries[0].events.push(message(2)); p.state.entries[0].revision='r2';
  assert.equal((await reader.scan()).sessions[0].calls.length,2); assert.equal(p.state.opens,2);
});
test('concurrent scans share the same read', async () => {
  const p=persistenceFixture(), reader=new UsageReader(p,{cacheMs:0});
  await Promise.all([reader.scan(),reader.scan(),reader.scan()]); assert.equal(p.state.opens,1);
});
test('damaged session is reported and closed while healthy sessions remain available', async () => {
  const p=persistenceFixture([{header:header('bad'),events:[],failRead:true},{header:header('good'),events:[route(),message()]}]);
  const r=await new UsageReader(p).scan(); assert.equal(r.errors.length,1); assert.equal(r.sessions.length,1); assert.equal(p.state.closes,2);
});
test('deleted sessions leave the cache and totals on next scan', async () => {
  const p=persistenceFixture(), reader=new UsageReader(p,{cacheMs:0}); await reader.scan(); p.state.entries=[];
  assert.equal((await reader.scan()).sessions.length,0); assert.equal(reader.cache.size,0);
});
test('event limit does not silently include a partial session', async () => {
  const p=persistenceFixture(), reader=new UsageReader(p,{maxEventsPerSession:1}); const r=await reader.scan();
  assert.equal(r.sessions.length,0); assert.equal(r.errors.length,1); assert.equal(p.state.closes,1);
});
test('listing failures do not turn into a successful empty snapshot', async () => {
  const reader=new UsageReader({list:async()=>{throw new Error('disk unavailable');}});
  await assert.rejects(reader.scan(),/disk unavailable/); assert.equal(reader.inflight,null);
});
