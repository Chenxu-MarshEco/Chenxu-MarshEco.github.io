/**
 * 链接工具。
 *
 * 站点目前部署在根路径 /，所以这些函数看起来有点多余；
 * 但如果你以后把站点改成项目仓库（比如 https://xxx.github.io/blog），
 * 只要改 astro.config.mjs 里的 base，全站链接会自动跟着变，不用手改。
 */

/** 站点根路径，base 为 '/' 时结果是空字符串 */
const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** 把站内路径补上前缀：withBase('/posts') -> '/posts' 或 '/blog/posts' */
export function withBase(path: string): string {
  if (/^https?:\/\//.test(path) || path.startsWith('#')) return path;
  return BASE + (path.startsWith('/') ? path : `/${path}`);
}

/** 生成完整的绝对地址，用于 RSS / sitemap / og:url */
export function absoluteUrl(path: string, site: URL | string | undefined): string {
  const origin = site ? String(site) : 'https://example.com';
  return new URL(withBase(path), origin).href;
}

/** 去掉尾斜杠，方便比较导航高亮 */
export function normalizePath(path: string): string {
  const clean = path.split(/[?#]/)[0];
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

/** 当前路径是否命中导航项（首页要精确匹配，其余按前缀匹配） */
export function isActive(currentPath: string, href: string): boolean {
  const current = normalizePath(currentPath);
  const target = normalizePath(href);
  if (target === '/' || target === '') return current === '/' || current === '';
  return current === target || current.startsWith(`${target}/`);
}
