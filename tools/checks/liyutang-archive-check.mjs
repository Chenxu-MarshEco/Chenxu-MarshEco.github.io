/*
 * ============================================================================
 * 聊天室「每日存档」的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：「每天保存一次聊天记录 …… 保存的聊天记录最好可以不调用腾讯云的额度
 * 例如保存在本地仓库？但是需要所有用户都能搜索」。
 *
 * 这一段量的是**存档这条流水线**，分两截：
 *   ① 纯函数：喂一批假消息给 writeArchive()，看它到底写了什么 ——
 *      文件在不在、图片字节解出来对不对、头像有没有按内容去重、
 *      索引有没有按日期倒序、跑第二遍会不会重复、--dry 是不是真不落盘；
 *   ② 命令行那条路：起一个假的"云函数"HTTP 服务，真跑一遍
 *      `node tools/liyutang-archive.mjs --day … --prune --root <临时目录>`，
 *      看它发出去的是不是 LT_ADMIN_CHAT_DAY / LT_ADMIN_CHAT_PRUNE、带没带密码和日期、
 *      以及"这一天没人说话"时会不会乖乖不写文件。
 *
 * 用法：node tools/checks/liyutang-archive-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
/* 画板坐标系（尺寸会变，别再写死数字） */
import { BOARD_W, BOARD_H } from '../../src/utils/liyutang-strokes.mjs';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(SRC, 'tools', 'liyutang-archive.mjs');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

const { writeArchive, writeDrawArchive, yesterdayInBeijing, decodeDataUrl } = await import(
  new URL(`file:///${SCRIPT.replace(/\\/g, '/')}`).href
);

/* 一张 1×1 的 PNG、一张 1×1 的 GIF、一张同样的 PNG（用来验头像去重） */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9UeIAAAAAElFTkSuQmCC';
const GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

/* ============================================================ ① 纯函数 */

console.log('=== ① 纯函数：writeArchive 到底写了什么 ===');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-'));
const day = '2026-10-08';
const messages = [
  { id: 'm3', nick: '虹星', avatar: PNG, text: '最后一句', image: '', createdAt: 3000, deleted: false },
  { id: 'm1', nick: '虹星', avatar: PNG, text: '带图的一句', image: PNG, createdAt: 1000, deleted: false },
  { id: 'm2', nick: 'hoshi', avatar: GIF, text: '撤回了的那句', image: '', createdAt: 2000, deleted: true },
];
const sum = writeArchive({ day, messages, root: tmp, now: Date.UTC(2026, 9, 9, 0, 10, 0) });

const chatDir = path.join(tmp, 'src', 'data', 'chat');
const imgDir = path.join(tmp, 'public', 'img', 'chat');
const dayFile = path.join(chatDir, `${day}.json`);
const indexFile = path.join(chatDir, 'index.json');

check('写出了那一天的 JSON', fs.existsSync(dayFile));
check('写好了索引 index.json', fs.existsSync(indexFile));
check('图片解出来了（public/img/chat/<日>/<消息 id>.webp）',
  fs.existsSync(path.join(imgDir, day, 'm1.png')), fs.existsSync(path.join(imgDir, day, 'm1.png')) ? 'm1.png' : '缺');
const avFiles = fs.existsSync(path.join(imgDir, 'avatars')) ? fs.readdirSync(path.join(imgDir, 'avatars')) : [];
check('★ 头像按内容去重：两条消息同一个头像 → 只写一份', avFiles.length === 2, avFiles.join(','));

const saved = JSON.parse(fs.readFileSync(dayFile, 'utf8'));
check('消息按时间正序，一条不少', saved.messages.length === 3 && saved.messages[0].id === 'm1' && saved.messages[2].id === 'm3');
check('★ 图片字段换成了仓库里的静态路径（不再是大 base64）',
  saved.messages[0].image === `/img/chat/${day}/m1.png`, saved.messages[0].image);
