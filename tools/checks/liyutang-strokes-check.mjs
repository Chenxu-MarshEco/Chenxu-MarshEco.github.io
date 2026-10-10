/*
 * ============================================================================
 * 画板「笔划」这套几何的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户对画板的要求里有两条是"手感"和"存档"：
 *   「让画画的手感可以比较舒服丝滑」+「每天保存一次画 …… 查看每一天的画板上都画了什么」。
 * 这两条最后都落在同一个纯函数模块上（src/utils/liyutang-strokes.mjs）：
 *   手感 = 中点二次贝塞尔那套路径（不是折线）；
 *   存档 = 同一批笔划渲染成一张 SVG（node 里跑，不需要画布）。
 * 所以这一段量的是它：路径长什么样、越界和脏数据怎么处理、SVG 干不干净、按人归类对不对。
 *
 * 用法：node tools/checks/liyutang-strokes-check.mjs
 * ============================================================================
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const mod = await import(new URL(`file:///${path.join(SRC, 'src', 'utils', 'liyutang-strokes.mjs').replace(/\\/g, '/')}`).href);
const { BOARD_W, BOARD_H, MAX_POINTS, safeColor, cleanPoints, strokePath, checkStroke, strokesToSvg, paintersOf } = mod;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};

console.log('=== ① 颜色：只收 #rrggbb（不给用户写 CSS 的机会）===');
check('正常六位色原样收下', safeColor('#FFB547') === '#ffb547');
check('三位简写展开成六位', safeColor('#abc') === '#aabbcc');
check('★ 塞 CSS 进来 → 空串（`red;background:url(x)`、`url(javascript:…)` 都不行）',
  safeColor('red;background:url(x)') === '' && safeColor('url(javascript:alert(1))') === '' &&
    safeColor('rgb(1,2,3)') === '' && safeColor('#12345') === '', '');

console.log('\n=== ② 点集：越界的夹回来、重复的去掉、太多的截断 ===');
const cleaned = cleanPoints([
  [-50, 10], [10, 10], [10, 10], [99999, 20], ['x', 'y'], [5], [BOARD_W, BOARD_H],
]);
check('★ 负坐标和超大坐标都被夹进画布',
  cleaned[0][0] === 0 && cleaned.some(([x, y]) => x === BOARD_W && y === BOARD_H),
  JSON.stringify(cleaned));
check('重复点只留一个', cleaned.filter(([x, y]) => x === 10 && y === 10).length === 1);
check('非数字 / 缺坐标的点被丢掉', cleaned.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
const many = cleanPoints(Array.from({ length: MAX_POINTS + 500 }, (_, i) => [i % BOARD_W, (i * 2) % BOARD_H]));
check(`点数被截到上限 ${MAX_POINTS}`, many.length === MAX_POINTS, String(many.length));

console.log('\n=== ③ 路径：手感就是这一段 ===');
/*
  ⚠ 2026-10-10：路径从**绝对命令**改成**相对命令**（`q`/`l` 写增量，省掉命令后的空格）——
  存档那天的 SVG 是仓库里最大的东西，相对写法实测省掉近一半，几何**一模一样**。
  所以下面这些断言改成判**几何**而不是判语法：先把相对路径还原成绝对坐标再比。
  （比"把期望字符串换成新写法"更结实：以后谁再改写法，只要几何没变就不会假红。）
*/
const toAbsolute = (d) => {
  /* 只认我们这两种命令：M（绝对起点）、l/q（相对）。返回绝对坐标序列 + 全程是否只有相对命令。 */
  const toks = String(d).match(/[Mlq]|-?\d*\.?\d+/g) ?? [];
  const out = [];
  let cmd = '';
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(toks[i++]);
  while (i < toks.length) {
    const t = toks[i];
    if (/^[Mlq]$/.test(t)) {
      cmd = t;
      i += 1;
      continue;
    }
    if (cmd === 'M') {
      x = num(); y = num(); out.push([x, y]);
    } else if (cmd === 'l') {
      x += num(); y += num(); out.push([x, y]);
    } else if (cmd === 'q') {
      const cx = x + num(); const cy = y + num(); const ex = x + num(); const ey = y + num();
      out.push([cx, cy], [ex, ey]); x = ex; y = ey;
    } else {
      i += 1;
    }
  }
  return out;
};
const one = strokePath([[100, 100]]);
const oneAbs = toAbsolute(one);
check('点一下 → 也能留下一个极短线段（不然"点了没反应"）',
  /^M100 100l\.1 0$/.test(one) && oneAbs.length === 2 &&
    Math.abs(oneAbs[1][0] - oneAbs[0][0] - 0.1) < 1e-9 && oneAbs[1][1] === oneAbs[0][1],
  one);
