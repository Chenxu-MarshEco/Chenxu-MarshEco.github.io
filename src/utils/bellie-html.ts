/**
 * ============================================================================
 * 「铃忆的冰室圣经」条目的 HTML 生成（构建期）—— /bellie/
 * ----------------------------------------------------------------------------
 * 这一份是 `utils/salon-html.ts` 的**同一套结构**，只为圣经页改了两处（站长 2026-11-20）：
 *   ① 数据来自 `utils/bellie.ts`（机器人每天投递的那份），不是 salon.json；
 *   ② 一张卡里**正文 + 评语**两段：正文是群友原句（正常字号），
 *      评语是铃忆每天写的吐槽评析（小字斜体，压在下面）。原话：
 *      「一张圣经卡片应分为正文和评语两个部分 正文是成员在群内说的原句 要正常比例显示
 *        而评语是lingyibot的AI每天对其的吐槽评析 应用小的斜体写在下方部分」
 *
 * 标记（类名、data-*）和精华页那一份**必须长得一模一样** —— 页面脚本是按
 * `.salon__item[data-members]`、`.salon__text` 这些找元素的，
 * 而 bellie.astro 就是 salon.astro 的拷贝（只换了数据模块和分块接口地址）。
 * ============================================================================
 */
import { bellieEntries, qqToNames, type BibleEntry } from './bellie';
import { memberName, membersOf, type SalonEssence } from './salon';
import { variantUrl } from './images';

/** 一簇多少条。圣经一天 5 条，20 条 = 4 天，和精华那边一个量级 */
export const BELLIE_CHUNK = 20;

export const bellieChunkCount = (): number => Math.max(1, Math.ceil(bellieEntries.length / BELLIE_CHUNK));

export function chunkRange(n: number): { from: number; to: number } {
  const from = Math.max(0, Math.min(bellieEntries.length, n * BELLIE_CHUNK));
  const to = Math.max(from, Math.min(bellieEntries.length, from + BELLIE_CHUNK));
  return { from, to };
}

export const bellieLastChunk = (): number => bellieChunkCount() - 1;

export const chunkOfIndex = (i: number): number => Math.floor(i / BELLIE_CHUNK);

const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 圣经的一条（借用精华那套「成员 + 日期」的形状，好让页面脚本原样认） */
function asEssence(e: BibleEntry): SalonEssence {
  return {
    id: e.id,
    memberIds: e.memberIds,
    kind: 'text',
    date: e.date,
    time: e.time,
    text: e.text,
    images: [],
    eraId: String(e.date).slice(0, 4),
  } as SalonEssence;
}

/** 一条圣经的标记 */
export function entryHtml(e: BibleEntry, params: Map<string, number>): string {
  const as = asEssence(e);
  const people = membersOf(as);
  const name = people.length ? memberName(as) : e.rawName || e.sender || '（没署名）';
  const param = params.get(e.id);
  const out: string[] = [];

  out.push(
    `<article class="salon__item" id="${esc(e.id)}"` +
      (param === undefined ? '' : ` data-tl-param="${esc(param)}"`) +
      ` data-members="${esc(e.memberIds.join(' '))}" data-kind="text">`
  );

  /* ---- 成员 + 时间（和精华那一行一模一样） ---- */
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
      `<span class="salon__face" title="${esc(e.rawName || e.sender || e.qq)}">` +
        `<span class="salon__avatar salon__avatar--none" aria-hidden="true">${esc((e.rawName || e.sender || e.qq || '群').slice(0, 1))}</span></span>`
    );
  }
  out.push('</span>');
  out.push(`<b class="salon__name">${esc(name)}</b>`);
  out.push(
    `<time class="salon__time" datetime="${esc(`${e.date}T${e.time || '00:00'}`)}">${esc(e.date)}${
      e.time ? esc(` ${e.time}`) : ''
    }</time>`
  );
  out.push('</div>');

  /* ---- 正文：群友原句（正常字号，和精华的正文同一个类） ---- */
  out.push(`<blockquote class="salon__text">${esc(qqToNames(e.text))}</blockquote>`);

  /* ---- 评语：铃忆的吐槽（小字斜体，压在正文下面） ---- */
  if (e.comment) out.push(`<p class="salon__comment">${esc(qqToNames(e.comment))}</p>`);

  out.push('</article>');
  return out.join('');
}

/** 日期头（换了一天就插一个；判断用的是**全局前一条**，跨簇才不漏不重） */
function headsOf(i: number): string {
  const e = bellieEntries[i];
  const prev = i > 0 ? bellieEntries[i - 1] : undefined;
  if (prev && prev.date === e.date) return '';
  return `<h3 class="salon__date">${esc(e.date)}</h3>`;
}

export function rangeHtml(from: number, to: number, params: Map<string, number>): string {
  const out: string[] = [];
  for (let i = Math.max(0, from); i < Math.min(bellieEntries.length, to); i += 1) {
    out.push(headsOf(i));
    out.push(entryHtml(bellieEntries[i], params));
  }
  return out.join('');
}

export function chunkHtml(n: number, params: Map<string, number>): string {
  const { from, to } = chunkRange(n);
  return rangeHtml(from, to, params);
}

/** 嵌进页面的索引表：每条一行 `[id, 时间轴位置, 簇号]`（点轴刻度跳转要在全表里找最近的） */
export function bellieIndexJson(params: Map<string, number>): string {
  return JSON.stringify(bellieEntries.map((e, i) => [e.id, params.get(e.id) ?? 0, chunkOfIndex(i)]));
}
