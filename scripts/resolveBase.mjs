// Where will the finished site live? The build has to know, because the page asks for its files by path.
//
//   GitHub Pages   https://<user>.github.io/<repo>/   -> "/<repo>/"
//   Vercel         https://<name>.vercel.app/         -> "/"   (also Netlify, Cloudflare Pages, Render)
//   anywhere else  -> "./"  (paths relative to the page, so it works from any folder or address)
//
// BASE_PATH always wins if it is set (the GitHub workflow sets it). `npm run dev` always uses "/".
export function resolveBase(env = {}, command = 'build') {
  if (command !== 'build') return '/';
  const explicit = (env.BASE_PATH || '').trim();
  if (explicit) {
    if (explicit === './' || explicit === '.') return './';
    const inner = explicit.replace(/^\/+|\/+$/g, '');
    return inner ? `/${inner}/` : '/';
  }
  if (env.VERCEL || env.NETLIFY || env.CF_PAGES || env.RENDER) return '/';
  if (env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY) {
    const repo = String(env.GITHUB_REPOSITORY).split('/').pop();
    if (repo) return `/${repo}/`;
  }
  return './';
}
