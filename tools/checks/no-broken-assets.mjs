/*
 * 全站「有没有指到不存在的文件」检查。
 *
 * 为什么需要：精华页里那 291 张群聊截图（加上图片管线生成的变体 /img/opt/…）、
 * 还有头像 / 冰山图这些"用户在编辑器里填地址"的图位。地址写错一个字母，
 * 页面上就是一张裂图，而且**构建不会报错**（构建只管生成，不管文件在不在）。
 *
 * 做法：扫 dist 里每个 html（外加 _astro 里的 css）里引用的站内资源，
 * 逐个查文件在不在。查的是**产物本身**，所以管线有没有生成、路径拼得对不对，
 * 一跑就知道。
 *
 * 用法：node tools/checks/no-broken-assets.mjs <dist目录>
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] ?? 'dist');
const EXT = /\.(png|jpe?g|gif|webp|avif|svg|ico|mp3|m4a|ogg|wav|mp4|webm|woff2?|ttf|otf|pdf|json)$/i;

/** 站内资源引用：src/href/srcset 里的、CSS url() 里的 */
function refsOf(text) {
  const out = new Set();
  const add = (raw) => {
    let u = String(raw || '').trim().replace(/^['"]|['"]$/g, '');
    if (!u) return;
    if (/^(https?:|data:|mailto:|tel:|#|\/\/)/i.test(u)) return;
    u = u.split('#')[0].split('?')[0];
    if (!u.startsWith('/')) return; // 相对路径这里不管（本站都是绝对路径）
    if (!EXT.test(u)) return;
    out.add(u);
  };
  for (const m of text.matchAll(/(?:src|href)="([^"]+)"/g)) add(m[1]);
  for (const m of text.matchAll(/srcset="([^"]+)"/g)) {
    for (const part of m[1].split(',')) add(part.trim().split(/\s+/)[0]);
  }
  for (const m of text.matchAll(/url\(([^)]+)\)/g)) add(m[1]);
  for (const m of text.matchAll(/content="([^"]*\/img\/[^"]*)"/g)) add(m[1]);
  return [...out];
}

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === '.prerender') continue;
      walk(p);
    } else if (/\.(html|css|xml)$/i.test(e.name)) files.push(p);
  }
};
walk(ROOT);

let checked = 0;
const missing = new Map();
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const u of refsOf(text)) {
    checked++;
    // 目录形式（/posts/ 这种）当 index.html 处理不了就跳过（它不以扩展名结尾，上面已经滤掉了）
    const target = path.join(ROOT, u);
    if (!fs.existsSync(target)) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (!missing.has(u)) missing.set(u, []);
      if (missing.get(u).length < 4) missing.get(u).push(rel);
    }
  }
}

console.log(`扫了 ${files.length} 个文件，站内资源引用 ${checked} 处`);
if (missing.size) {
  console.log(`\n✗ 有 ${missing.size} 个地址指向不存在的文件：`);
  for (const [u, from] of [...missing].slice(0, 40)) console.log(`   ${u}\n      被引用于：${from.join('、')}`);
  process.exit(1);
} else {
  console.log('✓ 没有裂图：每个引用都能在产物里找到对应文件');
}