const two = strokePath([[0, 0], [10, 20]]);
check('两个点 → 一条直线（相对写法，几何是 (0,0)→(10,20)）',
  !/[A-Z]/.test(two.replace(/M/g, '')) && JSON.stringify(toAbsolute(two)) === JSON.stringify([[0, 0], [10, 20]]), two);
const curve = strokePath([[0, 0], [30, 0], [60, 30], [90, 30]]);
/* 期望的绝对几何：起点 + 三段二次贝塞尔（控制点、终点）——就是原来那串 Q 命令 */
const wantCurve = [[0, 0], [30, 0], [45, 15], [60, 30], [75, 30], [60, 30], [90, 30]];
check('★ 三个点以上 → 中点二次贝塞尔（q），不是折线（相对命令里没有 l/大写 L）',
  /^M0 0q/.test(curve) && !/l/.test(curve) && JSON.stringify(toAbsolute(curve)) === JSON.stringify(wantCurve), curve);
check('锚点是"相邻两点的中点"：p1(30,0) 与 p2(60,30) 的中点是 (45,15)',
  JSON.stringify(toAbsolute(curve)[2]) === JSON.stringify([45, 15]) &&
    JSON.stringify(toAbsolute(curve)[4]) === JSON.stringify([75, 30]), curve);
check('smooth:false 时退回折线（对照用）',
  JSON.stringify(toAbsolute(strokePath([[0, 0], [10, 10], [20, 0]], { smooth: false }))) ===
    JSON.stringify([[0, 0], [10, 10], [20, 0]]));
check('空点集 → 空路径（不抛）', strokePath([]) === '');

console.log('\n=== ④ 校验：一根笔划什么样才算数 ===');
check('正常笔划通过，并且数字被规整',
  (() => {
    const r = checkStroke({ tool: 'pen', color: '#ff0000', size: 999, points: [[1, 2], [3, 4]] });
    return r.ok && r.stroke.size === 64;
  })(), 'size 夹到 64');
check('工具只认 pen / eraser / erase（画笔 / 老橡皮 / 像素橡皮）',
  !checkStroke({ tool: 'spray', color: '#fff', size: 4, points: [[1, 1]] }).ok &&
    checkStroke({ tool: 'erase', color: '#fbf6ee', size: 40, points: [[1, 1], [2, 2]] }).ok);
check('颜色不对 → 不通过', !checkStroke({ tool: 'pen', color: 'red', size: 4, points: [[1, 1]] }).ok);
check('没有点 → 不通过', !checkStroke({ tool: 'pen', color: '#ffffff', size: 4, points: [] }).ok);

console.log('\n=== ⑤ SVG：存档那一张图 ===');
const strokes = [
  { id: 'a', nick: '虹星', userId: 'u1', avatar: '/x.png', tool: 'pen', color: '#ff0000', size: 6, points: [[10, 10], [50, 10], [90, 40]] },
  { id: 'b', nick: 'hoshi', userId: 'u2', tool: 'eraser', color: '#000000', size: 20, points: [[40, 5], [60, 20]] },
  { id: 'c', nick: '虹星', userId: 'u1', tool: 'pen', color: '#00ff00', size: 4, points: [[0, 0]], deleted: true },
  { id: 'bad', nick: 'x', tool: 'pen', color: 'red', size: 4, points: [[1, 1]] },
];
const svg = strokesToSvg(strokes);
check('是合法的 SVG 开头（带 viewBox 和纸色底）',
  svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_W} ${BOARD_H}"`) && svg.includes(`<rect width="${BOARD_W}" height="${BOARD_H}" fill="#fbf6ee" />`),
  svg.slice(0, 90));
check('★ 有效笔划都画成了 path（2 条），被删的和脏数据都没进去',
  (svg.match(/<path /g) || []).length === 2, `${(svg.match(/<path /g) || []).length} 条`);
check('★ 橡皮按纸色画（存档靠"顺序重放"，不搞 destination-out）',
  svg.includes('stroke="#fbf6ee"'), '');
