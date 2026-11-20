/**
 * 精华条目的 **HTML 生成**（构建期）—— 页面和「按簇取」的接口共用这一份。
 *
 * 为什么单独拎出来（2026-11-20）：精华页一进来要把 833 条全渲出来（产物 1.67MB、
 * 2 万个元素、光布局就快一秒），站长要求「切成好几个部分，进来只加载最新那一部分，
 * 上翻 / 搜索跳转时才加载对应的那部分」。于是：
 *   · 页面自己只渲**最新那一簇**；
 *   · 其余的簇由 `/salon/chunk/<n>.json` 现取（见 pages/salon/chunk/[n].json.ts）；
 *   · 「一圈头部（年代 + 日期）」跨簇也不能重复或漏掉 —— 所以一簇渲染时要看得到
 *     **全局**的前一条（`from` 前面那条），这一份必须拿全表才写得对。
 *
 * 写成"返回 HTML 字符串"而不是 Astro 组件，是因为同一段标记要能从两个地方产出
 * （页面首屏 + JSON 接口），组件没法在构建期吐字符串给接口用。代价是样式不能靠
 * Astro 的作用域属性 —— salon.astro 里条目相关的选择器都套了 `.salon__list :global(...)`，
 * 见那边的说明。
 *
 * ⚠ 这里的标记必须和 salon.astro 里那份**长得一模一样**（类名、data-*、顺序）：
 * 脚本按 `.salon__item[data-members]`、`.salon__text`、`.salon__pic img` 这些东西找元素。
 * 验收脚本 `salon-chunks-check.mjs` 会拿首屏那条和接口取回来的那条逐项比。
 */
import {
  essenceIds,
  memberName,
  membersOf,
  salonEras,
  salonEssences,
  type SalonEssence,
} from './salon';
import { imageDims, variantUrl, viewUrls } from './images';

/** 一簇多少条。20 条一簇：首屏够看一屏半，簇文件 ~40KB，上翻几次就补齐 */
export const SALON_CHUNK = 20;

/** 一共几簇（至少 1，空数据也不至于除零） */
export const salonChunkCount = (): number =>
  Math.max(1, Math.ceil(salonEssences.length / SALON_CHUNK));

/** 第 n 簇覆盖的下标区间，**半开** [from, to) */
export function chunkRange(n: number): { from: number; to: number } {
  const from = Math.max(0, Math.min(salonEssences.length, n * SALON_CHUNK));
  const to = Math.max(from, Math.min(salonEssences.length, from + SALON_CHUNK));
  return { from, to };
}

/** 最新那一簇（= 一进页面就渲的那一簇） */
export const salonLastChunk = (): number => salonChunkCount() - 1;

/** 某条精华落在第几簇（数组下标 → 簇号） */
export const chunkOfIndex = (i: number): number => Math.floor(i / SALON_CHUNK);

/** id → 簇号 / 下标，模块加载时建一次 */
const INDEX_OF = new Map(salonEssences.map((e, i) => [e.id, i]));
export const chunkOfId = (id: string): number | null => {
  const i = INDEX_OF.get(id);
  return i === undefined ? null : chunkOfIndex(i);
};

const eraName = new Map(salonEras.map((e) => [e.id, e.title]));

/**
 * 每个年代一共多少天（含头含尾）。最后那个年代数据里写的是 2099-12-31（表示"还在继续"），
 * 所以超过今天的就按今天算，并标 data-live 让页面脚本每天自己涨。
 */
