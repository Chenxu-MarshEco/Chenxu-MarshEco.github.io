/**
 * 排版微调的共用取数逻辑。
 *
 * 数据结构见 src/data/layout.json：
 *   { pages: { home: { sun: {dx,dy,s}, ... }, board: {...}, ... } }
 *
 * 页面类型（page key）：
 *   home   首页
 *   board  大板块页（所有板块页共用一套微调）
 *   post   文章 / 手记详情页
 *   list   列表页（文章、手记、标签、归档、关于、友链）
 *
 * 生效方式：全局 CSS 里有一条 [data-edit] { translate: var(--dx) ...; scale: var(--s) }，
 * 这里负责把每个元素对应的变量值输出成一小段 <style>。
 * 用 translate/scale 而不是 left/top，是因为它是纯视觉变换、不参与布局，
 * 所以响应式断点照常生效，手机上不会错位。
 */
import layout from '../data/layout.json';

export type PageKey = 'home' | 'board' | 'post' | 'list';

interface Offset {
  dx?: number;
  dy?: number;
  s?: number;
}

const PAGES = (layout as { pages?: Record<string, Record<string, Offset>> }).pages ?? {};

/** 某个页面上某个元素的 CSS 变量片段；全是默认值时返回 null（不输出） */
export function editVars(page: PageKey, key: string): string | null {
  const v = PAGES[page]?.[key];
  if (!v) return null;
  const dx = v.dx ?? 0;
  const dy = v.dy ?? 0;
  const s = v.s ?? 1;
  if (dx === 0 && dy === 0 && s === 1) return null;
  return `--dx:${dx}%;--dy:${dy}%;--s:${s}`;
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
