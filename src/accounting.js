import { DEEPSEEK_PRICING, deepseekMultiplier } from '../web/pricing.js';

/** Pure accounting over Harness v2 settlement events; no prompts are retained. */
export const TOKEN_FIELDS = ['inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'reasoningTokens'];

export function normalizeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Number.isSafeInteger(value.inputTokens) || value.inputTokens < 0 ||
      !Number.isSafeInteger(value.outputTokens) || value.outputTokens < 0) return null;
  const usage = {};
  for (const field of TOKEN_FIELDS) {
    const n = value[field] ?? 0;
    if (!Number.isSafeInteger(n) || n < 0) return null;
    usage[field] = n;
  }
  // Harness inputTokens is UNcached input. Reasoning is diagnostic, not added again.
  usage.totalTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens + usage.outputTokens;
  return Number.isSafeInteger(usage.totalTokens) ? usage : null;
}

/** Last stream usage snapshot wins; snapshots for one attempt are not summed. */
function lastStreamUsage(stream) {
  let result;
  for (const record of stream ?? []) {
    if (record.type === 'chunk' && record.chunk?.type === 'usage') result = record.chunk.usage;
  }
  return result;
}

export function createFold(header, inheritedEventCount) {
  if (header.version !== 2) throw new Error(`Unsupported session format ${header.version}; expected 2`);
  if (!Number.isSafeInteger(inheritedEventCount) || inheritedEventCount < 0) {
    throw new Error('Session handle has no valid inheritedEventCount');
  }
  return { header, inheritedEventCount, provider: '(unknown)', model: '(unknown)', calls: [] };
}

/** Read inherited headers for route continuity but never count inherited usage. */
export function foldEvents(state, events) {
  for (const event of events) {
    if (event.type === 'request/header') {
      state.provider = event.data.header.config.provider;
      state.model = event.data.header.config.model;
    } else if (event.type === 'request/context') {
      state.provider = event.data.provider;
      state.model = event.data.model;
    }
    if (event.seq < state.inheritedEventCount) continue;
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue;
    if (!Number.isSafeInteger(event.time) || event.time < 0 || !Number.isFinite(new Date(event.time).getTime())) {
      throw new Error(`Invalid timestamp at event ${event.seq}`);
    }
    const usage = normalizeUsage(event.data.usage ?? lastStreamUsage(event.data.stream));
    state.calls.push({ seq: event.seq, time: event.time, provider: state.provider, model: state.model,
      kind: event.type === 'assistant/attempt' ? 'attempt' : 'message', usage });
  }
}

const dateFormatters = new Map();
export function dayKey(time, timeZone) {
  if (!dateFormatters.has(timeZone)) {
    if (dateFormatters.size > 8) dateFormatters.clear();
    dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  }
  const parts = dateFormatters.get(timeZone).formatToParts(time);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function validateRates(input) {
  if (!input || typeof input !== 'object' || input.version !== 1) throw new Error('费率文件版本必须为 1');
  if (!['CNY', 'USD'].includes(input.currency)) throw new Error('币种必须为 CNY 或 USD');
  if (typeof input.timeZone !== 'string') throw new Error('请填写有效时区');
  try { dayKey(0, input.timeZone); } catch { throw new Error('时区无效，例如 Asia/Shanghai'); }
  if (!Array.isArray(input.rates) || input.rates.length > 1000) throw new Error('费率最多 1000 条');
  const seen = new Set();
  const rates = input.rates.map(row => {
    if (!row || typeof row !== 'object') throw new Error('费率条目无效');
    for (const k of ['provider', 'model']) {
      if (typeof row[k] !== 'string' || !row[k].trim() || row[k].length > 300) throw new Error(`${k} 必须是 1–300 字符`);
    }
    if (typeof row.effectiveFrom !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(row.effectiveFrom) ||
        !Number.isFinite(Date.parse(row.effectiveFrom))) throw new Error('生效时间必须为 UTC ISO 时间');
    const clean = { provider: row.provider.trim(), model: row.model.trim(), effectiveFrom: new Date(row.effectiveFrom).toISOString() };
    if (row.schedule !== undefined) {
      if (row.schedule !== DEEPSEEK_PRICING.schedule) throw new Error('未知的峰谷计价规则');
      clean.schedule = row.schedule;
    }
    if (row.source !== undefined) {
      if (row.source !== DEEPSEEK_PRICING.source || row.checkedOn !== DEEPSEEK_PRICING.checkedOn) throw new Error('官方费率来源或核对日期无效');
      clean.source = row.source;
      clean.checkedOn = row.checkedOn;
    }
    const key = JSON.stringify([clean.provider, clean.model, clean.effectiveFrom]);
    if (seen.has(key)) throw new Error('相同供应商、模型、生效时间的费率不能重复');
    seen.add(key);
    for (const k of ['input', 'cacheRead', 'cacheWrite', 'output']) {
      if (typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] < 0 || row[k] > 1000000000) {
        throw new Error(`${k} 单价必须是 0–1000000000 之间的数字`);
      }
      clean[k] = row[k];
    }
    return clean;
  });
  return { version: 1, currency: input.currency, timeZone: input.timeZone, rates };
}