const dayNo = (s: string) => {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? '').trim());
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : NaN;
};
const TODAY_NO = (() => {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
})();
export const salonEraDays = new Map(
  salonEras.map((e) => {
    const from = dayNo(e.from);
    const to = dayNo(e.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return [e.id, { days: 0, live: false }];
    const live = to > TODAY_NO;
    const end = live ? TODAY_NO : to;
    return [e.id, { days: Math.max(1, Math.round(end - from) + 1), live }];
  })
);

/** 转义：正文、名字、日期都是用户数据，一律当字符串塞进 HTML */
const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 一条精华的标记（不含年代 / 日期那两个头） */
export function essenceHtml(e: SalonEssence, params: Map<string, number>): string {
  const people = membersOf(e);
  const name = memberName(e);
  const ids = essenceIds(e);
  const param = params.get(e.id);
  const out: string[] = [];

  out.push(
    `<article class="salon__item" id="${esc(e.id)}"` +
      (param === undefined ? '' : ` data-tl-param="${esc(param)}"`) +
      /* 日期也写一份：时间轴在浏览器里按"访问者今天"重排时，要用它把 param 重算一遍
         （构建机上算的那一份和访问者可能差一天，见 Timeline.astro 的 relayoutLive） */
      ` data-tl-date="${esc(e.date)}"` +
      ` data-members="${esc(ids.join(' '))}" data-kind="${esc(e.kind || 'text')}">`
  );

  /* ---- 成员那一行 ---- */
  out.push('<div class="salon__who"><span class="salon__faces">');
  if (people.length) {
    for (const p of people) {
      out.push(`<span class="salon__face" title="${esc(p.name)}">`);
      out.push(
        p.avatar
          ? `<img class="salon__avatar" src="${esc(variantUrl(p.avatar, 400))}" alt="" loading="lazy" decoding="async">`
          : `<span class="salon__avatar salon__avatar--none" aria-hidden="true">${esc(p.name.slice(0, 1))}</span>`
      );
      out.push('</span>');
    }
  } else {
    out.push(
      '<span class="salon__face" title="这条没解析出成员（OCR 是游戏聊天/表格截图）">' +
        '<span class="salon__avatar salon__avatar--none" aria-hidden="true">群</span></span>'
    );
  }
  out.push('</span>');
  out.push(`<b class="salon__name">${esc(name)}</b>`);
  if (e.ocr) {
    out.push('<span class="salon__badge" title="这条的正文是截图 OCR 自动转录的，尚未人工校对">OCR 转录</span>');
  }
  out.push(
    `<time class="salon__time" datetime="${esc(`${e.date}T${e.time || '00:00'}`)}">${esc(e.date)}${
      e.time ? esc(` ${e.time}`) : ''
    }</time>`
  );
  out.push('</div>');

  /* ---- 正文 / 截图 ---- */
  if (e.text) out.push(`<blockquote class="salon__text">${esc(e.text)}</blockquote>`);
  for (const src of e.images) {
    const dim = imageDims(src);
    const view = viewUrls(src);
    out.push(
      `<a class="salon__pic" href="${esc(view.webp)}" target="_blank" rel="noopener"` +
        ` aria-label="${esc(`查看大图：${name} ${e.date}`)}">` +
        `<img src="${esc(variantUrl(src, 800))}"` +
        (dim ? ` width="${dim.w}" height="${dim.h}"` : '') +
        ' alt="" loading="lazy" decoding="async" data-zoom="1"' +
        (view.avif ? ` data-full-avif="${esc(view.avif)}"` : '') +
        '></a>'
    );
  }

  out.push('</article>');
  return out.join('');
}

/** 年代 / 日期那两个头（只在"换了一个"的那条前面插，判断用的是**全局前一条**） */
function headsOf(i: number): string {
  const e = salonEssences[i];
  const prev = i > 0 ? salonEssences[i - 1] : undefined;
  const out: string[] = [];
  if (!prev || prev.eraId !== e.eraId) {
    const d = salonEraDays.get(e.eraId);
    out.push(
      `<h2 class="salon__era"><span class="salon__eraName">${esc(eraName.get(e.eraId) ?? '')}</span>` +
        `<span class="salon__eraDays" data-era-from="${esc(salonEras.find((x) => x.id === e.eraId)?.from ?? '')}"` +
        ` data-era-to="${esc(salonEras.find((x) => x.id === e.eraId)?.to ?? '')}"` +
        (d?.live ? ' data-live="1"' : '') +
        `>${d?.days ?? 0} 天</span></h2>`
    );
  }
  if (!prev || prev.date !== e.date) out.push(`<h3 class="salon__date">${esc(e.date)}</h3>`);
  return out.join('');
}

/**
 * 一段下标区间（半开）的完整标记：头部 + 条目。
 * `params` 是精华在所选时间轴上的位置（`essenceParams(tl)`），没有时间轴就传空表。
 */
export function rangeHtml(from: number, to: number, params: Map<string, number>): string {
  const out: string[] = [];
  for (let i = Math.max(0, from); i < Math.min(salonEssences.length, to); i += 1) {
    out.push(headsOf(i));
    out.push(essenceHtml(salonEssences[i], params));
  }
  return out.join('');
}

/** 第 n 簇的完整标记 */
export function chunkHtml(n: number, params: Map<string, number>): string {
  const { from, to } = chunkRange(n);
  return rangeHtml(from, to, params);
}

/**
 * 给页面嵌的那张索引表：每条精华一行 `[id, 时间轴位置, 簇号]`。
 *
 * 为什么需要它：页面上只渲一簇，而"点时间轴刻度 → 跳到最近那条精华"要在**全部 833 条**
 * 里找最近的（它可能还没渲出来）。表很小（833 行 ≈ 20KB），一次嵌进页面就不用请求。
 * 位置要按页面选的那条轴算，所以 params 由调用方传（`essenceParams(tl)`）。
 */
export function salonIndexJson(params: Map<string, number>): string {
  return JSON.stringify(
    salonEssences.map((e, i) => [e.id, params.get(e.id) ?? 0, chunkOfIndex(i)])
  );
}
