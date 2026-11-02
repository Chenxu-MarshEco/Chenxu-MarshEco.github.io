/**
 * ============================================================================
 * 网站地图（世界坐标 ↔ 图片像素）
 * ----------------------------------------------------------------------------
 * 数据在 `src/data/maps.json`（由 `tools/maps/xaero-export.mjs` 维护）。
 *
 * ⚠ 这一层的**唯一任务**就是那条换算 —— 用户原话：
 *   「可以锚定地图的原点 因为Xaero地图随着我的城建会不断更新 不能每次更新后让我画的
 *    道路标记失效 所以就算是换图片 道路标记的坐标位置也会相对于锚定的原点不动」
 *
 * 所以：
 *   · 道路 / 地点一律存**世界方块坐标**（wx / wz），不存像素；
 *   · 像素只在渲染时算：px = (wx - originX) / blocksPerPixel；
 *   · 重新导出的图如果范围变了（origin / 尺寸 / 比例变了），把新值填进 maps.json，
 *     所有标注自动落回原位 —— 换算函数不需要知道"图是哪一版"。
 *
 * 地形坐标约定和 Minecraft 一致：X 向东、Z 向南（图上的 y 就是 Z）。
 * ============================================================================
 */
import raw from '../data/maps.json';

/** 一条道路：折线，点都是世界坐标 [wx, wz] */
export interface MapRoad {
  id: string;
  name?: string;
  color?: string;
  /** 线宽（图片像素，1 块/像素的图上就是"几个方块那么粗"） */
  width?: number;
  /** 虚线（做"小径"用） */
  dashed?: boolean;
  points: [number, number][];
}

/** 一个地点：世界坐标上的一个点 */
export interface MapPlace {
  id: string;
  name: string;
  wx: number;
  wz: number;
  color?: string;
  /** 图标：单个 emoji 或站内的图；不填就画一个圆点 */
  icon?: string;
  /** 点开时显示的一句话（可留空） */
  note?: string;
}

export interface SiteMap {
  id: string;
  name: string;
  /** 底图地址（public/maps/…） */
  src: string;
  /** 底图像素尺寸 */
  width: number;
  height: number;
  /** 图片左上角那个像素对应的世界方块坐标 */
  originX: number;
  originZ: number;
  /** 一个像素代表多少块（Xaero 的 full 是 1，overview 是 8） */
  blocksPerPixel: number;
  dimension?: string;
  source?: string;
  exportedAt?: string;
  roads: MapRoad[];
  places: MapPlace[];
}

const doc = raw as unknown as { maps?: SiteMap[] };

/** 所有地图（一份数据，站点和编辑器共用） */
export const MAPS: SiteMap[] = (doc.maps ?? []).map((m) => ({
  ...m,
  roads: Array.isArray(m.roads) ? m.roads : [],
  places: Array.isArray(m.places) ? m.places : [],
}));

/** 按 id 取一张图（编辑器 / 页面块都用它，找不到返回 null） */
export function mapById(id: string | undefined | null): SiteMap | null {
  const key = String(id ?? '').trim();
  if (!key) return null;
  return MAPS.find((m) => m.id === key) ?? null;
}

/** 地图覆盖的世界范围（方块），给"这个点在图里吗""适不适合放标注"用 */
export function mapBounds(m: SiteMap) {
  const w = m.width * m.blocksPerPixel;
  const h = m.height * m.blocksPerPixel;
  return { minX: m.originX, minZ: m.originZ, maxX: m.originX + w, maxZ: m.originZ + h, wBlocks: w, hBlocks: h };
}

/** 世界方块坐标 → 底图像素（可以是小数） */
export function worldToPx(m: SiteMap, wx: number, wz: number): { x: number; y: number } {
  const bpp = m.blocksPerPixel || 1;
  return { x: (Number(wx) - m.originX) / bpp, y: (Number(wz) - m.originZ) / bpp };
}

/** 底图像素 → 世界方块坐标 */
export function pxToWorld(m: SiteMap, x: number, y: number): { wx: number; wz: number } {
  const bpp = m.blocksPerPixel || 1;
  return { wx: m.originX + Number(x) * bpp, wz: m.originZ + Number(y) * bpp };
}

/** 这个点在地图范围内吗（四舍五入到整块再比，免得边界上抖） */
export function inMap(m: SiteMap, wx: number, wz: number): boolean {
  const b = mapBounds(m);
  const x = Math.round(Number(wx));
  const z = Math.round(Number(wz));
  return x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
}

/** 把世界坐标裁进地图范围（画图和"拖出界"时用） */
export function clampWorld(m: SiteMap, wx: number, wz: number): { wx: number; wz: number } {
  const b = mapBounds(m);
  return {
    wx: Math.min(b.maxX - 1, Math.max(b.minX, Math.round(Number(wx)))),
    wz: Math.min(b.maxZ - 1, Math.max(b.minZ, Math.round(Number(wz)))),
  };
}

/** 道路/地点默认配色（编辑器里给一排色块用；都是深底上看得清的颜色） */
export const MAP_COLORS = ['#ff5fb0', '#ffd166', '#7ee081', '#6ec8ff', '#c792ff', '#ff8a5b', '#ffffff'];

/** 新标注的默认值 */
export const MAP_DEFAULTS = {
  roadColor: '#ff5fb0',
  roadWidth: 3,
  placeColor: '#ffd166',
} as const;