check('每条笔划标了作者（逐人显隐 / 存档都要）', svg.includes('data-by="虹星"') && svg.includes('data-by="hoshi"'));
check('圆的笔头圆角（手感）', svg.includes('stroke-linecap="round"') && svg.includes('stroke-linejoin="round"'));
const evil = strokesToSvg([{ nick: '"><script>alert(1)</script>', tool: 'pen', color: '#ffffff', size: 2, points: [[1, 1], [2, 2]] }]);
check('★ 昵称里的尖括号被转义（不留注入的路子）',
  !/<script/.test(evil) && evil.includes('&lt;script&gt;'), evil.includes('&lt;script&gt;') ? '' : evil.slice(0, 120));

console.log('\n=== ⑥ 像素橡皮（tool=erase）：存档里是一层 mask，顺序不能乱 ===');
/*
  2026-10-10 加的第二种橡皮：它不是"画一条纸色笔划盖住"，而是**把底下的墨去掉**。
  画布那边是 destination-out；存档这边（这张 SVG）**必须做同一件事**，否则
  "存档长得和当时一模一样"这条老规矩就断了。做法是一层 `<mask>` + 嵌套 `<g mask>`：
  一根 erase 把它后面的内容包进去，黑笔画过的地方从那些内容里挖掉。

  下面这段先量结构（纯 node），再在 ⑦ 里拿真浏览器**渲染出来读像素**（结构对不代表画出来对）。
*/
const maskInk = '#ff0000';
const maskInk2 = '#0000ff';
const maskErase = { id: 'e1', nick: '虹星', tool: 'erase', color: '#fbf6ee', size: 60, points: [[400, 300], [600, 300]] };
const maskStrokes = [
  { id: 'p1', nick: '虹星', tool: 'pen', color: maskInk, size: 40, points: [[0, 300], [1200, 300]] },
  maskErase,
  { id: 'p2', nick: 'hoshi', tool: 'pen', color: maskInk2, size: 40, points: [[500, 0], [500, 600]] },
  { id: 'e2', nick: 'hoshi', tool: 'erase', color: '#fbf6ee', size: 120, points: [[1100, 300], [1150, 300]] },
];
const maskSvg = strokesToSvg(maskStrokes, { w: BOARD_W, h: BOARD_H });
const eraseD = strokePath(maskErase.points);
check('★ 像素橡皮那一笔**不是一条看得见的 path**（它自己没有墨），而是一层 <mask>',
  (maskSvg.match(/<path /g) || []).length === 4 /* 3 根看得见的 + mask 里那 1 根 */ &&
    maskSvg.includes('<mask id="lt-erase-1" maskUnits="userSpaceOnUse"') &&
    !maskSvg.includes(`stroke="#fbf6ee"`));
check('★ mask 里是"白底 + 黑笔"：白底=全都看得见，黑的那条 = 划过的地方挖掉',
  /<mask id="lt-erase-1"[^>]*><rect x="0" y="0" width="\d+" height="\d+" fill="#ffffff" \/><path d="[^"]+" fill="none" stroke="#000000" stroke-width="60" stroke-linecap="round" stroke-linejoin="round" \/><\/mask>/.test(maskSvg));
check('★ mask 里那条黑笔的几何 = 画布上那一笔的几何（同一份 strokePath）',
  maskSvg.includes(`<path d="${eraseD}" fill="none" stroke="#000000"`), eraseD);
check('★ 顺序：erase 擦的是**它之前**画的内容（红线在 mask1 里），**之后**画的蓝线在外面',
  (() => {
    const g1 = /<g mask="url\(#lt-erase-1\)">([\s\S]*?)<\/g>/.exec(maskSvg)?.[1] ?? '';
    return g1.includes(`stroke="${maskInk}"`) && !g1.includes(`stroke="${maskInk2}"`);
  })(), maskSvg.slice(0, 240));
check('★ 两根 erase → 嵌套两层（后一根把前面那一坨整个再包一层）',
  /<g mask="url\(#lt-erase-2\)"><g mask="url\(#lt-erase-1\)">/.test(maskSvg),
  /<g mask="url\(#lt-erase-2\)">.{0,40}/.exec(maskSvg)?.[0] ?? '');
check('没有 erase 的老笔划表：一个 mask 都不该冒出来（不能给历史存档平白加东西）',
  !strokesToSvg(strokes).includes('<mask'));

