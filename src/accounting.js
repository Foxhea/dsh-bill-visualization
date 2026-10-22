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

/**
 * Session generations whose settlement payloads this reader has been verified
 * against: v2 (Harness ≤ 0.1.3-alpha.2), v3 (0.1.5-rc.2) and v4 (0.2.1-rc.2).
 * The persistence layer always translates every log to the *current*
 * generation before handing it over, so a newer generation is read on a
 * best-effort basis instead of failing every session: the four event types
 * this plugin reads (`request/header`, `request/context`, `assistant/message`,
 * `assistant/attempt`) have kept their payloads across v2–v4, and the v3→v4
 * step only added child-catalog/source metadata.
 */
export const SUPPORTED_SESSION_FORMATS = Object.freeze([2, 3, 4]);
const MIN_SESSION_FORMAT = 2;

/** @returns whether a session header generation can be read (v2 or newer). */
function isReadableSessionFormat(version) {
  return Number.isSafeInteger(version) && version >= MIN_SESSION_FORMAT;
}

export function createFold(header, inheritedEventCount) {
  if (!isReadableSessionFormat(header.version)) {
    throw new Error(`Unsupported session format ${header.version}; expected ${MIN_SESSION_FORMAT} or newer`);
  }
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

/**
 * Optional monthly budget + alert threshold stored beside the rates. Absent
 * means "no budget configured"; a zero monthly value also disables the bar.
 */
export function validateBudget(input) {
  if (input === undefined) return undefined;
  if (!input || typeof input !== 'object') throw new Error('预算配置无效');
  const monthly = input.monthly ?? 0;
  const alertThreshold = input.alertThreshold ?? 0.8;
  if (typeof monthly !== 'number' || !Number.isFinite(monthly) || monthly < 0 || monthly > 100000000) {
    throw new Error('月度预算必须是 0–100000000 之间的数字');
  }
  if (typeof alertThreshold !== 'number' || !Number.isFinite(alertThreshold) || alertThreshold <= 0 || alertThreshold > 1) {
    throw new Error('预算预警阈值必须在 (0, 1] 之间');
  }
  return { monthly, alertThreshold };
}

/**
 * Optional China public-holiday dates (Beijing time) that bill at the
 * off-peak rate all day. Sorted and de-duplicated for a stable file.
 */
export function validateHolidays(input) {
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 400) throw new Error('法定节假日最多 400 条');
  const seen = new Set();
  for (const value of input) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) {
      throw new Error('法定节假日必须是 YYYY-MM-DD');
    }
    if (seen.has(value)) throw new Error('法定节假日不能重复');
    seen.add(value);
  }
  return [...input].sort();
}

export function validateRates(input) {
  if (!input || typeof input !== 'object' || input.version !== 1) throw new Error('费率文件版本必须为 1');
  if (!['CNY', 'USD'].includes(input.currency)) throw new Error('币种必须为 CNY 或 USD');
  if (typeof input.timeZone !== 'string') throw new Error('请填写有效时区');
  try { dayKey(0, input.timeZone); } catch { throw new Error('时区无效，例如 Asia/Shanghai'); }
  if (!Array.isArray(input.rates) || input.rates.length > 1000) throw new Error('费率最多 1000 条');
  const budget = validateBudget(input.budget);
  const holidays = validateHolidays(input.holidays);
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
  return { version: 1, currency: input.currency, timeZone: input.timeZone,
    ...(budget === undefined ? {} : { budget }),
    ...(holidays === undefined ? {} : { holidays }), rates };
}

export function rateFor(call, config) {
  let best;
  for (const rate of config.rates) {
    if (rate.provider !== call.provider || rate.model !== call.model || Date.parse(rate.effectiveFrom) > call.time) continue;
    if (!best || Date.parse(rate.effectiveFrom) > Date.parse(best.effectiveFrom)) best = rate;
  }
  return best;
}

/**
 * Price one call against the route's latest effective rate.
 * @returns `{ cost, saved }` (saved = cache-read tokens priced at the miss rate
 *   minus the hit rate), or `null` when the call has no usage or no rate.
 */
export function priceCall(call, config) {
  if (!call.usage) return null;
  const rate = rateFor(call, config);
  if (!rate) return null;
  const u = call.usage;
  const multiplier = rate.schedule === DEEPSEEK_PRICING.schedule ? deepseekMultiplier(call.time, config.holidays ?? []) : 1;
  const cost = multiplier * (u.inputTokens * rate.input + u.cacheReadTokens * rate.cacheRead +
    u.cacheWriteTokens * rate.cacheWrite + u.outputTokens * rate.output) / 1000000;
  const saved = multiplier * u.cacheReadTokens * Math.max(0, rate.input - rate.cacheRead) / 1000000;
  return { cost, saved };
}

export function costFor(call, config) {
  const priced = priceCall(call, config);
  return priced === null ? null : priced.cost;
}

/** Money the cache-read discount saved versus billing those tokens at the miss price. */
export function cacheSavingsFor(call, config) {
  const priced = priceCall(call, config);
  return priced === null ? null : priced.saved;
}

function emptyTotals() {
  return { calls: 0, attempts: 0, reportedCalls: 0, missingUsageCalls: 0, unpricedCalls: 0,
    inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0,
    reasoningTokens: 0, totalTokens: 0, estimatedCost: 0, cacheSaved: 0 };
}

