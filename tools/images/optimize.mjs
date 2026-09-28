#!/usr/bin/env node
/**
 * ============================================================================
 * 图片优化管线
 * ----------------------------------------------------------------------------
 * 干三件事，都围绕着「站点只该发小图」这一个目标：
 *
 *   1. 给 public/img 下每张位图生成**多尺寸的 WebP + AVIF**，写到 public/img/opt/，
 *      再写一份 public/img/opt/manifest.json 记录每一张的尺寸、变体、
 *      以及一个几十字节的 LQIP（模糊占位图，inline 成 data URL）。
 *      页面渲染层（src/utils/images.ts）读这份清单来发 <picture> / srcset。
 *   2. 清单里带上缓存信息（源文件大小 + mtime + 配置版本）。重复运行时，
 *      没变过的图直接跳过，所以编辑器「保存并重新构建」不会每次都重编码。
 *   3. 被删掉/改名过的源图，它在 opt/ 里的产物会在这一轮里清掉。
 *
 * 为什么不用 Astro 自带的 astro:assets：
 *   本站的图片路径全是从数据文件、markdown 正文、编辑器上传里动态来的字符串，
 *   走不到 Astro 的静态 import 那条路上。自己跑一条管线，路径怎么来都无所谓。
 *
 * 怎么跑：
 *   node tools/images/optimize.mjs            # 增量（有缓存就跳过）
 *   node tools/images/optimize.mjs --force    # 全部重编码
 *   node tools/images/optimize.mjs --report   # 只报数，不编码
 *   node tools/images/optimize.mjs --only /img/uploads/xxx.jpg
 *   pnpm build 里已经带上它（见 package.json）
 *
 * 几个刻意的取舍，写在下面各处注释里：
 *   · JPEG → WebP q76 / AVIF q52；不覆盖原图（母本永远是母本），
 *     但会给一份 mozjpeg 压过的「兜底 JPEG」，给不支持 WebP 的老浏览器用。
 *   · PNG 分两种：先量一下「无损 WebP」和「有损 WebP」谁小 ——
 *     像 skyline.png 那种纯色剪影，无损反而只有有损的 1/2（实测 3.1KB vs 5.6KB），
 *     而且**颜色逐位不变**（首页塔吊剪影要和它的墨色 #08020c 对齐，不能被有损偏掉）；
 *     像 logo.png 那种带渐变的，则是有损小得多（17KB vs 67KB）。所以就按实测选。
 *   · 小于 20KB 的图直接跳过：省下的那点还不够多出来的一个请求。
 * ============================================================================
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const OPT_DIR = path.join(PUBLIC_DIR, 'img', 'opt');
const MANIFEST_FILE = path.join(OPT_DIR, 'manifest.json');

/** 改这里就等于「换一套产物」，版本号会自动让全量缓存失效 */
const CFG = {
  version: 5,
  /** 宽度档位；每张图只会用它自己够得着的那些档，最后一定再补一个原始宽度 */
  steps: [400, 800, 1200, 1600],
  maxWidth: 1920,
  /** 小于这个字节数的图不折腾 */
  minBytes: 20 * 1024,
  /*
    质量（2026-09-26 实测后调的，见 tools/checks/_quality-probe.mjs 那次的数）：
      · webp q76 → q72：同一张图小 8%，编码时间不变；
      · avif q52 → q46：小 16%（对比同一档 webp 是 -39%），effort 保持 4。
        effort 从 4 提到 6 只再多 3%，编码却要 3 倍时间 —— 不值，尤其 CI 每次部署
        都要重编一遍（.github 那边现在也缓存 public/img/opt 了）。
    AVIF 是现在浏览器实际会选的那一份，所以它的质量档才是最值钱的那个数。
  */
  webp: { quality: 72, effort: 5 },
  webpLossless: { lossless: true, effort: 6 },
  avif: { quality: 46, effort: 4 },
  jpeg: { quality: 82, mozjpeg: true, progressive: true },
  /**
   * 动图（GIF / 动 WebP）上传时重编码成动图 WebP 的质量档。
   * 2026-09-28 加的：以前 GIF 一律原样落盘，于是"传一张 9MB 的动图"就把 9MB
   * 塞进了仓库和页面。动图 WebP 各浏览器都认，通常还能小一半以上（小了才换）。
   */
  gifWebp: { quality: 72, effort: 4 },
  /**
   * 解码像素上限（sharp 的 limitInputPixels）。默认约 2.68 亿像素 ——
   * 手机拍的照片、扫描件离它很远，但用户现在可以传任意大的图，所以抬到 5 亿，
   * 同时留一道闸：真超过就按"压缩失败、原样保存"处理，不会把编辑器进程吃爆。
   */
  limitInputPixels: 500e6,
  lqipWidth: 20,
  concurrency: 4,
};

