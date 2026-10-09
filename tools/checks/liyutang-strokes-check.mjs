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
const one = strokePath([[100, 100]]);
check('点一下 → 也能留下一个极短线段（不然"点了没反应"）', /^M 100 100 l 0\.1 0$/.test(one), one);
const two = strokePath([[0, 0], [10, 20]]);
check('两个点 → 一条直线', two === 'M 0 0 L 10 20', two);
const curve = strokePath([[0, 0], [30, 0], [60, 30], [90, 30]]);
check('★ 三个点以上 → 中点二次贝塞尔（Q），不是折线（没有 L）',
  /^M 0 0 Q 30 0 45 15 Q 60 30 75 30 Q 60 30 90 30$/.test(curve), curve);
check('锚点是"相邻两点的中点"：p1(30,0) 与 p2(60,30) 的中点是 (45,15)',
  curve.includes('45 15') && curve.includes('75 30'), curve);
check('smooth:false 时退回折线（对照用）', strokePath([[0, 0], [10, 10], [20, 0]], { smooth: false }) === 'M 0 0 L 10 10 L 20 0');
check('空点集 → 空路径（不抛）', strokePath([]) === '');

console.log('\n=== ④ 校验：一根笔划什么样才算数 ===');
check('正常笔划通过，并且数字被规整',
  (() => {
    const r = checkStroke({ tool: 'pen', color: '#ff0000', size: 999, points: [[1, 2], [3, 4]] });
    return r.ok && r.stroke.size === 64;
  })(), 'size 夹到 64');
check('工具只认 pen / eraser', !checkStroke({ tool: 'spray', color: '#fff', size: 4, points: [[1, 1]] }).ok);
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

console.log('\n=== ⑥ 按人归类（"今天画过画的人"那张表）===');
const faces = paintersOf(strokes);
check('两个人、按笔划数倒序', faces.length === 2 && faces[0].nick === '虹星' && faces[0].count === 1, JSON.stringify(faces));
check('★ 只算画得出来的：删掉的和颜色不合法的那两条都不进表（否则表里会有个"隐形人"）',
  faces.reduce((s, f) => s + f.count, 0) === 2 && !faces.some((f) => f.nick === 'x'),
  JSON.stringify(faces.map((f) => `${f.nick}:${f.count}`)));
check('同一个人的头像取到就行', faces.every((f) => typeof f.avatar === 'string'));

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
