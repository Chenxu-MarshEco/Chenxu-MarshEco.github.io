/*
 * 构建完之后，把产物里**没人引用**的原图删掉。
 *
 * 为什么要这一步（2026-09-22，用户：「构建速度还是比较慢」）：
 *   本地量出来 dist = 62MB / 1647 个文件，最大的一块是图片：
 *     · img/opt        31.5MB（480 个变体，页面 srcset 用的就是它们）
 *     · img/uploads…   18.8MB（**原图**，因为躺在 public/ 里被原样拷进 dist）
 *     · audio           9.1MB（mp3，压不动）
 *   真正拖慢 CI 的不是构建（本地 astro build 只有 4.7s），而是**打包上传这个产物**：
 *   实测本地把 dist 压一遍要 28.4s 纯 CPU —— 图片本来就压过了，deflate 白费力气；
 *   2 核的 runner 上这一步要一两分钟。
 *   小一点就快一点，所以把确实没人引用的原图清出去。
 *
 * 只删**三个条件同时成立**的文件（删错就是裂图，所以条件写严一点）：
 *   ① 在 dist/img/ 下（不碰别的目录）；
 *   ② 在图片管线的清单里有**变体**（有变体 = 页面会用变体那份，原图本来就不该被直接引用）；
 *   ③ **整个 dist 里（HTML / JSON / XML / CSS / JS 全算）一处都没提到它**。
 * 任何一条不满足就原样留着。
 *
 * 用法：node tools/images/prune-dist.mjs [dist目录] [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const DIST = path.resolve(args.find((a) => !a.startsWith('--')) ?? 'dist');
const MANIFEST = path.join(DIST, 'img', 'opt', 'manifest.json');

if (!fs.existsSync(DIST)) {
  console.error(`找不到 ${DIST}，先构建`);
  process.exit(2);
}
if (!fs.existsSync(MANIFEST)) {
  console.log('产物里没有图片清单（没跑过图片管线？），跳过');
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
/** 有变体的原图：这些是"页面会用变体"的候选（key 就是 /img/... 那个地址） */
const withVariants = new Set(
  Object.values(manifest.items ?? {})
    .filter((it) => it && (it.variants?.length ?? 0) > 0 && it.key && !it.passthrough)
    .map((it) => String(it.key).replace(/^\//, ''))
);
if (!withVariants.size) {
  console.log('清单里没有"有变体的原图"，没什么可清的');
  process.exit(0);
}

/*
  全文搜一遍 dist：只把**浏览器运行时会读的**文本类文件算进来。
  ⚠ 特意**不算 .json**：`dist/salon.json`、`dist/img/opt/manifest.json` 这些数据文件里
  确实列着原图路径，但运行时没人拿它们去取图 ——
    · 首页那条「每日精华」用的是 salon.json.ts 预先算好的 `image`（变体）✅（grep 过）
    · 清单 manifest.json 只有构建期读（utils/images.ts），不进浏览器
  把它们算进来的话，每一张原图都"被引用"，这一步就白做了（实测 0 张可清）。
*/
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.xml', '.txt', '.webmanifest', '.svg']);
const haystack = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (TEXT_EXT.has(path.extname(e.name).toLowerCase())) haystack.push(fs.readFileSync(p, 'utf8'));
  }
};
const t0 = Date.now();
walk(DIST);
const hay = haystack.join('\n');
console.log(`扫了 ${haystack.length} 个文本文件（${Date.now() - t0}ms），候选原图 ${withVariants.size} 张`);

let removed = 0;
let bytes = 0;
const kept = [];
for (const rel of withVariants) {
  const abs = path.join(DIST, rel);
  if (!fs.existsSync(abs)) continue;
  /* 用文件名（带目录的那一段）搜：图片地址在页面里就是 /img/xxx/yyy.jpg 这种写法 */
  const needle = `/${rel}`;
  if (hay.includes(needle)) {
    kept.push(rel);
    continue;
  }
  const size = fs.statSync(abs).size;
  if (!DRY) fs.rmSync(abs, { force: true });
  removed++;
  bytes += size;
}
console.log(
  `${DRY ? '（--dry）' : ''}清掉没人引用的原图 ${removed} 张，省下 ${(bytes / 1024 / 1024).toFixed(1)} MB` +
    (kept.length ? `；还被引用着的留了 ${kept.length} 张` : '')
);
