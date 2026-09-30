// The umpire's recordings. Files in  public/sounds/umpire/  (names in umpireNames.js) are his voice. The build looks in that folder and hands the game the list (`__UMPIRE_FILES__`), so the game only downloads
// files that exist. Any call without a recording is silent (the umpire still signals it).
// The files are fetched once, after the first click/key press (the browser will not play sound before that). A file that cannot
// be read is simply skipped - nothing here can stop the game.
import { CONFIG } from '../config.js';
import { FILES_FOR, parseUmpireFile } from './umpireNames.js';

export { FILES_FOR, FILE_NAMES } from './umpireNames.js';

const baseUrl = () => {
  try { return (import.meta.env && import.meta.env.BASE_URL) || '/'; } catch (e) { return '/'; }
};
// the recordings the build found (a list of file names), or none when running from something that was not built
const builtList = () => (typeof __UMPIRE_FILES__ !== 'undefined' && Array.isArray(__UMPIRE_FILES__) ? __UMPIRE_FILES__ : []); // eslint-disable-line no-undef

// decodeAudioData exists in a promise form and (older Safari) a callback form
const decode = (ctx, bytes) => new Promise((resolve, reject) => {
  try {
    const r = ctx.decodeAudioData(bytes, resolve, reject);
    if (r && typeof r.then === 'function') r.then(resolve, reject);
  } catch (e) { reject(e); }
});

export class UmpireFiles {
  /**
   * @param {object} [o]
   * @param {string} [o.base]     site base path (defaults to the build's BASE_URL, so it works on GitHub Pages and on Vercel)
   * @param {string[]} [o.list]   file names present in the folder (defaults to what the build found)
   * @param {Function} [o.fetch]  (for tests)
   */
  constructor({ base = baseUrl(), list = builtList(), fetch: fetchFn } = {}) {
    this.base = base.endsWith('/') ? base : base + '/';
    this.list = list;
    this.fetch = fetchFn || (typeof fetch === 'function' ? (...a) => fetch(...a) : null);
    this.takes = new Map(); // call name -> [AudioBuffer]
    this.started = false;
    this.ready = Promise.resolve(0);
  }

  /** Fetch and decode the recordings. Safe to call twice; resolves to how many were loaded. */
  load(ctx) {
    if (this.started) return this.ready;
    this.started = true;
    const folder = this.base + CONFIG.audio.umpire.files.folder;
    const jobs = this.list.map((file) => ({ file, info: parseUmpireFile(file) })).filter((j) => j.info).map(async ({ file, info }) => {
      const buf = await this.fetchBuffer(ctx, folder + encodeURIComponent(file));
      if (buf) { if (!this.takes.has(info.name)) this.takes.set(info.name, []); this.takes.get(info.name).push(buf); }
    });
    this.ready = Promise.all(jobs).then(() => this.count, () => this.count);
    return this.ready;
  }

  async fetchBuffer(ctx, url) {
    try {
      if (!this.fetch) return null;
      const res = await this.fetch(url);
      if (!res || !res.ok) return null;
      const type = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (/html|json|text/i.test(type)) return null; // (a server that answers a missing file with its home page)
      return await decode(ctx, await res.arrayBuffer());
    } catch (e) { return null; }
  }

  get count() { let n = 0; for (const l of this.takes.values()) n += l.length; return n; }

  /** Is there a recording for this call? */
  has(kind) { return (FILES_FOR[kind] || []).some((n) => this.takes.has(n)); }

  /**
   * One recording of this call, or null. The takes of every file that fits are pooled and one is picked at random, so a first
   * strike is sometimes "Strike one!", sometimes "Strike!", sometimes a drawn-out "Strrrike!". ball4 is the exception: its own
   * file wins when it exists (it says something the plain call does not).
   */
  pick(kind, rng) {
    const names = FILES_FOR[kind] || [];
    const pool = [];
    for (const n of names) {
      const list = this.takes.get(n);
      if (!list || !list.length) continue;
      if (kind === 'ball4' && n === 'ball4') { pool.push(...list); break; }
      pool.push(...list);
    }
    if (!pool.length) return null;
    return pool[Math.floor((rng ? rng.next() : Math.random()) * pool.length) % pool.length];
  }
}
