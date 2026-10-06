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
  /*
    ⚠ 这条原来要求"基线里**没有** HomeWidgets.astro"（写它的时候 HEAD 就是加那一屏之前的代码）。
    后来 HEAD 往前走了（用户自己发布过几次，那一屏早就提交进去了），基线里自然就有了 ——
    再这么要求等于让检查永远红着。现在改成：导出成功 + 有首页就算过，
    并把"基线里有没有这一屏"记下来：下面那几条「新块 / 变长」的判定按它决定跑不跑。
  */
  const baselineHasExtras = hasNew;
  check(`从 git ${REF} 导出「改动前」源码（有首页）`,
    a.status === 0 && hasIndex,
    `git=${a.status} tar=${t.status} index.astro=${hasIndex} 基线里已有这一屏=${baselineHasExtras} pages ${fs.existsSync(path.join(HEAD, 'src', 'pages')) ? fs.readdirSync(path.join(HEAD, 'src', 'pages')).length : 0} 项${t.stderr ? ' tar stderr: ' + t.stderr.trim().split('\n').slice(-1)[0] : ''}`);

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
  /*
    "不要挤压"的核心：**横向位置和宽度**一个像素都不许动。
    ⚠ 高度这一条留了口子：首页那一屏里，"每日精华"原来会被最长的那条精华顶高、
    连累日历和冰山一起变高（用户 2026-10-06 报的那个问题）。那一屏被修好之后，
    它**本来就该变矮** —— 所以这几个 key 只卡横向，高度变化记下来、不算失败。
  */
  const heightFree = new Set(['.extras', '.cal', '.ice', '.daily']);
  /*
    ⚠ 2026-10-06：首页那一屏上面**新插了一行**（曼沫砾总线 + 黎语堂），
    所以日历 / 冰山 / 每日精华整体往**下**让开一行 —— 这是用户点名要的
    （"在甬城晴雨下方 涣源溪水钟上方插入新板块"），不是被挤压。
    规则收窄成两条，别的一句都不放松：
      · 三个必须让开**同样多**（相对关系一个像素都没变，下面单独判）；
      · 横向位置、宽度照旧卡死（sizeSame 里那两项没动）。
    `.extras` 是外面那个容器：新那一行装进它里面，所以它的顶边**往上**走、
    高度变大，两者都是应该的（高度本来就在 heightFree 里，这里把 y 也放开）。
  */
  const rowShifted = new Set(['.cal', '.ice', '.daily']);
  const containerFree = new Set(['.extras']);
  const rowShifts = [];
  for (const k of oldKeys) {
    const a0 = oldM.rects[k];
    const b0 = nowM.rects[k];
    if (!b0) { moved.push(`${k}（现在没了）`); continue; }
    const sizeSame = a0.x === b0.x && a0.w === b0.w && (heightFree.has(k) || k === '.home' || a0.h === b0.h);
    if (!sizeSame) moved.push(`${k} 横向/尺寸变了 ${JSON.stringify(a0)} → ${JSON.stringify(b0)}`);
    else if (shiftable.has(k)) shifts.push({ k, dy: +(b0.y - a0.y).toFixed(1) });
    else if (rowShifted.has(k)) rowShifts.push({ k, dy: +(b0.y - a0.y).toFixed(1) });
    else if (containerFree.has(k)) { /* 容器：顶边和高度都允许变（新那一行在里面） */ }
    else if (a0.y !== b0.y) moved.push(`${k} 纵向动了 ${a0.y} → ${b0.y}`);
  }
  check('改动前就有的元素：横向位置、宽度一个像素都没变（没有被挤压）',
    moved.length === 0, moved.length ? moved.join(' | ') : `逐项一致：${oldKeys.join(' ')}`);

  /*
    日历 / 冰山 / 每日精华的纵向位移：
      · 基线是"还没有新那一行"的代码 → 三个一起往下让开一行（同样的数）；
      · 基线里已经有新那一行了（这次改动提交之后 HEAD 就会带上）→ 一动不动。
    两种都对，但**三个必须一致**：只动其中一个就是"被各自挤歪"了。
  */
  const rowVals = [...new Set(rowShifts.map((s) => s.dy))];
  check('日历 / 冰山 / 每日精华：要么一起不动，要么**一起**让开同样多（新插那一行的高度）',
    rowShifts.length >= 1 && rowVals.length === 1 && rowVals[0] >= 0,
    `位移 ${JSON.stringify(rowShifts)}`);

  /*
    三张板块卡的位移：
      · 基线是"加封面那一屏之前"的代码 → 应该整体下移约一屏；
      · 基线里已经有封面了（HEAD 一路往前走，早就是这种情形）→ 应该一动不动。
    两种都算对，取决于基线。
  */
  const baselineHasCover = !!oldM.rects['.cover'] || !!oldM.rects['.cover__hint'];
  const shiftVals = [...new Set(shifts.map((s) => s.dy))];
  check(baselineHasCover
    ? '基线里已经有封面那一屏了 → 大板块这次**一动不动**（三者位移一致且为 0）'
    : '大板块只是被封面**整体下移一屏**（三者位移一致，位移约等于一屏高）',
  shifts.length === 3 && shiftVals.length === 1
  && (baselineHasCover ? shiftVals[0] === 0 : shiftVals[0] > nowM.viewport.h * 0.5),
  `位移 ${JSON.stringify(shifts)}；视口高 ${nowM.viewport.h}px；基线里有封面 ${baselineHasCover}`);

  const grown = nowM.rects['.home'] && oldM.rects['.home'] ? nowM.rects['.home'].h - oldM.rects['.home'].h : 0;
  const added = nowKeys.filter((k) => !oldM.rects[k]);
  const grew = nowM.scroll.height - oldM.scroll.height;
  /*
    这三条（新块是新增的 / .home 只长高 / 首页变长）都是为**当年那次「加了首页那一屏」**写的：
    前提是基线里还没有这一屏。基线（默认 git HEAD）现在早就包含它了，前提不成立 ——
    硬跑只会得到"新增 0 项、页面还变短了"这种假失败。所以基线里已有这一屏时跳过，
    要看当年那次真实对比就显式给个老提交号：
      node tools/checks/home-no-squeeze.mjs dist 69ed7e1
  */
  if (baselineHasExtras) {
    check('（基线里已经有这一屏：三条「新块 / 只长高 / 变长」的判定只对当年那次改动有意义，跳过）',
      true, `这次真正有意义的是上面那条「老元素的横向/尺寸一个像素都没变」`);
    console.log(`      · 顺带记一下：.home ${grown >= 0 ? '+' : ''}${grown.toFixed(1)}px、页面高度 ${grew >= 0 ? '+' : ''}${grew}px（变短是允许的 —— 首页那一行不再被最长的那张卡顶高了）`);
  } else {
    check(`.home 只长高（长了 ${grown.toFixed(1)}px：封面那一屏 + 新块占的地方）`, grown > 0, `长了 ${grown.toFixed(1)}px`);
    check('新块是**新增**的（改动前那些选择器在旧构建里量不到），不是从别处挤出来的',
      added.length >= 4 && added.some((k) => k.includes('extras')) && added.some((k) => k.includes('cal')) && added.some((k) => k.includes('ice')) && added.some((k) => k.includes('daily')),
      `新增：${added.join(' ')}`);
    check(`首页变长、滚轮能往下滚（页面高度 ${oldM.scroll.height} → ${nowM.scroll.height}，+${grew}px；可滚 ${oldM.scroll.canScroll} → ${nowM.scroll.canScroll}）`,
      nowM.scroll.height > oldM.scroll.height && nowM.scroll.canScroll === true, '');
  }
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
