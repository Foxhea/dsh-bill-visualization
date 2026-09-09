/** Synthetic counters, not real conversations or live billing rates. */
export const stamp = Date.parse('2026-09-09T04:00:00Z');
export const header = (id = 'test-session') => ({ id, version: 2, createdAt: stamp, isSeeded: false, cwd: '/home/test/project' });
export const usage = (inputTokens = 100, outputTokens = 20, extra = {}) => ({ inputTokens, outputTokens, ...extra });
export const route = (seq = 0, provider = 'test', model = 'fixture-model') => ({ seq, time: stamp, type: 'request/header', data: { header: { config: { provider, model } }, reason: 'initial' } });
export const message = (seq = 1, u = usage(), time = stamp) => ({ seq, time, type: 'assistant/message', data: { turn: 0, step: 0, message: { role: 'assistant', content: [] }, usage: u, stream: [] } });
export const streamUsage = u => ({ type: 'chunk', time: stamp, chunk: { type: 'usage', usage: u } });
export const rate = (overrides = {}) => ({ provider: 'test', model: 'fixture-model', effectiveFrom: '1970-01-01T00:00:00.000Z', input: 2, cacheRead: 0.5, cacheWrite: 3, output: 8, ...overrides });
export const config = (rates = [rate()]) => ({ version: 1, currency: 'CNY', timeZone: 'Asia/Shanghai', rates });

export function persistenceFixture(entries = [{ header: header(), events: [route(), message()] }]) {
  const state = { entries, opens: 0, closes: 0, reads: [], lists: 0 };
  return {
    state,
    async list() { state.lists++; return state.entries.map(e => ({ header: e.header, revision: e.revision ?? 'r1' })); },
    async open(id, access) {
      if (access !== 'read') throw new Error('Plugin attempted write access');
      state.opens++;
      const entry = state.entries.find(e => e.header.id === id);
      if (entry.failOpen) throw new Error('fixture open error');
      return { header: entry.header, inheritedEventCount: entry.inheritedEventCount ?? 0,
        async read(offset = 0, length = Infinity) { state.reads.push([offset, length]); if (entry.failRead) throw new Error(typeof entry.failRead === 'string' ? entry.failRead : 'fixture read error'); return { events: entry.events.slice(offset, offset + length), eventState: 'detached' }; },
        async close() { state.closes++; },
      };
    },
  };
}
