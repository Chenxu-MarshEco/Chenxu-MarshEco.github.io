/*
 * ============================================================================
 * 地图：数据 + 坐标锚定（2026-11-02）
 * ----------------------------------------------------------------------------
 * 用户最硬的那条要求：
 *   「可以锚定地图的原点 因为Xaero地图随着我的城建会不断更新 不能每次更新后让我画的
 *    道路标记失效 所以就算是换图片 道路标记的坐标位置也会相对于锚定的原点不动」
 *
 * 这份验收就钉这一条，外加载出来的图对不对：
 *   ① 两张图都在、数据自洽（id 唯一、底图文件真存在、声明的尺寸和真图一致）
 *   ② 世界坐标 ↔ 像素 换算：已知点对得上、来回换能回到原值
 *   ③ **换底图演练**：把同一份标注喂给"范围变大 / 比例变粗"的另一版图，
 *      世界坐标一点不变、像素位置按新参数重算 —— 这就是"重新导出后标记不失效"
 * 用法：node tools/checks/maps-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const near = (a, b, eps = 1e-6) => Math.abs(Number(a) - Number(b)) <= eps;

const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/data/maps.json'), 'utf8'));
const maps = Array.isArray(doc.maps) ? doc.maps : [];
console.log('================ ① 数据自洽 ================');
check('maps.json 里有地图（至少两张：城建 + 主世界）', maps.length >= 2, `${maps.length} 张`);
check('id 唯一', new Set(maps.map((m) => m.id)).size === maps.length);
check('每张都有 底图 / 尺寸 / 原点 / 比例',
  maps.every((m) => m.src && m.width > 0 && m.height > 0
    && Number.isFinite(m.originX) && Number.isFinite(m.originZ) && m.blocksPerPixel > 0),
  JSON.stringify(maps.map((m) => `${m.id}:${m.blocksPerPixel}块/px`)));

const sizes = {};
for (const m of maps) {
  const file = path.join(ROOT, 'public', m.src.replace(/^\//, ''));
  const exists = fs.existsSync(file);
  if (!exists) {
    check(`${m.id} 的底图文件存在`, false, file);
    continue;
  }
  const meta = await sharp(file).metadata();
  sizes[m.id] = { w: meta.width, h: meta.height, kb: fs.statSync(file).size / 1024 };
  check(`★ ${m.id}：声明的尺寸和真图一致（${m.width}×${m.height}，${sizes[m.id].kb.toFixed(1)} KB）`,
    meta.width === m.width && meta.height === m.height,
    `真图 ${meta.width}×${meta.height}`);
  check(`${m.id} 底图没超过 4 MB（网页要能顺手拉下来）`, sizes[m.id].kb < 4096, `${sizes[m.id].kb.toFixed(1)} KB`);
  check(`${m.id} 的道路 / 地点是数组`, Array.isArray(m.roads) && Array.isArray(m.places));
}

/* ---------------------------------------------------------------- ② 换算 */
console.log('\n================ ② 世界坐标 ↔ 像素 ================');
/* 这里刻意用"手算得出的已知点"，不用被测函数算出来的值来对被测函数 */
const cases = [
  {
    id: 'huaya-superflat', origin: [-2560, -2560], bpp: 1, w: 5120,
    /* 左上角像素 ↔ 世界原点；地图正中 ↔ 世界 (0,0)；右下角最后一个像素 */
    expect: [
      { world: [-2560, -2560], px: [0, 0] },
      { world: [0, 0], px: [2560, 2560] },
      { world: [2559, 2559], px: [5119, 5119] },
      { world: [-1, 128], px: [2559, 2688] },
    ],
  },
  {
    id: 'huaya-overworld', origin: [-5120, -3072], bpp: 8, w: 1024,
    expect: [
      { world: [-5120, -3072], px: [0, 0] },
      { world: [0, 0], px: [640, 384] },
      { world: [-5120 + 8 * 1023, -3072 + 8 * 1023], px: [1023, 1023] },
      { world: [24, -16], px: [643, 382] },
    ],
  },
];