export function rateFor(call, config) {
  let best;
  for (const rate of config.rates) {
    if (rate.provider !== call.provider || rate.model !== call.model || Date.parse(rate.effectiveFrom) > call.time) continue;
    if (!best || Date.parse(rate.effectiveFrom) > Date.parse(best.effectiveFrom)) best = rate;
  }
  return best;
}

export function costFor(call, config) {
  if (!call.usage) return null;
  const rate = rateFor(call, config);
  if (!rate) return null;
  const u = call.usage;
  const multiplier = rate.schedule === DEEPSEEK_PRICING.schedule ? deepseekMultiplier(call.time) : 1;
  return multiplier * (u.inputTokens * rate.input + u.cacheReadTokens * rate.cacheRead +
    u.cacheWriteTokens * rate.cacheWrite + u.outputTokens * rate.output) / 1000000;
}

function emptyTotals() {
  return { calls: 0, attempts: 0, reportedCalls: 0, missingUsageCalls: 0, unpricedCalls: 0,
    inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    reasoningTokens: 0, totalTokens: 0, estimatedCost: 0 };
}

function add(totals, call, cost) {
  totals.calls++;
  if (call.kind === 'attempt') totals.attempts++;
  if (!call.usage) { totals.missingUsageCalls++; return; }
  totals.reportedCalls++;
  for (const k of [...TOKEN_FIELDS, 'totalTokens']) totals[k] += call.usage[k];
  if (cost === null) totals.unpricedCalls++;
  else totals.estimatedCost += cost;
}

/** Aggregate an inclusive day range; the same timestamp/rate rules drive all views. */
export function summarize(sessions, config, { from = '', to = '', now = Date.now(), errors = [] } = {}) {
  const total = emptyTotals(), today = emptyTotals(), month = emptyTotals();
  const daily = new Map(), models = new Map(), rows = [], observed = new Map();
  const todayKey = dayKey(now, config.timeZone);
  for (const session of sessions) {
    const subtotal = emptyTotals();
    let lastTime = 0;
    for (const call of session.calls) {
      const routeKey = JSON.stringify([call.provider, call.model]);
      observed.set(routeKey, { provider: call.provider, model: call.model });
      const day = dayKey(call.time, config.timeZone), cost = costFor(call, config);
      // Today/month cards always describe their calendar period, independent of table filters.
      if (day === todayKey) add(today, call, cost);
      if (day.slice(0, 7) === todayKey.slice(0, 7)) add(month, call, cost);
      if ((from && day < from) || (to && day > to)) continue;
      add(total, call, cost); add(subtotal, call, cost);
      lastTime = Math.max(lastTime, call.time);
      if (!daily.has(day)) daily.set(day, { day, ...emptyTotals() });
      if (!models.has(routeKey)) models.set(routeKey, { provider: call.provider, model: call.model, ...emptyTotals() });
      add(daily.get(day), call, cost); add(models.get(routeKey), call, cost);
    }
    if (subtotal.calls) rows.push({ id: session.header.id, cwd: session.header.cwd ?? '', lastTime, ...subtotal });
  }
  return { generatedAt: now, currency: config.currency, timeZone: config.timeZone, from, to,
    total, today, month, daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    sessions: rows.sort((a, b) => b.lastTime - a.lastTime), observed: [...observed.values()],
    scannedSessions: sessions.length, errors };
}

export function toCsv(snapshot) {
  const keys = ['provider', 'model', 'calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'estimatedCost', 'unpricedCalls', 'missingUsageCalls'];
  const escape = value => {
    let text = String(value);
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [...[keys.concat('currency').map(escape).join(',')], ...snapshot.models.map(row =>
    keys.map(k => escape(row[k])).concat(escape(snapshot.currency)).join(','))].join('\r\n') + '\r\n';
}
