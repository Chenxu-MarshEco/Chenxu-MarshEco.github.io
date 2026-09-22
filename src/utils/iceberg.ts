/**
 * 冰山图（`/iceberg/`）的取数逻辑（构建期）。
 *
 * 数据在 `src/data/iceberg.json`，四块（编辑器的「冰山图」面板写的就是它）：
 *   categories  分类 —— 决定条目颜色（粉色花娅奇闻 / 蓝色冰室怪谈 / 棕色龙历院古卷…），
 *               还带一个 hidden：true 表示这一类默认不在页面上显示，
 *               页面顶部那排分类上的小眼睛随时可以手动开关。
 *   tags        标签 —— 条目上勾了哪个，悬停卡片顶部就显示哪个（先建后用）。
 *   layers      层级 —— 从浅到深一层一层往下排。每层有标题、副标题、背景图、头图、条目。
 *   （title / intro 是这一页自己的大标题和介绍。）
 *
 * 两条由数据推出来的规矩，页面和编辑器**都按同一套算**，不让人手工维护第二份真相：
 *   · 条目的颜色只由它的分类决定（改一次分类颜色，所有条目一起变）；
 *   · 完备标识只由「详细描述填没填」决定（`isComplete`）——
 *     不检测 tag、不检测链接，填了描述就盖章。
 */
import raw from '../data/iceberg.json';

export interface IcebergCategory {
  id: string;
  name: string;
  /** #rrggbb，条目在图里的颜色 */
  color: string;
  /** true = 这一类默认不显示（页面上点小眼睛还能开回来） */
  hidden: boolean;
}

export interface IcebergTag {
  id: string;
  name: string;
}

export interface IcebergItem {
  id: string;
  name: string;
  /** 指向 categories 里的一个 id；认不出来就是空串（用默认灰） */
  categoryId: string;
  /** 指向 tags 里的若干 id */
  tags: string[];
  /** 详细描述：悬停卡片的正文。填了就有完备标识 */
  desc: string;
  /** 站内或站外链接；空串 = 点不动 */
  href: string;
}

export interface IcebergLayer {
  id: string;
  title: string;
  subtitle: string;
  /** 这一层的背景图（站内 /img/… 或外链） */
  background: string;
  /** 这一层右边的头图 */
  head: string;
  items: IcebergItem[];
}

interface IcebergFile {
  title?: string;
  intro?: string;
  updated?: string;
  categories?: IcebergCategory[];
  tags?: IcebergTag[];
  layers?: IcebergLayer[];
}

const file = raw as IcebergFile;

/** 分类认不出来时用的颜色（中性灰紫，在浅色卡片上也看得清） */
export const DEFAULT_CATEGORY_COLOR = '#b9a6c9';

/* ------------------------------------------------------------------
   颜色小工具：让「分类色」在卡片 / 标识底上都读得清
   ------------------------------------------------------------------
   深紫底上分类色本身就能用（亮色），但「完备标识」那块底是分类色的半透明覆盖，
   比卡片亮，压在它上面的字就得跟着提亮才够对比度。这活儿在构建期算好写进 --ink，
   浏览器不做任何计算。色相全程不动（只推亮度），所以一眼还是那一类的颜色。
   ------------------------------------------------------------------ */

