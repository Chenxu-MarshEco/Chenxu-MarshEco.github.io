/**
 * 站点地图：/sitemap.xml
 * 提交给搜索引擎用，例如 Google Search Console。
 */
import type { APIRoute } from 'astro';
import { getNotes, getPosts } from '../utils/content';
import { absoluteUrl } from '../utils/url';
import { toISODate } from '../utils/date';
import site from '../site.config';

export const GET: APIRoute = async ({ site: astroSite }) => {
  const entries = [...(await getPosts()), ...(await getNotes())];

  const staticPages = ['/', '/posts', '/notes', '/tags', '/archive', '/about', '/friends'];

  /*
    首页那两个大板块以及它们的子页面也要收录。
    这些页面是后加的，早先 staticPages 是写死的，所以漏掉了 ——
    feed-check 就是靠比对 sitemap 和 dist 里的真实页面发现这个问题的。
    这里从 site.config 里取大板块，再补上花娅陌域下的两个固定子页面。
  */
  const boardPages = site.homeBoards.map((b) => b.href);
  const huayaChildren = ['/huaya/mozhiliu', '/huaya/yuanweimian'];

  const allStatic = [...staticPages, ...boardPages, ...huayaChildren];

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
