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

export interface BoardNode {
  id: string;
  title: string;
  subtitle?: string;
  image?: string;
  href?: string;
  /**
   * 版式。目前只认 'region'（设计稿那套三列分区，只有花娅陌域用）。
   * 不写就是默认的竖排：子页面一条一条占满整行。
   * 这个字段是给「这一页怎么排」用的，和树结构无关，所以随便哪一层都能挂。
   */
  layout?: string;
  children?: BoardNode[];
}

export interface FlatNode {
  node: BoardNode;
  /** 从根到当前节点的 id 链 */
  ids: string[];
  /** URL 路径，例如 /yongcheng/a */
  url: string;
  /** 面包屑，从大板块到当前节点 */
  trail: BoardNode[];
  /** 所属大板块的 id */
  boardId: string;
  /** 0 = 大板块本身 */
  depth: number;
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
    const url = node.href || (depth === 0 ? `/${seg}` : `${parentUrl}/${seg}`);
    const nextIds = [...ids, node.id];
    const nextTrail = [...trail, node];

    out.push({ node, ids: nextIds, url, trail: nextTrail, boardId, depth });

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
export function topBoards(boards: BoardNode[]): BoardNode[] {
  return boards;
}

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
    if (!flat) continue;
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
  return flattenBoards(boards).map((f) => ({
    id: f.node.id,
    label: f.node.title,
    indent: '　'.repeat(f.depth),
  }));
}
