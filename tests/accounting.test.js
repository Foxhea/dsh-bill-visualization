import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsage, createFold, foldEvents, summarize, validateRates, toCsv, dayKey, costFor } from '../src/accounting.js';
import { header, usage, route, message, streamUsage, rate, config, stamp } from './fixtures.js';

function folded(events, inherited = 0) { const s = createFold(header(), inherited); foldEvents(s, events); return { header: s.header, calls: s.calls }; }

test('disjoint input, cache read/write and output are added once; reasoning is not added twice', () => {
  const u = normalizeUsage(usage(100, 20, { cacheReadTokens: 60, cacheWriteTokens: 10, reasoningTokens: 12, totalTokens: 190 }));
  assert.equal(u.totalTokens, 190); assert.equal(u.inputTokens, 100); assert.equal(u.reasoningTokens, 12);
});
test('invalid, negative, incomplete, overflowing usage is unknown rather than zero', () => {
  for (const value of [null, {}, { inputTokens: 1 }, usage(-1), usage(1.2), usage(1, 2, { cacheReadTokens: NaN }), usage(Number.MAX_SAFE_INTEGER, 2)]) assert.equal(normalizeUsage(value), null);
});
test('message summary takes precedence over stream snapshots', () => {
  const m = message(1, usage(100)); m.data.stream = [streamUsage(usage(5)), streamUsage(usage(80))];
  const s = folded([route(), m]); assert.equal(s.calls.length, 1); assert.equal(s.calls[0].usage.inputTokens, 100);
});
test('attempt without message counts the final stream usage exactly once', () => {
  const attempt = { seq: 1, time: stamp, type: 'assistant/attempt', data: { stream: [streamUsage(usage(5)), streamUsage(usage(90))] } };
  const s = summarize([folded([route(), attempt])], config(), { now: stamp });
  assert.equal(s.total.inputTokens, 90); assert.equal(s.total.calls, 1); assert.equal(s.total.attempts, 1);
});
test('attempt without usage is explicitly counted as unreported', () => {
  const s = summarize([folded([route(), { seq: 1, time: stamp, type:'assistant/attempt', data:{stream:[]} }])], config());
  assert.equal(s.total.missingUsageCalls, 1); assert.equal(s.total.reportedCalls, 0); assert.equal(s.total.totalTokens, 0);
});
test('fork skips inherited costs but carries inherited model into child-owned events', () => {
  const session = folded([route(), message(1, usage(1000)), { seq:2,time:stamp,type:'session/end-seed',data:{inherited:true} }, message(3,usage(5))], 2);
  assert.equal(session.calls.length, 1); assert.equal(session.calls[0].model, 'fixture-model');
  assert.equal(summarize([session], config()).total.inputTokens, 5);
});
test('unmarked restore boundary does not hide earlier costs', () => {
  const session = folded([route(), message(), { seq:2,time:stamp,type:'session/end-seed',data:{} },message(3)]);
  assert.equal(session.calls.length, 2);
});
test('model changes split usage by exact provider/model route', () => {
  const session = folded([route(), message(), route(2,'relay','other'), message(3)]);
  const s = summarize([session], config()); assert.equal(s.models.length, 2); assert.equal(s.total.unpricedCalls, 1);
});
test('rates include cache-write and use the latest effective rate at event time', () => {
  const session = folded([route(), message(1,usage(100,20,{cacheReadTokens:60,cacheWriteTokens:10}))]);
  assert.equal(costFor(session.calls[0], config()), 420/1000000);
  const rates = config([rate(), rate({effectiveFrom:'2026-09-09T04:00:00Z',input:4}),rate({effectiveFrom:'2027-01-01T00:00:00Z',input:500})]);
  assert.equal(costFor(session.calls[0], rates), 620/1000000);
});
test('unknown rates are separate from explicit free rates', () => {
  const session = folded([route(),message()]);
  assert.equal(summarize([session],config([])).total.unpricedCalls,1);
  const free = summarize([session],config([rate({input:0,output:0,cacheRead:0,cacheWrite:0})]));
  assert.equal(free.total.unpricedCalls,0); assert.equal(free.total.estimatedCost,0);
});
test('calendar filters honor Asia/Shanghai midnight and keep today/month cards independent', () => {
  const before = Date.parse('2026-09-08T15:59:59Z'), after = Date.parse('2026-09-08T16:00:00Z');
  assert.equal(dayKey(after,'Asia/Shanghai'),'2026-09-09');
  const s = summarize([folded([route(),message(1,usage(),before),message(2,usage(),after)])], config(), {from:'2026-09-08',to:'2026-09-08',now:stamp});
  assert.equal(s.total.calls,1); assert.equal(s.today.calls,1); assert.equal(s.month.calls,2);
});
test('retains only usage and routing metadata, never message text', () => {
  const m=message(); m.data.message.content=[{type:'text',text:'PRIVATE TEST SENTINEL'}];
  assert.ok(!JSON.stringify(folded([route(),m])).includes('PRIVATE TEST SENTINEL'));
});
test('CSV neutralizes formula prefixes and quotes route labels', () => {
  const s=summarize([folded([route(0,' =CMD()','x,"y'),message()])],config([]));
  const csv=toCsv(s); assert.ok(csv.includes("' =CMD()")); assert.ok(csv.includes('x,""y')); assert.ok(csv.startsWith('\uFEFF'));
});
test('rate validation rejects unknown currencies, NaN, invalid zones and duplicate effective dates', () => {
  assert.throws(()=>validateRates({...config(),currency:'EUR'}));
  assert.throws(()=>validateRates({...config(),timeZone:'not/a/zone'}));
  assert.throws(()=>validateRates(config([rate({input:NaN})])));
  assert.throws(()=>validateRates(config([rate(),rate()])));
  assert.deepEqual(validateRates(config()),config());
});
test('old formats and missing inheritance metadata fail explicitly', () => {
  assert.throws(()=>createFold({...header(),version:1},0)); assert.throws(()=>createFold(header(),undefined));
});
