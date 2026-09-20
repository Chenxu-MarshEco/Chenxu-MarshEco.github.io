/*
 * 「首页不许挤压原有元素」的**可复现**证据。
 *
 * 用户最早的硬要求：新加的那些块（关于我入口 / 日历 / 冰室冰山 / 每日精华）不能挤压、
 * 不能挪动首页原来就有的元素；位置不够就让首页能滚轮滚下去。
 *
 * 后来用户又提了一条（原话见 README）：「首次进入网页首页时，画面上只有城市背景和
 * 花涧堂logo 没有下方这些可以点击的卡片」—— 要有一屏封面把卡片顶到折线以下。
 * 这一条**必然**让大板块往下挪一屏，所以判定标准跟着改成：
 *   · 页头 / 徽记 / 落日 / 天际线这些"上面那屏"的元素：x / y / 宽 / 高 一个像素都不许动；
 *   · 两个大板块和它们的两张卡：**尺寸和横向位置一个像素都不许动**（没有被挤压），
 *     纵向只允许"整体下移一屏封面"这一种移动，三者的位移必须一致、且等于封面高度。
 *
 * 做法：现场从 `git HEAD`（= 这一轮动手之前的那份代码）导出一份源码，单独构建出
 * 一个「改动前」的 dist，量一遍；再量当前的 dist，逐项对比。
 *
 * 为什么现场重建而不是读一份存下来的基线：`.tmp` 是临时目录，基线文件被清掉过一次，
 * 结论就再也不能复现了。这里每次跑都从 git 现取，所以结论随时能重跑。
 *
 * 用法：node tools/checks/home-no-squeeze.mjs [<当前dist>] [<对比提交>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const CUR = path.resolve(process.argv[2] ?? path.join(SRC, 'dist'));
/*
 * 拿哪个提交当「改动前」。
 * 默认 HEAD 就是"上一次提交"—— 平时改完东西还没提交时，它正好是动手前那份。
 * 但这一轮的四块已经在 5e203a7 提交进去了，所以想看当初那次真实对比要显式给提交号：
 *   node tools/checks/home-no-squeeze.mjs dist 69ed7e1      # 16:52 那次（没这四块）
 */
const REF = process.argv[3] ?? 'HEAD';
const HEAD = path.join(SRC, '.tmp', 'squeeze-head');
const TAR = path.join(SRC, '.tmp', 'squeeze-head.tar');
const OLD = path.join(SRC, '.tmp', 'squeeze-old.json');
const NOW = path.join(SRC, '.tmp', 'squeeze-now.json');
const CHECK = path.join(SRC, 'tools', 'checks', 'home-geom.mjs');

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/** 摘掉 junction 再删目录（Windows 上直接递归删会把 junction 目标一起带走） */
function rmHead() {
  for (const j of ['node_modules', 'public']) {
    const p = path.join(HEAD, j);
    if (fs.existsSync(p)) {
      try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ }
    }
  }
  try { fs.rmSync(HEAD, { recursive: true, force: true }); } catch { /* ignore */ }
  try { fs.rmSync(TAR, { force: true }); } catch { /* ignore */ }
}

