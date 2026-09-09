import test from 'node:test';
import assert from 'node:assert/strict';
import { DEEPSEEK_PRICING, deepseekMultiplier, officialDeepseekRates, mergeOfficialRates } from '../web/pricing.js';
import { costFor, validateRates, normalizeUsage } from '../src/accounting.js';
import { config, usage } from './fixtures.js';

test('official CNY snapshot includes only the three listed API model IDs', () => {
  assert.deepEqual(officialDeepseekRates().map(r=>[r.model,r.input,r.cacheRead,r.output]),[
    ['deepseek-v4-flash',1,0.02,4],['deepseek-v4-pro',4.5,0.15,13.5],['deepseek-v4-flash-vision-exp',1,0.02,4],
  ]);
});
test('weekday peak uses half-open 09–12 and 14–18 Beijing windows', () => {
  for (const [time,expected] of [['08:59:59',1],['09:00:00',2],['11:59:59',2],['12:00:00',1],['13:59:59',1],['14:00:00',2],['17:59:59',2],['18:00:00',1]]) {
    assert.equal(deepseekMultiplier(Date.parse(`2026-09-09T${time}+08:00`)),expected,time);
  }
});
test('Saturday and Sunday are off-peak all day', () => {
  for(const date of ['2026-09-12','2026-09-13']) for(const hour of ['09','11','14','17']) assert.equal(deepseekMultiplier(Date.parse(`${date}T${hour}:30:00+08:00`)),1);
});
test('official rates double all billing terms, independently of display timezone', () => {
  const cfg=config(officialDeepseekRates()), call={provider:'deepseek',model:'deepseek-v4-flash',time:Date.parse('2026-09-11T09:30:00+08:00'),usage:usage(1000000,1000000,{cacheReadTokens:1000000,cacheWriteTokens:1000000})};
  assert.equal(costFor(call,cfg),12.04);
  assert.equal(costFor(call,{...cfg,timeZone:'America/New_York'}),12.04);
  assert.equal(costFor({...call,time:Date.parse('2026-09-12T09:30:00+08:00')},cfg),6.02);
});
test('snapshot never backfills before its chosen start or prices unknown models and providers', () => {
  const cfg=config(officialDeepseekRates()), call={provider:'deepseek',model:'deepseek-v4-pro',time:Date.parse('2026-09-10T13:00:00+08:00'),usage:normalizeUsage(usage(1000000,0))};
  assert.equal(costFor(call,cfg),4.5);
  assert.equal(costFor({...call,time:Date.parse(DEEPSEEK_PRICING.effectiveFrom)-1},cfg),null);
  assert.equal(costFor({...call,provider:'relay'},cfg),null);
  assert.equal(costFor({...call,model:'deepseek-chat'},cfg),null);
});
test('reimport preserves custom rows at the same instant and adds no duplicates', () => {
  const incoming=officialDeepseekRates(), custom={...incoming[0],input:123};
  const merged=mergeOfficialRates([custom],incoming);
  assert.equal(merged.length,3);assert.equal(merged[0].input,123);assert.equal(mergeOfficialRates(merged,incoming).length,3);
});
test('rate validation round-trips schedule and source; unknown schedules fail', () => {
  const cfg=config(officialDeepseekRates());assert.deepEqual(validateRates(cfg),cfg);
  assert.throws(()=>validateRates(config([{...cfg.rates[0],schedule:'not-a-schedule'}])),/峰谷/);
});
