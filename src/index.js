import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { UsageReader } from './reader.js';
import { RatesStore } from './rates-store.js';
import { summarize, toCsv, validateRates } from './accounting.js';

export const name = 'dsh-bill-visualization';
export const inject = ['webServer', 'connection', 'sessionPersistence'];
const BASE = '/dsh-bill-visualization';
const FILES = new Map([
  [BASE, ['index.html', 'text/html; charset=utf-8']],
  [`${BASE}/app.js`, ['app.js', 'text/javascript; charset=utf-8']],
  [`${BASE}/pricing.js`, ['pricing.js', 'text/javascript; charset=utf-8']],
  [`${BASE}/style.css`, ['style.css', 'text/css; charset=utf-8']],
  [`${BASE}/bootstrap.js`, ['bootstrap.js', 'text/javascript; charset=utf-8']],
]);

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer', 'x-frame-options': 'SAMEORIGIN' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

function validDate(value) {
  if (value === '') return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

async function bodyJson(req) {
  if ((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json' || req.headers['x-dsh-bill-visualization'] !== '1') {
    const error = new Error('需要 JSON 请求及 X-Token-Ledger 标头'); error.status = 415; throw error;
  }
  const chunks = []; let size = 0;
  // data listeners let us answer 413 without async-iterator destruction of the socket.
  await new Promise((done, reject) => {
    const timer = setTimeout(() => finish(Object.assign(new Error('请求体读取超时'), { status: 408 })), 10000);
    const finish = error => {
      clearTimeout(timer); req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('aborted', onAborted);
      if (error) { req.resume(); reject(error); } else done();
    };
    const onData = chunk => {
      size += chunk.length;
      if (size > 256 * 1024) { finish(Object.assign(new Error('费率文件超过 256 KiB'), { status: 413 })); return; }
      chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = error => finish(error);
    const onAborted = () => finish(Object.assign(new Error('请求已中止'), { status: 400 }));
    req.on('data', onData); req.once('end', onEnd); req.once('error', onError); req.once('aborted', onAborted);
  });
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }); }
}

export function resolveOptions(config = {}) {
  const dataDir = config.dataDir ?? join(resolve(process.env.DSH_HOME || join(homedir(), '.dsh')), 'dsh-bill-visualization');
  if (typeof dataDir !== 'string' || !isAbsolute(dataDir)) throw new Error('dsh-bill-visualization dataDir 必须是绝对路径');
  const options = { dataDir };
  for (const [key, value, min, max] of [
    ['cacheMs', 15000, 1000, 3600000], ['maxSessions', 10000, 1, 100000],
    ['maxEventsPerSession', 1000000, 1, 10000000], ['readTimeoutMs', 30000, 1000, 300000],
  ]) {
    const n = config[key] ?? value;
    if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`dsh-bill-visualization ${key} 必须在 ${min}–${max} 之间`);
    options[key] = n;
  }
  return options;
}

/** Host-only plugin: public index-inject + authenticated routes; zero browser module imports. */
export async function apply(ctx, config = {}) {
  if (typeof ctx.sessionPersistence.open !== 'function' || typeof ctx.connection.requestRejection !== 'function') {
    throw new Error('dsh-bill-visualization 需要 Harness 0.1.3-alpha.2 的 SessionHandle 和 Connection 接口');
  }
  const options = resolveOptions(config);
  const store = new RatesStore(join(options.dataDir, 'rates.json'));
  await store.load();
  const reader = new UsageReader(ctx.sessionPersistence, options);
  const assets = new Map();
  for (const [route, [file, mime]] of FILES) assets.set(route, { content: await readFile(new URL(`../web/${file}`, import.meta.url)), mime });

  async function snapshot(url) {
    const from = url.searchParams.get('from') ?? '', to = url.searchParams.get('to') ?? '';
    if (!validDate(from) || !validDate(to) || (from && to && from > to)) throw Object.assign(new Error('日期范围无效'), { status: 400 });
    const data = await reader.scan();
    return { ...summarize(data.sessions, store.current, { from, to, errors: data.errors }),
      scanAt: data.at, pluginVersion: '0.1.2', targetHarness: '0.1.3-alpha.2' };
  }

  const handler = async (req, res) => {
    try {
      const rejection = ctx.connection.requestRejection(req);
      if (rejection !== undefined) {
        send(res, rejection, { error: rejection === 401 ? '请先用终端打印的 Harness 登录链接打开主页面，再打开统计。' : '请求来源未被 Harness 授权' });
        return;
      }
      const url = new URL(req.url, 'http://localhost'), path = url.pathname;
      if (FILES.has(path)) {
        if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('allow', 'GET, HEAD'); send(res, 405, { error: '不支持此方法' }); return; }
        const asset = assets.get(path);
        if (path === BASE) res.setHeader('content-security-policy', "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'");
        send(res, 200, req.method === 'HEAD' ? '' : asset.content, asset.mime); return;
      }
      if (path === `${BASE}/rates`) {
        if (req.method === 'GET') { send(res, 200, store.get()); return; }
        if (req.method === 'PUT') {
          const input = await bodyJson(req);
          let rates;
          try { rates = validateRates(input); } catch (error) { throw Object.assign(error, { status: 400 }); }
          send(res, 200, await store.save(rates, input.revision)); return;
        }
        res.setHeader('allow', 'GET, PUT'); send(res, 405, { error: '不支持此方法' }); return;
      }
      if (path === `${BASE}/stats` || path === `${BASE}/export.csv` || path === `${BASE}/export.json`) {
        if (req.method !== 'GET') { res.setHeader('allow', 'GET'); send(res, 405, { error: '不支持此方法' }); return; }
        const data = await snapshot(url);
        if (path.endsWith('export.csv')) {
          res.setHeader('content-disposition', 'attachment; filename="dsh-bill-visualization.csv"');
          send(res, 200, toCsv(data), 'text/csv; charset=utf-8');
        } else {
          if (path.endsWith('export.json')) res.setHeader('content-disposition', 'attachment; filename="dsh-bill-visualization.json"');
          send(res, 200, data);
        }
        return;
      }
      send(res, 404, { error: '未找到统计资源' });
    } catch (error) {
      const status = error.status ?? 500;
      if (status === 500) ctx.logger?.warn?.(`[dsh-bill-visualization] ${String(error.message ?? error)}`);
      if (!res.headersSent) send(res, status, { error: status === 500 ? '统计服务读取或写入失败，请查看 Harness 终端日志。' : error.message });
    }
  };

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: BASE, handler }), 'dsh-bill-visualization.routes');
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'script-src', placement: 'body', src: `${BASE}/bootstrap.js` });
  });
}
