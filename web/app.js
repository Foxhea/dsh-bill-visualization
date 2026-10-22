import { DEEPSEEK_PRICING, officialDeepseekRates, mergeOfficialRates } from './pricing.js';

/* UI only consumes this plugin's authenticated HTTP endpoints. */
(() => {
  // The launcher hands over the host's resolved theme; standalone visits keep
  // the stylesheet's prefers-color-scheme default.
  const requested = new URLSearchParams(location.search).get('theme');
  if (requested === 'dark' || requested === 'light') document.documentElement.dataset.theme = requested;
  const $ = id => document.getElementById(id), number = n => new Intl.NumberFormat('zh-CN').format(n);
  const compact = n => new Intl.NumberFormat('en-US', { notation:'compact', maximumFractionDigits:2 }).format(n);
  let data, rates, editIndex = -1, sessionLimit = 50, callLimit = 50, chartMode = 'tokens', busy = false, dirty = false, rangeInitialized = false;
  const money = n => new Intl.NumberFormat('zh-CN', { style: 'currency', currency: data?.currency ?? rates?.currency ?? 'CNY', minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(n);
  function notice(text = '', success = false) { $('notice').textContent = text; $('notice').hidden = !text; $('notice').classList.toggle('success', success); }
  function el(tag, text, className) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e; }
  async function api(path, options = {}) {
    const response = await fetch('/dsh-bill-visualization' + path, { credentials: 'same-origin', cache: 'no-store', ...options, signal: AbortSignal.timeout(120000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `请求失败 ${response.status}`);
    return result;
  }
  function query() {
    const p = new URLSearchParams();
    if ($('from').value) p.set('from', $('from').value);
    if ($('to').value) p.set('to', $('to').value);
    if ($('filter-provider').value) p.set('provider', $('filter-provider').value);
    if ($('filter-model').value) p.set('model', $('filter-model').value);
    if ($('filter-workspace').value) p.set('workspace', $('filter-workspace').value);
    return '?' + p;
  }
  function empty(tbody, columns, text) { const tr = el('tr'), td = el('td', text, 'empty-cell'); td.colSpan = columns; tr.append(td); tbody.append(tr); }
  function costCell(row) { const td = el('td', row.reportedCalls === row.unpricedCalls ? '—' : money(row.estimatedCost));
    if (row.unpricedCalls) td.append(el('span', `${number(row.unpricedCalls)} 次未定价`, 'unpriced'));
    if (row.missingUsageCalls) td.append(el('span', `${number(row.missingUsageCalls)} 次用量未知`, 'unpriced'));
    return td;
  }
  function cardCost(id, row) { $(id).textContent = row.reportedCalls === row.unpricedCalls && row.calls ? '—' : money(row.estimatedCost); }
  function periodNote(row) { return `${compact(row.totalTokens)} Token · ${number(row.calls)} 次调用` + (row.unpricedCalls ? ` · ${row.unpricedCalls} 次未定价` : ''); }
  function render() {
    cardCost('month-cost', data.month); cardCost('today-cost', data.today);
    $('month-note').textContent = periodNote(data.month); $('today-note').textContent = periodNote(data.today);
    $('total-tokens').textContent = compact(data.total.totalTokens);
    $('total-tokens').title = `${number(data.total.totalTokens)} Token`;
    $('total-tokens').setAttribute('aria-label',`${number(data.total.totalTokens)} Token`);
    $('calls-note').textContent = `${number(data.total.calls)} 次调用 · ${number(data.total.attempts)} 次无消息尝试`;
    const inputs = data.total.inputTokens + data.total.cacheReadTokens + data.total.cacheWriteTokens;
    $('cache-rate').textContent = inputs ? (100 * data.total.cacheReadTokens / inputs).toFixed(1) + '%' : '—';
    $('updated').textContent = `${new Date(data.scanAt).toLocaleTimeString('zh-CN')} 同步 · ${data.timeZone}`;
    const warnings = [];
    if (data.total.unpricedCalls) warnings.push(`${number(data.total.unpricedCalls)} 次调用未定价，费用合计不完整。可在「费率设置」导入官方价或填写单价。`);
    if (data.total.missingUsageCalls) warnings.push(`${number(data.total.missingUsageCalls)} 次调用用量未知，未计入总量。`);
    renderHealth();
    notice(warnings.join('\n'));
    $('connection').textContent = data.errors.length ? '部分数据不可用' : '已连接本机';
    $('connection').classList.toggle('partial',data.errors.length > 0);
    renderChart(); renderBreakdown(); renderModels(); renderSessions(); renderCalls(); renderObserved(); renderFilters(); renderBudget();
    $('csv').href = '/dsh-bill-visualization/export.csv' + query(); $('json').href = '/dsh-bill-visualization/export.json' + query();
    $('csv-calls').href = '/dsh-bill-visualization/export.calls.csv' + query();
  }
  function renderBudget() {
    const budget = data.budget, box = $('budget');
    if (!budget || !(budget.monthly > 0)) { box.hidden = true; return; }
    box.hidden = false;
    const spent = data.month.estimatedCost, ratio = spent / budget.monthly;
    const fill = $('budget-fill');
    fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
    fill.dataset.state = ratio >= 1 ? 'over' : ratio >= budget.alertThreshold ? 'warn' : 'ok';
    $('budget-note').textContent = `月度预算 ${money(budget.monthly)} · 已用 ${(ratio * 100).toFixed(1)}%`
      + (ratio >= 1 ? ' · 已超出预算' : ratio >= budget.alertThreshold ? ' · 接近预算' : '');
  }
  /** Rebuild one filter select while keeping the current choice when it still exists. */
  function fillSelect(id, values, label) {
    const select = $(id), current = select.value;
    select.replaceChildren(el('option', label));
    select.firstElementChild.value = '';
    for (const value of values) { const option = el('option', value); option.value = value; select.append(option); }
    select.value = values.includes(current) ? current : '';
  }
  function renderFilters() {
    fillSelect('filter-provider', [...new Set(data.observed.map(r => r.provider))].sort(), '全部供应商');
    fillSelect('filter-model', [...new Set(data.observed.map(r => r.model))].sort(), '全部模型');
    fillSelect('filter-workspace', [...new Set(data.workspaces.map(w => w.cwd))].filter(Boolean).sort(), '全部工作区');
  }
  function renderCalls() {
    const root = $('calls'); root.replaceChildren();
    $('calls-count').textContent = `共 ${number(data.callTotal)} 条请求`
      + (data.callTotal > data.calls.length ? `，显示最近 ${number(data.calls.length)} 条` : '');
    if (!data.calls.length) { empty(root, 8, '所选范围内还没有请求'); $('more-calls').hidden = true; return; }
    for (const row of data.calls.slice(0, callLimit)) {
      const tr = el('tr');
      const route = el('td'); route.append(el('strong', row.model), el('small', row.provider));
      const session = el('td'); session.append(el('small', row.sessionId)); session.title = row.cwd;
      const cost = el('td', row.status === 'priced' ? money(row.cost) : '—');
      if (row.status === 'unpriced') cost.append(el('span', '未定价', 'unpriced'));
      if (row.status === 'unknown') cost.append(el('span', '用量未知', 'unpriced'));
      const cells = [row.inputTokens, row.cacheReadTokens, row.cacheWriteTokens, row.outputTokens]
        .map(v => el('td', v === null || v === undefined ? '—' : number(v)));
      tr.append(el('td', new Date(row.time).toLocaleString('zh-CN', { timeZone: data.timeZone })), route, session, ...cells, cost);
      root.append(tr);
    }
    $('more-calls').hidden = data.calls.length <= callLimit;
  }
  function renderHealth() {
    $('data-health').hidden = !data.errors.length;
    $('health-title').textContent = `${data.errors.length} 项读取问题`;
    const root=$('health-issues');root.replaceChildren();
    for(const issue of data.errors) {
      const item=el('div',undefined,'health-item');
      const label=/seq gap|corrupt/i.test(issue.message)?'会话日志存在缺口或损坏':/unsupported|format/i.test(issue.message)?'历史会话格式暂不兼容':issue.code==='session-limit'?'会话数超过扫描上限':'会话读取异常';
      item.append(el('strong',label),el('span',issue.id ?? issue.code));
      const details=el('details'),summary=el('summary','技术详情');details.append(summary,el('pre',issue.message));item.append(details);root.append(item);
    }
  }
  function shiftDay(day, n) { const date = new Date(day + 'T12:00:00Z'); date.setUTCDate(date.getUTCDate() + n); return date.toISOString().slice(0, 10); }
  function todayInZone(zone) { const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return ['year', 'month', 'day'].map(t => parts.find(p => p.type === t).value).join('-'); }
  function setRange(value) {
    if (value === 'all') { $('from').value = ''; $('to').value = ''; }
    else { const today = todayInZone(rates.timeZone); $('to').value = today; $('from').value = shiftDay(today, 1 - Number(value)); }
    document.querySelectorAll('[data-range]').forEach(b => b.classList.toggle('selected', b.dataset.range === value));
  }
  function renderChart() {
    const metric = chartMode === 'cost' ? 'estimatedCost' : 'totalTokens';
    const chart = $('chart'); chart.replaceChildren(); chart.classList.remove('empty');
    if (!data.daily.length) { chart.classList.add('empty'); chart.textContent = '这个范围内还没有调用记录'; return; }
    const end = data.to || data.daily.at(-1).day;
    let start = shiftDay(end, -29); if (data.from && start < data.from) start = data.from;
    const map = new Map(data.daily.map(d => [d.day, d])); const days = [];
    for (let day = start; day <= end; day = shiftDay(day, 1)) days.push(map.get(day) || { day, totalTokens: 0, estimatedCost: 0 });
    const max = Math.max(1e-9, ...days.map(d => d[metric]));
    days.forEach((d, i) => {
      const group = el('div', undefined, 'bar-group'), space = el('div', undefined, 'bar-space');
      const bar = el('button', undefined, 'bar'); bar.type = 'button'; bar.style.height = `${Math.max(1, 100 * d[metric] / max)}%`;
      bar.title = `${d.day} · ${number(d.totalTokens)} Token · 已定价 ${money(d.estimatedCost)}`; bar.setAttribute('aria-label', bar.title);
      space.append(bar); group.append(space, el('span', i === 0 || i === days.length - 1 || (i % 7 === 0 && i < days.length - 3) ? d.day.slice(5) : '', 'bar-label')); chart.append(group);
    });
    $('chart-legend').textContent = chartMode === 'cost' ? '每日已定价费用' : '每日记录 Token';
  }
  function renderBreakdown() {
    const root = $('breakdown'); root.replaceChildren();
    for (const [key, label] of [['inputTokens','未缓存输入'],['cacheReadTokens','缓存读取'],['cacheWriteTokens','缓存写入'],['outputTokens','输出'],['reasoningTokens','其中：推理（不重复累加）']]) {
      const row = el('div', undefined, 'breakrow'), meter = el('div', undefined, 'meter'), fill = el('i');
      fill.style.width = `${Math.min(100, 100 * data.total[key] / (data.total.totalTokens || 1))}%`; meter.append(fill);
      row.append(el('span', label), el('strong', number(data.total[key])), meter); root.append(row);
    }
    $('cache-savings').textContent = data.total.cacheSaved > 0
      ? `缓存读取按命中价计费，较未命中价节省 ${money(data.total.cacheSaved)}。` : '';
  }
  function renderModels() {
    const root = $('models'); root.replaceChildren();
    if (!data.models.length) { empty(root, 7, '暂无模型用量。完成一次对话后刷新。'); return; }
    for (const row of data.models) {
      const tr = el('tr'), title = el('td'); title.append(el('strong', row.model), el('small', row.provider));
      tr.append(title, ...['calls','inputTokens','cacheReadTokens','cacheWriteTokens','outputTokens'].map(k => el('td', number(row[k]))), costCell(row)); root.append(tr);
    }
  }
  function renderSessions() {
    const root = $('sessions'); root.replaceChildren(); $('session-count').textContent = `${data.sessions.length} 个有调用的会话 / ${data.scannedSessions} 个已读取`;
    if (!data.sessions.length) empty(root, 5, '暂无会话用量');
    for (const row of data.sessions.slice(0, sessionLimit)) {
      const tr = el('tr'), title = el('td'); title.append(el('strong', row.id), el('small', row.cwd || '未指定工作目录')); title.title = row.cwd;
      tr.append(title, el('td', new Date(row.lastTime).toLocaleString('zh-CN', { timeZone: data.timeZone })), el('td', number(row.calls)), el('td', number(row.totalTokens)), costCell(row)); root.append(tr);
    }
    $('more-sessions').hidden = data.sessions.length <= sessionLimit;
  }
  function resetForm() {
    editIndex = -1; $('rate-form').reset(); $('effective').value = '1970-01-01T00:00'; $('rate-heading').textContent = '添加费率'; $('cancel-edit').hidden = true; dirty = false;
  }
  function renderRates() {
    $('currency').value = rates.currency; $('timezone').value = rates.timeZone;
    $('budget-monthly').value = rates.budget?.monthly ?? 0;
    $('budget-threshold').value = rates.budget?.alertThreshold ?? 0.8;
    $('holidays').value = (rates.holidays ?? []).join(', ');
    const root = $('rate-rows'); root.replaceChildren();
    if (!rates.rates.length) empty(root, 7, '还没有费率。请填写你的模型实际价格。');
    rates.rates.forEach((row, index) => {
      const tr = el('tr'), title = el('td'); title.append(el('strong', row.model), el('small', row.provider));
      if (row.schedule) title.append(el('small', '空闲价 · 工作日高峰 ×2'));
      if (row.source) title.append(el('small', `官方快照 · ${row.checkedOn}`));
      tr.append(title, el('td', new Date(row.effectiveFrom).toLocaleString('zh-CN')),
        ...['input','cacheRead','cacheWrite','output'].map(k => el('td', number(row[k]))));
      const action = el('td'), edit = el('button', '编辑'), remove = el('button', '删除'); edit.type = remove.type = 'button';
      edit.onclick = () => {
        editIndex = index; $('provider').value = row.provider; $('model').value = row.model;
        const date = new Date(row.effectiveFrom); $('effective').value = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0,16);
        for (const key of ['input','cacheRead','cacheWrite','output']) $('price-' + key).value = row[key];
        $('pricing-mode').value = row.schedule ?? 'fixed';
        $('rate-heading').textContent = '编辑费率'; $('cancel-edit').hidden = false; $('provider').focus(); dirty = true;
      };
      remove.onclick = async () => {
        if (!confirm(`删除 ${row.provider} / ${row.model} 的这条费率？历史费用将重新估算。`)) return;
        await save({ ...rates, rates: rates.rates.filter((_, i) => i !== index) });
      };
      action.append(edit, remove); tr.append(action); root.append(tr);
    });
  }
  function renderObserved() {
    const root = $('observed'); root.replaceChildren(); $('providers').replaceChildren(); $('model-ids').replaceChildren();
    if (!data.observed.length) root.append(el('span', '尚未检测到模型，完成对话后刷新。', 'smallprint'));
    for (const route of data.observed) {
      const button = el('button', route.model); button.type = 'button'; button.append(el('small', route.provider));
      button.onclick = () => { resetForm(); $('provider').value = route.provider; $('model').value = route.model; $('price-input').focus(); dirty = true; }; root.append(button);
    }
    for (const provider of new Set(data.observed.map(r => r.provider))) { const option = el('option'); option.value = provider; $('providers').append(option); }
    for (const model of new Set(data.observed.map(r => r.model))) { const option = el('option'); option.value = model; $('model-ids').append(option); }
  }
  async function refresh() {
    if (busy) return;
    busy = true; $('refresh').disabled = true; $('connection').textContent = '正在读取';
    try {
      if (!rates) { rates = await api('/rates'); renderRates(); }
      if (!rangeInitialized) { setRange('30'); rangeInitialized = true; }
      data = await api('/stats' + query()); render();
    } catch (error) { notice(error.message); $('connection').textContent = '读取失败'; }
    finally { busy = false; $('refresh').disabled = false; }
  }
  async function save(next) {
    const buttons = [...$('rates').querySelectorAll('button')]; buttons.forEach(b => b.disabled = true);
    try {
      rates = await api('/rates', { method: 'PUT', headers: { 'content-type':'application/json', 'x-dsh-bill-visualization':'1' }, body:JSON.stringify(next) });
      resetForm(); renderRates(); await refresh(); notice('已保存。统计按生效时间重新估算。', true);
    } catch (error) {
      notice(error.message);
      if (error.message.includes('另一个页面')) { rates = null; }
    } finally { buttons.forEach(b => b.disabled = false); }
  }
  document.querySelectorAll('[data-tab]').forEach(button => button.onclick = () => {
    document.querySelectorAll('[data-tab]').forEach(b => b.removeAttribute('aria-current')); button.setAttribute('aria-current','page');
    $('overview').hidden = button.dataset.tab !== 'overview'; $('rates').hidden = button.dataset.tab !== 'rates';
  });
  document.querySelectorAll('[data-range]').forEach(button => button.onclick = () => { if (!rates) return; setRange(button.dataset.range); refresh(); });
  $('apply-range').onclick = () => { document.querySelectorAll('[data-range]').forEach(b => b.classList.remove('selected')); refresh(); };
  $('refresh').onclick = async () => {
    if (!dirty) { try { rates = await api('/rates'); renderRates(); } catch (error) { notice(error.message); return; } }
    await refresh();
  };
  $('more-sessions').onclick = () => { sessionLimit += 50; renderSessions(); };
  $('more-calls').onclick = () => { callLimit += 50; renderCalls(); };
  document.querySelectorAll('[data-chart]').forEach(button => button.onclick = () => {
    chartMode = button.dataset.chart;
    document.querySelectorAll('[data-chart]').forEach(b => b.classList.toggle('selected', b === button));
    renderChart();
  });
  for (const id of ['filter-provider', 'filter-model', 'filter-workspace']) $(id).onchange = () => { refresh(); };
  $('cancel-edit').onclick = resetForm;
  $('rate-form').addEventListener('input', () => { dirty = true; });
  $('currency').onchange = $('timezone').oninput = $('budget-monthly').oninput = $('budget-threshold').oninput = $('holidays').oninput = () => { dirty = true; };
  $('rate-form').onsubmit = async event => {
    event.preventDefault(); if (!rates) { notice('请先刷新费率'); return; }
    const row = { provider: $('provider').value.trim(), model: $('model').value.trim(), effectiveFrom: new Date($('effective').value).toISOString() };
    if ($('pricing-mode').value !== 'fixed') row.schedule = $('pricing-mode').value;
    for (const key of ['input','cacheRead','cacheWrite','output']) row[key] = Number($('price-' + key).value);
    const updated = [...rates.rates]; if (editIndex < 0) updated.push(row); else updated[editIndex] = row;
    await save({ ...rates, rates: updated });
  };
  $('save-general').onclick = async () => {
    if (!rates) { notice('请先刷新费率'); return; }
    if (rates.rates.length && $('currency').value !== rates.currency) { notice('已有费率时不能直接切换币种。请先下载费率备份，再清空费率后切换。'); return; }
    const monthly = Number($('budget-monthly').value) || 0;
    const alertThreshold = Number($('budget-threshold').value) || 0.8;
    const holidays = $('holidays').value.split(/[\s,，]+/).map(v => v.trim()).filter(Boolean);
    await save({ ...rates, currency: $('currency').value, timeZone: $('timezone').value, budget: { monthly, alertThreshold }, holidays });
  };
  $('backup-rates').onclick = () => {
    if (!rates) return; const { revision, ...backup } = rates;
    const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type:'application/json' }));
    const link = el('a'); link.href = url; link.download = 'dsh-bill-visualization-rates.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  window.addEventListener('beforeunload', event => { if (dirty) { event.preventDefault(); event.returnValue = ''; } });
  for (const model of DEEPSEEK_PRICING.models) {
    const tr = el('tr'); tr.append(el('td', model.model), ...['input', 'cacheRead', 'output'].map(k => el('td', `¥${model[k]}`))); $('official-prices').append(tr);
  }
  const officialDate = new Date(DEEPSEEK_PRICING.effectiveFrom);
  $('official-effective').value = new Date(officialDate.getTime() - officialDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('import-official').onclick = async () => {
    if (!rates) { notice('请先刷新费率'); return; }
    if (rates.currency !== 'CNY') { notice('官方预设为人民币价格，请先切换为 CNY；不会自动换算美元费率。'); return; }
    const provider = $('official-provider').value.trim(), time = Date.parse($('official-effective').value);
    if (!provider || !Number.isFinite(time)) { notice('请填写供应商路由和有效的起始时间'); return; }
    const merged = mergeOfficialRates(rates.rates, officialDeepseekRates(provider, new Date(time).toISOString()));
    if (merged.length === rates.rates.length) { notice('这些路由在该生效时间已有费率，已保留原设置。'); return; }
    await save({ ...rates, rates: merged });
  };
  resetForm(); refresh();
  setInterval(() => { if (!document.hidden && !dirty && !$('overview').hidden) refresh(); }, 30000);
})();
