#!/usr/bin/env node
/**
 * ============================================================================
 * 水族缸素材烘焙（首页「涣愿终池」大卡里那口缸用）
 * ----------------------------------------------------------------------------
 * 从装好的 Marine Aquarium 3 屏保里把贴图解出来，烘成 `public/img/aquarium/`
 * 下那几个 WebP。**只在资源要重做的时候跑**，不是构建的一部分：
 * 产物已经进仓库，构建不依赖这个脚本、也不依赖本机装没装 MA3。
 *
 *   node tools/images/aquarium-bake.mjs
 *   node tools/images/aquarium-bake.mjs --scr "D:\\另一个路径\\MarineAquarium3.scr"
 *
 * 产出的东西：
 *   reef.webp            整张背景板（水体渐变 + 砂底 + 礁石 + 珊瑚，1200×656）
 *   caustic.webp         水底光网（自己算的，无缝）
 *   bubbles.webp         气泡柱
 *   fish-<名字>.webp     十条鱼（带 alpha）
 *   fish-<名字>-far.webp 同样十条，压过对比的，给远处的鱼用
 *
 * 几个坑，改之前先读：
 *
 *  ① **DXT3 的 alpha 和 DXT5 不是一回事。**
 *     DXT3 是 8 字节 = 16 个 4 位值；DXT5 才是"两个端点 + 48 位 3 位索引"。
 *     早先这里按 DXT5 解 DXT3，每条鱼边上都糊一圈方块毛刺。
 *
 *  ② **不能用 ctx.filter 做远处的鱼。**
 *     实测 canvas 的 filter 会把一次 drawImage 从 0.1ms 抬到 8ms（整帧 2→159ms）。
 *     所以"压过对比"的那份在构建时就烘进图里。
 *
 *  ③ **鱼贴图全都朝左。**
 *     运行时往右游要水平镜像 —— 这个和游动方向不是一回事。
 *
 *  ④ 礁石不能直接摆图集切出来的精灵：精灵的边界就是图集格子的边界，
 *     摆上去会留下笔直的竖边。所以是"一整条岩带 + 一块碎边轮廓遮罩"。
 * ============================================================================
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'public', 'img', 'aquarium');
const TMP = path.join(ROOT, '.tmp', 'aquarium');

const argScr = process.argv.indexOf('--scr');
const SCR = argScr > 0
  ? process.argv[argScr + 1]
  : 'C:\\Windows\\System32\\MarineAquarium3.scr';

const log = (s) => console.log(s);

/* ------------------------------------------------------------------ DDS */

function c565(c) {
  return [
    (((c >> 11) & 31) * 255) / 31,
    (((c >> 5) & 63) * 255) / 63,
    ((c & 31) * 255) / 31,
  ];
}

