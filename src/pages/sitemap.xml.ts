/**
 * 站点地图：/sitemap.xml
 * 提交给搜索引擎用，例如 Google Search Console。
 */
import type { APIRoute } from 'astro';
import { getNotes, getPosts } from '../utils/content';
import { absoluteUrl } from '../utils/url';
import { toISODate } from '../utils/date';
import site from '../site.config';
import { flattenBoards, type BoardNode } from '../utils/boards';

export const GET: APIRoute = async ({ site: astroSite }) => {
  const entries = [...(await getPosts()), ...(await getNotes())];

  const staticPages = ['/', '/posts', '/notes', '/tags', '/archive', '/about', '/friends'];

  /*
    大板块树里的每一层都会自动生成页面，这里把它们的地址全部收录。
    以前是手写死的列表，加一层就漏一个 —— 现在直接从树里推导，
    不会再出现 sitemap 和实际页面不一致的情况。
    feed-check 就是靠比对这两者发现问题的。
  */
  const boardPages = flattenBoards(site.homeBoards as BoardNode[]).map((f) => f.url);

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
