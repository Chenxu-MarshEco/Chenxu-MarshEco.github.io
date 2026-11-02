/**
 * ============================================================================
 * 网站地图（数据 + 类型）
 * ----------------------------------------------------------------------------
 * 数据在 `src/data/maps.json`（由 `tools/maps/xaero-export.mjs` 维护）。
 *
 * ⚠ 用户最硬的那条要求：
 *   「可以锚定地图的原点 因为Xaero地图随着我的城建会不断更新 不能每次更新后让我画的
 *    道路标记失效 所以就算是换图片 道路标记的坐标位置也会相对于锚定的原点不动」
 * 所以道路 / 地点一律存**世界方块坐标**，像素只在渲染时算。
 * 换算本身在 `maps-math.mjs`（纯函数、不依赖 JSON）—— 站点和验收跑的是同一份真身。
 * ============================================================================
 */
import raw from '../data/maps.json';
import {
  clampWorld,
  inMap,
  mapBounds,
  pctToWorld,
  pxToWorld,
  siteMapAsPage,
  worldToPct,
  worldToPx,
} from './maps-math.mjs';

/** 一条道路：折线，点都是世界坐标 [wx, wz] */
export interface MapRoad {
  id: string;
  name?: string;
  color?: string;
  /** 线宽（底图像素，1 块/像素的图上就是"几个方块那么粗"） */
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
  src: string;
  width: number;
  height: number;
  originX: number;
  originZ: number;
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

export { clampWorld, inMap, mapBounds, pctToWorld, pxToWorld, siteMapAsPage, worldToPct, worldToPx };

/** 道路/地点默认配色（编辑器里给一排色块用；都是深底上看得清的颜色） */
export const MAP_COLORS = ['#ff5fb0', '#ffd166', '#7ee081', '#6ec8ff', '#c792ff', '#ff8a5b', '#ffffff'];

/** 新标注的默认值 */
export const MAP_DEFAULTS = {
  roadColor: '#ff5fb0',
  roadWidth: 3,
  placeColor: '#ffd166',
} as const;