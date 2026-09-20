/**
 * 把冰室精华导出成 dist/salon.json —— 给首页那条「每日精华」用。
 *
 * 为什么要单独导出：首页要在**浏览器里**按"今天"挑一条（这样同一天固定、
 * 隔天自动换，不用重新构建站点）。要是把 784 条全塞进首页 HTML，
 * 首页会白白胖几千字；让首页脚本 fetch 这份 JSON 再挑，首页 HTML 就还是干净的。
 *
 * 只吐出挑一条要用到的字段（成员们、时间、正文、头一张图），不带年代、备注那些
 * 首页用不上的东西。一条精华**可以属于多个成员**（完美对话那种），所以这里是
 * `members: [{ name, avatar }]` 数组，不是单个名字。
 * 名字和头像都是**现查成员表**的 —— 所以编辑器里改成员，首页也跟着变。
 */
import type { APIRoute } from 'astro';
import { salonEssences, salonMembers, salonTitle, memberName, membersOf } from '../utils/salon';
import { variantUrl } from '../utils/images';

export const prerender = true;

export const GET: APIRoute = async () => {
  const essences = salonEssences.map((e) => ({
    id: e.id,
    member: memberName(e),
    avatar: membersOf(e)[0]?.avatar || '',
    members: membersOf(e).map((m) => ({ name: m.name, avatar: m.avatar ? variantUrl(m.avatar, 400) : '' })),
    date: e.date,
    time: e.time,
    text: e.text,
    ocr: Boolean(e.ocr),
    /*
      图片给的是**管线里的那一档**（多尺寸 WebP）而不是原图：
      首页那条每日精华是浏览器里重挑的，客户端拿不到构建期的图片清单，
      所以清单查询只能在这儿（服务端）做好，把结果写进 JSON。
      variantUrl 查不到就退回原图，不影响没跑过管线的场景。
    */
    image: e.images[0] ? variantUrl(e.images[0], 500) : '',
  }));
  return new Response(
    JSON.stringify({ title: salonTitle, count: essences.length, members: salonMembers.length, essences }, null, 1),
    { headers: { 'content-type': 'application/json; charset=utf-8' } }
  );
};
