/**
 * 排版微调的共用取数逻辑。
 *
 * 数据结构见 src/data/layout.json：
 *   { pages: { home: { sun: {dx,dy,s,w,h}, ... }, board: {...}, ... } }
 *
 * 页面类型（page key）：
 *   home   首页
 *   board  大板块页（所有板块页共用一套微调）
 *   post   文章 / 手记详情页
 *   list   列表页（文章、手记、标签、归档、关于、友链）
 *
 * 每个元素能存三种东西：
 *   dx/dy  相对自身尺寸的百分比位移（纯视觉变换，不参与布局，手机上不会错位）
 *   s      缩放倍数
 *   w/h    明确的像素宽高（"把这张卡改小一点"就用这个 —— 百分比位移配固定像素，
 *          比缩放在文字清晰度上更干净，也不会把里面的字一起缩小）
 *
 * 关于 w/h 的权重：数据里也能给卡片填像素尺寸（home-boards.json 的 cardW/cardH），
 * 那是「这张卡本来多大」。排版里改过的尺寸属于**事后微调**，理应压过数据里的 ——
 * 数据那份是元素的内联 style，样式表里的 !important 正好能压住内联，
 * 所以这里输出 `width:...px !important`。没设 w/h 的时候一条规则都不出，
 * 不会去动别的元素的宽度。
 *
 * 生效方式：全局 CSS 里有一条 [data-edit] { translate: var(--dx) ...; scale: var(--s) }，
 * 这里负责把每个元素对应的变量值输出成一小段 <style>。用 translate/scale 而不是
 * left/top，是因为它们是纯视觉变换、不参与布局，所以响应式断点照常生效。
 */
import layout from '../data/layout.json';

export type PageKey = 'home' | 'board' | 'post' | 'list';

interface Offset {
  dx?: number;
  dy?: number;
  s?: number;
  /** 明确的像素宽高；不写就是跟着版式走 */
  w?: number;
  h?: number;
}

const PAGES = (layout as { pages?: Record<string, Record<string, Offset>> }).pages ?? {};

/** 某个页面上某个元素的 CSS 变量片段；全是默认值时返回 null（不输出） */
export function editVars(page: PageKey, key: string): string | null {
  const v = PAGES[page]?.[key];
  if (!v) return null;
  const dx = v.dx ?? 0;
  const dy = v.dy ?? 0;
  const s = v.s ?? 1;
  const w = Number(v.w) > 0 ? Number(v.w) : null;
  const h = Number(v.h) > 0 ? Number(v.h) : null;
  if (dx === 0 && dy === 0 && s === 1 && !w && !h) return null;

  const parts: string[] = [];
  if (dx !== 0) parts.push(`--dx:${dx}%`);
  if (dy !== 0) parts.push(`--dy:${dy}%`);
  if (s !== 1) parts.push(`--s:${s}`);
  if (w) parts.push(`--w:${w}px`, `width:${w}px !important`);
  if (h) parts.push(`--h:${h}px`, `height:${h}px !important`);
  return parts.join(';');
}

/**
 * 整个页面所有元素的样式块，直接塞进 <style is:inline>。
 *
 * 为什么不用内联 style：一个元素可能同时被好几处渲染，
 * 集中输出一份规则比在每个标签上算一遍更省事，也好排查。
 */
export function editStyleBlock(page: PageKey): string | null {
  const group = PAGES[page];
  if (!group) return null;

  const rules: string[] = [];
  for (const key of Object.keys(group)) {
    const vars = editVars(page, key);
    if (vars) rules.push(`[data-edit="${key}"]{${vars}}`);
  }
  return rules.length ? rules.join('') : null;
}

/** 这个页面上哪些元素可以调（编辑器用它列清单） */
export function editableKeys(page: PageKey): string[] {
  return Object.keys(PAGES[page] ?? {});
}
