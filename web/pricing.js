/** Official CNY price snapshot, verified 2026-10-22. No live-fetch or historical-price claim. */
export const DEEPSEEK_PRICING = Object.freeze({
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/',
  checkedOn: '2026-10-22',
  effectiveFrom: '2026-09-10T04:00:00.000Z',
  schedule: 'deepseek-weekday-peak-v1',
  models: Object.freeze([
    // Current Flash id (DeepSeek-V4.1-Flash).
    Object.freeze({ model: 'deepseek-flash', input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 }),
    // Retired Flash ids: still callable, served by V4.1-Flash and billed at the Flash price.
    Object.freeze({ model: 'deepseek-v4-flash', input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 }),
    Object.freeze({ model: 'deepseek-v4-flash-vision-exp', input: 1, cacheRead: 0.02, cacheWrite: 1, output: 4 }),
    Object.freeze({ model: 'deepseek-v4-pro', input: 4.5, cacheRead: 0.15, cacheWrite: 4.5, output: 13.5 }),
  ]),
});

/**
 * Prices above are off-peak. Peak windows are Beijing time and independent of
 * the display timezone: Monday–Friday 09:00–12:00 and 14:00–18:00. Weekends
 * and any date listed in `holidays` (China public holidays as YYYY-MM-DD in
 * Beijing time) are off-peak all day, per the official billing rules.
 */
export function deepseekMultiplier(time, holidays = []) {
  const beijing = new Date(time + 8 * 3600000);
  const weekday = beijing.getUTCDay(), minute = beijing.getUTCHours() * 60 + beijing.getUTCMinutes();
  const peakWindow = (minute >= 540 && minute < 720) || (minute >= 840 && minute < 1080);
  if (!(weekday >= 1 && weekday <= 5) || !peakWindow) return 1;
  if (holidays.length > 0) {
    const day = `${beijing.getUTCFullYear()}-${String(beijing.getUTCMonth() + 1).padStart(2, '0')}-${String(beijing.getUTCDate()).padStart(2, '0')}`;
    if (holidays.includes(day)) return 1;
  }
  return 2;
}

export function officialDeepseekRates(provider = 'deepseek', effectiveFrom = DEEPSEEK_PRICING.effectiveFrom) {
  return DEEPSEEK_PRICING.models.map(model => ({ ...model, provider, effectiveFrom,
    schedule: DEEPSEEK_PRICING.schedule, source: DEEPSEEK_PRICING.source, checkedOn: DEEPSEEK_PRICING.checkedOn }));
}

/** Keep every existing row, including a user's price at an identical effective instant. */
export function mergeOfficialRates(existing, incoming) {
  return [...existing, ...incoming.filter(row => !existing.some(old => old.provider === row.provider && old.model === row.model && Date.parse(old.effectiveFrom) === Date.parse(row.effectiveFrom)))];
}
