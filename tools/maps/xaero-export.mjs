/*
 * ============================================================================
 * 把 Xaero 的 World Map 导成网站能用的地图图 + 锚点（2026-10-15）
 * ----------------------------------------------------------------------------
 * 站长原话：
 *   「我需要编辑的地图是 …versions\篠花娅风尚 这个ip为 h1.getmc.cn:35569 的服务器存档的
 *    Xaero地图 你看看能不能直接把它导出来 另外有一点非常需要注意：可以锚定地图的原点
 *    因为Xaero地图随着我的城建会不断更新 不能每次更新后让我画的道路标记失效
 *    所以就算是换图片 道路标记的坐标位置也会相对于锚定的原点不动」
 *
 * 怎么导：Xaero 的世界地图把每个 512×512 块的分区打包成 `<X>_<Z>.zip`，里面一个
 * `region.xaero`（zlib 压缩的 64×64 RGBA8 叶/分支瓦片）。解码是社区工具
 * `xwm2png`（tools/maps/xwm2png.exe，GPL/开源，见同目录的 xwm2png-README.md）——
 * 它一次就能把整个维度拼成 `full.png`（level-0，1 像素 = 1 块）并写出 `meta.json`
 * （里面 `blocks.minX/maxX/minZ/maxZ` 就是我们要的锚点）。
 *
 * ⚠ 这个脚本的**核心承诺**：重新导出（城建长大之后）**绝不会**丢掉已经画好的道路/地点。
 * 每次只更新图和数据里的锚点（origin / blocksPerPixel / 尺寸），`roads` / `places`
 * 原样保留 —— 那些东西存的是**世界方块坐标**，跟图怎么变没关系。
 *
 * 用法：
 *   node tools/maps/xaero-export.mjs                # 默认导出两个维度（城建用 full，主世界用 overview）
 *   node tools/maps/xaero-export.mjs --check        # 只看会做什么，不动文件
 *   node tools/maps/xaero-export.mjs --dim huaya$superflat
 *   node tools/maps/xaero-export.mjs --world "E:\…\Multiplayer_h1.getmc.cn" --in .tmp/xaero-out
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const EXE = path.join(HERE, 'xwm2png.exe');
const DATA = path.join(ROOT, 'src', 'data', 'maps.json');
const OUT_PUBLIC = path.join(ROOT, 'public', 'maps');

/** 默认：这两个维度各出一张（城建世界全分辨率，主世界用 8 块/像素的缩图） */
const DEFAULT_DIMS = [
  { dim: 'huaya$superflat', slug: 'huaya-superflat', name: '篠花娅 · 超平坦城建', image: 'full.png' },
  { dim: 'null', slug: 'huaya-overworld', name: '篠花娅 · 主世界（总览）', image: 'overview.png' },
];