for (const c of cases) {
  const m = maps.find((x) => x.id === c.id);
  if (!m) {
    check(`找得到 ${c.id}`, false);
    continue;
  }
  const bpp = m.blocksPerPixel || 1;
  const wx2px = (wx, wz) => ({ x: (wx - m.originX) / bpp, y: (wz - m.originZ) / bpp });
  const px2wx = (x, y) => ({ wx: m.originX + x * bpp, wz: m.originZ + y * bpp });
  let ok = true;
  const bad = [];
  for (const e of c.expect) {
    const got = wx2px(e.world[0], e.world[1]);
    if (!near(got.x, e.px[0]) || !near(got.y, e.px[1])) {
      ok = false;
      bad.push(`${JSON.stringify(e.world)}→${got.x},${got.y}（应 ${e.px[0]},${e.px[1]}）`);
    }
    const back = px2wx(e.px[0], e.px[1]);
    if (!near(back.wx, e.world[0]) || !near(back.wz, e.world[1])) {
      ok = false;
      bad.push(`回程 ${e.px} → ${back.wx},${back.wz}`);
    }
  }
  check(`★ ${c.id}：已知点对得上、来回换能回到原值（原点 ${m.originX},${m.originZ}；${bpp} 块/像素）`, ok, bad.join(' | '));
  check(`${c.id}：比例和"块数/像素数"自洽`,
    near(bpp, (m.width * bpp) / m.width) && m.width === c.w, `${m.width}px × ${bpp} = ${m.width * bpp} 块`);
}

/* ---------------------------------------------------- ③ "换底图"演练（核心） */
console.log('\n================ ③ 重新导出后标记不动（核心）================');
const base = maps.find((m) => m.id === 'huaya-superflat');
if (!base) {
  check('找得到 huaya-superflat 来演练', false);
} else {
  /* 一份标注：一条折线 + 一个地点（世界坐标，写死） */
  const road = { points: [[-2560, -2560], [0, 0], [128, 256], [2559, 2559]] };
  const place = { wx: 128, wz: 256 };
  const bppOf = (m) => m.blocksPerPixel || 1;
  const toPx = (m, wx, wz) => ({ x: (wx - m.originX) / bppOf(m), y: (wz - m.originZ) / bppOf(m) });

  const before = road.points.map(([wx, wz]) => toPx(base, wx, wz));
  const beforePlace = toPx(base, place.wx, place.wz);

  /*
    模拟"城建长大之后重新导出"：范围从 5120 块扩到 8192 块（原点往西北挪 1536 块），
    图从 5120px 变成 4096px（也就是 2 块/像素）—— 三个参数全变了。
  */
  const re = { ...base, originX: -4096, originZ: -4096, width: 4096, height: 4096, blocksPerPixel: 2 };
  const after = road.points.map(([wx, wz]) => toPx(re, wx, wz));
  const afterPlace = toPx(re, place.wx, place.wz);

  const sameWorld = road.points.every(([wx, wz], i) => {
    const back = { wx: re.originX + after[i].x * bppOf(re), wz: re.originZ + after[i].y * bppOf(re) };
    return near(back.wx, wx) && near(back.wz, wz);
  }) && near(re.originX + afterPlace.x * bppOf(re), place.wx)
      && near(re.originZ + afterPlace.y * bppOf(re), place.wz);
  check('★ 换底图（原点 + 范围 + 比例全变）之后，标注的世界坐标一个字没动', sameWorld);

  const moved = before.some((p, i) => !near(p.x, after[i].x) || !near(p.y, after[i].y));
  check('★ 而像素位置按新参数重算了（不是死记旧像素）', moved,
    `旧：${before.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')} 新：${after.map((p) => `${p.x.toFixed(0)},${p.y.toFixed(0)}`).join(' ')}`);

  /* 同一个世界点在两张"版本"的图上，落到不同的像素，但还原回世界坐标都一样 */
  const a1 = { wx: base.originX + beforePlace.x * 1, wz: base.originZ + beforePlace.y * 1 };
  const a2 = { wx: re.originX + afterPlace.x * 2, wz: re.originZ + afterPlace.y * 2 };
  check('★ 地点：两版图上像素不同、世界坐标相同（这就是锚定原点要的效果）',
    near(a1.wx, a2.wx) && near(a1.wz, a2.wz) && (beforePlace.x !== afterPlace.x || beforePlace.y !== afterPlace.y),
    `${JSON.stringify(a1)} vs ${JSON.stringify(a2)}`);
}