function add(totals, call, priced) {
  totals.calls++;
  if (call.kind === 'attempt') totals.attempts++;
  if (!call.usage) { totals.missingUsageCalls++; return; }
  totals.reportedCalls++;
  for (const k of [...TOKEN_FIELDS, 'totalTokens']) totals[k] += call.usage[k];
  if (priced === null) totals.unpricedCalls++;
  else { totals.estimatedCost += priced.cost; totals.cacheSaved += priced.saved; }
}

/** Upper bound on per-call rows returned by one snapshot (newest first). */
export const CALL_LOG_LIMIT = 5000;

/**
 * Aggregate an inclusive day range; the same timestamp/rate rules drive all
 * views. `provider`/`model`/`workspace` narrow the range totals, tables and
 * call log only — the today/month calendar cards stay global, exactly as they
 * already did for the `from`/`to` range.
 */
export function summarize(sessions, config, { from = '', to = '', now = Date.now(), errors = [],
  provider = '', model = '', workspace = '', maxCalls = CALL_LOG_LIMIT } = {}) {
  const total = emptyTotals(), today = emptyTotals(), month = emptyTotals();
  const daily = new Map(), models = new Map(), workspaces = new Map(), rows = [], observed = new Map();
  const log = [];
  const todayKey = dayKey(now, config.timeZone);
  for (const session of sessions) {
    const cwd = session.header.cwd ?? '';
    const subtotal = emptyTotals();
    let lastTime = 0;
    for (const call of session.calls) {
      const routeKey = JSON.stringify([call.provider, call.model]);
      observed.set(routeKey, { provider: call.provider, model: call.model });
      const day = dayKey(call.time, config.timeZone), priced = priceCall(call, config);
      // Today/month cards always describe their calendar period, independent of table filters.
      if (day === todayKey) add(today, call, priced);
      if (day.slice(0, 7) === todayKey.slice(0, 7)) add(month, call, priced);
      if ((from && day < from) || (to && day > to)) continue;
      if (provider && call.provider !== provider) continue;
      if (model && call.model !== model) continue;
      if (workspace && cwd !== workspace) continue;
      add(total, call, priced); add(subtotal, call, priced);
      lastTime = Math.max(lastTime, call.time);
      if (!daily.has(day)) daily.set(day, { day, ...emptyTotals() });
      if (!models.has(routeKey)) models.set(routeKey, { provider: call.provider, model: call.model, ...emptyTotals() });
      if (!workspaces.has(cwd)) workspaces.set(cwd, { cwd, ...emptyTotals() });
      add(daily.get(day), call, priced); add(models.get(routeKey), call, priced); add(workspaces.get(cwd), call, priced);
      log.push({
        time: call.time, day, provider: call.provider, model: call.model,
        sessionId: session.header.id, cwd, kind: call.kind,
        inputTokens: call.usage?.inputTokens ?? null, cacheReadTokens: call.usage?.cacheReadTokens ?? null,
        cacheWriteTokens: call.usage?.cacheWriteTokens ?? null, outputTokens: call.usage?.outputTokens ?? null,
        totalTokens: call.usage?.totalTokens ?? null,
        cost: priced === null ? null : priced.cost, cacheSaved: priced === null ? null : priced.saved,
        status: call.usage === null ? 'unknown' : priced === null ? 'unpriced' : 'priced',
      });
    }
    if (subtotal.calls) rows.push({ id: session.header.id, cwd, lastTime, ...subtotal });
  }
  const callTotal = log.length;
  const calls = log.sort((a, b) => b.time - a.time).slice(0, maxCalls);
  return { generatedAt: now, currency: config.currency, timeZone: config.timeZone,
    from, to, provider, model, workspace, budget: config.budget ?? null,
    total, today, month, daily: [...daily.values()].sort((a, b) => a.day.localeCompare(b.day)),
    models: [...models.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    workspaces: [...workspaces.values()].sort((a, b) => b.totalTokens - a.totalTokens),
    sessions: rows.sort((a, b) => b.lastTime - a.lastTime), observed: [...observed.values()],
    calls, callTotal, scannedSessions: sessions.length, errors };
}

/** One CSV cell: quoted, with spreadsheet formula prefixes neutralized. */
function csvCell(value) {
  let text = String(value);
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(snapshot) {
  const keys = ['provider', 'model', 'calls', 'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'estimatedCost', 'cacheSaved', 'unpricedCalls', 'missingUsageCalls'];
  return '\uFEFF' + [...[keys.concat('currency').map(csvCell).join(',')], ...snapshot.models.map(row =>
    keys.map(k => csvCell(row[k])).concat(csvCell(snapshot.currency)).join(','))].join('\r\n') + '\r\n';
}

/** Per-call audit export; matches the dashboard's request log columns. */
export function toCallsCsv(snapshot) {
  const keys = ['time', 'provider', 'model', 'sessionId', 'cwd', 'kind',
    'inputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'outputTokens', 'totalTokens', 'cost', 'status'];
  const cell = (call, key) => {
    if (key === 'time') return csvCell(new Date(call.time).toISOString());
    const value = call[key];
    return csvCell(value === null || value === undefined ? '' : value);
  };
  return '\uFEFF' + [...[keys.concat('currency').map(csvCell).join(',')], ...(snapshot.calls ?? []).map(call =>
    keys.map(key => cell(call, key)).concat(csvCell(snapshot.currency)).join(','))].join('\r\n') + '\r\n';
}