check('★ 头像字段也换成了静态路径', /^\/img\/chat\/avatars\/av-[0-9a-f]{8}\.png$/.test(saved.messages[0].avatar), saved.messages[0].avatar);
check('撤回的那条**照样存档**（历史要完整，只是打了标记）',
  saved.messages.some((m) => m.id === 'm2' && m.deleted === true));
check('存档里写了 count / images / archivedAt',
  saved.count === 3 && saved.images === 1 && /^2026-10-09T00:10:00/.test(String(saved.archivedAt)), JSON.stringify({ c: saved.count, i: saved.images }));

/* 写盘的图片字节，和 data URL 里解出来的字节必须一模一样（不能压、不能转） */
const pngBytes = decodeDataUrl(PNG).buf;
const wroteBytes = fs.readFileSync(path.join(imgDir, day, 'm1.png'));
check('★ 写下去的图片字节和原始 data URL 完全一致（没重编码）', Buffer.compare(pngBytes, wroteBytes) === 0,
  `${wroteBytes.length} 字节`);

const idx = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
check('索引里记了这一天（条数 / 图数 / 都有谁）',
  idx.days.length === 1 && idx.days[0].day === day && idx.days[0].count === 3 && idx.days[0].images === 1,
  JSON.stringify(idx.days[0]));
check('索引里的 users 去重了', JSON.stringify(idx.days[0].users) === JSON.stringify(['虹星', 'hoshi']), JSON.stringify(idx.days[0].users));
check('索引带说明（别手改那句）', Array.isArray(idx._readme) && idx._readme.join('').includes('别手改'));

/* 再跑一遍：同一天要覆盖、不能变成两条 */
const again = writeArchive({ day, messages, root: tmp, now: Date.UTC(2026, 9, 9, 1, 0, 0) });
const idx2 = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
check('★ 同一天再跑一遍 → 索引里还是一天（覆盖，不是追加）', idx2.days.length === 1 && idx2.days[0].day === day);
check('再跑一遍也不报错、条数一样', again.messages === 3 && again.images === 1);

/* 第二天 */
writeArchive({ day: '2026-10-09', messages: [{ id: 'x1', nick: '虹星', avatar: '', text: '新的一天', createdAt: 10, deleted: false }], root: tmp });
const idx3 = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
check('★ 索引按日期倒序（最新的在前）', idx3.days[0].day === '2026-10-09' && idx3.days[1].day === '2026-10-08',
  idx3.days.map((d) => d.day).join(' > '));

/* dry：一个字节都不该落盘 */
const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-dry-'));
const drySum = writeArchive({ day, messages, root: tmp2, dry: true });
check('--dry：算得出概要，但一个文件都不写',
  drySum.messages === 3 && !fs.existsSync(path.join(tmp2, 'src')), `messages=${drySum.messages}`);

/*
  北京时间切天：切点是**凌晨四点**（2026-10-09 用户要求："每天保存一次"挪到四点跑，覆盖 昨天04:00→今天04:00）。
  ⚠ 这条断言原来是按**午夜**切写的（"23:30 与 00:30 分属不同天"）—— 四点切之后它是错的：
    23:30 与次日 00:30 都还在同一个"四点日"里，属于**同一天**；真正翻页的是 03:59 / 04:01。
  所以改成一对边界：跨零点的两刻同天，跨四点的两刻不同天。
*/
const bj = (h, m, d = 9) => Date.UTC(2026, 9, d, h - 8, m); // 北京时间 → UTC
const y1 = yesterdayInBeijing(bj(23, 30));
const y2 = yesterdayInBeijing(bj(0, 30, 10));
const y3 = yesterdayInBeijing(bj(3, 59, 10));
const y4 = yesterdayInBeijing(bj(4, 1, 10));
const y5 = yesterdayInBeijing(bj(12, 0, 10));
check('★ "昨天"按北京时间**凌晨四点**切：23:30 与次日 00:30 同一天，03:59 与 04:01 分属两天',
  y1 === y2 && y3 !== y4 && y4 === y5 && y1 === '2026-10-08' && y4 === '2026-10-09',
  `23:30=${y1} 00:30=${y2} 03:59=${y3} 04:01=${y4} 12:00=${y5}`);