const RASTER = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const SKIP_EXT = new Set(['.gif', '.svg', '.ico', '.avif', '.bmp']);

// ---------------------------------------------------------------- sharp 加载

let sharpPromise = null;
/**
 * sharp 是 Astro 的依赖，这里也把它声明成了直接依赖（package.json）。
 * 万一某台机器上没装上（比如全新 clone 还没 install），整条管线**安静降级**：
 * 页面渲染层拿不到清单，就照原样发原图 —— 站点照常能跑，只是没优化。
 */
async function loadSharp() {
  if (!sharpPromise) {
    sharpPromise = import('sharp').then((m) => m.default);
  }
  return sharpPromise;
}

export async function sharpAvailable() {
  try {
    await loadSharp();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 工具

const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

function srcKey(abs) {
  return '/' + path.relative(PUBLIC_DIR, abs).split(path.sep).join('/');
}

/** `/img/uploads/a.jpg` + 800 + 'webp' → { abs, url } */
function variantPath(key, width, ext) {
  const rel = key.replace(/^\/img\//, '');
  const dir = path.dirname(rel);
  const base = path.basename(rel).replace(/\.[^.]+$/, '');
  const name = `${base}-${width}.${ext}`;
  return {
    abs: path.join(OPT_DIR, dir, name),
    url: `/img/opt/${dir === '.' ? '' : dir + '/'}${name}`,
  };
}

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (p === OPT_DIR) continue;
      await walk(p, out);
    } else if (e.isFile()) {
      out.push(p);
    }
  }
  return out;
}

/**
 * 只读宽高（不编码）。
 *
 * 给「原样发」的小图用：它们不生成变体，但渲染层**仍然需要宽高**去写
 * `<img width height>` —— 少了这个，图一到位就把下面的内容顶下去，
 * 页面一边滚一边跳版（冰室精华页 784 条 + 291 张截图，跳起来受不了）。
 * EXIF 带旋转的（手机竖拍）宽高要对调，和 encodeItem 里一个道理。
 */
async function dimsOf(sharp, abs) {
  try {
    const meta = await sharp(abs, { failOn: 'none' }).metadata();
    const rotated = [5, 6, 7, 8].includes(meta.orientation);
    const w = rotated ? meta.height : meta.width;
    const h = rotated ? meta.width : meta.height;
    return w && h ? { w, h } : null;
  } catch {
    return null;
  }
}

/** 这份图该出哪些宽度档 */
function planWidths(origWidth) {
  const cap = Math.min(origWidth, CFG.maxWidth);
  const widths = CFG.steps.filter((w) => w <= cap);
  if (!widths.length || widths[widths.length - 1] !== cap) widths.push(cap);
  // 小图（比如 384 的徽记）只有一档的话，再补一个半宽档：
  // 它在页头上只显示 40px 上下，没必要每台设备都下整张
  if (widths.length === 1 && widths[0] >= 256) widths.unshift(Math.round(widths[0] / 2));
  return [...new Set(widths)].sort((a, b) => a - b);
}

