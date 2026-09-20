/**
 * 站点地图：/sitemap.xml
 * 提交给搜索引擎用，例如 Google Search Console。
 */
import type { APIRoute } from 'astro';
import { getNotes, getPosts } from '../utils/content';
import { absoluteUrl } from '../utils/url';
import { toISODate } from '../utils/date';
import site from '../site.config';
import { flattenBoards, isStandalone, type BoardNode } from '../utils/boards';

export const GET: APIRoute = async ({ site: astroSite }) => {
  const entries = [...(await getPosts()), ...(await getNotes())];

  /*
    手写死的几个独立页面。
    `/about-me/`（页头左上角那个小圆片点进去的）和 `/iceberg/`（首页冰室冰山那块）
    是本轮新加的，性质跟 `/about` 一样是普通公开页，收录。

    ⚠ **`/salon/`（冰室精华）故意不收**：那页是 735 条群聊里摘出来的原话，
    属于"首页点得进去、知道地址就能看"的东西，不该主动推给搜索引擎。
    哪天想让它被搜到，把它加进这个数组即可（或者给那页加 noindex）。
  */
  const staticPages = ['/', '/posts', '/notes', '/tags', '/archive', '/about', '/friends', '/about-me', '/iceberg'];

  /*
    大板块树里的每一层都会自动生成页面，这里把它们的地址全部收录。
    以前是手写死的列表，加一层就漏一个 —— 现在直接从树里推导，
    不会再出现 sitemap 和实际页面不一致的情况。
    feed-check 就是靠比对这两者发现问题的。

    **独立页面（standalone）不收**：它们按定义就是"不挂在任何列表里、
    只能靠别处的链接点进来"的那种页面，丢进站点地图等于自己把它列出来。
    （页面本身照旧生成，地址照旧能访问 —— 只是不主动告诉搜索引擎。）
  */
  const boardPages = flattenBoards(site.homeBoards as BoardNode[])
    .filter((f) => !isStandalone(f.node))
    .map((f) => f.url);

  const allStatic = [...staticPages, ...boardPages];

  const tags = [...new Set(entries.flatMap((e) => e.data.tags ?? []))].map(
    (tag) => `/tags/${encodeURIComponent(tag)}/`
  );

  const urls = [
    ...allStatic.map((p) => ({ loc: absoluteUrl(p, astroSite), lastmod: undefined })),
    ...tags.map((p) => ({ loc: absoluteUrl(p, astroSite), lastmod: undefined })),
    ...entries.map((entry) => ({
      loc: absoluteUrl(
        entry.collection === 'posts' ? `/posts/${entry.id}/` : `/notes/${entry.id}/`,
        astroSite
      ),
      lastmod: toISODate(entry.data.updated ?? entry.data.date),
    })),
  ];

  const body = urls
    .map(
      ({ loc, lastmod }) =>
        `  <url>\n    <loc>${loc}</loc>\n${lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : ''}  </url>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