/* ============================================================ ②-b 画板存档（纯函数） */

console.log('\n=== ②-b 画板存档：笔划 → JSON + 一张 SVG ===');
const tmpDraw = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-draw-archive-'));
const drawStrokes = [
  { id: 's1', uk: 'aaaa1111', nick: '虹星', avatar: '', tool: 'pen', color: '#1d1430', size: 8, points: [[100, 100], [300, 200], [500, 150]], createdAt: 1000 },
  { id: 's2', uk: 'bbbb2222', nick: 'hoshi', avatar: '', tool: 'eraser', color: '#fbf6ee', size: 20, points: [[200, 150], [260, 170]], createdAt: 2000 },
  { id: 's3', uk: 'aaaa1111', nick: '虹星', avatar: '', tool: 'pen', color: '#ff4d6d', size: 6, points: [[300, 300]], createdAt: 3000, deleted: true },
  { id: 'bad', uk: 'x', nick: 'x', tool: 'pen', color: 'red', size: 4, points: [[1, 1]], createdAt: 4000 },
];
const drawSum = writeDrawArchive({ day: '2026-10-08', strokes: drawStrokes, root: tmpDraw, now: Date.UTC(2026, 9, 9, 0, 10, 0) });
const drawDirOut = path.join(tmpDraw, 'src', 'data', 'draw');
const drawDayFile = path.join(drawDirOut, '2026-10-08.json');
const drawSvgFile = path.join(tmpDraw, 'public', 'img', 'draw', '2026-10-08.svg');
check('画板存档：那天的 JSON + 一张 SVG 都写出来了', fs.existsSync(drawDayFile) && fs.existsSync(drawSvgFile));
check('画板存档：索引写出来了', fs.existsSync(path.join(drawDirOut, 'index.json')));

const drawJson = JSON.parse(fs.readFileSync(drawDayFile, 'utf8'));
check('★ 脏笔划（颜色不合法）和删掉的那笔都没进存档', drawJson.count === 2 && drawJson.strokes.length === 2, `${drawJson.count} 笔`);
check('★ 按人归好了（谁画了几笔）',
  drawJson.painters.length === 2 && drawJson.painters.some((p) => p.nick === '虹星' && p.count === 1),
  JSON.stringify(drawJson.painters));
