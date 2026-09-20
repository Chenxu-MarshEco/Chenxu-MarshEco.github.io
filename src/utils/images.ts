/**
 * 图片渲染工具 —— 读 `tools/images/optimize.mjs` 生成的清单，把一张原图
 * 变成「多尺寸 + 现代格式 + 模糊占位」的标签属性。
 *
 * 为什么要有这一层：
 *   本站图片路径全是从数据文件 / markdown / 编辑器上传里动态来的字符串，
 *   用不了 Astro 的 `astro:assets`（那套要求静态 import）。所以构建前先跑
 *   图片管线生成变体与清单，渲染时按路径查表。
 *
 * 清单不存在时（还没跑过管线 / 新克隆的仓库）所有函数都退化成「原样发原图」，
 * 页面照常出，只是没优化 —— 不会因为缺一个构建产物就炸构建。
 */
import fs from 'node:fs';
import path from 'node:path';
import { withBase } from './url';

export type ImageVariant = {
  w: number;
  h: number;
  webp: { url: string; bytes: number };
  avif: { url: string; bytes: number } | null;
};

export type ImageItem = {
  src: string;
  w: number | null;
  h: number | null;
  hasAlpha?: boolean;
  lossless?: boolean;
  passthrough?: boolean;
  animated?: boolean;
  variants: ImageVariant[];
  fallback: { url: string; bytes: number };
  lqip: string;
};

let cache: Record<string, ImageItem> | null | undefined;

