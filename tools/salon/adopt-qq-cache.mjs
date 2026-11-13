/**
 * 从本机 QQ / NapCat 的图片缓存里收图（2026-11-13 加）。
 *
 * 背景：10 月那 5 张精华图的 CDN 链接全过期（原链接 404、`appid` 换过是 400），
 * NapCat 的 `get_image` / `get_msg` 只能给回同一条死链接，这版 NapCat 也没有
 * 「下载图片文件流」这个接口。但图**并没有被 QQ 删**：
 *   · 精华接口里那张图的 `file` 字段是 `E54529E5E535AF980ED92D76C99C73BE.jpg` 这种
 *     **32 位十六进制 + 扩展名**，其实就是这张图的 **MD5**；
 *   · QQ 本地缓存的文件名正是这个 MD5（`nt_data\Pic\<年-月>\Ori\<md5>.jpg`，
 *     小写、不带扩展名的也有）。只要那个账号在 QQ 里把图**点开过**（显示出来一次），
 *     文件就落盘了。
 *
 * 所以流程是：在 QQ 里滚到那几条消息、把图点开 → 跑这个脚本把图收进仓库、
 * 写回 salon.json。取不到图的那几条会原样留着，不瞎改。
 *
 * 用法：
 *   node tools/salon/adopt-qq-cache.mjs              # 只找，报告找到几张、在哪
 *   node tools/salon/adopt-qq-cache.mjs --write      # 找到的拷进 public/img/salon 并回填 salon.json
 *   node tools/salon/adopt-qq-cache.mjs --root "D:\某个目录"   # 额外扫一个目录
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const SALON_FILE = path.join(PROJ, 'src', 'data', 'salon.json');
const IMG_DIR = path.join(PROJ, 'public', 'img', 'salon');

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const extraRoots = [];
for (let i = 0; i < argv.length; i++) if (argv[i] === '--root' && argv[i + 1]) extraRoots.push(argv[i + 1]);

/**
 * 10 月那批缺的 5 张。`md5` 就是精华接口里那个 `file` 字段（去扩展名、转小写）。
 * 这几条是从服务器上真实跑出来的清单，改新月份时换掉这一段即可。
 */
const WANTED = [
  { id: 'e0824', md5: 'caae99e5169dc1f52fc913c4831424be', label: '10-11 16:14' },
  { id: 'e0827', md5: 'e54529e5e535af980ed92d76c99c73be', label: '10-10 19:29' },
  { id: 'e0828', md5: '79aa75168f3be14a57160b2f9139bea3', label: '10-10 17:28' },
  { id: 'e0829', md5: 'b522411ebec41aa9a270fec4b5962330', label: '10-09 13:42' },
  { id: 'e0832', md5: '8a3e3234a248ea73991762b3cf6e870f', label: '10-03 01:30' },
];

function sniffExt(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  if (buf.length > 6 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return '';
}

const home = process.env.USERPROFILE || '';
const ROOTS = [
  path.join(home, 'Documents', 'Tencent Files'),
  path.join(home, 'AppData', 'Roaming', 'QQ'),
  path.join(home, 'AppData', 'Local', 'Tencent'),
  path.join(home, 'Documents', 'Tencent Files'),
  'D:\\',
  ...extraRoots,
].filter((p) => p && fs.existsSync(p));

/** 在目录里找文件名以某个 md5 开头的文件（QQ 缓存是小写、有的带扩展名有的不带） */
function findFile(md5, maxDepth = 8) {
  const walk = (dir, depth) => {
    if (depth > maxDepth) return '';
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return ''; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        const got = walk(full, depth + 1);
        if (got) return got;
      } else if (e.name.toLowerCase().startsWith(md5)) {
        /* 只要图片，别的同名文件不算 */
        const ext = path.extname(e.name).toLowerCase().replace('.', '');
        if (!ext || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)) return full;
      }
    }
    return '';
  };
  for (const r of ROOTS) {
    const hit = walk(r, 0);
    if (hit) return hit;
  }
  return '';
}

const data = JSON.parse(fs.readFileSync(SALON_FILE, 'utf8'));
const byId = new Map(data.essences.map((e) => [String(e.id), e]));

console.log(`扫描根目录：\n  ${ROOTS.join('\n  ')}\n`);

let found = 0;
let adopted = 0;
for (const w of WANTED) {
  const entry = byId.get(w.id);
  if (!entry) {
    console.log(`? ${w.id}（${w.label}）站里没有这个条目，跳过`);
    continue;
  }
  if ((entry.images ?? []).length) {
    console.log(`· ${w.id}（${w.label}）站里已经有图 ${entry.images[0]}，跳过`);
    continue;
  }
  const file = findFile(w.md5);
  if (!file) {
    console.log(`✗ ${w.id}（${w.label}）本机缓存里没有 —— 去 QQ 里把那天的图点开一次再来`);
    continue;
  }
  const buf = fs.readFileSync(file);
  const ext = sniffExt(buf);
  const size = buf.length;
  found++;
  if (!ext) {
    console.log(`⚠ ${w.id}（${w.label}）找到了 ${file}，但它不是图片（${size} 字节）`);
    continue;
  }
  const name = `${w.id}-1.${ext}`;
  console.log(`✅ ${w.id}（${w.label}）${file}`);
  console.log(`     → ${name}（${ext}，${(size / 1024).toFixed(0)} KB）`);
  if (WRITE) {
    fs.mkdirSync(IMG_DIR, { recursive: true });
    fs.writeFileSync(path.join(IMG_DIR, name), buf);
    entry.images = [`/img/salon/${name}`];
    adopted++;
  }
}

console.log('');
console.log(`找到 ${found} / ${WANTED.length} 张${WRITE ? `，已收进仓库 ${adopted} 张` : '（没写盘，加 --write 才收）'}`);

if (WRITE && adopted) {
  try { fs.copyFileSync(SALON_FILE, `${SALON_FILE}.bak`); } catch { /* 首次无备份 */ }
  fs.writeFileSync(SALON_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log('已写回 src/data/salon.json');
  console.log('下一步：node tools/salon/repair-images.mjs --all --write（补 OCR / 归属 / 去空壳），但那条要连得上 NapCat 才行；');
  console.log('        纯本机的话用 tools/salon/ocr-local.ps1 逐张认字。');
}