check('笔划带着工具 / 颜色 / 点集（够画回一张图）',
  drawJson.strokes.every((s) => ['pen', 'eraser'].includes(s.tool) && /^#[0-9a-f]{6}$/.test(s.color) && s.points.length >= 1));

const svgText = fs.readFileSync(drawSvgFile, 'utf8');
check('★ SVG 是合法的一张图（viewBox 就是画板尺寸、纸色底）',
  svgText.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BOARD_W} ${BOARD_H}"`) && svgText.includes('fill="#fbf6ee"'),
  svgText.slice(0, 80));
check('★ SVG 里两条笔划（橡皮按纸色画）',
  (svgText.match(/<path /g) || []).length === 2 && svgText.includes('stroke="#fbf6ee"'),
  `${(svgText.match(/<path /g) || []).length} 条`);
check('SVG 里标了作者（回看时知道是谁画的）', svgText.includes('data-by="虹星"') && svgText.includes('data-by="hoshi"'));

const drawIdx = JSON.parse(fs.readFileSync(path.join(drawDirOut, 'index.json'), 'utf8'));
check('索引里记了那一天（笔数 / 人数 / 都有谁）',
  drawIdx.days.length === 1 && drawIdx.days[0].day === '2026-10-08' && drawIdx.days[0].count === 2 && drawIdx.days[0].painters === 2,
  JSON.stringify(drawIdx.days[0]));

writeDrawArchive({ day: '2026-10-09', strokes: [{ id: 'n1', uk: 'u', nick: '桑芙', avatar: '', tool: 'pen', color: '#3a86ff', size: 4, points: [[1, 1], [2, 2]], createdAt: 10 }], root: tmpDraw });
const drawIdx2 = JSON.parse(fs.readFileSync(path.join(drawDirOut, 'index.json'), 'utf8'));
check('★ 画板索引也按日期倒序、同一天不重复',
  drawIdx2.days.length === 2 && drawIdx2.days[0].day === '2026-10-09' && drawIdx2.days[1].day === '2026-10-08',
  drawIdx2.days.map((d) => d.day).join(' > '));
const drawDry = writeDrawArchive({ day: '2026-10-08', strokes: drawStrokes, root: fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-draw-dry-')), dry: true });
check('画板存档 --dry：算得出概要、不落盘', drawDry.strokes === 2 && drawDry.svg.startsWith('<svg'), `${drawDry.strokes} 笔`);

/* ============================================================ ② 命令行那条路 */

console.log('\n=== ② 命令行：真跑一遍（对着一个假的云函数）===');
const seen = [];
const fakeFn = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      /* 空 */
    }
    seen.push(body);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (body.event === 'LT_ADMIN_CHAT_DAY') {
      res.end(JSON.stringify({ code: 0, day: body.day, count: 2, messages: [
        { id: 'c1', nick: '虹星', avatar: '', text: '命令行这条', image: PNG, createdAt: 1, deleted: false },
        { id: 'c2', nick: 'hoshi', avatar: '', text: '还有这条', image: '', createdAt: 2, deleted: false },
      ] }));
      return;
    }
    if (body.event === 'LT_ADMIN_CHAT_PRUNE') {
      res.end(JSON.stringify({ code: 0, day: body.day, pruned: 1 }));
      return;
    }
    if (body.event === 'LT_ADMIN_DRAW_DAY') {
      res.end(JSON.stringify({ code: 0, day: body.day, count: 1, strokes: [
        { id: 'k1', uk: 'aaaa1111', nick: '虹星', avatar: '', tool: 'pen', color: '#1d1430', size: 10, points: [[10, 10], [20, 30], [40, 20]], createdAt: 1, deleted: false },
      ] }));
      return;
    }
    if (body.event === 'LT_ADMIN_DRAW_CLEAR') {
      res.end(JSON.stringify({ code: 0, day: body.day, cleared: 1 }));
      return;
    }
    res.end(JSON.stringify({ code: 0 }));
  });
});
await new Promise((r) => fakeFn.listen(0, '127.0.0.1', r));
const api = `http://127.0.0.1:${fakeFn.address().port}/fn`;

const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-cli-'));
const run = (args) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [SCRIPT, ...args], { cwd: SRC, env: { ...process.env, LT_ADMIN_PASSWORD: '' } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });

const cli = await run(['--day', '2026-10-07', '--api', api, '--password', 'pw-123', '--prune', '--root', tmp3]);
info('脚本输出：' + cli.out.trim().split('\n').map((l) => l.trim()).join(' | ').slice(0, 200));
check('命令行跑通了（退出码 0）', cli.code === 0, `exit=${cli.code}`);
check('★ 先问 LT_ADMIN_CHAT_DAY（带密码和日期）',
  seen[0]?.event === 'LT_ADMIN_CHAT_DAY' && seen[0]?.password === 'pw-123' && seen[0]?.day === '2026-10-07',
  JSON.stringify(seen[0] ?? {}));
check('★ 再问 LT_ADMIN_CHAT_PRUNE（把云端图片抹掉）',
  seen[1]?.event === 'LT_ADMIN_CHAT_PRUNE' && seen[1]?.day === '2026-10-07', JSON.stringify(seen[1] ?? {}));
check('★ 接着问 LT_ADMIN_DRAW_DAY（画板那天也要搬）',
  seen[2]?.event === 'LT_ADMIN_DRAW_DAY' && seen[2]?.day === '2026-10-07', JSON.stringify(seen[2] ?? {}));
