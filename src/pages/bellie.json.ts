/**
 * 把「铃忆的冰室圣经」导出成 dist/bellie.json —— 给首页那条「每日圣经」用。
 *
 * 和 `salon.json.ts` 一个道理：首页要在**浏览器里**按"今天"挑一条
 * （同一天固定、隔天自动换，不用重新构建站点），所以只在这里吐挑一条要用的字段。
 *
 * 和精华那一份的差别（站长 2026-11-20）：
 *   「一张圣经卡片应分为正文和评语两个部分 正文是成员在群内说的原句 要正常比例显示
 *    而评语是lingyibot的AI每天对其的吐槽评析 应用小的斜体写在下方部分」——
 *   所以每条多一个 `comment`，正文仍然是 `text`。
 *   评语里的 QQ 号在这里就换成成员名（客户端拿不到 aliases 表）。
 */
import type { APIRoute } from 'astro';
import { bellieEntries, bellieTitle, qqToNames } from '../utils/bellie';
import { salonMembers, memberName, membersOf } from '../utils/salon';
import { variantUrl } from '../utils/images';

export const prerender = true;

export const GET: APIRoute = async () => {
  const entries = bellieEntries.map((e) => {
    /* 借用精华那套"成员们"的形状，页面脚本两边共用一份渲染逻辑 */
    const as = {
      id: e.id,
      memberIds: e.memberIds,
      kind: 'text',
      date: e.date,
      time: e.time,
      text: e.text,
      images: [] as string[],
      eraId: String(e.date).slice(0, 4),
    };
    const people = membersOf(as as Parameters<typeof membersOf>[0]);
    return {
      id: e.id,
      member: people.length ? memberName(as as Parameters<typeof memberName>[0]) : e.rawName || e.sender,
      avatar: people[0]?.avatar || '',
      members: people.map((m) => ({ name: m.name, avatar: m.avatar ? variantUrl(m.avatar, 400) : '' })),
      date: e.date,
      time: e.time,
      text: qqToNames(e.text),
      comment: qqToNames(e.comment),
    };
  });
  return new Response(
    JSON.stringify({ title: bellieTitle, count: entries.length, members: salonMembers.length, entries }, null, 1),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