// ---------------------------------------------------------------- 单张编码

async function encodeItem(sharp, abs, key) {
  const orig = await fsp.readFile(abs);
  const meta = await sharp(orig, { failOn: 'none' }).metadata();
  const hasAlpha = Boolean(meta.hasAlpha);
  // EXIF 里带旋转的（手机竖拍）宽高是「存储尺寸」，摆正之后要对调，
  // 否则 srcset 里写的 h 会反，浏览器按错误比例预留位置 → 加载完跳一下
  const rotated = [5, 6, 7, 8].includes(meta.orientation);
  const dispW = rotated ? meta.height : meta.width;
  const dispH = rotated ? meta.width : meta.height;
  const widths = planWidths(dispW || 0);

  if ((meta.pages ?? 1) > 1) {
    // 动图（多帧 webp / gif）不重编码：变体只会留下第一帧，等于把动图弄死
    return {
      key, src: key, w: dispW, h: dispH, hasAlpha, lossless: false, animated: true,
      variants: [], fallback: { url: key, bytes: orig.length }, lqip: '',
      source: {
      bytes: orig.length,
      mtimeMs: (await fsp.stat(abs)).mtimeMs,
      hash: crypto.createHash('sha1').update(orig).digest('hex').slice(0, 16),
      cfg: CFG.version,
    },
    };
  }

  /*
   * PNG 先探一次「无损 vs 有损」：只在原始宽度上各编一份比大小，成本很低，
   * 但能把纯色剪影（无损赢）和渐变/照片（有损赢）分开处理。
   */
  let pngMode = 'lossy';
  if (path.extname(abs).toLowerCase() === '.png') {
    const [lossless, lossy] = await Promise.all([
      sharp(orig).rotate().resize({ width: widths[widths.length - 1] }).webp(CFG.webpLossless).toBuffer(),
      sharp(orig).rotate().resize({ width: widths[widths.length - 1] }).webp(CFG.webp).toBuffer(),
    ]);
    pngMode = lossless.length <= lossy.length ? 'lossless' : 'lossy';
  }
  const losslessArt = pngMode === 'lossless';

  const variants = [];
  for (const w of widths) {
    const pipeline = () =>
      sharp(orig, { failOn: 'none' })
        .rotate()
        /*
         * 纯色剪影走无损时必须用 nearest 缩放：
         * 默认的 lanczos 会在边缘插值出一圈半透明过渡色，一张 2 色图就变成上万色，
         * 无损 WebP 反而爆炸（实测 skyline.png：nearest 时 400px 档 1.6KB，
         * 用默认核却是 6.1KB —— 比不做缩放的整张原图还大）。
         */
        .resize({ width: w, withoutEnlargement: true, kernel: losslessArt ? 'nearest' : 'lanczos3' });
    const webp = await pipeline().webp(losslessArt ? CFG.webpLossless : CFG.webp).toBuffer();
    const webpPath = variantPath(key, w, 'webp');
    await fsp.mkdir(path.dirname(webpPath.abs), { recursive: true });
    await fsp.writeFile(webpPath.abs, webp);

    let avif = null;
    // 纯色剪影不做 AVIF：实测 AVIF 无损比 WebP 无损还大（8.4KB vs 3.1KB），纯属浪费
    if (!losslessArt) {
      const buf = await pipeline().avif(CFG.avif).toBuffer();
      const p = variantPath(key, w, 'avif');
      await fsp.writeFile(p.abs, buf);
      avif = { url: p.url, bytes: buf.length };
    }
    variants.push({ w, h: Math.round((dispH / dispW) * w), webp: { url: webpPath.url, bytes: webp.length }, avif });
  }

  /*
   * 兜底就用原图本身（<picture> 里 <img src> 指它）。
   * 这里**刻意不再另存一份 mozjpeg 压过的兜底图**：那份只有「连 WebP 都不认识的浏览器」
   * 才会下载（2026 年基本不存在），却要给 dist 多塞 3.7MB —— 不划算。
   * 原图本来就在，指过去就行。
   */
  const fallback = { url: key, bytes: orig.length, ext: path.extname(abs).toLowerCase() };

  // LQIP：20px 宽的极小图，inline 成 data URL。带透明的图不做 ——
  // 那张模糊图会从 PNG 的透明区域里透出来，糊在 logo 后面。
  let lqip = '';
  if (!hasAlpha) {
    const buf = await sharp(orig, { failOn: 'none' }).rotate().resize({ width: CFG.lqipWidth }).webp({ quality: 40 }).toBuffer();
    lqip = `data:image/webp;base64,${buf.toString('base64')}`;
  }

  return {
    key,
    src: key,
    w: dispW,
    h: dispH,
    hasAlpha,
    lossless: losslessArt,
    variants,
    fallback,
    lqip,
    source: {
      bytes: orig.length,
      mtimeMs: (await fsp.stat(abs)).mtimeMs,
      hash: crypto.createHash('sha1').update(orig).digest('hex').slice(0, 16),
      cfg: CFG.version,
    },
  };
}

