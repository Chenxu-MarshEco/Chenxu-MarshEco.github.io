/**
 * 页面里的锚点 —— 「不只是跳到这一页，还要落到这一页的某个位置上」。
 *
 * 以前站内跳转只能跳到页面为止（`/huaya/bingshi`）。用户在别处写链接
 * （时间轴上的点、地图图钉、导航条目、正文里的链接）时，常常想直接落到
 * 那一页的**某个小标题 / 某张图 / 某一段**上 —— 比如「桑芙加入冰室」那个
 * 时间点，点下去应该直接停在冰室页的「桑芙」那个标题，而不是页面顶部。
 *
 * 锚点有两种来源，都在这里收口（页面渲染和导出用同一套，不能各算各的）：
 *   · 小标题：`## 桑芙` 渲染成 `<h2 id="桑芙">`，id = slugify(标题)，
 *     同一页里重名依次加 `-2`、`-3`
 *   · 内容块：每个块外面那层块壳上带 `id="blk-<块 id>"`（图片、地图、时间轴…都算）
 *
 * 谁在用：
 *   · src/components/PageContent.astro —— 渲染时真给标题加 id（slugify / makeSlugger）
 *   · src/pages/anchors.json.ts        —— 导出 dist/anchors.json 给本地编辑器挑锚点
 */
import { marked } from 'marked';
import { enhanceHtml } from './images';
import type { PageBlock } from './boards';

/**
 * 标题文字 -> 锚点 id。
 * 中文原样留着（`## 常规行动` → `#常规行动`），空格变连字符，其余符号去掉。
 * 标题里可能写了 `**粗体**`，那会被渲染成标签，所以先剥一遍标签再算。
 */
export function slugify(raw: string): string {
  const base = raw
    .replace(/<[^>]*>/g, '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '-')
    .replace(/[^\p{L}\p{N}_-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

/** 同一页里标题重名时依次加 -2、-3，保证 id 不撞 */
export type Slugger = (raw: string) => string;

/**
 * 造一个"记名"的 slug 生成器。
 * 每渲染/导出一页要新造一个 —— 序号是**按页**算的，跨页共用一个会把
 * 别页的重名也算进来，锚点就跟着构建顺序变了。
 */
export function makeSlugger(): Slugger {
  const used = new Set<string>();
  return (raw: string) => {
    const base = slugify(raw);
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}-${n++}`;
    used.add(slug);
    return slug;
  };
}

/**
 * 找标题用的正则（**每次现造**：带 g 的正则是有状态的，
 * 模块级共享一个，并发渲染时 lastIndex 会互相踩）。
 *
 * 为什么用正则改 HTML，而不是让 marked 自己吐 id：
 * marked 从 8 开始就不再自动生成标题 id 了，要自己写 renderer / walkTokens。
 * 而这里要的非常窄 —— 实测它输出的标题就是干干净净的 `<h2>…</h2>`
 * （没有属性、不会嵌套），一次 replace 既够用，又不会误伤正文里别的标签。
 */
export const headingRe = () => /<(h[1-4])>([\s\S]*?)<\/\1>/g;

/** 剥掉标签后的纯文字（标题文字就是这么取的） */
export const plainText = (html: string) => html.replace(/<[^>]*>/g, '').trim();

/** 一段 Markdown -> 渲染好的 HTML（和页面正文同一套管线） */
export const renderForAnchors = (text: string) => enhanceHtml(marked.parse(text ?? '', { async: false }) as string);

/** 一个能挑的锚点 */
export interface Anchor {
  /** 拼在地址后面：`/huaya/bingshi#桑芙` */
  id: string;
  /** 给人看的名字（编辑器那个下拉里显示的就是它） */
  text: string;
  /** 哪一类：h2 / h3 是标题，其余是块类型 —— 面板里好分组、也好认 */
  kind: string;
}

/**
 * 一个块的锚点文字：块本身的类型 + 一点能认出是哪个块的内容。
 *
 * titles 是「子页面 id → 标题」那张表：单张卡 / 卡片框在「位置」选择器里
 * 只写一个 id（`page-mu9w6v28-2`）没人看得懂，得换成子页面自己的名字。
 */
function blockLabel(b: PageBlock, html: string | null, titles?: Map<string, string>): string {
  const cut = (s: string, n = 24) => {
    const t = s.replace(/\s+/g, ' ').trim();
    return t.length > n ? `${t.slice(0, n)}…` : t;
  };
  switch (b.type) {
    case 'text': {
      const t = cut(plainText(html ?? ''), 30);
      return t ? `正文：${t}` : '正文';
    }
    case 'image':
      return b.alt ? `图片：${cut(b.alt)}` : '图片';
    case 'link':
      return `链接：${cut(b.text || b.href || '')}`;
    case 'divider':
      return b.text ? `分隔线：${cut(b.text)}` : '分隔线';
    case 'columns':
      return '两栏';
    case 'video':
      return '视频';
    case 'posts':
      return '文章列表';
    case 'toc':
      return '目录';
    case 'map':
      return '地图';
    case 'children':
      return '子页面';
    /* 单张卡 / 卡片框：位置选择器里要能一眼认出是哪张卡（2026-09-24 加的） */
    case 'card':
      return `子页面卡：${cut(titles?.get(b.ref) || b.ref)}`;
    case 'cardbox':
      return b.refs.length ? `子版块框（${b.refs.length} 张）` : '子版块框';
    case 'nav':
      return b.text ? `导航表：${cut(b.text)}` : '导航表';
    default:
      return '内容块';
  }
}

/**
 * 一页里所有能跳的锚点，按**页面上的先后**排：每个块先出块自己那一条
 * （文字块就是它开头那几个字），紧跟它底下的小标题。
 *
 * 标题序号必须按页面的渲染顺序走（同一页重名才加 -2），所以这里也按
 * 「先左后右、一个块一个块往下」的顺序扫，和 PageContent 那边一致。
 */
export function blockAnchors(
  blocks: readonly PageBlock[],
  titles?: Map<string, string>
): Anchor[] {
  const slug = makeSlugger();
  const out: Anchor[] = [];

  /** 把一段渲染好的正文里的小标题收进来（顺序就是它们在正文里的顺序） */
  const takeHeadings = (html: string) => {
    for (const m of html.matchAll(headingRe())) {
      const tag = m[1];
      const text = plainText(m[2]);
      if (!text) continue;
      out.push({ id: slug(text), text, kind: Number(tag[1]) <= 2 ? 'h2' : 'h3' });
    }
  };

  for (const b of blocks) {
    // 提醒：这里刻意**不做**悬停卡片（[[文字|图片]]）那一趟还原 ——
    // 标题里写悬停卡片是极少数情况，真写了也只是这一条的名字难看一点，
    // 锚点 id 照样对得上（slugify 会把多出来的符号去掉）。
    const html = b.type === 'text' ? renderForAnchors(b.text) : null;
    out.push({ id: `blk-${b.id}`, text: blockLabel(b, html, titles), kind: b.type });
    if (html !== null) takeHeadings(html);
    else if (b.type === 'columns') {
      takeHeadings(renderForAnchors(b.left));
      takeHeadings(renderForAnchors(b.right));
    }
  }

  return out;
}
