/**
 * 聊天室历史的**小索引** —— `dist/chat-search.json`
 *
 * 用户原话：「也可以搜索历史聊天记录 …… 但是**需要所有用户都能搜索**」。
 *
 * 静态站没有后端可以问，所以搜索只能这么成立：构建期把仓库里那些存档
 * （`src/data/chat/<日>.json`，每天一份，见 utils/chat-archive.ts）摊平成一份公开的
 * 静态索引，页面在**浏览器里**过滤它 —— 匿名访客（没登录、没过审）照样搜得了，
 * 而且这条路完全不碰云端，一分腾讯云额度都不花。
 *
 * 只要三样东西，而且**只有文字、不带图片**（图片在存档页上，这里只是用来"找到那句话"）：
 *   · `d`  哪一天（跳到 `/liyutang/chatroom/<日>/#<id>` 要用）
 *   · `id` 那一条的 id（就是存档页上那个元素的 id，深链接落点）
 *   · `t`  正文，截到 200 字（再多也只是把整份索引喂胖，搜索用不上）
 *
 * 顺序就是页面上要的顺序：**新的在前**（日期倒序，同一天里也从最后一条往前走），
 * 于是搜索页只管过滤、不用再排一次。写法照抄 /anchors.json 那一份（prerender + GET）。
 */
import type { APIRoute } from 'astro';
import { chatArchives } from '../utils/chat-archive';

export const prerender = true;

/** 每条正文留多少个字。整份索引是要被每个访客下载下来过滤的，越小越好 */
const KEEP = 200;

export const GET: APIRoute = async () => {
  const items: Array<{ d: string; id: string; nick: string; t: string }> = [];
  for (const archive of chatArchives()) {
    /* 同一天里倒着走一遍：这样索引天然就是「最新的一条在最前」，
       搜索页过滤完直接就是结果该有的顺序（新的在前）。 */
    for (let i = archive.messages.length - 1; i >= 0; i--) {
      const m = archive.messages[i];
      items.push({ d: archive.day, id: m.id, nick: m.nick, t: m.text.slice(0, KEEP) });
    }
  }

  const body = {
    note: `聊天室历史的小索引（构建期生成，机器写的别手改）：${items.length} 条，按新的在前排，正文截到 ${KEEP} 字，只有文字没有图片。`,
    count: items.length,
    items,
  };

  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