function colorBlock(buf, off, dxt1) {
  const c0 = buf.readUInt16LE(off);
  const c1 = buf.readUInt16LE(off + 2);
  const idx = buf.readUInt32LE(off + 4);
  const p0 = c565(c0);
  const p1 = c565(c1);
  const pal = [p0, p1];
  let punch = -1;
  if (dxt1) {
    if (c0 > c1) {
      pal.push([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3]);
      pal.push([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]);
    } else {
      pal.push([(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2]);
      pal.push([0, 0, 0]);
      punch = 3;
    }
  } else {
    pal.push([(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3]);
    pal.push([(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3]);
  }
  const rgbs = [];
  const alpha = [];
  for (let i = 0; i < 16; i++) {
    const ci = (idx >> (i * 2)) & 3;
    rgbs.push(pal[ci]);
    alpha.push(ci === punch ? 0 : 255);
  }
  return { rgbs, alpha };
}

/** DXT3：8 字节 16 个 4 位 alpha（低半字节是偶数号像素） */
function alphaDxt3(buf, off) {
  const a = [];
  for (let i = 0; i < 16; i++) {
    const byte = buf[off + (i >> 1)];
    a.push(((i & 1) === 0 ? byte & 0x0f : (byte >> 4) & 0x0f) * 17);
  }
  return a;
}

/** DXT5：两个端点 + 48 位 3 位索引 */
function alphaDxt5(buf, off) {
  const a0 = buf[off];
  const a1 = buf[off + 1];
  const table = [a0, a1];
  if (a0 > a1) {
    for (let i = 1; i <= 6; i++) table.push(Math.round(((7 - i) * a0 + i * a1) / 7));
  } else {
    for (let i = 1; i <= 4; i++) table.push(Math.round(((5 - i) * a0 + i * a1) / 5));
    table.push(0, 255);
  }
  const res = [];
  for (let i = 0; i < 16; i++) {
    const bit = i * 3;
    const bp = off + 2 + (bit >> 3);
    const sh = bit & 7;
    let v = buf[bp] >> sh;
    if (sh > 5 && bp + 1 < buf.length) v |= buf[bp + 1] << (8 - sh);
    res.push(table[v & 7]);
  }
  return res;
}

function decodeDds(buf, w, h, fourcc) {
  const px = Buffer.alloc(w * h * 4);
  const bw = Math.max(1, Math.ceil(w / 4));
  const bh = Math.max(1, Math.ceil(h / 4));
  const dxt1 = fourcc === 'DXT1';
  const blockSize = dxt1 ? 8 : 16;
  let off = 128;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      if (off + blockSize > buf.length) break;
      let alpha = null;
      if (fourcc === 'DXT3') { alpha = alphaDxt3(buf, off); off += 8; }
      else if (fourcc === 'DXT5') { alpha = alphaDxt5(buf, off); off += 8; }
      const col = colorBlock(buf, off, dxt1);
      off += 8;
      const al = alpha ?? col.alpha;
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i % 4);
        const y = by * 4 + ((i / 4) | 0);
        if (x >= w || y >= h) continue;
        const o = (y * w + x) * 4;
        const c = col.rgbs[i];
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = al[i];
      }
    }
  }
  return px;
}

/** 在 .scr 里扫 "DDS " 魔数，按块尺寸算出每张图落在哪一段 */
function findDds(buf) {
  const found = [];
  for (let i = 0; i < buf.length - 128; i++) {
    if (buf[i] !== 0x44 || buf[i + 1] !== 0x44 || buf[i + 2] !== 0x53 || buf[i + 3] !== 0x20) continue;
    const h = buf.readUInt32LE(i + 12);
    const w = buf.readUInt32LE(i + 16);
    const fourcc = buf.toString('ascii', i + 84, i + 88);
    const blockSize = fourcc === 'DXT1' ? 8 : 16;
    if (!['DXT1', 'DXT3', 'DXT5'].includes(fourcc)) continue;
    if (!w || !h || w > 4096 || h > 4096) continue;
    const size = 128 + Math.ceil(w / 4) * Math.ceil(h / 4) * blockSize;
    if (i + size > buf.length) continue;
    found.push({ start: i, end: i + size, w, h, fourcc });
    i += size - 1;
  }
  return found;
}

/* ------------------------------------------------------- 连通区域切图集 */

/** 4 邻域连通区域，返回 { lab, boxes } */
function components(data, w, h, thr) {
  const n = w * h;
  const lab = new Int32Array(n).fill(-1);
  const boxes = [];
  const stack = [];
  for (let s = 0; s < n; s++) {
    if (lab[s] !== -1 || data[s * 4 + 3] <= thr) continue;
    const id = boxes.length;
    let x0 = w, y0 = h, x1 = -1, y1 = -1, count = 0;
    stack.push(s); lab[s] = id;
    while (stack.length) {
      const i = stack.pop();
      const x = i % w;
      const y = (i / w) | 0;
      count++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
      for (const j of nb) {
        if (j < 0 || lab[j] !== -1 || data[j * 4 + 3] <= thr) continue;
        lab[j] = id; stack.push(j);
      }
    }
    boxes.push({ id, x0, y0, x1, y1, count });
  }
  return { lab, boxes };
}

