/**
 * 导航分类库的取数逻辑（构建期）。
 *
 * 结构和时间轴一模一样：**先建可复用的单位，页面里只引用**。
 *   timelines.json  : timelines[ 一条轴 ] -> points / spans，页面用节点的 timeline 字段引用
 *   navs.json       : categories[ 大分类 ] -> groups[ 子分类 ] -> items[ 条目 ]，
 *                     页面用内容块 { type:'nav', cats:[分类 id…] } 引用
 *
 * 为什么复用单位是**大分类**而不是整套导航：用户的原话是"有些条目对应的页面
 * 可能既属于 A 大分类又属于 B 大分类"，而 A 页的导航可能是「甲+乙」、B 页是「甲+丙」——
 * 甲里那几十条条目只该录一次。所以页面引用的是分类 id 的列表，顺序也由页面自己定
 * （同一个分类在 A 页放前面、B 页放后面都行）。
 *
 * 改一次分类，所有引用它的页面一起变 —— 因为页面上渲染的就是这份数据，
 * 页面里存的是一个 id，不是一份拷贝。
 */
import raw from '../data/navs.json';

export interface NavItem {
  id: string;
  /** 条目文字 */
  text: string;
  /** 点它跳去哪。站内 `/huaya/xxx`，站外 `https://…`；留空就只是看看名字 */
  href?: string;
  /** 条目左边的小图标（/img/uploads/… 或 /img/home/…） */
  image?: string;
  /** 鼠标移上去的提示 */
  tip?: string;
}

export interface NavGroup {
  id: string;
  /** 子分类的名字，比如「友好生物」 */
  title: string;
  items: NavItem[];
}

export interface NavCategory {
  id: string;
  /** 大分类的名字，比如「实体」 */
  title: string;
  /** 大分类下面那句说明（可选） */
  note?: string;
  groups: NavGroup[];
}

interface NavFile {
  categories?: NavCategory[];
}

const DATA = raw as NavFile;

/** 库里所有大分类（保持数据里的顺序） */
export const navCategories: NavCategory[] = Array.isArray(DATA.categories)
  ? DATA.categories.filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string')
  : [];

export const getNavCategory = (id: string): NavCategory | undefined =>
  navCategories.find((c) => c.id === id);

/**
 * 页面块引用的分类：按块里写的顺序解析，认不出来的 id 直接丢掉。
 *
 * 丢掉而不是报错：分类被删掉之后，旧页面里的引用就成了悬空指针 ——
 * 那时候应该只是少一块，而不是整站构建失败（和 timelines 那边
 * "找不到的时间点就跳过"一个规矩）。
 */
export function navCatsFor(cats: readonly string[] | undefined | null): NavCategory[] {
  if (!Array.isArray(cats)) return [];
  const out: NavCategory[] = [];
  for (const id of cats) {
    const c = getNavCategory(String(id));
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

/** 这个分类里一共有多少条目（编辑器列表里显示个数用） */
export const countNavItems = (c: NavCategory): number =>
  c.groups.reduce((n, g) => n + g.items.length, 0);
