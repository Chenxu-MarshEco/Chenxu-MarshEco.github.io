#!/usr/bin/env node
/**
 * ============================================================================
 * 「疑问的雕像」彩蛋剪影生成器
 * ----------------------------------------------------------------------------
 * 从 tools/egg/source.png（用户给的立绘）做出主页天空里那个彩蛋用的两张图：
 *
 *   public/img/home/statue.png        身体（翅膀已经挖掉）
 *   public/img/home/statue-wing.png   翅膀（同尺寸同原点，叠上去就对得上）
 *
 * 翅膀单独一层是为了能扇动：主页里这一层绕根部来回转 ±10°，身体那张画在上层，
 * 压住翅膀根部，看起来才像从背后长出来的。
 *
 * 怎么跑：
 *   node tools/egg/build-sprite.mjs                 # 默认读 tools/egg/source.png
 *   node tools/egg/build-sprite.mjs 别的图.png 200   # 指定图 / 成品宽度
 *   node tools/egg/build-sprite.mjs --preview       # 额外输出三姿势预览图
 *
 * ── 这张图的三个坑（都踩过，别再踩）─────────────────────────────────────
 * 1. **棋盘格是画进像素里的，没有 alpha 通道**。而且判据不能是「等于棋盘两色之一」：
 *    生物身体是白的、和亮格同色，洪泛一漏进身体，整块白体都会被当成背景
 *    （实测前景只剩 15%，全是线稿）。要用**棋盘的周期规律**判：36px 周期、18px 方块、
 *    相位是算出来的，于是每个像素"该是亮格还是暗格"是已知的；身体内部那些碰巧同色的
 *    像素被四周不匹配的像素围住，洪泛进不去，整块身体就保住了。
 *    再用「非棋盘像素膨胀 2px」把 1px 线稿上的缝封住，然后从边界洪泛取补集 —— 得到实心剪影。
 * 2. **必须在原分辨率上抠图**。先缩图会把棋盘重采样成 248/200 这类过渡色，
 *    严格的图案判据当场失效（实测非棋盘像素从 20% 涨到 73%，整张图都被当前景）。
 * 3. **sharp.resize() 会把单通道灰度提升成 3 通道**，照 1 字节/像素索引就会整体错位，
 *    表现是横条纹（150×238 里有 75 行全空、0/非空跳变 111 次，翅膀那张甚至整张全空）。
 *    所以下面一律按 info.channels 索引。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const WANT_PREVIEW = process.argv.includes('--preview');
const SRC = args[0] ? path.resolve(args[0]) : path.join(HERE, 'source.png');
const OUT_W = Number(args[1] ?? 150);
const OUT_BODY = path.join(ROOT, 'public/img/home/statue.png');
const OUT_WING = path.join(ROOT, 'public/img/home/statue-wing.png');

/**
 * 翅膀的范围：这六边形是**画在原图上、肉眼核对过正好罩住那只灰翅膀**的
 * （含左侧尖端与上方的爪尖，不含白色的胸腹）。换图就得重新核对。
 */
const WING_POLY = [
  [42, 192],
  [56, 166],
  [118, 166],
  [133, 196],
  [106, 226],
  [58, 214],
];
/** 翅膀根部（靠身体那一侧），既是切分参考点，也是动画的旋转轴 */
const PIVOT = { x: 124, y: 196 };
/** 根轴周围这一圈补回身体层：扇动时根部不露缝（离轴近，转起来几乎不动） */
const FILL_R = 10;

