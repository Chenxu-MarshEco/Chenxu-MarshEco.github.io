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
