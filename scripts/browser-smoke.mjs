/** Optional browser QA. Set PLAYWRIGHT_PATH to an installed Playwright package. */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
import { apply } from '../src/index.js';
import { persistenceFixture, header, route, message, usage } from '../tests/fixtures.js';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const output = resolve(process.argv[2] || 'qa');
await mkdir(output, { recursive: true });
const dir = await mkdtemp(join(tmpdir(), 'dsh-bill-visualization-browser-'));
const persistence = persistenceFixture([]), routes = [], disposers = [], events = new Map();
await apply({ sessionPersistence: persistence,
  connection: { requestRejection: req => req.headers.cookie === 'qa-auth=1' ? undefined : 401 },
  webServer: { register: route => { routes.push(route); return () => {}; } },
  effect: fn => { disposers.push(fn()); }, on: (name, fn) => events.set(name, fn), logger: console,
}, { dataDir: dir, cacheMs: 1000 });
const server = createServer((req, res) => {
  if (req.url.startsWith('/dsh-bill-visualization')) { void routes[0].handler(req, res); return; }
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end('<!doctype html><html><body style="margin:0;font:14px system-ui;background:#fff;color:#26392e"><aside style="width:256px;height:100vh;box-sizing:border-box;padding:18px 12px;display:flex;flex-direction:column;background:#f7f9f8;border-right:1px solid #e3e8e4"><strong>Harness · 合成测试界面</strong><div style="flex:1;padding-top:30px;color:#85958b">新建会话<br><br>最近会话</div><div id="settings-area"><div data-slot="sidebar.settings"><button style="border:0;background:transparent;padding:14px;font:14px system-ui">⚙ 设置</button></div></div></aside><script src="/dsh-bill-visualization/bootstrap.js"></script></body></html>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.BROWSER_PATH ? { executablePath: process.env.BROWSER_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
  const url = `http://127.0.0.1:${server.address().port}`;
  await context.addCookies([{ name: 'qa-auth', value: '1', url }]);
  const page = await context.newPage(), failures = [];
  page.on('pageerror', e => failures.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') failures.push(msg.text()); });
  await page.goto(url + '/dsh-bill-visualization');
  await page.locator('#connection').filter({ hasText: '已连接本机' }).waitFor();
  assert.match(await page.locator('#models').innerText(), /暂无模型/);
  const now = Date.now();
  persistence.state.entries = ['workspace-alpha', 'workspace-beta', 'workspace-gamma'].map((id, j) => {
    const events = [route(0, 'demo-provider', 'demo-model')];
    for (let i = 0; i < 20; i++) events.push(message(i + 1,
      usage(20000 + i * 1500 + j * 2000, 4000 + i * 150, { cacheReadTokens: 3800000 + i * 800, cacheWriteTokens: 1000, reasoningTokens: 1100 }), now - (19 - i) * 86400000));
    return { header: { ...header(id), cwd: `/home/dennis/demo/${id}` }, events };
  });
  persistence.state.entries.push(...Array.from({length:10},(_,i)=>({header:header(`unreadable-fixture-${i}`),events:[],failRead:'Unsupported descriptor version in synthetic old session; '+ 'long diagnostic context '.repeat(30)})));
  await new Promise(done => setTimeout(done, 1050));
  await page.locator('#refresh').click();
  await page.locator('#models').filter({ hasText: 'demo-model' }).waitFor();
  assert.equal(await page.locator('#data-health').evaluate(e=>e.open),false);
  assert.ok((await page.locator('#data-health').boundingBox()).height < 65);
  assert.match(await page.locator('#total-tokens').innerText(),/M/);
  assert.match(await page.locator('#notice').innerText(), /未.*费率|未定价/);
  await page.locator('[data-tab="rates"]').click();
  await page.locator('#observed button').first().click();
  for (const [field, value] of Object.entries({ input: '2', cacheRead: '0.5', cacheWrite: '3', output: '8' })) await page.locator('#price-' + field).fill(value);
  await page.locator('#rate-form button[type="submit"]').click();
  await page.locator('#notice').filter({ hasText: '已保存' }).waitFor();
  assert.equal(await page.locator('#rate-rows tr').count(), 1);
  await page.locator('#import-official').click();
  await page.locator('#rate-rows tr').nth(3).waitFor();
  assert.match(await page.locator('#rate-rows').innerText(), /工作日高峰/);
  assert.match(await page.locator('#rate-rows').innerText(), /deepseek-v4-flash/);
  await page.locator('#import-official').click();
  await page.locator('#notice').filter({hasText:'保留原设置'}).waitFor();
  assert.equal(await page.locator('#rate-rows tr').count(), 4);
  await page.locator('#rate-rows tr').nth(1).getByRole('button',{name:'编辑'}).click();
  assert.equal(await page.locator('#pricing-mode').inputValue(),'deepseek-weekday-peak-v1');
  await page.locator('#cancel-edit').click();
  await page.screenshot({ path: join(output, 'rates-demo.png'), fullPage: true });
  await page.locator('[data-tab="overview"]').click();
  assert.ok(!(await page.locator('#models').innerText()).includes('未定价'));
  await page.locator('[data-range="all"]').click();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  assert.match(await page.locator('#calls-note').innerText(), /60 次调用/);
  await page.evaluate(() => {
    const n = document.querySelector('#notice'); n.hidden = false; n.textContent = '界面预览 · 此图使用合成测试数据与示例费率，并非你的实际用量。';
  });
  await page.screenshot({ path: join(output, 'overview-demo.png'), fullPage: true });
  const downloadPromise = page.waitForEvent('download'); await page.locator('#csv').click();
  const download = await downloadPromise; assert.equal(download.suggestedFilename(), 'dsh-bill-visualization.csv');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: join(output, 'mobile-demo.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile page must not overflow horizontally');
  await page.goto(url);
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button', { name: 'Token / 费用',exact:true }).waitFor();
  assert.ok(await page.locator('#dsh-bill-visualization-launcher').evaluate(e=>!!e.nextElementSibling?.querySelector('[data-slot="sidebar.settings"]')));
  await page.screenshot({path:join(output,'sidebar-demo.png')});
  await page.evaluate(()=>document.querySelector('aside').style.width='60px');
  await page.waitForFunction(()=>document.querySelector('#dsh-bill-visualization-launcher').hasAttribute('data-collapsed'));
  await page.evaluate(()=>document.querySelector('aside').style.width='256px');
  await page.evaluate(()=>{const node=document.querySelector('[data-slot="sidebar.settings"]');node.parentElement.replaceChildren(node.cloneNode(true));});
  await page.getByRole('button', { name: 'Token / 费用',exact:true }).waitFor();
  assert.equal(await page.locator('#dsh-bill-visualization-launcher').count(),1);
  await page.getByRole('button', { name: 'Token / 费用',exact:true }).click();
  await page.frameLocator('iframe').locator('#connection').filter({ hasText: /已连接本机|部分数据不可用/ }).waitFor();
  await page.getByRole('button', { name: '关闭统计窗口' }).click();
  assert.equal(await page.locator('dialog').evaluate(d => d.open), false);
  assert.deepEqual(failures, []);
  const report = { passed: true, checks: ['empty state','live refresh','unknown rates','collapsed diagnostics','large token formatting','rate form save','repricing','official price import','idempotent import','peak schedule retained in editor','all-time range','CSV download','mobile overflow','sidebar placement above settings','collapsed sidebar','sidebar remount without duplicate','iframe dashboard','dialog close','no browser errors'], syntheticData: true };
  await writeFile(join(output, 'browser-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(done => server.close(done));
  disposers.reverse().forEach(fn => fn()); await rm(dir, { recursive: true, force: true });
}