/* ------------------------------------------------------------- 鱼的处理 */

/** 只留最大的一块连通区域（先腐蚀切断细桥，再腐蚀回来） */
function biggestBlob(data, w, h, thr = 10) {
  const n = w * h;
  const a0 = new Uint8Array(n);
  for (let i = 0; i < n; i++) a0[i] = data[i * 4 + 3];
  const morph = (src, r, min) => {
    const out = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let v = min ? 255 : 0;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { if (min) v = 0; continue; }
          for (let dx = -r; dx <= r; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) { if (min) v = 0; continue; }
            const s = src[yy * w + xx];
            if (min ? s < v : s > v) v = s;
          }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  };
  const eroded = morph(a0, 2, true);
  const { lab, boxes } = components(
    Array.from({ length: n }, (_, i) => [0, 0, 0, eroded[i]]).flat(),
    w, h, thr,
  );
  if (!boxes.length) return data;
  const max = Math.max(...boxes.map((b) => b.count));
  const grow = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const l = lab[i];
    if (l >= 0 && boxes[l].count >= max * 0.3) grow[i] = 255;
  }
  const grown = morph(grow, 2, false);
  for (let i = 0; i < n; i++) data[i * 4 + 3] = Math.min(a0[i], grown[i]);
  return data;
}

/** 裁到 alpha 的内容框 */
function trimRaw(data, W, H, thr = 8) {
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * 4 + 3] > thr) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { buf: data, w: W, h: H };
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    data.copy(buf, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0) * 4 + w * 4);
  }
  return { buf, w, h };
}

/**
 * 清边：抬掉低 alpha 的灰雾 + 腐蚀 1px + 把颜色往外扩。
 * DXT 会把透明像素的 RGB 弄成脏值，浏览器双线性采样时那团脏值会渗进边缘，
 * 鱼身边上就多一圈白边/绿边。
 */
function defringe(data, w, h, erode = 1) {
  const n = w * h;
  const LO = 64;
  for (let i = 0; i < n; i++) {
    const v = data[i * 4 + 3];
    data[i * 4 + 3] = v <= LO ? 0 : Math.min(255, Math.round(((v - LO) * 255) / (255 - LO)));
  }
  const a = new Uint8Array(n);
  for (let i = 0; i < n; i++) a[i] = data[i * 4 + 3];
  if (erode > 0) {
    const e = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let m = 255;
        for (let dy = -erode; dy <= erode && m > 0; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) { m = 0; break; }
          for (let dx = -erode; dx <= erode; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) { m = 0; break; }
            if (a[yy * w + xx] < m) m = a[yy * w + xx];
          }
        }
        e[y * w + x] = m;
      }
    }
    for (let i = 0; i < n; i++) { data[i * 4 + 3] = e[i]; a[i] = e[i]; }
  }
  // 颜色往外扩（只动 RGB）
  const filled = new Uint8Array(n);
  for (let i = 0; i < n; i++) filled[i] = a[i] > 0 ? 1 : 0;
  const pass = new Uint8Array(n);
  for (let round = 0; round < 24; round++) {
    let changed = 0;
    pass.fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (filled[i]) continue;
        let r = 0, g = 0, b = 0, c = 0;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const j = yy * w + xx;
            if (!filled[j]) continue;
            r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; c++;
          }
        }
        if (c) {
          data[i * 4] = Math.round(r / c);
          data[i * 4 + 1] = Math.round(g / c);
          data[i * 4 + 2] = Math.round(b / c);
          pass[i] = 1;
          changed++;
        }
      }
    }
    for (let i = 0; i < n; i++) if (pass[i]) filled[i] = 1;
    if (!changed) break;
  }
  return data;
}

/* --------------------------------------------------------------- 常量表 */

/** DDS 序号 → 鱼名。这些编号是 MA3 内嵌的顺序，不会变 */
const FISH = [
  [1, 'tang-brown', 220],
  [32, 'tang-blue', 220],
  [5, 'angel-emperor', 176],
  [49, 'idol', 170],
  [35, 'butterfly-copper', 150],
  [46, 'butterfly-raccoon', 150],
  [22, 'angel-flame', 126],
  [30, 'clown', 132],
  [50, 'tang-yellow', 140],
  [27, 'angel-juvenile', 124],
];