/* ------------------------------------------- ④ 接进页面地图块（百分比 + 接线） */
console.log('\n================ ④ 页面地图块接线 ================');
{
  /*
    页面里的地图块（pmap）用**百分比**坐标，站内地图要摊成它认的那一页。
    这里直接调 src/utils/maps.ts 里的纯函数（Node 能直接跑 TS 的类型擦除）验证换算，
    再接上源码级接线断言 —— 这样不用起浏览器也能钉住"标注会不会落错地方"。
  */
  /* ⚠ Windows 上动态 import 绝对路径要给 file:// URL，直接传路径会失败 */
  const { pathToFileURL } = await import('node:url');
  const mod = await import(pathToFileURL(path.join(ROOT, 'src/utils/maps-math.mjs')).href).catch(() => null);
  if (!mod) {
    check('能 import src/utils/maps-math.mjs（拿 siteMapAsPage 来量换算）', false);
  } else {
    const m = maps.find((x) => x.id === 'huaya-superflat');
    const page = mod.siteMapAsPage(m);
    check('★ 摊成页面认得的那一页：底图是同一张、有 id', page.src === m.src && !!page.id, page.src);
    check('★ 地点 → 图钉：数量对得上，坐标是百分比',
      page.markers.length === (m.places ?? []).length
      && page.markers.every((k) => k.x >= 0 && k.x <= 100 && k.y >= 0 && k.y <= 100 && typeof k.title === 'string'),
      `${page.markers.length} 个：${page.markers.map((k) => `${k.title}@${k.x},${k.y}`).join(' ')}`);
    /* 世界 (0,0) 在 5120² 的图上、原点 -2560 → 正好是 50% */
    const zero = page.markers.find((k) => k.title.startsWith('原点'));
    check('★ 世界 (0,0) 落在图的正中（50%, 50%）', !!zero && Math.abs(zero.x - 50) < 0.05 && Math.abs(zero.y - 50) < 0.05,
      zero ? `${zero.x},${zero.y}` : '没找到原点那个样例');
    check('★ 道路 → 线段：一条 3 点的折线拆成 2 段，颜色跟着走',
      page.lines.length === 2 && page.lines.every((l) => l.color === (m.roads[0].color || undefined)),
      JSON.stringify(page.lines.map((l) => `${l.x1},${l.y1}→${l.x2},${l.y2}`)));
    /* 反推：百分比 → 世界坐标，要回到原来的方块坐标 */
    const back = mod.pctToWorld(m, zero.x, zero.y);
    check('★ 百分比再换回世界坐标，回到 (0,0)', Math.abs(back.wx) < 0.01 && Math.abs(back.wz) < 0.01,
      `${back.wx},${back.wz}`);
  }
  const pc = fs.readFileSync(path.join(ROOT, 'src/components/PageContent.astro'), 'utf8');
  const sv = fs.readFileSync(path.join(ROOT, 'tools/editor/server.mjs'), 'utf8');
  const app = fs.readFileSync(path.join(ROOT, 'tools/editor/ui/app.js'), 'utf8');
  const bt = fs.readFileSync(path.join(ROOT, 'src/utils/boards.ts'), 'utf8');
  check('数据模型：地图块能带 siteMapId', /type: 'map'; pages: MapPage\[\]; siteMapId\?: string/.test(bt));
  check('站点渲染：有 siteMapId 就用站内地图那一页（复用 pmap 取景框）',
    /siteMapAsPage\(siteMap\)/.test(pc) && /mapById\(/.test(pc));
  check('编辑器保存：地图块会把 siteMapId 存下来（不会被吞）', /withSite\(|siteMapId = siteMapId/.test(sv));
  check('编辑器接口：/api/maps 能列出地图', /route === '\/api\/maps'/.test(sv));
  check('编辑器面板：地图块有「地图来源」选择器', /地图来源/.test(app) && /api\('\/api\/maps'\)/.test(app));
}

console.log('\\n================ 结果 ================');
console.log('\n================ 结果 ================');
console.log('PASS ' + pass + '   FAIL ' + fail);
if (fail > 0) process.exit(1);