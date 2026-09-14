/**
 * 站点地图：/sitemap.xml
 * 提交给搜索引擎用，例如 Google Search Console。
 */
import type { APIRoute } from 'astro';
import { getNotes, getPosts } from '../utils/content';
import { absoluteUrl } from '../utils/url';
import { toISODate } from '../utils/date';

export const GET: APIRoute = async ({ site: astroSite }) => {
  const entries = [...(await getPosts()), ...(await getNotes())];

  const staticPages = ['/', '/posts', '/notes', '/tags', '/archive', '/about', '/friends'];

  const tags = [...new Set(entries.flatMap((e) => e.data.tags ?? []))].map(
    (tag) => `/tags/${encodeURIComponent(tag)}/`
  );

  const urls = [
    ...staticPages.map((p) => ({ loc: absoluteUrl(p, astroSite), lastmod: undefined })),
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
