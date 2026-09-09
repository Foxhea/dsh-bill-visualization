import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RatesStore } from '../src/rates-store.js';
import { config } from './fixtures.js';

test('rate settings persist and survive a store restart', async t => {
  const dir=await mkdtemp(join(tmpdir(),'dsh-bill-visualization-test-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'rates.json'), store=new RatesStore(file); await store.load();
  assert.equal(store.get().rates.length,0); await store.save(config(),store.revision);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),config());
  const second=new RatesStore(file); await second.load(); assert.deepEqual(second.current,config());
});
test('stale and concurrent edits receive conflict rather than losing updates', async t => {
  const dir=await mkdtemp(join(tmpdir(),'dsh-bill-visualization-test-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const store=new RatesStore(join(dir,'rates.json')); await store.load(); const rev=store.revision;
  const results=await Promise.allSettled([store.save(config(),rev),store.save(config([]),rev)]);
  assert.equal(results[0].status,'fulfilled'); assert.equal(results[1].reason.status,409);
  await store.save(config([]),store.revision); assert.equal(store.current.rates.length,0);
});
test('malformed saved rate file is preserved instead of silently reset', async t => {
  const dir=await mkdtemp(join(tmpdir(),'dsh-bill-visualization-test-')); t.after(()=>rm(dir,{recursive:true,force:true}));
  const path=join(dir,'rates.json'); await writeFile(path,'bad-json');
  await assert.rejects(new RatesStore(path).load()); assert.equal(await readFile(path,'utf8'),'bad-json');
});