// ---------------------------------------------------------------- 主流程

/**
 * 源图的内容哈希（sha1 前 16 位）。
 *
 * 为什么需要它：`cachedOk` 原先只比 **size + mtime**。本地改图 mtime 会变、缓存自然失效，
 * 但 **CI 上每次 checkout 出来的 mtime 都是"刚刚"** —— 于是每次推送都把 300 多张图
 * 从头到尾用 sharp 重编一遍（用户反馈的「github 的构建速度非常非常慢」就是它）。
 * 换成"mtime 对不上就再比一次内容哈希"之后：内容没变 → 缓存命中 → 秒过。
 * 50MB 图库算一遍 sha1 不到 1 秒，比重编几分钟划算得多。
 */
async function hashOf(abs) {
  const buf = await fsp.readFile(abs);
  return crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
}

async function readManifest() {
  try {
    const raw = JSON.parse(await fsp.readFile(MANIFEST_FILE, 'utf8'));
    if (raw && raw.cfg === CFG.version && raw.items) return raw;
  } catch {
    /* 没有 / 坏了 / 版本不符 → 当作空清单，全部重编 */
  }
  return { cfg: CFG.version, generated: null, items: {} };
}

function cachedOk(prev, stat, hash) {
  if (!prev || !prev.source) return false;
  if (prev.source.cfg !== CFG.version) return false;
  if (prev.source.bytes !== stat.size) return false;
  /*
    mtime 一致 → 直接命中（本地改图最常走的路）；
    mtime 不一致 → 比内容哈希：**CI 每次 checkout 的 mtime 都是新的**，
    只认 mtime 的话每次推送都会全量重编（就是"构建特别慢"的根）。
    老清单里没有 hash（第一次升级）→ 退回按 mtime 判（那一趟会重编一次，之后就快了）。
  */
  if (Math.abs(prev.source.mtimeMs - stat.mtimeMs) > 1) {
    if (!prev.source.hash || !hash || prev.source.hash !== hash) return false;
  }
  // 产物文件得都还在（可能被人手删过）
  const files = [];
  for (const v of prev.variants ?? []) {
    files.push(v.webp?.url, v.avif?.url);
  }
  if (prev.fallback?.generated) files.push(prev.fallback.url);
  for (const u of files) {
    if (!u) continue;
    if (!fs.existsSync(path.join(PUBLIC_DIR, u.replace(/^\//, '')))) return false;
  }
  return true;
}

/**
 * 跑一遍管线。
 * @param {{only?: string[]|null, force?: boolean, log?: (s: string) => void, quiet?: boolean}} opts
 */
/**
 * 护栏：public/ 下**不属于** public/img/ 的栅格图，管线一个都不会处理。
 *
 * 为什么要有这条（2026-09-26）：用户要求「以后增添的可以上传图片的板块也都做同样处理」。
 * 现在编辑器只有一个上传落点（public/img/uploads），新板块自然也走它；
 * 但万一以后有人图省事把某个板块的图传到 public/uploads、public/assets 之类的地方，
 * 那些图就会**原样发出去** —— 没有多尺寸、没有 avif、没有模糊占位、也不进清单，
 * 页面上还看不出毛病，只是慢。所以每次跑管线都扫一眼，发现了就明说。
 */
async function strayImages() {
  /*
    img/   = 管线自己的地盘
    audio/ fonts/ = 不是图片
    secret/ = public/secret/xianbao 那个手写的 Spine 演示页（首页雕像点进去的彩蛋）：
              它整个页面和素材都是独立的一份，按设计不走站点的图片管线
    .开头的目录（.tmp 之类）不扫
  */
  const SKIP_DIRS = new Set(['img', 'audio', 'fonts', 'secret']);
  const found = [];
  let top = [];
  try {
    top = await fsp.readdir(PUBLIC_DIR, { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of top) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
    for (const abs of await walk(path.join(PUBLIC_DIR, entry.name))) {
      if (RASTER.has(path.extname(abs).toLowerCase())) found.push(srcKey(abs));
    }
  }
  return found;
}

export async function optimizeAll(opts = {}) {
  const { only = null, force = false, log = () => {}, quiet = false } = opts;
  const sharp = await loadSharp();

  const manifest = force ? { cfg: CFG.version, items: {} } : await readManifest();
  const prevItems = manifest.items ?? {};
  const files = await walk(path.join(PUBLIC_DIR, 'img'));

  /* 先看一眼有没有"漏网"的图（只报不改：它可能压根不该由这条管线管） */
  const stray = await strayImages();
  if (stray.length) {
    log(
      `⚠️ 有 ${stray.length} 张图不在 public/img/ 下面，图片管线不会处理它们`
        + `（不会有多尺寸 / AVIF / 模糊占位）：${stray.slice(0, 5).join(' ')}`
        + (stray.length > 5 ? ' …' : '')
        + '\n   要么把它们挪到 public/img/ 下面，要么把那个目录加进 tools/images/optimize.mjs 的扫描范围。'
    );
  }

  const candidates = [];
  for (const abs of files) {
    const ext = path.extname(abs).toLowerCase();
    if (SKIP_EXT.has(ext) || !RASTER.has(ext)) continue;
    const key = srcKey(abs);
    if (only && !only.includes(key)) continue;
    candidates.push({ abs, key });
  }

  const next = {};
  const stats = { reused: 0, encoded: 0, skipped: 0, inBytes: 0, outBytes: 0 };
  const queue = [...candidates];
  const encoded = [];

  async function worker() {
    while (queue.length) {
      const { abs, key } = queue.shift();
      const stat = await fsp.stat(abs);
      const prev = prevItems[key];
      if (stat.size < CFG.minBytes) {
        stats.skipped++;
        /*
          小图不生成变体，但清单里留一条「原样发」的记录 ——
          尺寸必须有：渲染层要靠它给 <img> 写 width/height，不然图一到位就跳版。
          上次已经量过（prev.w/h）就直接复用，别再开一次 sharp。
        */
        let pw = prev?.w ?? null;
        let ph = prev?.h ?? null;
        if (!pw || !ph) {
          const d = await dimsOf(sharp, abs);
          if (d) {
            pw = d.w;
            ph = d.h;
          }
        }
        next[key] = {
          key, src: key, passthrough: true,
          w: pw, h: ph,
          hasAlpha: prev?.hasAlpha ?? false,
          variants: [], fallback: { url: key, bytes: stat.size }, lqip: '',
          source: { bytes: stat.size, mtimeMs: stat.mtimeMs, hash: await hashOf(abs), cfg: CFG.version },
        };
        continue;
      }
      const sameMtime = prev?.source && Math.abs(prev.source.mtimeMs - stat.mtimeMs) <= 1;
      const hash = !force && !sameMtime ? await hashOf(abs) : null;
      if (!force && cachedOk(prev, stat, hash)) {
        next[key] = prev;
        stats.reused++;
        stats.inBytes += prev.source.bytes;
        stats.outBytes += prev.fallback?.bytes ?? 0;
        continue;
      }
      const item = await encodeItem(sharp, abs, key);
      next[key] = item;
      stats.encoded++;
      encoded.push(item);
      const origBytes = item.source.bytes;
      const servedBytes = item.fallback?.bytes ?? origBytes;
      stats.inBytes += origBytes;
      stats.outBytes += servedBytes;
      log(`  编码 ${key}  ${kb(origBytes)} → 兜底 ${kb(servedBytes)}；` +
        item.variants.map((v) => `${v.w}:${kb(v.webp.bytes)}${v.avif ? '/avif ' + kb(v.avif.bytes) : ''}`).join('  '));
    }
  }
  await Promise.all(Array.from({ length: Math.min(CFG.concurrency, queue.length || 1) }, worker));

  // 清掉不再需要的产物
  if (!only) {
    const keep = new Set([MANIFEST_FILE]);
    for (const item of Object.values(next)) {
      for (const v of item.variants ?? []) {
        if (v.webp?.url) keep.add(path.join(PUBLIC_DIR, v.webp.url.replace(/^\//, '')));
        if (v.avif?.url) keep.add(path.join(PUBLIC_DIR, v.avif.url.replace(/^\//, '')));
      }
      if (item.fallback?.generated) keep.add(path.join(PUBLIC_DIR, item.fallback.url.replace(/^\//, '')));
    }
    for (const abs of await walk(OPT_DIR)) {
      if (!keep.has(abs)) {
        await fsp.rm(abs, { force: true });
        log(`  清理 ${srcKey(abs)}`);
      }
    }
  }

  manifest.cfg = CFG.version;
  manifest.generated = new Date().toISOString();
  /*
    只有「整库跑」（only === null）才能把 items 直接换成 next —— 那次是
    以盘上现有的图为准，顺便把已经删掉的图从清单里清出去。这也是上面那段
    「清掉不再需要的产物」只在 !only 时跑的原因。

    只编一张时（编辑器上传走的就是 optimizeOne -> optimizeAll({only:[key]})）
    **必须合并**：以前这里是无条件 `= next`，于是「上传一张新头像」会把清单里
    另外 1039 张的记录全抹掉 —— 后果有两个，都量过：
      · 紧接着的那次构建找不到缓存，把 1039 张全部重编：45.1s（正常 4.9s）；
      · 在下次构建跑完之前，那些图因为 manifest 里查不到而退回原图发。
    变体文件本身没被删（only 时跳过清理），所以合并回来就是完整的。
  */
  manifest.items = only ? { ...prevItems, ...next } : next;
  await fsp.mkdir(OPT_DIR, { recursive: true });
  await fsp.writeFile(MANIFEST_FILE, JSON.stringify(manifest));

  if (!quiet) {
    const totalVariants = Object.values(next).reduce((n, i) => n + (i.variants?.length ?? 0), 0);
    log(`图片管线：${Object.keys(next).length} 张在册（复用 ${stats.reused} / 新编 ${stats.encoded} / 小图跳过 ${stats.skipped}），变体 ${totalVariants} 个`);
  }
  return { manifest, stats };
}

/** 给编辑器上传用：只处理一个文件（编完顺手更新清单） */
export async function optimizeOne(relKey) {
  return optimizeAll({ only: [relKey], quiet: true });
}

// ---------------------------------------------------------------- 上传时压缩

/**
 * 上传进来的图片先过一遍这里，再落盘。
 * 目标是「用户拖进来的就是压缩过的」，而不是「站上发的才是压缩过的」：
 * 不然仓库和 dist 里会一直躺着几 MB 的原图。
 *
 *   jpg  → 自动摆正（EXIF）→ 限宽 1920 → mozjpeg q82 → 去掉元数据
 *   png  → 限宽 1920 → 无损 WebP / WebP q80 / PNG 最高压缩级别，谁小用谁
 *   webp → 限宽 1920 → webp q80
 *   gif / 动图 → 限宽 1920 → **动图 WebP**（比原来小才换），见下面 2026-09-28 那段
 *   svg  → 原样（矢量图重编码等于拍成位图，不该动）
 *
 * 返回 { buf, ext, before, after, note }。任何一步失败都退回原图，绝不让上传失败。
 *
 * ⚠ 2026-09-28：以前动图（GIF / 多页图）一律原样返回 —— 用户报「我上传一个 9MB 的
 *   图片却提示不能超过 12MB」之后一起改了：上传现在**不设大小限制**，
 *   所以"原样保留"就等于把 9MB 塞进仓库。现在动图也压：解码成所有帧 →
 *   限宽 1920 → 编成动图 WebP，比原来的字节小才用（大就还留 GIF）。
 */
export async function compressUpload(buf, ext, mime) {
  const e = (ext || '').toLowerCase();
  if (e === '.svg' || mime === 'image/svg+xml') {
    return { buf, ext: e || '.svg', before: buf.length, after: buf.length, note: '矢量图原样保留' };
  }
  let sharp;
  try {
    sharp = await loadSharp();
  } catch {
    return { buf, ext: e, before: buf.length, after: buf.length, note: '没装上 sharp，未压缩' };
  }
  const open = (opts = {}) => sharp(buf, { failOn: 'none', limitInputPixels: CFG.limitInputPixels, ...opts });
  try {
    const meta = await open().metadata();
    const isAnimated = (meta.pages ?? 1) > 1 || e === '.gif' || mime === 'image/gif';
    if (isAnimated) {
      const cand = await open({ animated: true })
        .resize({ width: CFG.maxWidth, withoutEnlargement: true })
        .webp({ ...CFG.gifWebp })
        .toBuffer()
        .catch(() => null);
      if (cand && cand.length < buf.length) {
        return { buf: cand, ext: '.webp', before: buf.length, after: cand.length, note: `动图 → WebP（${meta.pages ?? 1} 帧）` };
      }
      return {
        buf,
        ext: e || '.gif',
        before: buf.length,
        after: buf.length,
        note: cand ? '动图原样保留（转 WebP 反而更大）' : '动图原样保留（这张转不了）',
      };
    }
    /** 每次都从原图重新起一条管线（一次次 toBuffer 之后实例状态不好复用） */
    const mk = () =>
      open()
        .rotate()
        /*
          ⚠ 只封**宽度**，不封高度（2026-09-26 改）。
          以前这里是 width + height 都限 1920、fit:'inside' —— 于是聊天记录那种
          「窄而极长」的截图（站里现成那几张是 520×4747）一上传就被压到 1920 高、
          字也跟着缩到四成，正好砸在这个站最需要看清的地方。
          现在长图原样保留高度，体积交给 WebP / AVIF 的质量档去省。
        */
        .resize({ width: CFG.maxWidth, withoutEnlargement: true });

    /*
      PNG 上传：**比一比再决定格式**（2026-09-26）。
      截图/照片存成 PNG 是家常便饭 —— 一张 1920 宽的 PNG 常有 1~3MB，而同样内容的
      WebP 往往只有它的四分之一；再说页面本来就是发 WebP/AVIF 的，源图留 PNG 没意义。
      三种都编一遍，谁小用谁：
        · 无损 WebP  —— 纯色/线条图（图标、界面截图）通常比 PNG 小一大截，而且像素不变；
        · WebP q80   —— 照片类 PNG 小得多；
        · PNG 自己（压缩级别 9）—— 前两种都没更小就还是留 PNG。
      这样以后不管哪个板块上传什么图，落盘的就已经是小的那一份了。
    */
    if (e === '.png') {
      const cands = [
        { buf: await mk().webp({ lossless: true, effort: 6 }).toBuffer(), ext: '.webp', note: 'PNG → 无损 WebP' },
        { buf: await mk().webp({ quality: 80, effort: 5 }).toBuffer(), ext: '.webp', note: 'PNG → WebP q80' },
        { buf: await mk().png({ compressionLevel: 9, effort: 8 }).toBuffer(), ext: '.png', note: 'PNG（重新压过）' },
      ];
      cands.sort((a, b) => a.buf.length - b.buf.length);
      const pick = cands[0];
      if (pick.buf.length >= buf.length) {
        return { buf, ext: e, before: buf.length, after: buf.length, note: '已经是压过的，保持原样' };
      }
      return { buf: pick.buf, ext: pick.ext, before: buf.length, after: pick.buf.length, note: pick.note };
    }

    const base = mk();
    let out;
    if (e === '.webp') out = await base.webp({ quality: 80, effort: 5 }).toBuffer();
    else out = await base.jpeg(CFG.jpeg).toBuffer();
    // 万一压完反而更大（小图/已高度优化过），就保留原图
    if (out.length >= buf.length) {
      return { buf, ext: e, before: buf.length, after: buf.length, note: '已经是压过的，保持原样' };
    }
    return { buf: out, ext: e, before: buf.length, after: out.length, note: '已压缩' };
  } catch (err) {
    return { buf, ext: e, before: buf.length, after: buf.length, note: `压缩失败（${err.message}），已按原图保存` };
  }
}

// ---------------------------------------------------------------- CLI

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const reportOnly = args.includes('--report');
  const onlyIdx = args.indexOf('--only');
  const only = onlyIdx >= 0 ? [args[onlyIdx + 1]] : null;

  if (reportOnly) {
    const raw = JSON.parse(await fsp.readFile(MANIFEST_FILE, 'utf8'));
    const items = Object.entries(raw.items ?? {});
    let sumOrig = 0, sumWebp = 0, sumAvif = 0;
    const rows = [];
    for (const [key, it] of items) {
      if (it.passthrough) continue;
      const webp = it.variants.reduce((n, v) => n + (v.webp?.bytes ?? 0), 0);
      const avif = it.variants.reduce((n, v) => n + (v.avif?.bytes ?? 0), 0);
      sumOrig += it.source.bytes;
      sumWebp += webp;
      sumAvif += avif;
      rows.push([key, it.source.bytes, it.fallback?.bytes ?? 0, webp, avif, it.variants.map((v) => v.w).join('/')]);
    }
    rows.sort((a, b) => b[1] - a[1]);
    console.log('源图'.padEnd(58) + '原始'.padStart(10) + '兜底'.padStart(10) + 'WebP 全档'.padStart(12) + 'AVIF 全档'.padStart(12) + '  档位');
    for (const [k, o, f, w, a, ws] of rows) {
      console.log(k.slice(0, 56).padEnd(58) + kb(o).padStart(10) + kb(f).padStart(10) + kb(w).padStart(12) + (a ? kb(a) : '—').padStart(12) + '  ' + ws);
    }
    console.log(`合计：原始 ${kb(sumOrig)}，兜底 ${kb(rows.reduce((n, r) => n + r[2], 0))}，WebP 全档 ${kb(sumWebp)}（${((sumWebp / sumOrig) * 100).toFixed(1)}%），AVIF 全档 ${kb(sumAvif)}`);
  } else {
    await optimizeAll({ only, force, log: (s) => console.log(s) });
  }
}