const W = 1200;
const H = 656;
const SAND = Math.round(H * 0.62);

/** 确定性伪随机（每次烘出来的东西一模一样） */
function makeNoise(seed) {
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const o1 = rnd() * 6.283, o2 = rnd() * 6.283, o3 = rnd() * 6.283;
  return (x) => Math.sin(x / 47 + o1) * 0.5 + Math.sin(x / 19 + o2) * 0.3 + Math.sin(x / 91 + o3) * 0.5;
}

/** 礁石上沿那几个峰：[中心 x, 峰顶 y, 宽度] */
const TOPS = [
  [150, H - 214, 300],
  [420, H - 128, 250],
  [690, H - 100, 220],
  [980, H - 230, 310],
  [1210, H - 168, 230],
];

function ridgeYAt(x) {
  const n = makeNoise(20261118);
  let y = SAND + 26;
  for (const [px, py, spread] of TOPS) {
    const d = (x - px) / spread;
    const w = Math.exp(-d * d * 1.6);
    y = Math.min(y, py + (1 - w) * 400);
  }
  return y + n(x) * 20;
}

function ridgePath() {
  const pts = [];
  for (let x = -40; x <= W + 40; x += 8) pts.push([x, ridgeYAt(x)]);
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
    + ` L${W + 40} ${H + 60} L-40 ${H + 60} Z`;
}

/* ------------------------------------------------------------------ 主流程 */

