/**
 * 大板块树的工具函数。
 *
 * 数据结构见 src/data/home-boards.json：boards 是若干棵树，
 * 每个节点有 id / title / children，可以无限嵌套。
 * 每一层都能挂文章 —— 文章 frontmatter 里的 subs 填节点 id。
 *
 * 页面地址由 id 推导（用户选了「自动生成页面」）：
 *   yongcheng            -> /yongcheng
 *   yongcheng-a          -> /yongcheng/a        （去掉父级前缀）
 *   yongcheng-a-1        -> /yongcheng/a/1
 * 节点上显式写了 href 时以 href 为准，那就不再自动生成页面。
 */

/**
 * 一个成分（页面内容块、子版块）认领的时间点 / 时间段。
 *
 * 两个字段二选一：`timePoint` 指某个时间点，`timeSpan` 指某一段时间。
 * 指的 id 都在**这一页用的那条时间轴**里（见 BoardNode.timeline）。
 */
export interface TimeFields {
  timePoint?: string;
  timeSpan?: string;
}

/**
 * 页面内容块。
 *
 * 一个版块页除了「子版块自动铺开」，还可以自己写一段内容：
 * 介绍文字、图片、链接、分隔线、两栏、视频、目录、地图，
 * 以及把子页面插到任意位置。
 * 每种块都带一个 id —— 排版模式就是拿它当锚点（data-edit="pg-<id>"），
 * 所以 id 要**全站唯一**（同一块内容在不同页面之间不能撞），
 * 编辑器新建块时用「节点 id + 序号」来保证这点。
 *
 * 用交叉类型挂上 TimeFields，是为了每个块都能认领时间点/时间段，
 * 而不用在十种块里各写一遍这两个字段。
 */
export type PageBlock = (
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; src: string; alt?: string; width?: ImageWidth }
  | { id: string; type: 'link'; text: string; href: string }
  /** 一条横线，可选中间一句话（用来分段） */
  | { id: string; type: 'divider'; text?: string }
  /** 左右两栏，各写一段 Markdown；窄屏自动上下叠起来 */
  | { id: string; type: 'columns'; left: string; right: string }
  /** 视频：本地/远程视频文件，或 B 站、YouTube 链接（自动转成播放器） */
  | { id: string; type: 'video'; src: string; caption?: string }
  /** 把归到这一页的文章列出来；不写这一块时，页面底部也会自动列一遍 */
  | { id: string; type: 'posts'; text?: string }
  /**
   * 这一页的目录：把页面内容里的小标题（`##` / `###`）自动收集成一份可跳转的列表。
   * text 是目录的标题，不写就叫「目录」。
   *
   * 为什么做成「块」而不是全站开关：只有长页面才需要目录，
   * 一两段话的介绍页挂个目录反而碍事。做成块，就由写的人按页决定
   * 放不放、放在哪（放开头最像目录，想放侧边也随你）。
   * 它自己不产生任何文字，页面里没有小标题时只显示一句提示。
   */
  | { id: string; type: 'toc'; text?: string }
  /**
   * 一张地图 + 钉在上面的塔吊地标。
   *
   * 分页：`pages` 每一页都有自己的图、图钉、划分线和简介，
   * 页面上用地图下面那对箭头翻页。
   * 坐标一律存**百分比**而不是像素：地图能放大缩小、能拖，框的宽度还随
   * 屏幕变，只有「相对图片的百分之几」这套坐标在任何情况下都还指着同一个点。
   */
  | { id: string; type: 'map'; pages: MapPage[] }
  /**
   * 把这一层的子页面铺在这里。
   * shape / size 是整块的默认值，单张卡想不一样就在那个子版块上设
   * cardShape / cardSize（见 BoardNode），单个永远压过整块。
   */
  | { id: string; type: 'children'; shape?: CardShape; size?: CardSize }
) &
  TimeFields;

/**
 * 图钉的两种类型。
 *   building  建筑：粉色 + 简约塔吊图标
 *   region    区域：蒸汽波落日那套橙黄色
 * 两种都带向下的小箭头，都显示名字、都能点着跳转。
 */
export type MapPinKind = 'building' | 'region';

/**
 * 地图上的一个地标（图钉）。
 *
 * x / y 是相对地图图片的百分比（0~100），原点在图片左上角。
 * 存百分比是为了让图钉跟着图走：放大、缩小、拖动、换屏幕宽度，
 * 它都还钉在图上同一个位置。存像素的话一缩放就全跑偏了。
 */
