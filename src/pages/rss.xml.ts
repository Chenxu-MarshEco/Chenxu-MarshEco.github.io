/**
 * RSS 订阅源：/rss.xml
 * 用任意 RSS 阅读器订阅这个地址即可跟进更新。
 */
import type { APIRoute } from 'astro';
import site from '../site.config';
import { excerpt, getNotes, getPosts } from '../utils/content';
import { absoluteUrl } from '../utils/url';

const escapeXml = (value: string): string =>
  value.replace(
    /[<>&'"]/g,
    (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c] as string
  );

export const GET: APIRoute = async ({ site: astroSite }) => {
  const entries = [...(await getPosts()), ...(await getNotes())]
    .sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
    .slice(0, 30);

  const items = entries
    .map((entry) => {
      const path = entry.collection === 'posts' ? `/posts/${entry.id}/` : `/notes/${entry.id}/`;
      const url = absoluteUrl(path, astroSite);
      const description = excerpt(entry, 200);
      return `    <item>
      <title>${escapeXml(entry.data.title)}</title>
      <link>${escapeXml(url)}</link>
      <guid isPermaLink="true">${escapeXml(url)}</guid>
      <pubDate>${entry.data.date.toUTCString()}</pubDate>
      <description>${escapeXml(description)}</description>
${entry.data.tags.map((t) => `      <category>${escapeXml(t)}</category>`).join('\n')}
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.title)}</title>
    <link>${escapeXml(absoluteUrl('/', astroSite))}</link>
    <description>${escapeXml(site.description)}</description>
    <language>${escapeXml(site.lang)}</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <atom:link href="${escapeXml(absoluteUrl('/rss.xml', astroSite))}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
};
