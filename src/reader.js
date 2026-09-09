import { createFold, foldEvents } from './accounting.js';

/** Revision cache stores only counters and route IDs, never conversation text. */
export class UsageReader {
  constructor(persistence, { cacheMs = 15000, maxSessions = 10000, maxEventsPerSession = 1000000, readTimeoutMs = 30000 } = {}) {
    this.persistence = persistence;
    this.options = { cacheMs, maxSessions, maxEventsPerSession, readTimeoutMs };
    this.cache = new Map();
    this.last = null;
    this.inflight = null;
  }

  async scan() {
    if (this.last && Date.now() - this.last.at < this.options.cacheMs) return this.last;
    if (this.inflight) return this.inflight;
    this.inflight = this.scanFresh();
    try { return await this.inflight; } finally { this.inflight = null; }
  }

  async scanFresh() {
    const snapshots = await this.persistence.list({ signal: AbortSignal.timeout(this.options.readTimeoutMs) });
    const sessions = [], errors = [], seen = new Set();
    if (snapshots.length > this.options.maxSessions) errors.push({ code: 'session-limit', message: `会话数 ${snapshots.length} 超过上限 ${this.options.maxSessions}，统计不完整。` });
    for (const snapshot of snapshots.slice(0, this.options.maxSessions)) {
      const id = snapshot.header.id;
      seen.add(id);
      const cached = this.cache.get(id);
      if (cached && cached.revision === snapshot.revision) { sessions.push(cached.session); continue; }
      let handle;
      try {
        const signal = AbortSignal.timeout(this.options.readTimeoutMs);
        handle = await this.persistence.open(id, 'read', { signal });
        const state = createFold(handle.header, handle.inheritedEventCount);
        let offset = 0;
        for (;;) {
          if (signal.aborted) throw new Error('会话读取超时');
          const { events } = await handle.read(offset, 512, { signal });
          if (!events.length) break;
          if (offset + events.length > this.options.maxEventsPerSession) throw new Error('会话事件数超过上限，未计入统计');
          foldEvents(state, events);
          offset += events.length;
          if (events.length < 512) break;
        }
        const session = { header: state.header, calls: state.calls };
        await handle.close();
        handle = undefined;
        this.cache.set(id, { revision: snapshot.revision, session });
        sessions.push(session);
      } catch (error) {
        this.cache.delete(id);
        errors.push({ code: 'session-read', id, message: String(error.message ?? error).slice(0, 300) });
      } finally {
        if (handle) {
          try { await handle.close(); } catch { errors.push({ code: 'session-close', id, message: '会话读取句柄释放失败' }); }
        }
      }
    }
    for (const id of this.cache.keys()) if (!seen.has(id)) this.cache.delete(id);
    this.last = { at: Date.now(), sessions, errors };
    return this.last;
  }
}
