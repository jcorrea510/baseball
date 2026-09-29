// The boot guard in index.html: it must turn every startup problem into a readable on-screen message.
// The real inline script is pulled out of index.html and run against a tiny fake page with fake timers.
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const inline = html.match(/<script>([\s\S]*?)<\/script>/);

function makePage(hostname = 'example.vercel.app') {
  const els = {};
  const el = (id) => (els[id] = els[id] || { id, textContent: '', hidden: true, style: {}, parentNode: { removeChild(n) { n.removed = true; } } });
  ['boot', 'boot-msg', 'boot-error', 'boot-error-title', 'boot-error-body', 'boot-error-detail'].forEach(el);
  els['boot'].hidden = false;
  const attrs = {};
  const listeners = {};
  const timers = [];
  let now = 0;
  const win = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    __errors: [],
  };
  const sandbox = {
    window: win,
    document: {
      getElementById: (id) => els[id] || null,
      documentElement: { setAttribute: (k, v) => { attrs[k] = v; } },
      addEventListener() {},
    },
    navigator: { userAgent: 'test-agent' },
    location: { hostname },
    console: { error() {} },
    setTimeout: (fn, ms) => { timers.push({ at: now + ms, fn, live: true }); return timers.length; },
    clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
  };
  vm.createContext(sandbox);
  vm.runInContext(inline[1], sandbox);
  return {
    els,
    boot: win.__sandlotBoot,
    state: () => attrs['data-boot'],
    fire: (type, ev) => (listeners[type] || []).forEach((fn) => fn(ev)),
    advance(ms) {
      now += ms;
      for (const t of timers) if (t.live && t.at <= now) { t.live = false; t.fn(); }
    },
    win,
  };
}

describe('index.html boot guard', () => {
  it('has an inline boot script that runs before the game module', () => {
    expect(inline).toBeTruthy();
    expect(html.indexOf(inline[0])).toBeLessThan(html.indexOf('type="module"'));
    expect(html).toContain('id="boot"');
    expect(html).toContain('id="boot-error"');
  });

  it('starts out loading', () => {
    const p = makePage();
    expect(p.state()).toBe('loading');
    expect(p.boot).toBeTruthy();
  });

  it('shows "game files didn\'t load" when the game script fails to load, without GitHub talk for players', () => {
    const p = makePage();
    p.fire('error', { target: { tagName: 'SCRIPT', src: 'https://example.vercel.app/baseball/assets/index.js' } });
    expect(p.state()).toBe('failed:load');
    expect(p.els['boot-error'].hidden).toBe(false);
    expect(p.els['boot-error-title'].textContent).toMatch(/game files/i);
    expect(p.els['boot-error-body'].textContent).not.toMatch(/GitHub|Pages|Actions/i);
    expect(p.els['boot-error-detail'].textContent).toContain('assets/index.js');
  });

  it('on a non-GitHub host the site-owner hint talks about the build address, never about GitHub Actions', () => {
    const p = makePage('my-game.vercel.app');
    p.fire('error', { target: { tagName: 'SCRIPT', src: 'https://my-game.vercel.app/baseball/assets/index.js' } });
    const detail = p.els['boot-error-detail'].textContent;
    expect(detail).toMatch(/whoever runs this site/i);
    expect(detail).toMatch(/Vercel/);
    expect(detail).not.toMatch(/GitHub Actions/);
  });

  it('on GitHub Pages the site-owner hint (in the folded details only) explains the Pages source setting', () => {
    const p = makePage('jcorrea510.github.io');
    p.fire('error', { target: { tagName: 'SCRIPT', src: 'https://jcorrea510.github.io/src/main.js' } });
    expect(p.els['boot-error-body'].textContent).not.toMatch(/GitHub/i);
    expect(p.els['boot-error-detail'].textContent).toMatch(/GitHub Actions/);
    expect(p.els['boot-error-detail'].textContent).toContain('src/main.js');
  });

  it('ignores a missing icon or stylesheet (not fatal)', () => {
    const p = makePage();
    p.fire('error', { target: { tagName: 'LINK', href: 'x.css' } });
    p.fire('error', { target: { tagName: 'IMG', src: 'x.png' } });
    expect(p.state()).toBe('loading');
  });

  it('explains a missing WebGL context in plain English', () => {
    const p = makePage();
    p.boot.fail('start', new Error('THREE.WebGLRenderer: Error creating WebGL context.'));
    expect(p.state()).toBe('failed:start');
    expect(p.els['boot-error-title'].textContent).toMatch(/3D graphics/i);
    expect(p.els['boot-error-body'].textContent).toMatch(/hardware acceleration/i);
  });

  it('reports an uncaught startup exception with technical details', () => {
    const p = makePage();
    p.fire('error', { target: p.win, error: new Error('boom in the constructor') });
    expect(p.state()).toBe('failed:start');
    expect(p.els['boot-error-title'].textContent).toMatch(/went wrong/i);
    expect(p.els['boot-error-detail'].textContent).toContain('boom in the constructor');
    expect(p.els['boot-error-detail'].textContent).toContain('test-agent');
  });

  it('reports an unhandled promise rejection during startup', () => {
    const p = makePage();
    p.fire('unhandledrejection', { reason: new Error('rejected') });
    expect(p.state()).toBe('failed:start');
  });

  it('warns about a slow start after 12s and gives up with a message at 45s instead of spinning forever', () => {
    const p = makePage();
    p.advance(11000);
    expect(p.els['boot-msg'].textContent).toBe('');
    p.advance(2000);
    expect(p.els['boot-msg'].textContent).toMatch(/still loading/i);
    expect(p.state()).toBe('loading');
    p.advance(33000);
    expect(p.state()).toBe('failed:timeout');
    expect(p.els['boot-error'].hidden).toBe(false);
    expect(p.els['boot-error-title'].textContent).toMatch(/too long/i);
  });

  it('a late start recovers from the timeout screen', () => {
    const p = makePage();
    p.advance(46000);
    expect(p.state()).toBe('failed:timeout');
    p.boot.done();
    expect(p.state()).toBe('ready');
    expect(p.els['boot-error'].hidden).toBe(true);
  });

  it('done() hides the splash, and later stray errors never cover a running game', () => {
    const p = makePage();
    p.boot.done();
    expect(p.state()).toBe('ready');
    expect(p.els['boot'].style.opacity).toBe('0');
    p.advance(700);
    expect(p.els['boot'].removed).toBe(true);
    p.fire('error', { target: p.win, error: new Error('harmless later error') });
    p.advance(60000);
    expect(p.state()).toBe('ready');
    expect(p.els['boot-error'].hidden).toBe(true);
  });

  it('a real failure is final: a later done() does not hide the error', () => {
    const p = makePage();
    p.boot.fail('start', new Error('nope'));
    p.boot.done();
    expect(p.state()).toBe('failed:start');
    expect(p.els['boot-error'].hidden).toBe(false);
  });

  it('the game code reports through the boot guard', () => {
    const main = fs.readFileSync(path.join(ROOT, 'src/main.js'), 'utf8');
    const app = fs.readFileSync(path.join(ROOT, 'src/app.js'), 'utf8');
    expect(main).toMatch(/boot\.fail\('start'/);
    expect(main).toMatch(/setTimeout\(start, \d+\)/); // startup must not depend on animation frames alone
    expect(app).toMatch(/__sandlotBoot\.done\(\)/);
    expect(app).toMatch(/__sandlotBoot\.fail\('frame'/);
  });
});