check('★ 最后 LT_ADMIN_DRAW_CLEAR（画板搬完把云端那天的笔划删掉，省数据库）',
  seen[3]?.event === 'LT_ADMIN_DRAW_CLEAR' && seen[3]?.day === '2026-10-07', JSON.stringify(seen[3] ?? {}));
check('文件真的写到了 --root 指定的地方',
  fs.existsSync(path.join(tmp3, 'src', 'data', 'chat', '2026-10-07.json')) &&
    fs.existsSync(path.join(tmp3, 'public', 'img', 'chat', '2026-10-07', 'c1.png')) &&
    fs.existsSync(path.join(tmp3, 'src', 'data', 'draw', '2026-10-07.json')) &&
    fs.existsSync(path.join(tmp3, 'public', 'img', 'draw', '2026-10-07.svg')));

/* 没密码就该拒绝干活 */
const noPw = await run(['--day', '2026-10-07', '--api', api, '--root', tmp3]);
check('不给站长密码 → 直接拒绝（不猜、不空跑）', noPw.code === 2 && /站长密码/.test(noPw.out), `exit=${noPw.code}`);

/* 这一天没人说话：不写文件 */
seen.length = 0;
const emptyFn = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, day: '2026-01-01', count: 0, messages: [] }));
});
await new Promise((r) => emptyFn.listen(0, '127.0.0.1', r));
const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-empty-'));
const cliEmpty = await run(['--day', '2026-01-01', '--api', `http://127.0.0.1:${emptyFn.address().port}/fn`, '--password', 'pw', '--root', tmp4]);
check('★ 这一天没人说话 → 不写文件（不给仓库留空档）',
  cliEmpty.code === 0 && !fs.existsSync(path.join(tmp4, 'src')), cliEmpty.out.trim().slice(-40));

/*
  冷启动那一枪：云函数闲一阵之后第一次调，偶尔会回
  `Socket 'secureConnect' timed out`（code 不是 0）。存档脚本每天只跑一次，
  那一下撞上就白存了 —— 所以要自动重试。这里就让假云函数**第一枪故意失败**。
*/
let coldHits = 0;
const coldFn = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    let body = {};
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    } catch {
      /* 空 */
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    if (body.event === 'LT_ADMIN_CHAT_DAY') {
      coldHits += 1;
      if (coldHits === 1) {
        res.end(JSON.stringify({ code: 1000, message: "Socket 'secureConnect' timed out after 5001ms" }));
        return;
      }
      res.end(JSON.stringify({ code: 0, day: body.day, count: 1, messages: [
        { id: 'z1', nick: '虹星', avatar: '', text: '冷启动之后这一条', image: '', createdAt: 1, deleted: false },
      ] }));
      return;
    }
    res.end(JSON.stringify({ code: 0 }));
  });
});
await new Promise((r) => coldFn.listen(0, '127.0.0.1', r));
const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-cold-'));
const cliCold = await run(['--day', '2026-10-06', '--api', `http://127.0.0.1:${coldFn.address().port}/fn`, '--password', 'pw', '--only', 'chat', '--root', tmp5]);
check('★ 第一枪撞上冷启动 → 自动重试、这一天的存档照样落下来（不然每天只跑一次就白存了）',
  cliCold.code === 0 && coldHits >= 2 && fs.existsSync(path.join(tmp5, 'src', 'data', 'chat', '2026-10-06.json')),
  `问了两枪以上：${coldHits} 次 · ${cliCold.out.includes('重试') ? '日志里有重试' : '日志里没写重试'}`);
check('重试这件事在日志里说得明白（人去 Actions 里能看懂）', /重试/.test(cliCold.out), cliCold.out.trim().split('\n').slice(-3).join(' | ').slice(0, 120));

fakeFn.close();
emptyFn.close();
coldFn.close();
for (const d of [tmp, tmp2, tmp3, tmp4, tmp5]) {
  try {
    fs.rmSync(d, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
