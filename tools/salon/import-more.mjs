/**
 * 「导入最新精华」—— 把一份新的月度导出文件并进站里的冰室精华（2026-10-06 加）。
 *
 *   node tools/salon/import-more.mjs "<群精华_2026年9月.html>"          # 直接给 HTML
 *   node tools/salon/import-more.mjs "<qq精华-202609.zip>"             # 给压缩包也行（自动解）
 *   node tools/salon/import-more.mjs "<…>" --dry                      # 只算一遍，不写任何文件
 *   node tools/salon/import-more.mjs "<…>" --json                     # 给编辑器读的机器可读报告
 *
 * 用户原话：
 *   「在编辑器的精华消息页面里新增一个接口 可以接受这一类文件 接受后把里面的内容全部转化为
 *    和之前精华一样的一条条精华条目 …这个接口以后也可以定期接收新的精华文件然后把他们
 *    全部转化为本站的精华格式」
 *
 * 认的输入就是导出管线（压缩包里的 `工具/05_build_docs.py`）产出的那两种东西：
 *   · 月度 HTML（`群精华_YYYY年M月.html`）—— 结构见 tools/salon/month-html.mjs 的头注释
 *   · 整个压缩包（里面挑那份 HTML；顺手认一下月文件名）
 * 行为：**只增不改**，去重、成员按名字或别名认、年代按日期落段、图片抽成
 * `public/img/salon/<id>-<k>.<ext>`。规则全在 tools/salon/merge.mjs 里。
 *
 * ⚠ 它和 tools/salon/import.mjs 是两件事：那份是"拿最早那份图文版**整份重建**"
 *   （精华 id 会重排，只适合从头来过）；这份是"往现有数据里**追加**"，可以反复跑。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseMonthHtml } from './month-html.mjs';
import { mergeEssences } from './merge.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const SALON_FILE = path.join(PROJ, 'src', 'data', 'salon.json');
const IMG_DIR = path.join(PROJ, 'public', 'img', 'salon');

/** 把压缩包解开到一个临时目录（Windows 10+ / macOS / Linux 都自带 tar，认得 zip） */
function unzip(zipPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-import-'));
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', dir], { stdio: 'ignore' });
  } catch (err) {
    /* 有些精简系统没有 tar：退到 PowerShell（只在 Windows 上有） */
    try {
      execFileSync('powershell', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dir.replace(/'/g, "''")}' -Force`],
      { stdio: 'ignore' });
    } catch {
      throw new Error(`解不开这个压缩包（tar 和 Expand-Archive 都失败了）：${String(err?.message || err)}`);
    }
  }
  return dir;
}

/** 在解开的目录里找那份"精华 HTML" */
function findEssenceHtml(dir) {
  const found = [];
  const walk = (d, depth = 0) => {
    if (depth > 4) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p, depth + 1); continue; }
      if (!/\.html?$/i.test(e.name)) continue;
      /* 「群精华_原始_…」是纯文字版（没有 item 结构），不要它 */
      if (/原始/.test(e.name)) continue;
      const head = fs.readFileSync(p, 'utf8').slice(0, 200000);
      /* 认标记：月度文件是 <div class='item'>，老图文版是 <div class="item"> */
      const items = (head.match(/<div class=['"]item['"]/g) ?? []).length;
      if (items > 0) found.push({ file: p, name: e.name, items });
    }
  };
  walk(dir);
  /* 名字里带「群精华」的优先，其次条目多的 */
  found.sort((a, b) => (Number(/群精华/.test(b.name)) - Number(/群精华/.test(a.name))) || b.items - a.items);
  return found[0] ?? null;
}

/**
 * 干正事：认文件 → 解析 → 合并 → 写盘。
 * @param {{ file: string, dryRun?: boolean, repoRoot?: string }} opts
 */
export function importEssenceFile({ file, dryRun = false, repoRoot = PROJ }) {
  const salonFile = path.join(repoRoot, 'src', 'data', 'salon.json');
  const imageDir = path.join(repoRoot, 'public', 'img', 'salon');
  let target = path.resolve(file);
  if (!fs.existsSync(target)) throw new Error(`找不到这个文件：${target}`);

  let tempDir = '';
  if (/\.zip$/i.test(target)) {
    tempDir = unzip(target);
    const html = findEssenceHtml(tempDir);
    if (!html) throw new Error('压缩包里没找到精华 HTML（要那种带 <div class=\'item\'> 的导出页）');
    target = html.file;
  }

  try {
    const html = fs.readFileSync(target, 'utf8');
    const parsed = parseMonthHtml(html);
    if (!parsed.items.length) {
      throw new Error('这份文件里一条精华都没解析出来 —— 是不是拿错文件了？（要导出管线产出的那份 HTML）');
    }
    const data = JSON.parse(fs.readFileSync(salonFile, 'utf8'));
    const { file: next, report } = mergeEssences({ data, parsed, imageDir, dryRun });
    report.source = path.basename(target);
    if (!dryRun && report.added > 0) {
      try { fs.copyFileSync(salonFile, `${salonFile}.bak`); } catch { /* 第一次没有备份，正常 */ }
      fs.writeFileSync(salonFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }
    return { file: next, report, sourcePath: target };
  } finally {
    if (tempDir) { try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ } }
  }
}

/* ---------------- 命令行 ---------------- */
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const src = args.find((a) => !a.startsWith('--'));
  const asJson = args.includes('--json');
  const dryRun = args.includes('--dry');
  if (!src) {
    console.error('用法：node tools/salon/import-more.mjs "<群精华_2026年9月.html | qq精华-202609.zip>" [--dry] [--json]');
    process.exit(1);
  }
  try {
    const { report } = importEssenceFile({ file: src, dryRun });
    if (asJson) {
      console.log(JSON.stringify(report, null, 1));
    } else {
      console.log(`文件：${report.source}（${report.title}）`);
      console.log(`解析：${report.parsed.items} 条 / 图片 ${report.parsed.images} 张 / 名册 ${report.parsed.people} 人`);
      console.log(`新增：${report.added} 条${report.added ? `（${report.addedIds[0]}…${report.addedIds[report.addedIds.length - 1]}）` : ''}`);
      console.log(`跳过：${report.skipped} 条（站里已有）`);
      for (const s of report.skippedList) console.log(`   · ${s.date} ${s.time || '--:--'} ${s.text}`);
      console.log(`新成员：${report.newMembers.length ? report.newMembers.join('、') : '（没有新的）'}`);
      console.log(`图片：写入 ${report.images} 张 ${(report.imageBytes / 1048576).toFixed(1)} MB`);
      console.log(`总数：精华 ${report.before.essences} → ${report.after.essences}，成员 ${report.before.members} → ${report.after.members}`);
      if (report.updated) console.log(`数据截止：${report.updated.from || '(空)'} → ${report.updated.to}`);
      for (const w of report.warnings) console.log(`⚠ ${w}`);
      if (dryRun) console.log('（--dry：什么都没写）');
    }
    if (report.warnings.length) process.exitCode = 3;
  } catch (err) {
    if (asJson) console.log(JSON.stringify({ ok: false, error: String(err?.message || err) }, null, 1));
    else console.error(`导入失败：${String(err?.message || err)}`);
    process.exit(2);
  }
}
