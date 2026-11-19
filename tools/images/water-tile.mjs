/**
 * 首页「涣愿终池」卡上那层水光用的贴图（2026-11-18）。
 *
 * 站长原话：「给它蒙上一层水光波纹的滤镜即可 水光可以打在我上传的图片上
 *            并且有那种微微的水体扭曲感」
 *
 * 所以这张图要满足三件事：
 *   ① **能无缝平铺** —— 卡上的水光是一层慢慢漂的背景，接缝露馅就全毁了。
 *      做法是 Voronoi 在环面上算（坐标取模），边界天然对得上；
 *      模糊也用 3×3 平铺后再裁中心，免得边缘被羽化出暗边。
 *   ② 只带 alpha 的白光，图上用 `screen` 叠 —— 只加光不压暗底下那张照片。
 *   ③ 纹路要软、要稀，别做成"裂纹玻璃"。
 *
 * 重新生成：node tools/images/water-tile.mjs
 * 产物：public/img/aquarium/water-light.webp
 */
import path from 'node:path';
import sharp from 'sharp';

/* 参数可以从环境变量覆盖，方便一次生成几版对着看（默认就是正式那版） */
const S = Number(process.env.WT_S || 256);          // 边长
const N = Number(process.env.WT_N || 8);            // 细胞数
const K = Number(process.env.WT_K || 0.045);        // 线宽（相对边长）
const GAMMA = Number(process.env.WT_G || 3.0);      // 越大线越细、越像水光而不是裂纹
const BLUR = Number(process.env.WT_B || 1.2);
const OUT = path.resolve(process.env.WT_OUT || 'public/img/aquarium/water-light.webp');

/* 定死的伪随机，重跑得到同一张图 */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rand = rng(20261118);
const pts = [];
for (let i = 0; i < N; i++) pts.push([rand() * S, rand() * S]);

/* 环面上的最近/次近距离 —— (d2-d1) 越小越靠近细胞边界，边界就是水光的亮线 */
const v = new Float32Array(S * S);
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let d1 = Infinity, d2 = Infinity;
    for (let i = 0; i < N; i++) {
      const px = pts[i][0], py = pts[i][1];
      for (let ox = -S; ox <= S; ox += S) {
        for (let oy = -S; oy <= S; oy += S) {
          const dx = x - (px + ox), dy = y - (py + oy);
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < d1) { d2 = d1; d1 = d; }
          else if (d < d2) { d2 = d; }
        }
      }
    }
    v[y * S + x] = Math.exp(-(d2 - d1) / (K * S));
  }
}

/*
  低频亮度调制：整数频率的正弦，铺起来也是无缝的。
  这一层很关键 —— 水光要是均匀铺满整张卡，就变成"裂纹玻璃"了；
  让有的地方几乎没有光、有的地方是一簇亮线，才像水面打下来的光。
*/
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    const a = Math.sin((2 * Math.PI * 2 * x) / S) * Math.sin((2 * Math.PI * 1 * y) / S);
    const b = Math.sin((2 * Math.PI * 3 * y) / S + 1.1);
    const c = Math.sin((2 * Math.PI * 1 * x) / S + 2.3);
    const m = 0.55 + 0.62 * a + 0.28 * b + 0.3 * c;
    v[y * S + x] *= Math.min(1.35, Math.max(0.12, m));
  }
}

/* 全白 + alpha */
const buf = Buffer.alloc(S * S * 4);
for (let i = 0; i < S * S; i++) {
  const a = Math.min(1, Math.max(0, Math.pow(v[i], GAMMA)));
  buf[i * 4] = 255;
  buf[i * 4 + 1] = 255;
  buf[i * 4 + 2] = 255;
  buf[i * 4 + 3] = Math.round(a * 255);
}

/* 3×3 平铺 → 模糊 → 裁中心，模糊才是无缝的 */
const big = Buffer.alloc(S * 3 * S * 3 * 4);
for (let y = 0; y < S * 3; y++) {
  for (let x = 0; x < S * 3; x++) {
    const si = (((y % S) * S) + (x % S)) * 4;
    const di = (y * S * 3 + x) * 4;
    big[di] = buf[si]; big[di + 1] = buf[si + 1]; big[di + 2] = buf[si + 2]; big[di + 3] = buf[si + 3];
  }
}

const blurred = await sharp(big, { raw: { width: S * 3, height: S * 3, channels: 4 } })
  .blur(BLUR * 3)
  .extract({ left: S, top: S, width: S, height: S })
  .webp({ quality: 72 })
  .toFile(OUT);

console.log(`water-light.webp  ${blurred.width}x${blurred.height}  ${Math.round(blurred.size / 1024)} KB`);

/* 顺便报告一下边界接缝（左右两列、上下两行的平均差，越小越无缝） */
const { data } = await sharp(OUT).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const at = (x, y) => data[(y * S + x) * 4 + 3];
let lr = 0, tb = 0;
for (let i = 0; i < S; i++) { lr += Math.abs(at(0, i) - at(S - 1, i)); tb += Math.abs(at(i, 0) - at(i, S - 1)); }
console.log(`接缝：左右 ${(lr / S).toFixed(1)} / 上下 ${(tb / S).toFixed(1)}（0~255 的 alpha 差）`);
