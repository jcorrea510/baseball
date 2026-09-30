// The build must pick the right base path for each host, or the page asks for files that are not there
// (that is exactly what left the Vercel site on an error screen: it asked for /baseball/assets/... at the site root).
import { describe, it, expect } from 'vitest';
import { resolveBase } from '../scripts/resolveBase.mjs';

describe('resolveBase', () => {
  it('uses "/" while developing', () => {
    expect(resolveBase({}, 'serve')).toBe('/');
    expect(resolveBase({ VERCEL: '1', BASE_PATH: '/x/' }, 'serve')).toBe('/');
  });
  it('uses "/" on Vercel and other root hosts', () => {
    expect(resolveBase({ VERCEL: '1' })).toBe('/');
    expect(resolveBase({ VERCEL: '1', VERCEL_ENV: 'production' })).toBe('/');
    expect(resolveBase({ NETLIFY: 'true' })).toBe('/');
    expect(resolveBase({ CF_PAGES: '1' })).toBe('/');
  });
  it('uses /<repo>/ in the GitHub Pages workflow', () => {
    expect(resolveBase({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jcorrea510/baseball' })).toBe('/baseball/');
    expect(resolveBase({ BASE_PATH: '/baseball/', GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'jcorrea510/baseball' })).toBe('/baseball/');
  });
  it('lets BASE_PATH win and tidies its slashes', () => {
    expect(resolveBase({ BASE_PATH: 'my-repo' })).toBe('/my-repo/');
    expect(resolveBase({ BASE_PATH: '/a/b' })).toBe('/a/b/');
    expect(resolveBase({ BASE_PATH: '/', VERCEL: '1' })).toBe('/');
    expect(resolveBase({ BASE_PATH: './' })).toBe('./');
    expect(resolveBase({ BASE_PATH: '/baseball/', VERCEL: '1' })).toBe('/baseball/');
  });
  it('falls back to paths relative to the page (works from any folder)', () => {
    expect(resolveBase({})).toBe('./');
  });
});

describe('the site address for link previews', () => {
  it('uses SITE_URL, else Vercel\'s production domain, else GitHub Pages, else nothing', async () => {
    const { resolveSiteUrl } = await import('../scripts/resolveBase.mjs');
    expect(resolveSiteUrl({ SITE_URL: 'https://sandlot.example.com' })).toBe('https://sandlot.example.com/');
    expect(resolveSiteUrl({ VERCEL: '1', VERCEL_PROJECT_PRODUCTION_URL: 'baseball-abc.vercel.app' })).toBe('https://baseball-abc.vercel.app/');
    expect(resolveSiteUrl({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'JCorrea510/baseball' })).toBe('https://jcorrea510.github.io/baseball/');
    expect(resolveSiteUrl({})).toBe('');
  });
});