const args = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const CHECK_ONLY = args.includes('--check');
const WORLD = argOf('world', 'E:\\Minecraft\\.minecraft\\versions\\篠花娅风尚\\xaero\\world-map\\Multiplayer_h1.getmc.cn');
const CACHE = argOf('in', path.join(ROOT, '.tmp', 'xaero-out'));
const ONLY = argOf('dim', '');
const today = () => {
  const d = new Date(Date.now() + 8 * 3600 * 1000);   // 北京时间
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

const log = (s) => console.log(s);

/* ------------------------------------------------------------------ ① 解码 */
function decode() {
  if (!fs.existsSync(EXE)) {
    throw new Error(`找不到 ${EXE}（xwm2png.exe）。它是开源工具，见同目录 xwm2png-README.md`);
  }
  if (!fs.existsSync(WORLD)) throw new Error(`Xaero 地图根目录不存在：${WORLD}`);
  log(`解码：${WORLD}`);
  log(`输出：${CACHE}`);
  if (CHECK_ONLY) return;
  const out = execFileSync(EXE, ['all', '-i', WORLD, '-o', CACHE], {
    encoding: 'utf8',
    windowsHide: true,          // 别弹黑框（站长点过名）
    maxBuffer: 32 * 1024 * 1024,
  });
  for (const line of out.split(/\r?\n/).filter(Boolean)) log(`   ${line}`);
}

/* -------------------------------------------------- ② 收进 public + 锚点 */
async function importDim(cfg, maps) {
  const metaFile = path.join(CACHE, cfg.dim, 'meta.json');
  const imgFile = path.join(CACHE, cfg.dim, cfg.image);
  if (!fs.existsSync(metaFile) || !fs.existsSync(imgFile)) {
    log(`跳过 ${cfg.dim}：没找到 ${cfg.image} 或 meta.json（先跑一次不带 --in 的导出）`);
    return null;
  }
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const b = meta.blocks;
  const wBlocks = b.maxX - b.minX;
  const hBlocks = b.maxZ - b.minZ;
  const probe = await sharp(imgFile).metadata();
  if (!probe.width || !probe.height) throw new Error(`${imgFile} 读不出尺寸`);
  /* 一个像素代表多少块（full 是 1，overview 是 8）——用块数/像素数现算，别写死 */
  const scaleX = wBlocks / probe.width;
  const scaleZ = hBlocks / probe.height;
  if (Math.abs(scaleX - scaleZ) > 0.01) {
    log(`   ⚠ ${cfg.dim} 横竖比例不一致（${scaleX} vs ${scaleZ}），按横向的算`);
  }
  const blocksPerPixel = Math.round(scaleX * 1000) / 1000;
  const outName = `${cfg.slug}.webp`;
  const outFile = path.join(OUT_PUBLIC, outName);
  if (!CHECK_ONLY) {
    fs.mkdirSync(OUT_PUBLIC, { recursive: true });
    /* WebP 质量 82：地图是像素画，这个档位肉眼看不出损失，体积能小一大截 */
    await sharp(imgFile).webp({ quality: 82, effort: 5 }).toFile(outFile);
  }
  const size = fs.existsSync(outFile) ? fs.statSync(outFile).size : 0;
  const prev = maps.find((m) => m.id === cfg.slug) ?? {};
  const next = {
    id: cfg.slug,
    name: prev.name || cfg.name,
    /* 路线 / 地点一个都不许丢：它们存的是世界坐标，跟图怎么换没关系 */
    ...prev,
    id: cfg.slug,
    name: prev.name || cfg.name,
    dimension: cfg.dim,
    src: `/maps/${outName}`,
    width: probe.width,
    height: probe.height,
    originX: b.minX,
    originZ: b.minZ,
    blocksPerPixel,
    source: cfg.image,
    exportedAt: today(),
  };
  next.roads = Array.isArray(prev.roads) ? prev.roads : [];
  next.places = Array.isArray(prev.places) ? prev.places : [];
  log(`   ${cfg.dim} → public/maps/${outName}  ${probe.width}×${probe.height}（${blocksPerPixel} 块/像素）`
    + ` 方块 X[${b.minX},${b.maxX}) Z[${b.minZ},${b.maxZ})  ${(size / 1024).toFixed(1)} KB`
    + `  已有标注：道路 ${next.roads.length} 条 / 地点 ${next.places.length} 个`);
  return next;
}

/* ------------------------------------------------------------------ ③ 写数据 */
function writeData(maps) {
  const doc = {
    _readme: [
      '地图（编辑器「地图」面板 + 页面「地图」块都用这一份）。由 tools/maps/xaero-export.mjs 维护。',
      '⚠ 道路 / 地点存的是**世界方块坐标**（wx / wz），不是像素：换底图（重新导出 Xaero）后会自动回到原位。',
      'originX / originZ = 图片左上角那个像素对应的世界方块坐标；blocksPerPixel = 一个像素代表几块。',
      '像素 ↔ 方块：px = (wx - originX) / blocksPerPixel，py = (wz - originZ) / blocksPerPixel。',
      'roads = 折线（points 是世界坐标数组）；places = 一个点（wx / wz + 名字 / 颜色 / 图标）。',
      '手改这份文件没问题，但**别动 origin / blocksPerPixel**，除非你重新导出的图范围变了。',
    ],
    updated: today(),
    maps,
  };
  fs.writeFileSync(DATA, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  log(`写出 ${path.relative(ROOT, DATA)}：${maps.length} 张图`);
}

/* ------------------------------------------------------------------ 主流程 */
log(`模式：${CHECK_ONLY ? '只看（不动文件）' : '真导出'}`);
decode();

const old = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, 'utf8')) : { maps: [] };
const oldMaps = Array.isArray(old.maps) ? old.maps : [];
const list = DEFAULT_DIMS.filter((d) => !ONLY || d.dim === ONLY || d.slug === ONLY);
const next = [];
for (const cfg of list) {
  const one = await importDim(cfg, oldMaps);
  if (one) next.push(one);
}
/* 别的维度（没参与这次导出）原样保留，别把它们删了 */
for (const m of oldMaps) {
  if (!next.some((n) => n.id === m.id)) next.push(m);
}
if (!CHECK_ONLY) writeData(next);
else log('（--check：什么都没写）');