function manifest(): Record<string, ImageItem> | null {
  if (cache !== undefined) return cache;
  try {
    const file = path.join(process.cwd(), 'public', 'img', 'opt', 'manifest.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    cache = (raw?.items as Record<string, ImageItem>) ?? null;
  } catch {
    cache = null;
  }
  return cache;
}

/** 查一张图在清单里的条目；外链、SVG、没进清单的都返回 null */
export function imageItem(src?: string | null): ImageItem | null {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:')) return null;
  const item = manifest()?.[src];
  return item && item.variants.length ? item : null;
}

/**
 * 一张图**原始**的宽高（连"没进变体清单、原样发"的小图也有）。
 *
 * 给 `<img width height>` 用：浏览器拿到宽高就会在图片下载期间先把位置留出来，
 * 图到位时不会把下面的内容顶下去。冰室精华页有 291 张截图 + 784 条内容，
 * 一张不留位就是一次全页重排 —— 那正是"越滚越卡、还老是跳"的来源。
 * 没进过图片管线（清单里没有）就返回 null，页面照常出图，只是没有预留尺寸。
 */
export function imageDims(src?: string | null): { w: number; h: number } | null {
  if (!src || /^(https?:)?\/\//.test(src) || src.startsWith('data:')) return null;
  const it = manifest()?.[src];
  return it && it.w && it.h ? { w: it.w, h: it.h } : null;
}

/** 从大到小挑一个宽度不小于 need 的档；都不够就用最大的那档 */
export function pickVariant(item: ImageItem, need: number): ImageVariant {
  const sorted = [...item.variants].sort((a, b) => a.w - b.w);
  return sorted.find((v) => v.w >= need) ?? sorted[sorted.length - 1];
}

/** srcset；kind='avif' 的档位若缺失会被跳过 */
export function srcsetFor(item: ImageItem, kind: 'webp' | 'avif'): string {
  return item.variants
    .map((v) => (kind === 'avif' ? v.avif && `${withBase(v.avif.url)} ${v.w}w` : `${withBase(v.webp.url)} ${v.w}w`))
    .filter(Boolean)
    .join(', ');
}

export function hasAvif(item: ImageItem): boolean {
  return item.variants.some((v) => v.avif);
}

/** <img> 的兜底地址：清单给了就用清单的，否则原图 */
export function fallbackSrc(item: ImageItem | null, src: string): string {
  return withBase(item?.fallback.url ?? src);
}

/**
 * 单张「最合适的那一档」的地址（不是 srcset）。
 *
 * 给两处用：
 *   1. CSS 背景图（`image-set` 之外的场合，只需要一个 URL）
 *   2. <link rel=preload as=image href=…>：preload 的地址必须跟 CSS 里用的**完全一致**，
 *      否则浏览器会当成两个资源各下一份。所以这里返回确定的单个 URL，两边共用同一个变量。
 */
export function variantUrl(src: string, w: number): string {
  const item = imageItem(src);
  if (!item) return withBase(src);
  return withBase(pickVariant(item, w).webp.url);
}

/**
 * 模糊占位（LQIP）：把那张 20px 宽的极小图当 <img> 自己的背景。
 * 图还没到时先显示它，到了以后真图直接盖在上面 —— 纯 CSS，不需要一行 JS。
 * 带透明的图清单里不给 LQIP（那张模糊图会从透明区域透出来），返回空串。
 */
export function lqipStyle(item: ImageItem | null): string {
  if (!item?.lqip) return '';
  return `background-image:url(${item.lqip});background-size:cover;background-position:center;`;
}

/** 模糊占位作为一层背景（垫在真图下面）；没有就返回 null */
function lqipLayer(item: ImageItem | null): string | null {
  return item?.lqip ? `url(${item.lqip})` : null;
}

/**
 * 只给 CSS 自定义属性 `--cover` 用的值：一张宽度合适的 **WebP**，
 * 底下垫一层模糊占位（先出个色块，真图到了直接盖上去）。
 *
 * 这里刻意不用 image-set：自定义属性不校验值，浏览器不认 image-set 时
 * `background-image: var(--cover)` 会变成 invalid-at-computed-value-time，
 * 连兜底一起丢掉，封面就彻底空了。WebP 从 2020 年起（Safari 14 / 所有现代浏览器）
 * 就是全支持，单张 URL 最稳，也不比 image-set 多下多少 —— 真正省下来的是
 * 「按显示尺寸挑档」（300KB 的原图 → 20KB 的 800 档），这一条已经拿到了。
 */
export function coverUrl(src: string, w = 800): string {
  const item = imageItem(src);
  if (!item) return `url(${withBase(src)})`;
  const real = `url(${withBase(pickVariant(item, w).webp.url)})`;
  const lqip = lqipLayer(item);
  return lqip ? `${real},${lqip}` : real;
}

/**
 * `--cover` 的「高清版」：1x/2x 按 DPR 挑，只有认 image-set 的浏览器才会用到
 * （用法见 SubCard.astro 里那段 @supports）。认不出来的浏览器继续用单张的 --cover，
 * 不会因为一条声明作废而丢掉整张封面。
 */
export function coverUrlHd(src: string, w = 400, w2 = 800): string | null {
  const item = imageItem(src);
  if (!item) return null;
  const one = pickVariant(item, w);
  const two = pickVariant(item, w2);
  const a = withBase(one.webp.url);
  const b = withBase(two.webp.url);
  if (a === b) return null;
  const set = `image-set(url(${a}) type('image/webp') 1x,url(${b}) type('image/webp') 2x)`;
  const lqip = lqipLayer(item);
  return lqip ? `${set},${lqip}` : set;
}

/**
 * 直接写进 style 属性的背景声明（这里可以放心用 image-set：
 * 内联样式是实打实的声明，不支持 image-set 的浏览器会保留前一条 url() 兜底，
 * 不存在自定义属性那种「整条作废」的问题）。
 *
 * 1x / 2x 两档：桌面 DPR1 拿小图、手机 DPR2 拿大图，都不浪费。
 */
export function bgStyle(src: string, opts: { w?: number; w2?: number; size?: string; position?: string } = {}): string {
  const { w = 800, w2, size = 'cover', position = 'center' } = opts;
  const item = imageItem(src);
  const tail = `background-size:${size};background-position:${position};`;
  if (!item) return `background-image:url(${withBase(src)});${tail}`;
  const one = pickVariant(item, w);
  const two = pickVariant(item, w2 ?? w * 2);
  const oneUrl = withBase(one.webp.url);
  const twoUrl = withBase(two.webp.url);
  const lqip = lqipLayer(item);
  // 多层背景：写在前面的是上层。真图在前、模糊占位在后 ——
  // 图没到时先看到那张 20px 的糊图（浏览器把它放大，天然就是模糊的），
  // 真图一解码完就直接盖住它，全程不需要 JS。
  const set = oneUrl === twoUrl
    ? `image-set(url(${oneUrl}) type('image/webp'))`
    : `image-set(url(${oneUrl}) type('image/webp') 1x,url(${twoUrl}) type('image/webp') 2x)`;
  const plain = lqip ? `url(${oneUrl}),${lqip}` : `url(${oneUrl})`;
  const modern = lqip ? `${set},${lqip}` : set;
  return `background-image:${plain};background-image:${modern};${tail}`;
}

/** 给 <link rel="preload" as="image"> 用：imagesrcset + imagesizes */
export function preloadFor(src?: string | null, sizes = '100vw'): { srcset: string; sizes: string; type: string } | null {
  const item = imageItem(src);
  if (!item) return null;
  if (hasAvif(item)) return { srcset: srcsetFor(item, 'avif'), sizes, type: 'image/avif' };
  return { srcset: srcsetFor(item, 'webp'), sizes, type: 'image/webp' };
}

/* ------------------------------------------------------------------
 * Markdown 里写的图片（![说明](/img/uploads/x.png)）走的是 marked → HTML 字符串，
 * 不经过 Astro 组件，所以只能在字符串这一层把它换成 <picture>。
 * 编辑器「上传图片」插进去的就是这种 Markdown，所以这条路必须接上。
 * ------------------------------------------------------------------ */

const BASE = import.meta.env.BASE_URL.replace(/\/+$/, '');

/** 把可能带 base 前缀的 src 还原成清单里的键（/img/...） */
function toKey(src: string): string {
  let s = src.trim();
  if (BASE && s.startsWith(BASE)) s = s.slice(BASE.length);
  return s;
}

function hasAttr(tag: string, name: string): boolean {
  return new RegExp(`\\s${name}\\s*=`, 'i').test(tag);
}

function getAttr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? '') : null;
}