async function main() {
  if (!fs.existsSync(SCR)) {
    console.error(
      `找不到 MA3 屏保：${SCR}\n`
      + '　装好 Marine Aquarium 3 之后它会出现在 Windows 的 System32 里；\n'
      + '　装在别处就用 --scr 指过去。',
    );
    process.exit(2);
  }
  await fsp.mkdir(TMP, { recursive: true });
  await fsp.mkdir(OUT, { recursive: true });

  const scr = fs.readFileSync(SCR);
  const ddsList = findDds(scr);
  log(`屏保里找到 ${ddsList.length} 张 DDS`);

  /* 全部解出来放 .tmp，按 序号_宽x高_FOURCC 命名 */
  const atlas = new Map();
  for (let k = 0; k < ddsList.length; k++) {
    const d = ddsList[k];
    const name = `${String(k + 1).padStart(2, '0')}_${d.w}x${d.h}_${d.fourcc}`;
    const px = decodeDds(scr.subarray(d.start, d.end), d.w, d.h, d.fourcc);
    const file = path.join(TMP, `${name}.png`);
    await sharp(px, { raw: { width: d.w, height: d.h, channels: 4 } }).png().toFile(file);
    atlas.set(k + 1, { file, w: d.w, h: d.h });
  }

  const raw = async (n) => {
    const a = atlas.get(n);
    const { data, info } = await sharp(a.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data: Buffer.from(data), w: info.width, h: info.height };
  };

  /* ---- 鱼 ---- */
  for (const [idx, name, maxW] of FISH) {
    const r = await raw(idx);
    const main2 = biggestBlob(r.data, r.w, r.h, 10);
    const t = trimRaw(main2, r.w, r.h);
    const clean = defringe(Buffer.from(t.buf), t.w, t.h, 1);
    const scale = Math.min(1, maxW / t.w);
    const w = Math.round(t.w * scale);
    const h = Math.round(t.h * scale);
    const opts = { quality: 90, alphaQuality: 95, effort: 6 };
    const base = () => sharp(clean, { raw: { width: t.w, height: t.h, channels: 4 } })
      .resize(w, h, { kernel: 'lanczos3' });

    await base().webp(opts).toFile(path.join(OUT, `fish-${name}.webp`));
    await base().modulate({ saturation: 0.82, brightness: 0.9 }).webp(opts)
      .toFile(path.join(OUT, `fish-${name}-far.webp`));
    log(`  fish-${name}  ${t.w}x${t.h} → ${w}x${h}`);
  }

  /* ---- 焦散：抖动网格的 Voronoi 边界（环绕距离，所以无缝） ---- */
  {
    const S = 512;
    const N = 7;
    const cell = S / N;
    let seed = 20261118;
    const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
    const pts = [];
    for (let gy = 0; gy < N; gy++) {
      for (let gx = 0; gx < N; gx++) {
        pts.push([(gx + 0.15 + rand() * 0.7) * cell, (gy + 0.15 + rand() * 0.7) * cell]);
      }
    }
    const buf = Buffer.alloc(S * S * 4);
    const TAU = Math.PI * 2;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const u = x / S, v = y / S;
        // 揉一下坐标，边界才弯弯曲曲不像铁丝网
        const wx = x + Math.sin(TAU * (2 * v + u)) * cell * 0.34 + Math.sin(TAU * (3 * v - 2 * u) + 1.1) * cell * 0.16;
        const wy = y + Math.cos(TAU * (2 * u - v) + 0.7) * cell * 0.34 + Math.cos(TAU * (3 * u + 2 * v) + 2.3) * cell * 0.16;
        let d1 = 1e9, d2 = 1e9;
        for (const [px, py] of pts) {
          let dx = Math.abs(wx - px);
          let dy = Math.abs(wy - py);
          if (dx > S / 2) dx = S - dx;
          if (dy > S / 2) dy = S - dy;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
        }
        const a = Math.min(255, Math.round(255 * Math.exp(-(d2 - d1) / (cell * 0.055))));
        const o = (y * S + x) * 4;
        buf[o] = 255; buf[o + 1] = 255; buf[o + 2] = 255; buf[o + 3] = a;
      }
    }
    await sharp(buf, { raw: { width: S, height: S, channels: 4 } })
      .blur(1.1).resize(320, 320, { kernel: 'lanczos3' })
      .webp({ quality: 62, alphaQuality: 78, effort: 6 })
      .toFile(path.join(OUT, 'caustic.webp'));
    log('  caustic 320x320');
  }

  /* ---- 气泡柱（08 号贴图） ---- */
  {
    const r = await raw(8);
    const t = trimRaw(r.data, r.w, r.h, 4);
    await sharp(t.buf, { raw: { width: t.w, height: t.h, channels: 4 } })
      .webp({ quality: 88, alphaQuality: 94 })
      .toFile(path.join(OUT, 'bubbles.webp'));
    log(`  bubbles ${t.w}x${t.h}`);
  }

  /* ---- 背景板 ---- */
  {
    /** 把图集里某一块抠出来（按连通区域编号），缓存到 .tmp */
    const sliceCache = new Map();
    async function piece(atlasIdx, compIdx, wantW, opts = {}) {
      const key = `${atlasIdx}:${compIdx}:${wantW}:${JSON.stringify(opts)}`;
      if (sliceCache.has(key)) return sliceCache.get(key);
      const r = await raw(atlasIdx);
      const { lab, boxes } = components(r.data, r.w, r.h, 24);
      const keep = boxes
        .filter((b) => b.count > 900 && b.x1 - b.x0 > 24 && b.y1 - b.y0 > 24)
        .sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
      const b = keep[compIdx];
      if (!b) throw new Error(`图集 ${atlasIdx} 没有第 ${compIdx} 块`);
      const sw = b.x1 - b.x0 + 1;
      const sh = b.y1 - b.y0 + 1;
      const buf = Buffer.alloc(sw * sh * 4);
      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const si = (b.y0 + y) * r.w + (b.x0 + x);
          if (lab[si] !== b.id) continue;
          const di = (y * sw + x) * 4;
          buf[di] = r.data[si * 4];
          buf[di + 1] = r.data[si * 4 + 1];
          buf[di + 2] = r.data[si * 4 + 2];
          buf[di + 3] = r.data[si * 4 + 3];
        }
      }
      let img = sharp(buf, { raw: { width: sw, height: sh, channels: 4 } })
        .resize(wantW, Math.round((sh / sw) * wantW), { kernel: 'lanczos3' });
      let out = await img.png().toBuffer();
      if (opts.flip) out = await sharp(out).flop().png().toBuffer();
      const res = { input: out, h: Math.round((sh / sw) * wantW) };
      sliceCache.set(key, res);
      return res;
    }

    const grad = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="#1b5ea8"/><stop offset="0.24" stop-color="#1c5f9c"/>
            <stop offset="0.46" stop-color="#1f6289"/><stop offset="0.66" stop-color="#22657b"/>
            <stop offset="0.84" stop-color="#1f6a6e"/><stop offset="1" stop-color="#1c6a63"/>
          </linearGradient>
          <radialGradient id="glow" cx="0.5" cy="-0.05" r="0.8">
            <stop offset="0" stop-color="#8fd0ff" stop-opacity="0.42"/>
            <stop offset="0.5" stop-color="#4a9fe0" stop-opacity="0.1"/>
            <stop offset="1" stop-color="#1a5aa4" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#g)"/>
        <rect width="${W}" height="${H}" fill="url(#glow)"/>
      </svg>`,
    );

    const layers = [];

    /* 砂底：25 号图集第 0 块是一整片砂面 */
    {
      const sand = await piece(25, 0, W);
      const flat = await sharp(sand.input).flatten({ background: '#a99b82' })
        .resize(W, 150, { kernel: 'lanczos3' })
        .modulate({ brightness: 0.82, saturation: 0.62 })
        .ensureAlpha().raw().toBuffer();
      const bh = H - SAND + 30;
      const bed = Buffer.alloc(W * bh * 4);
      for (let x = 0; x < W; x++) {
        const lift = Math.round(14 * Math.sin(x / 240) + 8 * Math.sin(x / 83 + 1.3));
        for (let y = 0; y < bh; y++) {
          const a = y < lift ? 0 : Math.min(1, (y - lift) / 30);
          if (a <= 0) continue;
          const o = (y * W + x) * 4;
          const ty = ((((y - lift) % 150) + 150) % 150);
          const s = (ty * W + x) * 4;
          bed[o] = flat[s]; bed[o + 1] = flat[s + 1]; bed[o + 2] = flat[s + 2];
          bed[o + 3] = Math.round(255 * a);
        }
      }
      layers.push({
        input: await sharp(bed, { raw: { width: W, height: bh, channels: 4 } }).png().toBuffer(),
        left: 0, top: SAND,
      });
    }

    /* 石头：一整条连续岩带 + 碎边轮廓遮罩 */
    {
      const BAND_H = 420;
      const BAND_TOP = H - BAND_H + 46;
      const PLANKS = [
        [26, 4, 520, -60, 0.86, false],
        [9, 2, 560, 330, 1.0, false],
        [26, 2, 540, 760, 0.82, true],
        [9, 2, 580, 1080, 0.98, true],
      ];
      const bandLayers = [];
      for (const [ai, ci, w, x, dark, flip] of PLANKS) {
        const p = await piece(ai, ci, w, { flip });
        const meta = await sharp(p.input).metadata();
        let buf = await sharp(p.input).modulate({ brightness: dark, saturation: 0.72 }).png().toBuffer();
        const top = BAND_H - meta.height;
        if (top < 0) {
          buf = await sharp(buf)
            .extract({ left: 0, top: -top, width: meta.width, height: BAND_H }).png().toBuffer();
        }
        bandLayers.push({ input: buf, left: x, top: Math.max(0, top) });
      }
      const tileSrc = await sharp((await piece(26, 4, 300)).input)
        .flatten({ background: '#6b6151' })
        .modulate({ brightness: 0.74, saturation: 0.62 })
        .png().toBuffer();
      const tiles = [];
      for (let y = 0; y < BAND_H; y += 300) {
        for (let x = -300; x < W + 300; x += 300) tiles.push({ input: tileSrc, left: x, top: y });
      }
      const band = await sharp({
        create: { width: W, height: BAND_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([...tiles, ...bandLayers]).png().toBuffer();

      const mask = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><path d="${ridgePath()}" fill="#fff"/></svg>`,
      );
      const full = await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([{ input: band, left: 0, top: BAND_TOP }]).png().toBuffer();
      const filled = await sharp(full)
        .composite([{ input: mask, left: 0, top: 0, blend: 'dest-in' }]).png().toBuffer();
      layers.push({ input: filled, left: 0, top: 0 });
    }

    /* 珊瑚：根一律埋到石脊下面，不会浮空 */
    const CORALS = [
      [11, 0, 195, 60], [48, 1, 250, 185], [19, 0, 280, 300], [3, 0, 190, 22],
      [17, 7, 160, 505], [19, 8, 130, 630],
      [48, 0, 235, 870], [17, 3, 210, 1000], [19, 6, 150, 1120],
    ];
    for (const [ai, ci, w, left] of CORALS) {
      const p = await piece(ai, ci, w);
      layers.push({ input: p.input, left, top: Math.round(ridgeYAt(left + w / 2) + 26 - p.h) });
    }

    /* 前景砂脊：砂面当纹理，用一条小起伏的轮廓裁出来 */
    {
      const RH = 92;
      const sandStrip = await sharp((await piece(25, 0, W)).input)
        .flatten({ background: '#9c9078' })
        .resize(W, RH, { fit: 'cover', kernel: 'lanczos3' })
        .modulate({ brightness: 0.46, saturation: 0.5 })
        .png().toBuffer();
      const n = makeNoise(7777);
      const pts = [];
      for (let x = -20; x <= W + 20; x += 7) pts.push([x, H - RH + 14 + n(x) * 9 + Math.sin(x / 130) * 7]);
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
        + ` L${W + 20} ${H + 30} L-20 ${H + 30} Z`;
      const m = Buffer.from(
        `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#fff"/></svg>`,
      );
      const full = await sharp({
        create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      }).composite([{ input: sandStrip, left: 0, top: H - RH + 14 }]).png().toBuffer();
      layers.push({
        input: await sharp(full).composite([{ input: m, left: 0, top: 0, blend: 'dest-in' }]).png().toBuffer(),
        left: 0, top: 0,
      });
    }

    const reef = await sharp(grad).composite(layers).png().toBuffer();
    const shade = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.34" stop-color="#062433" stop-opacity="0"/>
            <stop offset="0.68" stop-color="#062433" stop-opacity="0.12"/>
            <stop offset="1" stop-color="#04161f" stop-opacity="0.4"/>
          </linearGradient>
          <radialGradient id="v" cx="0.5" cy="0.42" r="0.8">
            <stop offset="0.52" stop-color="#02141f" stop-opacity="0"/>
            <stop offset="1" stop-color="#02141f" stop-opacity="0.42"/>
          </radialGradient>
        </defs>
        <rect width="${W}" height="${H}" fill="url(#d)"/>
        <rect width="${W}" height="${H}" fill="url(#v)"/>
      </svg>`,
    );
    const tint = Buffer.from(
      `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${W}" height="${H}" fill="#0d6f8f" opacity="0.13"/>
      </svg>`,
    );
    const final = await sharp(reef)
      .composite([{ input: tint, left: 0, top: 0, blend: 'overlay' }, { input: shade, left: 0, top: 0 }])
      .png().toBuffer();
    await sharp(final).webp({ quality: 84, effort: 6 }).toFile(path.join(OUT, 'reef.webp'));
    log('  reef 1200x656');
  }

  const total = (await fsp.readdir(OUT)).length;
  const bytes = (await Promise.all((await fsp.readdir(OUT)).map(async (f) => (await fsp.stat(path.join(OUT, f))).size)))
    .reduce((a, b) => a + b, 0);
  log(`\n${OUT}：${total} 个文件，共 ${(bytes / 1024).toFixed(1)} KB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