export interface MapMarker {
  id: string;
  kind: MapPinKind;
  x: number;
  y: number;
  /** 鼠标移到图标上显示的建筑名 */
  title: string;
  /** 点它跳去哪。站内写 `/huaya/xxx`，站外写 `https://…`；留空就只是看看名字 */
  href?: string;
}

/**
 * 区域划分线：从 (x1,y1) 拉到 (x2,y2) 的一条线，坐标同样是百分比。
 *
 * 它不显示名字、也不能点 —— 只是把地图划成几块给人看，
 * 所以这里没有 title / href。编辑器里按住鼠标在地图上拖一下就有了。
 */
export interface MapLine {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * 这条线的颜色，`#rrggbb`。编辑器里是拿 RGB 色板挑的，一条线一个色，
   * 这样几块区域可以用不同颜色区分开。
   *
   * 老数据没有这个字段：渲染时回落到 DEFAULT_LINE_COLOR，
   * 所以不填也画得出来，不会变成一根隐形的线。
   */
  color?: string;
}

/** 老数据（没存颜色）的划分线用这个色，和最早那版固定橙色一致 */
export const DEFAULT_LINE_COLOR = '#ffb43c';

/**
 * 把用户存下来的颜色洗干净。
 *
 * 只认 `#rrggbb`（三位简写也帮忙补全成六位）；认不出来的一律当没填。
 * 颜色是直接塞进 style / SVG 属性的，不校验的话等于开了一个注入口子。
 */