function setAttr(tag: string, name: string, value: string): string {
  const re = new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, 'i');
  if (re.test(tag)) return tag.replace(re, ` ${name}="${value}"`);
  // 没有这个属性就插在标签名后面，其余属性和结尾的 /> 都保持原样
  return tag.replace(/^(<img\b)/i, `$1 ${name}="${value}"`);
}

/**
 * 把一段 HTML 里所有站内 <img> 换成「<picture> + srcset + 模糊占位」。
 * 已经在 <picture> 里、或者路径不在清单里的图，原样不动。
 */
export function enhanceHtml(html: string, opts: { sizes?: string } = {}): string {
  const { sizes = '(max-width: 760px) 100vw, 760px' } = opts;
  if (!html || !html.includes('<img')) return html;
  return html.replace(/<img\b[^>]*>/gi, (tag) => {
    // 已经有 srcset 说明处理过了，别套两层
    if (hasAttr(tag, 'srcset')) return tag;
    const src = getAttr(tag, 'src');
    if (!src) return tag;
    const item = imageItem(toKey(src));
    if (!item) return tag;

    let img = tag;
    if (!hasAttr(img, 'decoding')) img = setAttr(img, 'decoding', 'async');
    if (!hasAttr(img, 'loading')) img = setAttr(img, 'loading', 'lazy');
    if (!hasAttr(img, 'width') && item.w) img = setAttr(img, 'width', String(item.w));
    if (!hasAttr(img, 'height') && item.h) img = setAttr(img, 'height', String(item.h));
    const lqip = lqipStyle(item);
    if (lqip) {
      const prev = getAttr(img, 'style');
      img = setAttr(img, 'style', `${prev ? `${prev};` : ''}${lqip}`);
    }

    const sources: string[] = [];
    if (hasAvif(item)) sources.push(`<source type="image/avif" srcset="${srcsetFor(item, 'avif')}" sizes="${sizes}">`);
    sources.push(`<source type="image/webp" srcset="${srcsetFor(item, 'webp')}" sizes="${sizes}">`);
    return `<picture>${sources.join('')}${img}</picture>`;
  });
}