console.log('\n=== ⑦ 真浏览器：把这张存档 SVG 渲染出来，量像素（结构对 ≠ 画出来对）===');
/*
  为什么非得渲染一遍：`<mask>` 有几个坑（默认 maskUnits 是 objectBoundingBox、
  嵌套遮罩是相乘不是覆盖、黑白谁挖谁）—— 只看字符串是看不出来的。
  这里把 ⑥ 那张 SVG 当图片画进 canvas，再读三个像素：
    · (200,300) 红线上**没被擦到**的地方 → 还是红的；
    · (500,300) 红线**被擦到**的地方 → 变成纸色（这说明遮罩真的挖下去了）；
    · (500,450) erase **之后**画的蓝线 → 还在（顺序是对的，没被"擦前面"误伤）。
*/
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9411;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let chrome = null;
try {
  const { spawn, execSync } = await import('node:child_process');
  chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio',
      '--disable-breakpad', `--user-data-dir=${path.join(process.env.TEMP ?? '.', `dsh-strokes-${Date.now()}`)}`,
      `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' }
  );
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 Chrome 起来 */
    }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + expr.slice(0, 80));
    return r.result.value;
  };
  await send('Runtime.enable');
  const b64 = Buffer.from(maskSvg, 'utf8').toString('base64');
  const shot = await ev(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,${b64}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = ${BOARD_W};
      c.height = ${BOARD_H};
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const at = (x, y) => {
        const d = g.getImageData(x, y, 1, 1).data;
        return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      };
      return {
        intact: at(200, 300),
        erased: at(430, 300),
        laterCross: at(500, 300),
        after: at(500, 450),
        second: at(1125, 300),
        secondOff: at(990, 300),
      };
    })()`);
  check('★ 没被擦到的红线还是红的（遮罩没有把整条线挖掉）', shot.intact === '#ff0000', JSON.stringify(shot));
  check('★ 被擦到的地方真的变成纸色（这就是"仅去除划过的地方的像素"）',
    shot.erased === '#fbf6ee', JSON.stringify(shot));
  check('★ erase **之后**画的蓝线穿过擦痕也**没被挖掉**（顺序对：擦的是它之前的墨）',
    shot.laterCross === '#0000ff' && shot.after === '#0000ff', JSON.stringify(shot));
  check('★ 第二根 erase（嵌套在外面那一层）也照常生效，而且只擦自己那一条带子',
    shot.second === '#fbf6ee' && shot.secondOff === '#ff0000', JSON.stringify(shot));
  /* 顺带量一张"没有 erase 的"：渲染出来必须一笔不少（别把老的存档弄坏） */
  const plainSvg = strokesToSvg([
    { id: 'q1', nick: '虹星', tool: 'pen', color: '#00aa00', size: 30, points: [[0, 800], [1200, 800]] },
    { id: 'q2', nick: '虹星', tool: 'eraser', color: '#000000', size: 60, points: [[600, 800], [700, 800]] },
  ], { w: BOARD_W, h: BOARD_H });
  const plain = await ev(`(async () => {
      const img = new Image();
      img.src = 'data:image/svg+xml;base64,${Buffer.from(plainSvg, 'utf8').toString('base64')}';
      await img.decode();
      const c = document.createElement('canvas');
      c.width = ${BOARD_W}; c.height = ${BOARD_H};
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const at = (x, y) => { const d = g.getImageData(x, y, 1, 1).data; return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); };
      return { ink: at(300, 800), covered: at(650, 800) };
    })()`);
  check('老写法（tool=eraser = 纸色笔划）在存档里照旧"盖住"——历史那几天的图一个像素不变',
    plain.ink === '#00aa00' && plain.covered === '#fbf6ee', JSON.stringify(plain));
  ws.close();
} catch (err) {
  fail += 1;
  console.log('FAIL  真浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  if (chrome) {
    try {
      const { execSync } = await import('node:child_process');
      execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* 已退 */
    }
  }
}

console.log('\n=== ⑧ 按人归类（"今天画过画的人"那张表）===');
const faces = paintersOf(strokes);
check('两个人、按笔划数倒序', faces.length === 2 && faces[0].nick === '虹星' && faces[0].count === 1, JSON.stringify(faces));
check('★ 只算画得出来的：删掉的和颜色不合法的那两条都不进表（否则表里会有个"隐形人"）',
  faces.reduce((s, f) => s + f.count, 0) === 2 && !faces.some((f) => f.nick === 'x'),
  JSON.stringify(faces.map((f) => `${f.nick}:${f.count}`)));
check('同一个人的头像取到就行', faces.every((f) => typeof f.avatar === 'string'));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