export function normalizeLineColor(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`.toLowerCase();
  const full = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (full) return s.toLowerCase();
  return undefined;
}

/**
 * 地图的一页。
 * 翻页翻的就是它：每页一张图，图上各自有自己的图钉、划分线和简介。
 */
export interface MapPage {
  id: string;
  src: string;
  alt?: string;
  /** 这一页的简介，显示在地图下面 */
  text?: string;
  markers: MapMarker[];
  lines: MapLine[];
}

/**
 * 取一个地图块的所有页，并把每一页补齐成完整形状。
 *
 * 兼容最早那版「只有一页」的写法（块上直接挂 `src` + `markers`）：
 * 纷湖那张图就是老版本编辑器做的，数据已经落在硬盘上了，
 * 不能因为代码升级就让它渲染不出来。读到的老数据当「只有一页」，
 * 图钉补上默认类型（建筑）。编辑器再保存一次就会写成新的分页结构。
 */
export function mapPages(block: {
  id?: string;
  pages?: MapPage[];
  src?: string;
  alt?: string;
  markers?: MapMarker[];
}): MapPage[] {
  const normMarkers = (list: MapMarker[] | undefined): MapMarker[] =>
    (Array.isArray(list) ? list : []).map((m) => ({ ...m, kind: m.kind === 'region' ? 'region' : 'building' }));

  // 线也过一遍：颜色字段是后加的，老数据没有；万一存进来一个乱七八糟的字符串，
  // 这里直接丢掉，免得它被当成 style 用。
  const normLines = (list: MapLine[] | undefined): MapLine[] =>
    (Array.isArray(list) ? list : []).map((l) => {
      const color = normalizeLineColor(l.color);
      return color ? { ...l, color } : { id: l.id, x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2 };
    });

  if (Array.isArray(block.pages) && block.pages.length) {
    return block.pages.map((pg) => ({
      ...pg,
      markers: normMarkers(pg.markers),
      lines: normLines(pg.lines),
    }));
  }

  if (!block.src) return [];
  return [
    {
      id: `${block.id ?? 'map'}-p1`,
      src: block.src,
      alt: block.alt,
      markers: normMarkers(block.markers),
      lines: [],
    },
  ];
}

/** 图片宽度档位 */
export type ImageWidth = 'full' | 'wide' | 'half' | 'third';
/** 子页面卡片的横竖比例 */
export type CardShape = 'wide' | 'square' | 'tall';
/** 子页面卡片的大小 */
export type CardSize = 'l' | 'm' | 's';

/**
 * 链接版块：填了 link 的子版块不再有自己的页面，点它就是跳走。
 *
 * 为什么还要校验一遍协议：编辑器保存时服务端已经收过一遍，
 * 但这份 JSON 是纯文本，手改得动。如果这里不挡，手写一个
 * `javascript:` 进去，构建出来的就是一条能执行脚本的链接。
 */
const SAFE_LINK = /^(https?:\/\/|mailto:|tel:|\/|#)/i;

/** 这个值能不能当链接用 */
export function isLinkUrl(value: unknown): boolean {
  return typeof value === 'string' && SAFE_LINK.test(value.trim());
}

export interface BoardNode {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  href?: string;
  /**
   * 链接版块的目标地址。填了就：
   *   · 它自己**不再生成页面**
   *   · 卡片照旧有名字和封面图，但点下去是打开这个链接
   *   · 页面上不显示这个地址本身
   * 允许 http(s) / mailto / tel / 站内 `/路径` / `#锚点`。
   */
  link?: string;
  /**
   * **独立页面**：不挂在任何版块下面，站内的目录树 / 首页卡片 / 任何"子版块"
   * 列表里都不会出现它 —— 只能靠别处给它挂的那个链接点进来
   * （正文里的链接、时间轴上某个点的跳转地址、地图图钉…都行）。
   *
   * 为什么这么设计：文章那套（frontmatter + 列表页）管得太多，写一页"就放在那儿
   * 给人看"的东西不如直接建页面；但普通页面必须挂在某个版块下才生得出来，
   * 于是给它一个 `standalone: true`：**页面照旧生成**（地址还是推导出来的
   * `/<id>`），只是**不被任何列表收录**。
   *
   * 只写在**顶层**（`boards` 数组里）才有意义 —— 树里看不见的子树等于不存在。
   */
  standalone?: boolean;
  /**
   * 这一页用哪条时间轴（`src/data/timelines.json` 里的 id）。
   *
   * 放在页面上而不是时间轴上，是因为「哪些页共用一条轴」是页面的属性：
   * 好多页可以都指同一条（同一个时间轴），也可以各指各的。
   * 不填就是这一页没有时间轴 —— 右侧那个书签不会出现。
   */
  timeline?: string;
  /**
   * 这一页自己认领的时间点 / 时间段。
   *
   * 两个用处：一是这个版块作为卡片出现在上一页时，滚到它就停在这一点；
   * 二是直接打开这一页时，时间轴默认停在这里（比如某个年代的中点）。
   */
  timePoint?: string;
  timeSpan?: string;
  /**
   * 版式。目前只认 'region'（设计稿那套三列分区，只有花娅陌域用）。
   * 不写就是默认的竖排：子页面一条一条占满整行。
   * 这个字段是给「这一页怎么排」用的，和树结构无关，所以随便哪一层都能挂。
   */
  layout?: string;
  /**
   * 这一页自己写的内容（介绍文字 / 图片 / 链接 / 子页面）。
   * 不写就退回老样子：子版块自动铺开。
   */
  page?: PageBlock[];
  /**
   * 这一项作为「子页面卡」出现时的横竖比例和大小。
   *
   * 为什么放在子节点上而不是「子页面」块里：卡片是跟着**这个版块**走的，
   * 放在块里就得按 id 去对，编辑器新加的版块还没有 id，一对就错位；
   * 放在节点上，移到哪个块、哪一页都跟着走，也不会因为换了顺序就串。
   */
  cardShape?: CardShape;
  cardSize?: CardSize;
  /**
   * 卡片的像素宽高（可选）。填了就**盖过** cardSize 的档位 ——
   * 「这张卡太大了，想改成 300×80」这种要求只有具体数字能满足。
   * 卡片出现在面板清单、竖排大卡、页面里的「子页面」块时都按这个来。
   */
  cardW?: number;
  cardH?: number;
  children?: BoardNode[];
}

export interface FlatNode {
  node: BoardNode;
  /** 从根到当前节点的 id 链 */
  ids: string[];
  /** URL 路径，例如 /yongcheng/a；链接版块则是它那个外链 */
  url: string;
  /** 面包屑，从大板块到当前节点 */
  trail: BoardNode[];
  /** 所属大板块的 id */
  boardId: string;
  /** 0 = 大板块本身 */
  depth: number;
  /** 链接版块：url 指向站外（或站内锚点），没有自己的页面，别再往下走 */
  external: boolean;
}

/** 去重后的 URL 段：nodeId 去掉 parentId 前缀 -> a-1 这类短段 */
function segmentOf(nodeId: string, parentId: string | null): string {
  if (parentId && nodeId.startsWith(`${parentId}-`)) {
    const rest = nodeId.slice(parentId.length + 1);
    if (rest) return rest;
  }
  return nodeId;
}