const t0 = Date.now();
const { data, info } = await sharp(fs.readFileSync(SRC)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, C = info.channels;
console.log(`源图 ${path.relative(ROOT, SRC)}  ${W}×${H}`);

// ── 棋盘两色 + 相位 ──────────────────────────────────────────────────────
const hist = new Map();
for (let y = 0; y < Math.min(60, H); y++) for (let x = 0; x < Math.min(60, W); x++) {
  const i = (y * W + x) * C;
  const k = `${data[i]},${data[i + 1]},${data[i + 2]}`;
  hist.set(k, (hist.get(k) || 0) + 1);
}
const sorted = [...hist.entries()].sort((a, b) => b[1] - a[1]);
const c1 = sorted[0][0].split(',').map(Number);
const c2 = (sorted.find(([k]) => {
  const [r, g, b] = k.split(',').map(Number);
  return Math.abs(r - c1[0]) > 20 || Math.abs(g - c1[1]) > 20 || Math.abs(b - c1[2]) > 20;
}) || sorted[1])[0].split(',').map(Number);
const lumOf = (c) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
const cbDark = lumOf(c1) < lumOf(c2) ? c1 : c2;
const cbLight = lumOf(c1) < lumOf(c2) ? c2 : c1;
const eq = (x, y, c) => {
  const i = (y * W + x) * C;
  return Math.abs(data[i] - c[0]) <= 8 && Math.abs(data[i + 1] - c[1]) <= 8 && Math.abs(data[i + 2] - c[2]) <= 8;
};
let phX = 0, phY = 0;
for (let x = 0; x < 40; x++) if (eq(x, 20, cbDark)) { phX = x; break; }
for (let y = 0; y < 40; y++) if (eq(20, y, cbDark)) { phY = y; break; }
const TILE = 18;
console.log(`棋盘 亮${cbLight.join(',')} 暗${cbDark.join(',')} 相位(${phX},${phY}) 方块 ${TILE}px`);

const isPattern = (x, y) => {
  const ix = Math.floor((x - phX) / TILE), iy = Math.floor((y - phY) / TILE);
  const want = (ix + iy) % 2 === 0 ? cbDark : cbLight;
  const i = (y * W + x) * C;
  return Math.abs(data[i] - want[0]) <= 10 && Math.abs(data[i + 1] - want[1]) <= 10 && Math.abs(data[i + 2] - want[2]) <= 10;
};

// ── 非棋盘 → 膨胀 → 边界洪泛 → 补集（实心剪影）────────────────────────────
const N = W * H;
const m = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = isPattern(x, y) ? 0 : 1;

/** 可分离的最大值滤波（方形结构元）；horiz=true 走横向那趟 */
function maxF(src, r, horiz) {
  const o = new Uint8Array(N);
  if (horiz) {
    for (let y = 0; y < H; y++) {
      const row = y * W; let c = 0;
      for (let x = 0; x < W + r; x++) {
        if (x < W && src[row + x]) c++;
        if (x - 2 * r - 1 >= 0 && src[row + x - 2 * r - 1]) c--;
        const ox = x - r;
        if (ox >= 0 && ox < W) o[row + ox] = c > 0 ? 1 : 0;
      }
    }
  } else {
    for (let x = 0; x < W; x++) {
      let c = 0;
      for (let y = 0; y < H + r; y++) {
        if (y < H && src[y * W + x]) c++;
        if (y - 2 * r - 1 >= 0 && src[(y - 2 * r - 1) * W + x]) c--;
        const oy = y - r;
        if (oy >= 0 && oy < H) o[oy * W + x] = c > 0 ? 1 : 0;
      }
    }
  }
  return o;
}
const dil = maxF(maxF(m, 2, true), 2, false);
const bg = new Uint8Array(N);
const queue = new Int32Array(N);
let qh = 0, qt = 0;
const seed = (i) => { if (!bg[i] && !dil[i]) { bg[i] = 1; queue[qt++] = i; } };
for (let x = 0; x < W; x++) { seed(x); seed((H - 1) * W + x); }
for (let y = 0; y < H; y++) { seed(y * W); seed(y * W + W - 1); }
while (qh < qt) {
  const j = queue[qh++]; const jx = j % W, jy = (j - jx) / W;
  if (jx + 1 < W) seed(j + 1);
  if (jx > 0) seed(j - 1);
  if (jy + 1 < H) seed(j + W);
  if (jy > 0) seed(j - W);
}
const keep = new Uint8Array(N);
for (let i = 0; i < N; i++) keep[i] = bg[i] ? 0 : 1;
let minX = W, maxX = -1, minY = H, maxY = -1;
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (keep[y * W + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
}
console.log(`剪影 ${maxX - minX + 1}×${maxY - minY + 1}（bbox x${minX}..${maxX} y${minY}..${maxY}）  ${Date.now() - t0}ms`);

// ── 切翅膀 ──────────────────────────────────────────────────────────────
const inPoly = (x, y) => {
  let inside = false;
  for (let i = 0, j = WING_POLY.length - 1; i < WING_POLY.length; j = i++) {
    const [xi, yi] = WING_POLY[i], [xj, yj] = WING_POLY[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const wing = new Uint8Array(N), base = new Uint8Array(N);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x;
  if (!keep[i]) continue;
  if (inPoly(x, y) && Math.hypot(x - PIVOT.x, y - PIVOT.y) > FILL_R) wing[i] = 1;
  else base[i] = 1;
}
let wn = 0, bn = 0;
for (let i = 0; i < N; i++) { if (wing[i]) wn++; if (base[i]) bn++; }
console.log(`切分：身体 ${bn} px，翅膀 ${wn} px（根轴 ${PIVOT.x},${PIVOT.y}，补缝半径 ${FILL_R}）`);

// ── 裁到剪影 bbox（留 2px）后缩到目标宽度，写成墨色剪影 ──────────────────
const PAD = 2;
const cw = maxX - minX + 1 + PAD * 2;
const ch = maxY - minY + 1 + PAD * 2;
const scale = OUT_W / cw;
const outH = Math.max(1, Math.round(ch * scale));

async function writeSprite(mask, outPath) {
  const crop = Buffer.alloc(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sx = minX - PAD + x, sy = minY - PAD + y;
    crop[y * cw + x] = (sx >= 0 && sy >= 0 && sx < W && sy < H && mask[sy * W + sx]) ? 255 : 0;
  }
  const small = await sharp(crop, { raw: { width: cw, height: ch, channels: 1 } })
    .resize({ width: OUT_W })
    .blur(0.4)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const chn = small.info.channels; // ⚠ 别假设是 1（见文件头第 3 条）
  const rgba = Buffer.alloc(OUT_W * outH * 4);
  for (let i = 0; i < OUT_W * outH; i++) {
    rgba[i * 4] = 8; rgba[i * 4 + 1] = 2; rgba[i * 4 + 2] = 12; // = --ink #08020c
    rgba[i * 4 + 3] = small.data[i * chn];
  }
  const buf = await sharp(rgba, { raw: { width: OUT_W, height: outH, channels: 4 } })
    .png({ compressionLevel: 9, effort: 10 })
    .toBuffer();
  fs.writeFileSync(outPath, buf);
  return { buf, small: small.data, chn };
}

const B = await writeSprite(base, OUT_BODY);
const Wg = await writeSprite(wing, OUT_WING);
const px = (PIVOT.x - (minX - PAD)) * scale;
const py = (PIVOT.y - (minY - PAD)) * scale;
console.log(`\n成品 ${OUT_W}×${outH}（缩放 ${scale.toFixed(3)}）`);
console.log(`  ${path.relative(ROOT, OUT_BODY)}  ${(B.buf.length / 1024).toFixed(1)} KB`);
console.log(`  ${path.relative(ROOT, OUT_WING)}  ${(Wg.buf.length / 1024).toFixed(1)} KB`);
console.log(`  HomeBirds.astro 里的 transform-origin 应当是：${((px / OUT_W) * 100).toFixed(1)}% ${((py / outH) * 100).toFixed(1)}%`);

if (WANT_PREVIEW) {
  const poses = [-13, 0, 11];
  const gap = 16;
  const PW = OUT_W * poses.length + gap * (poses.length - 1);
  const canvas = Buffer.alloc(PW * outH * 4);
  for (let i = 0; i < PW * outH; i++) { canvas[i * 4] = 238; canvas[i * 4 + 1] = 240; canvas[i * 4 + 2] = 245; canvas[i * 4 + 3] = 255; }
  const rad = (d) => (d * Math.PI) / 180;
  for (let p = 0; p < poses.length; p++) {
    const [cos, sin] = [Math.cos(rad(poses[p])), Math.sin(rad(poses[p]))];
    const ox = p * (OUT_W + gap);
    for (let y = 0; y < outH; y++) for (let x = 0; x < OUT_W; x++) {
      const dx = x - px, dy = y - py;
      const sx = Math.round(px + dx * cos + dy * sin), sy = Math.round(py - dx * sin + dy * cos);
      const wingA = (sx >= 0 && sy >= 0 && sx < OUT_W && sy < outH ? Wg.small[(sy * OUT_W + sx) * Wg.chn] : 0) / 255;
      const bodyA = B.small[(y * OUT_W + x) * B.chn] / 255;
      const i = (y * PW + ox + x) * 4;
      let r = 238, g = 240, b = 245;
      if (bodyA > 0) { r = r * (1 - bodyA) + 8 * bodyA; g = g * (1 - bodyA) + 2 * bodyA; b = b * (1 - bodyA) + 12 * bodyA; }
      if (wingA > 0) { r = r * (1 - wingA) + 200 * wingA; g = g * (1 - wingA) + 40 * wingA; b = b * (1 - wingA) + 40 * wingA; }
      canvas[i] = Math.round(r); canvas[i + 1] = Math.round(g); canvas[i + 2] = Math.round(b);
    }
  }
  const dest = path.join(ROOT, '.tmp', 'egg-preview.png');
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await sharp(canvas, { raw: { width: PW, height: outH, channels: 4 } }).png().toFile(dest);
  console.log(`  预览（翅膀 ${poses.join('° / ')}°）：${path.relative(ROOT, dest)}`);
}
console.log(`共 ${Date.now() - t0}ms`);
