import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateRates } from './accounting.js';

export const DEFAULT_RATES = { version: 1, currency: 'CNY', timeZone: 'Asia/Shanghai', rates: [] };

/** Only the plugin's rate file is written. Invalid existing files are never overwritten. */
export class RatesStore {
  constructor(path) { this.path = path; this.current = null; this.queue = Promise.resolve(); this.revision = ''; }
  async load() {
    let data;
    try { data = await readFile(this.path, 'utf8'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.current = validateRates(data === undefined ? DEFAULT_RATES : JSON.parse(data));
    this.revision = randomUUID();
    return this.get();
  }
  get() { return { ...structuredClone(this.current), revision: this.revision }; }
  save(input, expectedRevision) {
    const operation = this.queue.then(async () => {
      if (expectedRevision !== this.revision) {
        const error = new Error('费率已在另一个页面更新，请刷新后重试'); error.status = 409; throw error;
      }
      const next = validateRates(input);
      await mkdir(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        await rename(temporary, this.path);
      } catch (error) {
        await unlink(temporary).catch(() => {}); // Only our unique temporary file may be left after a failed write.
        throw error;
      }
      this.current = next; this.revision = randomUUID();
      return this.get();
    });
    this.queue = operation.catch(() => {}); // A failed request must not block later valid saves.
    return operation;
  }
}