/** 把整片森林展平成一维列表，顺序即先序遍历 */
export function flattenBoards(boards: BoardNode[]): FlatNode[] {
  const out: FlatNode[] = [];

  const walk = (
    node: BoardNode,
    parentId: string | null,
    parentUrl: string,
    ids: string[],
    trail: BoardNode[],
    boardId: string,
    depth: number
  ) => {
    const seg = segmentOf(node.id, parentId);
    /*
      链接版块：url 直接用那个外链，并且**当成叶子**不再往下走。
      往下走的话子节点的地址会拼成 https://别的站/xxx，既生不出页面，
      也会在树上留下一堆指不到地方的条目。
    */
    const link = typeof node.link === 'string' ? node.link.trim() : '';
    const external = isLinkUrl(link);
    const url = external ? link : node.href || (depth === 0 ? `/${seg}` : `${parentUrl}/${seg}`);
    const nextIds = [...ids, node.id];
    const nextTrail = [...trail, node];

    out.push({ node, ids: nextIds, url, trail: nextTrail, boardId, depth, external });
    if (external) return;

    for (const child of node.children ?? []) {
      walk(child, node.id, url, nextIds, nextTrail, boardId, depth + 1);
    }
  };

  for (const board of boards) {
    walk(board, null, '', [], [], board.id, 0);
  }
  return out;
}

/** 按 URL 找节点，用于动态路由 getStaticPaths 之后的取数 */
export function findByUrl(boards: BoardNode[], url: string): FlatNode | undefined {
  return flattenBoards(boards).find((f) => f.url === url);
}

/** 顶层大板块（首页那两块） */
export const topBoards = (boards: BoardNode[]): BoardNode[] => boards;

/**
 * 这一页是不是「独立页面」（不挂在任何版块下面、只能靠链接点进来）。
 * 见 `BoardNode.standalone` 的注释。
 */
export const isStandalone = (node: { standalone?: boolean } | null | undefined): boolean =>
  node?.standalone === true;

/**
 * 能出现在首页卡片 / 目录树里的顶层板块。
 *
 * **独立页面必须从这里滤掉**：它们和两大板块平级躺在 `boards` 数组里
 * （那是为了借用同一套地址推导与页面生成），但按定义不该被任何列表收录。
 */
export const visibleBoards = (boards: readonly BoardNode[]): BoardNode[] =>
  boards.filter((b) => !isStandalone(b));

/**
 * 一个节点下**可见的**子版块。
 *
 * 独立页面不会挂在别人底下（编辑器也只允许它待在顶层），所以这里过滤的是
 * "万一有人手改了数据" 的情况：挂了也不显示，免得它偷偷冒出来。
 */
export const visibleChildren = (node: BoardNode | null | undefined): BoardNode[] =>
  (node?.children ?? []).filter((c) => !isStandalone(c));

/** 面包屑的一项。最后一项不带 url，表示「当前所在」 */
export interface Crumb {
  title: string;
  url?: string;
}

/**
 * 文章 / 手记 frontmatter 里的 subs（节点 id 列表）→ 面包屑链。
 *
 * 每条链从大板块一路接到「这篇东西直接所属的那个节点」，每一项都带 url，
 * 所以文章页能直接拿它拼出「花娅陌域 › 陌质流记忆库 › 测试性流质酶」，
 * 点最末一项就回到了上一级。当前页自己（文章标题）由调用方接在末尾。
 *
 * 一篇文章可以同时归到多个节点，所以返回的是「链的数组」而不是一条链。
 *
 * 找不到的 id 直接丢掉：版块在 home-boards.json 里被删掉之后，
 * 旧文章 frontmatter 里的 subs 就成了悬空引用 ——
 * 那时候应该只是少一条面包屑，而不是整站构建报错。
 */
export function trailsOf(boards: BoardNode[], ids: readonly string[]): Crumb[][] {
  const all = flattenBoards(boards);
  const out: Crumb[][] = [];

  for (const id of ids) {
    const flat = all.find((f) => f.node.id === id);
    // 链接版块没有页面，文章挂上去也没地方显示，直接跳过（编辑器里也选不到它）
    if (!flat || flat.external) continue;
    out.push(
      flat.trail.map((n) => ({
        title: n.title,
        // 同一个节点对象在展平结果里能按引用找回来（boardPage.ts 也是这么做的）
        url: all.find((x) => x.node === n)?.url ?? '/',
      }))
    );
  }

  return out;
}

/** 文章归类用的「所有可选节点」，带上层级前缀方便在勾选框里看出从属关系 */
export function selectableNodes(boards: BoardNode[]): {
  id: string;
  label: string;
  indent: string;
}[] {
  return flattenBoards(boards)
    // 链接版块不是「一层页面」，文章归不到它名下
    .filter((f) => !f.external)
    .map((f) => ({
      id: f.node.id,
      label: f.node.title,
      indent: '　'.repeat(f.depth),
    }));
}