/** #rrggbb → [r,g,b] */
function toRgb(hex: string): [number, number, number] {
  const h = /^#([0-9a-f]{6})$/i.exec(String(hex ?? '').trim());
  if (!h) return [185, 166, 201];
  const n = parseInt(h[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const toHex = (rgb: number[]): string =>
  `#${rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/** WCAG 相对亮度 */
function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 两个颜色的对比度（1~21） */
export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** sRGB 里线性插值（t = 0 拿 a，t = 1 拿 b） */
export function mixColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = toRgb(a);
  const [r2, g2, b2] = toRgb(b);
  return toHex([r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t]);
}

/**
 * 把 `color` 按 `alpha`（0~1，color 占多少）铺在 `base` 上 —— 就是 CSS 里
 * `color-mix(in srgb, color alpha%, transparent)` 盖在 base 上的那个结果。
 * ⚠ 单独写一个函数就是为了不再搞混方向：`mixColor(cat, card, 0.22)` 是
 * "22% 的卡片色"，而这里 `overColor(cat, card, 0.22)` 是 "22% 的分类色" ——
 * 第一版标识底就写反了（几乎整块都是分类色），文字被迫提亮成纯白，验收脚本当场逮出来。
 */
export function overColor(color: string, base: string, alpha: number): string {
  const [r1, g1, b1] = toRgb(color);
  const [r2, g2, b2] = toRgb(base);
  return toHex([r1 * alpha + r2 * (1 - alpha), g1 * alpha + g2 * (1 - alpha), b1 * alpha + b2 * (1 - alpha)]);
}

/** RGB → HSL（h 0~360，s/l 0~1） */
function toHsl([r, g, b]: [number, number, number]): { h: number; s: number; l: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = ((G - B) / d) % 6;
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

/** HSL → RGB */
function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const m = l - c / 2;
  const seg: [number, number, number] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return seg.map((v) => (v + m) * 255) as [number, number, number];
}

/**
 * 卡片底色：**取最亮的那一档**。
 * 卡片是 `linear-gradient(rgba(46,8,70,.78), rgba(20,3,34,.78))` 压在 body 的 #1e0730 上，
 * 越靠上越亮 —— 条目可能正好落在层的顶部，所以算文字色要按这个最不利的底：
 * 0.78 × (46,8,70) + 0.22 × (30,7,48) = (42, 8, 65)。
 * 第一版取的是中间值 #200633（偏暗），弹设往事那条算出来的字压在真底上只有 4.26:1。
 */
export const CARD_BG = '#2a0841';
/**
 * 完备标识底**最深的那一档**：分类色盖在卡片上的那一层。
 * ⚠ 和组件 CSS 里那条渐变对齐：
 *   `linear-gradient(color-mix(in srgb, var(--cat) 12%, transparent),
 *                    color-mix(in srgb, var(--cat) 26%, transparent))` + 元素 `opacity: .85`
 * 透明混色 = 半透明覆盖，所以真正压在卡片上的量是 **26% × 0.85**（不是 26%）。
 * 为什么取这么淡：标识底越"实"，压在它上面的字就得提得越亮才够对比度 ——
 * 26% 这一档下，条目文字基本还是分类色本身（只微微提亮一点点），
 * 而标识本身仍然看得出是那一类的颜色（还有那道白栅格和一圈光晕）。
 */
export const BADGE_ALPHA = 0.26;
export const BADGE_OPACITY = 0.85;
export const BADGE_MIX = BADGE_ALPHA * BADGE_OPACITY;
/** 完备标识底最不利的那一头：分类色按 BADGE_MIX 铺在卡片上 */
export const badgeBg = (color: string): string => overColor(color, CARD_BG, BADGE_MIX);

/**
 * 条目文字色：从分类色出发，**只把亮度往需要的方向推**（色相和饱和度原样保留），
 * 一直到在 `bg` 上至少 4.5:1。
 *
 * 两个方向都要（底可能是深的卡片，也可能是比卡片亮一点的完备标识底）：
 *   文字比底暗 → 往下压；文字比底亮 → 往上提。
 * 为什么不混色：混色会把色相带跑 —— 灰蓝 #9aa7c7 混深棕之后偏了 53°（实测过），
 * 看起来就不像那一类了；只改 L 则色相一点不动。
 */
export function readableInk(color: string, bg: string = CARD_BG, target = 4.55): string {
  const base = /^#[0-9a-f]{6}$/i.test(String(color ?? '')) ? String(color) : DEFAULT_CATEGORY_COLOR;
  /* 目标给 4.55 而不是正好 4.5：结果要四舍五入成 #rrggbb，留一点余量给取整 */
  if (contrastRatio(base, bg) >= target) return base;
  const { h, s, l } = toHsl(toRgb(base));
  /* 底比文字亮 → 把文字压暗；底比文字暗 → 把文字提亮 */
  const darken = luminance(bg) > luminance(base);
  /*
    二分「刚好够」的那个亮度：
      darken  → L 越小对比越高，起手 lo=0（一定够）、hi=l（不够），最后取**够的那一侧里最大的**
      lighten → L 越大对比越高，起手 lo=l（不够）、hi=1（一定够），最后取**够的那一侧里最小的**
    ⚠ 两个方向的 `ok` 走的分支是相反的 —— 第一版把两边的赋值写成了同一个，
    提亮那一支就退化了（弹设往事那条算出来只有 3.00:1）。
  */
  let lo = darken ? 0 : l;
  let hi = darken ? l : 1;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const ok = contrastRatio(toHex(fromHsl(h, s, mid)), bg) >= target;
    if (darken) {
      if (ok) lo = mid;
      else hi = mid;
    } else {
      if (ok) hi = mid;
      else lo = mid;
    }
  }
  return toHex(fromHsl(h, s, darken ? lo : hi));
}

/**
 * 条目实际要用的那个色：有完备标识的条目，字压在**标识底**上（比卡片亮），
 * 所以要按标识底算；没有标识的按卡片算。两边都保证 ≥4.5:1。
 */
export const itemInk = (color: string, withBadge = false): string =>
  readableInk(color, withBadge ? badgeBg(color) : CARD_BG);

/** 分类色块上的字：亮底用深字、暗底用浅字，取对比度高的那个 */
export function chipInk(color: string): string {
  const dark = '#2a0620';
  const light = '#fff6fb';
  return contrastRatio(color, dark) >= contrastRatio(color, light) ? dark : light;
}

const str = (v: unknown): string => String(v ?? '').trim();

/** 分类：id / 名字都空的直接丢掉（页面上一张没有字的色卡没有意义） */
export const categories: IcebergCategory[] = (Array.isArray(file.categories) ? file.categories : [])
  .map((c) => ({
    id: str(c?.id),
    name: str(c?.name),
    color: /^#[0-9a-f]{6}$/i.test(str(c?.color)) ? str(c?.color) : DEFAULT_CATEGORY_COLOR,
    hidden: c?.hidden === true,
  }))
  .filter((c) => c.id && c.name);

export const tags: IcebergTag[] = (Array.isArray(file.tags) ? file.tags : [])
  .map((t) => ({ id: str(t?.id), name: str(t?.name) }))
  .filter((t) => t.id && t.name);

const categoryOf = new Map(categories.map((c) => [c.id, c]));
const tagOf = new Map(tags.map((t) => [t.id, t]));

/** 条目归到哪个分类（认不出来给 null = 默认色） */
export function categoryById(id: string): IcebergCategory | null {
  return categoryOf.get(str(id)) ?? null;
}

/** 条目背后那排 tag 名字（顺序 = 数据里的顺序） */
export function tagNames(ids: string[] | undefined): string[] {
  return (Array.isArray(ids) ? ids : []).map((id) => tagOf.get(str(id))?.name ?? '').filter(Boolean);
}

/**
 * 完备标识：**只看详细描述**（用户的原话：「不需要检测填写 tag 和链接等，
 * 只需要检测详细描述」）。编辑器里那枚小小的「完备」也是这样算的。
 */
export function isComplete(item: IcebergItem): boolean {
  return str(item?.desc) !== '';
}

const item = (i: IcebergItem): IcebergItem => ({
  id: str(i?.id),
  name: str(i?.name),
  categoryId: categoryOf.has(str(i?.categoryId)) ? str(i?.categoryId) : '',
  tags: (Array.isArray(i?.tags) ? i.tags : []).map(str).filter((id) => tagOf.has(id)),
  desc: str(i?.desc),
  href: str(i?.href),
});

/** 层级：顺序 = 数组顺序（页面从上往下就是它）。标题空的层级也留着，只是不显示大标题 */
export const layers: IcebergLayer[] = (Array.isArray(file.layers) ? file.layers : [])
  .map((l) => ({
    id: str(l?.id),
    title: str(l?.title),
    subtitle: str(l?.subtitle),
    background: str(l?.background),
    head: str(l?.head),
    items: (Array.isArray(l?.items) ? l.items : []).map(item).filter((i) => i.name),
  }))
  .filter((l) => l.id || l.title || l.items.length);

/** 整张图一共多少条（页面上「共 N 条」用；分类隐藏的也算） */
export const itemCount = layers.reduce((n, l) => n + l.items.length, 0);

export const iceberg = {
  title: str(file.title) || '冰室冰山',
  intro: str(file.intro),
  updated: str(file.updated),
  categories,
  tags,
  layers,
  itemCount,
  /** 有没有内容可画（没内容时那一页退回显示首页那块的大图） */
  hasContent: layers.length > 0 && itemCount > 0,
};
