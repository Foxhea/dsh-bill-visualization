/** Official CNY price snapshot, verified 2026-09-09. No live-fetch or historical-price claim. */
export const DEEPSEEK_PRICING = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  checkedOn: '2026-09-09',
  effectiveFrom: '2026-09-10T04:00:00.000Z',
  schedule: 'deepseek-weekday-peak-v1',
  models: Object.freeze([
    Object.freeze({ model: 'deepseek-v4-flash', input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 }),
    Object.freeze({ model: 'deepseek-v4-pro', input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 }),
    Object.freeze({ model: 'deepseek-v4-flash-vision-exp', input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 }),
  ]),
});

/** Prices above are off-peak. Peak boundaries are Beijing time, independent of display timezone. */
export function deepseekMultiplier(time) {
  const beijing = new Date(time + 8 * 3600000);
  const weekday = beijing.getUTCDay(), minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  return weekday >= 1 && weekday <= 5 && ((minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080)) ? 2 : 1;
}

export function officialDeepseekRates(provider = 'deepseek', effectiveFrom = DEEPSEEK_PRICING.effectiveFrom) {
  return DEEPSEEK_PRICING.models.map(model => ({ ...model, provider, effectiveFrom,
    schedule: DEEPSEEK_PRICING.schedule, source: DEEPSEEK_PRICING.source, checkedOn: DEEPSEEK_PRICING.checkedOn }));
}

/** Keep every existing row, including a user's price at an identical effective instant. */
export function mergeOfficialRates(existing, incoming) {
  return [...existing, ...incoming.filter(row => !existing.some(old => old.provider === row.provider && old.model === row.model && Date.parse(old.effectiveFrom) === Date.parse(row.effectiveFrom)))];
}
