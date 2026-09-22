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

/** 分类认不出来时用的颜色（中性灰紫，在深色卡片上也看得清） */
export const DEFAULT_CATEGORY_COLOR = '#b9a6c9';

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