try {
  rmHead();
  fs.mkdirSync(HEAD, { recursive: true });

  /* git archive -> tar 文件 -> 解开。全程用 spawnSync 传参数组，
     不走 cmd /c 的管道（那一路在带空格/中文的路径上会静默失败，踩过一次）。 */
  const a = spawnSync('git', ['archive', REF, '-o', TAR], { cwd: SRC, encoding: 'utf8' });
  const t = spawnSync('tar', ['-xf', TAR, '-C', HEAD], { encoding: 'utf8' });
  const hasIndex = fs.existsSync(path.join(HEAD, 'src', 'pages', 'index.astro'));
  const hasNew = fs.existsSync(path.join(HEAD, 'src', 'components', 'HomeWidgets.astro'));
  /* tar 在 Windows 上遇到个别它建不出来的条目会以 1 退出但仍然把该解的都解出来了，
     所以判定看**解出来没有**，tar 的退出码只当参考一起打出来。 */
  check(`从 git ${REF} 导出「改动前」源码（有首页、且没有这一轮的新文件）`,
    a.status === 0 && hasIndex && !hasNew,
    `git=${a.status} tar=${t.status} index.astro=${hasIndex} HomeWidgets.astro=${hasNew} pages ${fs.existsSync(path.join(HEAD, 'src', 'pages')) ? fs.readdirSync(path.join(HEAD, 'src', 'pages')).length : 0} 项${t.stderr ? ' tar stderr: ' + t.stderr.trim().split('\n').slice(-1)[0] : ''}`);

  /* public 在 HEAD 里是被跟踪的，解出来是一份真目录；换成 junction 指向当前 public，
     让两份构建用**同一套图片产物**，量出来的差别才只来自布局改动。 */
  const headPublic = path.join(HEAD, 'public');
  if (fs.existsSync(headPublic)) fs.rmSync(headPublic, { recursive: true, force: true });
  execSync(`cmd /c mklink /J "${path.join(HEAD, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
  execSync(`cmd /c mklink /J "${headPublic}" "${path.join(SRC, 'public')}"`, { stdio: 'ignore' });

  const b = spawnSync(process.execPath, [path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'], { cwd: HEAD, encoding: 'utf8' });
  const oldHome = path.join(HEAD, 'dist', 'index.html');
  check('改动前那份源码能构建出首页（对比才有意义）',
    b.status === 0 && fs.existsSync(oldHome),
    `${(b.stdout ?? '').trim().split('\n').slice(-1)[0] ?? ''} 首页 ${fs.existsSync(oldHome) ? fs.statSync(oldHome).size + 'B' : '缺失'}`);

  /* 量两份：改动前 / 现在。再跑一次 --compare 把逐项的 ✓/✗ 打出来当证据 */
  const r1 = spawnSync(process.execPath, [CHECK, path.join(HEAD, 'dist'), '--save', OLD], { cwd: SRC, encoding: 'utf8' });
  check('量到「改动前」首页几何', r1.status === 0 && fs.existsSync(OLD), fs.existsSync(OLD) ? fs.statSync(OLD).size + 'B' : '缺失');
  const r2 = spawnSync(process.execPath, [CHECK, CUR, '--save', NOW], { cwd: SRC, encoding: 'utf8' });
  check('量到「现在」首页几何', r2.status === 0 && fs.existsSync(NOW), fs.existsSync(NOW) ? fs.statSync(NOW).size + 'B' : '缺失');

  const oldM = JSON.parse(fs.readFileSync(OLD, 'utf8'));
  const nowM = JSON.parse(fs.readFileSync(NOW, 'utf8'));
  const oldKeys = Object.keys(oldM.rects).filter((k) => oldM.rects[k]);
  const nowKeys = Object.keys(nowM.rects).filter((k) => nowM.rects[k]);
  check('「改动前」那份首页确实量到了元素（不是 404 空页 —— 首轮这里翻过车）',
    oldKeys.length >= 10 && oldM.scroll.height > 400,
    `旧 ${oldKeys.length} 项 / 高度 ${oldM.scroll.height}；新 ${nowKeys.length} 项 / 高度 ${nowM.scroll.height}`);

  const cmp = spawnSync(process.execPath, [CHECK, CUR, '--compare', OLD], { cwd: SRC, encoding: 'utf8' });
  console.log('\n' + (cmp.stdout ?? ''));

  const moved = [];
  /* 这一轮之后允许"整体下移一屏"的三项：两个大板块和它们的卡片 */
  const shiftable = new Set(['.boards', '.boards .board:nth-child(1)', '.boards .board:nth-child(2)']);
  const shifts = [];
  for (const k of oldKeys) {
    const a0 = oldM.rects[k];
    const b0 = nowM.rects[k];
    if (!b0) { moved.push(`${k}（现在没了）`); continue; }
    /*
      尺寸和横向位置：这一轮也不许动（"不要挤压"的核心）。
      纵向：不在这三项里的必须一动不动；在这三项里的只允许整体下移（封面把卡片顶下去了），
      位移记下来，最后要求三者一致而且是"一屏"那么多。
      `.home` 例外：它必须变高（多了一屏封面），但左上角和宽度同样不许动。
    */
    const sizeSame = a0.x === b0.x && a0.w === b0.w && (k === '.home' || a0.h === b0.h);
    if (!sizeSame) moved.push(`${k} 横向/尺寸变了 ${JSON.stringify(a0)} → ${JSON.stringify(b0)}`);
    else if (shiftable.has(k)) shifts.push({ k, dy: +(b0.y - a0.y).toFixed(1) });
    else if (a0.y !== b0.y) moved.push(`${k} 纵向动了 ${a0.y} → ${b0.y}`);
  }
  check(`改动前就有的元素：横向位置、宽度、高度一个像素都没变（没有被挤压）`,
    moved.length === 0, moved.length ? moved.join(' | ') : `逐项一致：${oldKeys.join(' ')}`);

  /* 三张板块卡的位移必须一致，而且是"被封面顶下去一屏"那么多 */
  const shiftVals = [...new Set(shifts.map((s) => s.dy))];
  check('大板块只是被封面**整体下移一屏**（三者位移一致，位移约等于一屏高）',
    shifts.length === 3 && shiftVals.length === 1 && shiftVals[0] > nowM.viewport.h * 0.5,
    `位移 ${JSON.stringify(shifts)}；视口高 ${nowM.viewport.h}px`);

  const grown = nowM.rects['.home'] && oldM.rects['.home'] ? nowM.rects['.home'].h - oldM.rects['.home'].h : 0;
  check(`.home 只长高（长了 ${grown.toFixed(1)}px：封面那一屏 + 新块占的地方）`, grown > 0, `长了 ${grown.toFixed(1)}px`);

  const added = nowKeys.filter((k) => !oldM.rects[k]);
  check('新块是**新增**的（改动前那些选择器在旧构建里量不到），不是从别处挤出来的',
    added.length >= 4 && added.some((k) => k.includes('extras')) && added.some((k) => k.includes('cal')) && added.some((k) => k.includes('ice')) && added.some((k) => k.includes('daily')),
    `新增：${added.join(' ')}`);

  const grew = nowM.scroll.height - oldM.scroll.height;
  check(`首页变长、滚轮能往下滚（页面高度 ${oldM.scroll.height} → ${nowM.scroll.height}，+${grew}px；可滚 ${oldM.scroll.canScroll} → ${nowM.scroll.canScroll}）`,
    nowM.scroll.height > oldM.scroll.height && nowM.scroll.canScroll === true, '');
  console.log(`\n关键数字：视口 ${oldM.viewport.w}×${oldM.viewport.h}；`.concat(
    `品牌 .site-brand ${JSON.stringify(nowM.rects['.site-brand'])}；`,
    `大板块 .boards ${JSON.stringify(nowM.rects['.boards'])}；`,
    `新块 .extras ${JSON.stringify(nowM.rects['.extras'])}`));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  rmHead();
  console.log('临时构建目录已清理:', !fs.existsSync(HEAD));
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
