/*
 * 地图坐标换算（纯函数，**不依赖任何 JSON / 框架**）
 * ----------------------------------------------------------------------------
 * 单独一层是为了让它能被 `src/utils/maps.ts`（站点）和 `tools/checks/*.mjs`（验收）
 * 同时 import —— 验收里直接跑真身，而不是在测试里再抄一份公式。
 *
 * 约定：X 向东、Z 向南（图上的 y 就是 Z）。每张地图三样参数：
 *   originX / originZ   图片左上角那个像素对应的世界方块坐标
 *   blocksPerPixel      一个像素代表多少块（Xaero 的 full = 1，overview = 8）
 *   width / height      底图像素尺寸
 */

/** 世界方块坐标 → 底图像素（可小数） */
export function worldToPx(map, wx, wz) {
  const bpp = Number(map?.blocksPerPixel) || 1;
  return { x: (Number(wx) - Number(map?.originX || 0)) / bpp, y: (Number(wz) - Number(map?.originZ || 0)) / bpp };
}

/** 底图像素 → 世界方块坐标 */
export function pxToWorld(map, x, y) {
  const bpp = Number(map?.blocksPerPixel) || 1;
  return { wx: Number(map?.originX || 0) + Number(x) * bpp, wz: Number(map?.originZ || 0) + Number(y) * bpp };
}

/** 地图覆盖的世界范围（方块） */
export function mapBounds(map) {
  const bpp = Number(map?.blocksPerPixel) || 1;
  const wBlocks = (Number(map?.width) || 0) * bpp;
  const hBlocks = (Number(map?.height) || 0) * bpp;
  const minX = Number(map?.originX) || 0;
  const minZ = Number(map?.originZ) || 0;
  return { minX, minZ, maxX: minX + wBlocks, maxZ: minZ + hBlocks, wBlocks, hBlocks };
}

/** 这个点在地图范围内吗（按整块比，免得边界上抖） */
export function inMap(map, wx, wz) {
  const b = mapBounds(map);
  const x = Math.round(Number(wx));
  const z = Math.round(Number(wz));
  return x >= b.minX && x < b.maxX && z >= b.minZ && z < b.maxZ;
}

/** 把世界坐标裁进地图范围 */
export function clampWorld(map, wx, wz) {
  const b = mapBounds(map);
  return {
    wx: Math.min(b.maxX - 1, Math.max(b.minX, Math.round(Number(wx)))),
    wz: Math.min(b.maxZ - 1, Math.max(b.minZ, Math.round(Number(wz)))),
  };
}

/**
 * 世界坐标 → 底图上的**百分比**（0..100）。
 * 页面里的地图块用的是百分比坐标（它自带的拖动 / 滚轮缩放 / 图钉反缩都按百分比算），
 * 站内地图接进去只要走这一层 —— 不用另写一套缩放逻辑。
 */
export function worldToPct(map, wx, wz) {
  const p = worldToPx(map, wx, wz);
  const w = Number(map?.width) || 1;
  const h = Number(map?.height) || 1;
  return { x: (p.x / w) * 100, y: (p.y / h) * 100 };
}

/** 百分比 → 世界坐标（点图上某个位置时反算，存回方块坐标） */
export function pctToWorld(map, x, y) {
  const w = Number(map?.width) || 1;
  const h = Number(map?.height) || 1;
  return pxToWorld(map, (Number(x) / 100) * w, (Number(y) / 100) * h);
}

/**
 * 把一张站内地图摊成页面地图块认的那一页 `{ id, src, alt, markers, lines }`。
 * · 地点 → 图钉；道路 → 相邻两点的一段段线（同色段在视觉上是连续的一条路）。
 * 于是页面那块**照旧用它自己的取景框**，站内地图只是换了个数据来源。
 */
export function siteMapAsPage(map) {
  const round2 = (n) => Math.round(n * 100) / 100;
  const markers = (map?.places ?? []).map((p, i) => {
    const at = worldToPct(map, p.wx, p.wz);
    return {
      id: p.id || `${map.id}-place-${i + 1}`,
      kind: 'building',
      x: round2(at.x),
      y: round2(at.y),
      title: p.name || '',
      ...(p.note ? { note: p.note } : {}),
    };
  });
  const lines = [];
  (map?.roads ?? []).forEach((road, ri) => {
    const pts = (road.points ?? []).map(([wx, wz]) => worldToPct(map, wx, wz));
    for (let i = 0; i + 1 < pts.length; i += 1) {
      lines.push({
        id: `${road.id || `${map.id}-road-${ri + 1}`}-s${i + 1}`,
        x1: round2(pts[i].x),
        y1: round2(pts[i].y),
        x2: round2(pts[i + 1].x),
        y2: round2(pts[i + 1].y),
        ...(road.color ? { color: road.color } : {}),
      });
    }
  });
  return { id: `site-${map?.id ?? 'map'}`, src: map?.src ?? '', alt: map?.name ?? '', text: '', markers, lines };
}
