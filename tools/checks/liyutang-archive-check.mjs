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
/* 2026-10-10 用户："存进仓库也尽量压小" —— 那天的话可能很长，缩进纯属白占地方（索引仍旧缩进，它每天有 diff） */
check('★ 聊天室那天的存档写的是紧凑 JSON（不缩进）',
  fs.readFileSync(dayFile, 'utf8').split('\n').length <= 2, `${fs.readFileSync(dayFile, 'utf8').split('\n').length} 行`);
check('★ 索引仍旧缩进写（它小、而且每天都要 diff 一行）',
  fs.readFileSync(indexFile, 'utf8').includes('\n  "'), '');
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
/* 一个 20KB 的假头像：用来证明"头像只按人存一份"，不是每笔复制一遍（那会把文件撑到十倍） */
const BIG_AVATAR = 'data:image/png;base64,' + 'A'.repeat(20 * 1024);
const drawStrokes = [
  { id: 's1', uk: 'aaaa1111', nick: '虹星', avatar: BIG_AVATAR, tool: 'pen', color: '#1d1430', size: 8, points: [[100, 100], [300, 200], [500, 150]], createdAt: 1000 },
  { id: 's2', uk: 'bbbb2222', nick: 'hoshi', avatar: '', tool: 'eraser', color: '#fbf6ee', size: 20, points: [[200, 150], [260, 170]], createdAt: 2000 },
  { id: 's3', uk: 'aaaa1111', nick: '虹星', avatar: BIG_AVATAR, tool: 'pen', color: '#ff4d6d', size: 6, points: [[300, 300]], createdAt: 3000, deleted: true },
  { id: 'bad', uk: 'x', nick: 'x', tool: 'pen', color: 'red', size: 4, points: [[1, 1]], createdAt: 4000 },
];
const drawSum = writeDrawArchive({ day: '2026-10-08', strokes: drawStrokes, root: tmpDraw, now: Date.UTC(2026, 9, 9, 0, 10, 0) });
const drawDirOut = path.join(tmpDraw, 'src', 'data', 'draw');
const drawDayFile = path.join(drawDirOut, '2026-10-08.json');
const drawSvgFile = path.join(tmpDraw, 'public', 'img', 'draw', '2026-10-08.svg');
check('画板存档：那天的 JSON + 一张 SVG 都写出来了', fs.existsSync(drawDayFile) && fs.existsSync(drawSvgFile));
check('画板存档：索引写出来了', fs.existsSync(path.join(drawDirOut, 'index.json')));

const drawRaw = fs.readFileSync(drawDayFile, 'utf8');
const drawJson = JSON.parse(drawRaw);
check('★ 脏笔划（颜色不合法）和删掉的那笔都没进存档', drawJson.count === 2 && drawJson.strokes.length === 2, `${drawJson.count} 笔`);
/*
  ⚠ 2026-10-10 补的两条，来由是真事故：清理云端时如果拿 count（存档里留下的笔数）去对账，
  它会永远对不上云端那份原始条数（10-09 是 1476 里留下 1224），于是云端永远清不掉。
  所以存档必须**如实记下云端本来有几笔**（cloudTotal）和丢了几笔（skipped）。
*/
check('★★ 存档如实记着"云端本来有几笔"（cloudTotal = 4）与丢了什么（删掉 1 / 脏 1）',
  drawJson.cloudTotal === 4 && drawJson.skipped?.deleted === 1 && drawJson.skipped?.dirty === 1,
  `cloudTotal=${drawJson.cloudTotal} count=${drawJson.count} skipped=${JSON.stringify(drawJson.skipped)}`);
check('★ 对账用的数必须是 cloudTotal（不是 count）—— 4 ≠ 2，两者确实不是同一个数',
  drawJson.cloudTotal !== drawJson.count, `${drawJson.cloudTotal} vs ${drawJson.count}`);
/*
  ★★ 2026-10-10 用户拍的那条：「存入仓库也尽量压小 / 8MB 太大了」。
  实测 10-09 那份：6.24MB 里 **5.61MB 是每笔各存一份的头像**（那天总共只有 6 张不同的脸）。
  规矩：**头像按人存一份**（people 里），笔划里一个 avatar 都不许有；而且整体写紧凑 JSON。
*/
check('★★ 头像只按人存一份：笔划里没有 avatar 字段',
  drawJson.strokes.every((s) => !Object.prototype.hasOwnProperty.call(s, 'avatar')),
  JSON.stringify(Object.keys(drawJson.strokes[0] ?? {})));
check('★★ 头像本身没丢：people 里那个人带着（一份，不是每笔一份）',
  Array.isArray(drawJson.people) && drawJson.people.some((p) => p.uk === 'aaaa1111' && p.avatar === BIG_AVATAR),
  JSON.stringify((drawJson.people ?? []).map((p) => ({ uk: p.uk, av: String(p.avatar || '').length }))));
check(`★★ 20KB 的假头像没有被复制进文件：整份存档只有 ${Math.round(Buffer.byteLength(drawRaw) / 1024)}KB（撑到十倍就是每笔一份头像）`,
  Buffer.byteLength(drawRaw) < 30 * 1024, `${Buffer.byteLength(drawRaw)} 字节`);
check('★★ 存档写的是**紧凑 JSON**（不缩进）—— 缩进一天要多占两成多',
  !drawRaw.includes('\n  "') && drawRaw.split('\n').length <= 2, `${drawRaw.split('\n').length} 行`);
check('★ 按人归好了（谁画了几笔）',
  drawJson.people.length === 2 && drawJson.people.some((p) => p.nick === '虹星' && p.count === 1),
  JSON.stringify((drawJson.people ?? []).map((p) => ({ n: p.nick, c: p.count }))));
check('★ 索引里也带了那份人表（日页靠它，于是构建不必读每天的 <日>.json）',
  (() => {
    const idx = JSON.parse(fs.readFileSync(path.join(drawDirOut, 'index.json'), 'utf8'));
    const e = (idx.days ?? []).find((d) => d.day === '2026-10-08');
    return !!e && Array.isArray(e.people) && e.people.length === 2;
  })(), '');

/* ---- 构建成本（2026-10-10 用户："不要让构建太慢"）：不许再把每天的存档读进构建 ---- */
const drawReader = fs.readFileSync(path.join(SRC, 'src', 'utils', 'draw-archive.ts'), 'utf8');
const drawDayPage = fs.readFileSync(path.join(SRC, 'src', 'pages', 'liyutang', 'teahouse', '[day].astro'), 'utf8');
/* 判的是**代码**，不是注释：注释里正大光明地写着"以前是这么干的、别改回去"（剥掉注释再判） */
const stripComments = (s) => String(s).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('★★ 构建期不再读每天的画板存档（`import.meta.glob ... data/draw/*.json` 一个都不许有；eager 更不行）',
  !/import\.meta\.glob[^\n]*data\/draw\/\*\.json/.test(stripComments(drawReader)), '');
check('★ 画板日页的人表从索引读（drawPeople），不再去读那天几 MB 的笔划存档',
  /drawPeople/.test(stripComments(drawDayPage)) && !/drawArchive\(/.test(stripComments(drawDayPage)), '');
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
/*
  ★★ 2026-10-10 用户："存进仓库也尽量压小" —— SVG 是那天的第二大件（10-09 实测 1.35MB），
  改成**相对命令**（q/l 写增量）并把共用的表现属性提到外层 <g> 之后降到 0.77MB（省 43%）。
  这两条是防回退：路径必须是相对的、每条 path 上不许再重复那三个可继承属性。
*/
check('★★ SVG 用相对命令写路径（q / l 增量），不是绝对的大坐标 —— 10-09 那份因此小了 43%',
  /<path d="M[^"]*q/.test(svgText) && !/<path d="M[^"]* Q /.test(svgText), '');
check('★★ 共用的表现属性在外层一个 <g> 上（fill / linecap / linejoin），不在每条 path 上重复',
  svgText.includes('<g fill="none" stroke-linecap="round" stroke-linejoin="round">') &&
    !/<path [^>]*stroke-linecap=/.test(svgText), '');

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
      /* 和画板一样是分页夹具：两条消息、一次给一条，第二条才收尾（验"翻页"这条路真的走通） */
      const all = [
        { id: 'c1', nick: '虹星', avatar: '', text: '命令行这条', image: PNG, createdAt: 1, deleted: false },
        { id: 'c2', nick: 'hoshi', avatar: '', text: '还有这条', image: '', createdAt: 2, deleted: false },
      ];
      const after = Number(body.after) || 0;
      const rest = all.filter((m) => m.createdAt > after);
      const page = rest.slice(0, 1);
      res.end(JSON.stringify({
        code: 0, day: body.day, count: page.length, total: all.length, messages: page,
        next: page.length && rest.length > page.length ? { ts: page[0].createdAt, id: page[0].id } : null,
      }));
      return;
    }
    if (body.event === 'LT_ADMIN_CHAT_PRUNE') {
      res.end(JSON.stringify({ code: 0, day: body.day, pruned: 1 }));
      return;
    }
    if (body.event === 'LT_ADMIN_DRAW_DAY') {
      /*
        分页夹具（2026-10-10 起云函数就是分页的）：一共两笔，一次给一笔、第二笔才收尾。
        这样"翻页"这条路在验收里是真走了一遍的，而不是只看代码里写了 while。
      */
      const all = [
        { id: 'k1', uk: 'aaaa1111', nick: '虹星', avatar: '', tool: 'pen', color: '#1d1430', size: 10, points: [[10, 10], [20, 30], [40, 20]], createdAt: 1, deleted: false },
        { id: 'k2', uk: 'bbbb2222', nick: 'hoshi', avatar: '', tool: 'eraser', color: '#fbf6ee', size: 20, points: [[50, 50], [60, 60]], createdAt: 2, deleted: false },
        /* 一笔**撤掉的**：它不进存档，但云端确实有它 —— 对账必须按 3 笔算，不是 2 笔 */
        { id: 'k3', uk: 'aaaa1111', nick: '虹星', avatar: '', tool: 'pen', color: '#ff4d6d', size: 6, points: [[70, 70], [80, 80]], createdAt: 3, deleted: true },
      ];
      const after = Number(body.after) || 0;
      const rest = all.filter((s) => s.createdAt > after);
      const page = rest.slice(0, 1);
      res.end(JSON.stringify({
        code: 0, day: body.day, count: page.length, total: all.length, strokes: page,
        next: page.length && rest.length > page.length ? { ts: page[0].createdAt, id: page[0].id } : null,
      }));
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

/* ---- 命令行 ①：只搬，**绝不动云端**（2026-10-10 的新顺序）---- */
const cli = await run(['--day', '2026-10-07', '--api', api, '--password', 'pw-123', '--root', tmp3]);
info('脚本输出：' + cli.out.trim().split('\n').map((l) => l.trim()).join(' | ').slice(0, 260));
check('命令行跑通了（退出码 0）', cli.code === 0, `exit=${cli.code}`);
check('★ 先问 LT_ADMIN_CHAT_DAY（带密码和日期、从第一批开始）',
  seen[0]?.event === 'LT_ADMIN_CHAT_DAY' && seen[0]?.password === 'pw-123' && seen[0]?.day === '2026-10-07' &&
    (seen[0]?.after ?? 0) === 0,
  JSON.stringify(seen[0] ?? {}));
check('★ 聊天室取数也是**分页**的：第二批带上 after / afterId 游标',
  seen[1]?.event === 'LT_ADMIN_CHAT_DAY' && seen[1]?.after === 1 && seen[1]?.afterId === 'c1',
  JSON.stringify(seen[1] ?? {}));
check('★ 接着问 LT_ADMIN_DRAW_DAY（画板那天也要搬）',
  seen[2]?.event === 'LT_ADMIN_DRAW_DAY' && seen[2]?.day === '2026-10-07', JSON.stringify(seen[2] ?? {}));
check('★ 画板取数也是分页的：第二批带上了 after / afterId 游标',
  seen[3]?.event === 'LT_ADMIN_DRAW_DAY' && seen[3]?.after === 1 && seen[3]?.afterId === 'k1',
  JSON.stringify(seen[3] ?? {}));
check('★★ 搬的这一趟**一次都没碰云端**（没有 PRUNE、没有 CLEAR —— 10-09 丢图就是栽在这上面）',
  seen.every((b) => b.event !== 'LT_ADMIN_CHAT_PRUNE' && b.event !== 'LT_ADMIN_DRAW_CLEAR'),
  seen.map((b) => b.event).join(' > '));
check('文件真的写到了 --root 指定的地方',
  fs.existsSync(path.join(tmp3, 'src', 'data', 'chat', '2026-10-07.json')) &&
    fs.existsSync(path.join(tmp3, 'public', 'img', 'chat', '2026-10-07', 'c1.png')) &&
    fs.existsSync(path.join(tmp3, 'src', 'data', 'draw', '2026-10-07.json')) &&
    fs.existsSync(path.join(tmp3, 'public', 'img', 'draw', '2026-10-07.svg')));
check('★★ 翻页取回来的 3 条里，该留的 2 笔都进了存档（撤掉的那笔按规矩不进）',
  (() => {
    const j = JSON.parse(fs.readFileSync(path.join(tmp3, 'src', 'data', 'draw', '2026-10-07.json'), 'utf8'));
    return j.strokes.length === 2 && j.strokes.map((s) => s.id).join() === 'k1,k2' && j.cloudTotal === 3;
  })());
check('★★ 聊天室翻页取回来的话也一条不少（两批各一条，按时间正序）',
  (() => {
    const j = JSON.parse(fs.readFileSync(path.join(tmp3, 'src', 'data', 'chat', '2026-10-07.json'), 'utf8'));
    return j.count === 2 && j.messages.map((m) => m.id).join() === 'c1,c2';
  })());

/* ---- 命令行 ②：提交之后再清（--prune-only）---- */
seen.length = 0;
const cli2 = await run(['--day', '2026-10-07', '--api', api, '--password', 'pw-123', '--prune-only', '--root', tmp3]);
check('清理那一趟跑通了（退出码 0）', cli2.code === 0, `exit=${cli2.code}：${cli2.out.trim().split('\n').slice(-2).join(' ')}`);
check('★ 清理先抹聊天室图片、再清画板笔划',
  seen[0]?.event === 'LT_ADMIN_CHAT_PRUNE' && seen[1]?.event === 'LT_ADMIN_DRAW_CLEAR', seen.map((b) => b.event).join(' > '));
check('★★ 清理带上了**对账数字**（expect：聊天室 1 张图 / 画板 **3 笔 = 云端原始条数**，不是存档里的 2 笔）',
  seen[0]?.expect === 1 && seen[1]?.expect === 3,
  JSON.stringify(seen.map((b) => ({ e: b.event, expect: b.expect }))));

/* ---- 命令行 ③：仓库里没有那天的存档时，清理一步一个请求都不许发 ---- */
seen.length = 0;
const tmpEmpty = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-pruneempty-'));
const cli5 = await run(['--day', '2026-10-07', '--api', api, '--password', 'pw-123', '--prune-only', '--root', tmpEmpty]);
check('★★ 仓库里没有那天的存档 → 清理什么都不做（一个请求都不发，云端那份原封不动）',
  cli5.code === 0 && seen.length === 0 && /没有那天的存档/.test(cli5.out),
  `exit=${cli5.code} requests=${seen.length}`);

/* ---- 命令行 ④：画板失败不许把聊天室那份一起弄丢（10-09 的真事故）---- */
const brokeFn = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => (raw += d));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    res.writeHead(200, { 'content-type': 'application/json' });
    if (body.event === 'LT_ADMIN_DRAW_DAY') {
      /* 复刻 10-09 那一枪：云函数直接报响应体超限 */
      res.end(JSON.stringify({ code: 1000, message: 'The size of HTTP response body exceeds the upper limit (6MB).' }));
      return;
    }
    /* 聊天室照常给（新协议，一条消息就收尾）—— 这一段要验的是"画板炸了、聊天室那份也得落盘" */
    res.end(JSON.stringify({
      code: 0, day: body.day, count: 1, total: 1,
      messages: [{ id: 'x1', nick: '虹星', avatar: '', text: '画板炸了也別丢我', image: '', createdAt: 1, deleted: false }],
      next: null, strokes: [],
    }));
  });
});
await new Promise((r) => brokeFn.listen(0, '127.0.0.1', r));
const brokeApi = `http://127.0.0.1:${brokeFn.address().port}/fn`;
const tmp6 = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-archive-brokedraw-'));
const cli6 = await run(['--day', '2026-10-08', '--api', brokeApi, '--password', 'pw-123', '--root', tmp6]);
check('★★ 画板那一枪失败时：退出码 1（工作流会标红），但**聊天室那份照样落盘**（以前整次运行直接退出，那份也白写了）',
  cli6.code === 1 && fs.existsSync(path.join(tmp6, 'src', 'data', 'chat', '2026-10-08.json')) && /画板/.test(cli6.out),
  `exit=${cli6.code} 聊天室文件=${fs.existsSync(path.join(tmp6, 'src', 'data', 'chat', '2026-10-08.json'))}`);
check('★ 那次失败时也没碰云端（没有 DRAW_CLEAR / CHAT_PRUNE）', !/清云端|抹掉/.test(cli6.out), '');
await new Promise((r) => brokeFn.close(r));

/* ---- 工作流那三段：顺序和开关本身就是安全的一部分（2026-10-10 定的）---- */
const wf = fs.readFileSync(path.join(SRC, '.github', 'workflows', 'daily-archive.yml'), 'utf8');
const at = (needle) => wf.indexOf(needle);
check('★ 工作流的排程是北京时间 04:00（UTC 20:00）', /cron:\s*'0 20 \* \* \*'/.test(wf), '');
check('★ 搬的那一步允许失败（continue-on-error: true）—— 这样后面"提交"那一步还跑得到',
  /把昨天的话和画搬进仓库[\s\S]{0,400}?continue-on-error:\s*true/.test(wf), '');
check('★★ 提交那一步必须排在清理之前（先提交、后清理 —— 顺序换回去就是 10-09 的坑）',
  at('提交并推送') > 0 && at('提交并推送') < at('提交成功之后再清云端'),
  `提交@${at('提交并推送')} < 清理@${at('提交成功之后再清云端')}`);
check('★★ 清理那一步只在"搬没报错 + 这一次确实有东西提交"时才跑',
  /提交成功之后再清云端[\s\S]{0,320}?if:\s*steps\.fetch\.outcome == 'success' && steps\.changed\.outputs\.changed == '1'/.test(wf), '');
check('★★ 工作流里不许再出现"搬完顺手清"的老开关（裸 --prune 就是 10-09 丢掉 5 张图的写法）',
  !/\s--prune\s/.test(wf) && /--prune-only/.test(wf), '');
check('★ 搬失败会把这次跑标红（用 ::error:: + exit 1），但已经提交的部分留着',
  /::error::/.test(wf) && /exit 1/.test(wf), '');
/* 三段（提交/部署/清理）互不拖累：部署挂了也要让清理跑得到，反之亦然；末尾统一标红 */
check('★★ 部署与清理两步都挂了 continue-on-error（谁失败都不许把另一段卡死）',
  (wf.match(/continue-on-error: true/g) || []).length >= 3 &&
    /id: deploy[\s\S]{0,400}?continue-on-error: true/.test(wf) &&
    /id: prune[\s\S]{0,400}?continue-on-error: true/.test(wf), '');
check('★★ 末尾那一步把三段的结果都看了（fetch / deploy / prune 任意一段失败 → 这次跑标红）',
  /steps\.fetch\.outcome == 'failure' \|\| steps\.deploy\.outcome == 'failure' \|\| steps\.prune\.outcome == 'failure'/.test(wf), '');
/*
  ⚠ 2026-10-10 实测的第二个坑：用默认 GITHUB_TOKEN 推的提交**不会触发** push 类工作流
  （GitHub 防递归），于是"存档进了 main、线上还是 404" —— 那天 /liyutang/teahouse/2026-10-09/
  确实一直是 404，直到手动点了一次 Run workflow。所以工作流必须自己点一次 deploy.yml。
*/
check('★★ 工作流自己点一次站点部署（否则机器人提交的存档永远不上线）',
  /gh workflow run deploy\.yml/.test(wf), '');
check('★ 为了能 dispatch，权限里得有 actions: write',
  /permissions:[\s\S]{0,200}?actions:\s*write/.test(wf), '');
check('★★ 顺序是"提交 → 点部署 → 清云端"（部署不该被清理挡住）',
  at('name: 提交并推送') > 0 && at('name: 提交并推送') < at('name: 点一次站点部署') &&
    at('name: 点一次站点部署') < at('name: 提交成功之后再清云端'),
  `提交@${at('name: 提交并推送')} < 部署@${at('name: 点一次站点部署')} < 清理@${at('name: 提交成功之后再清云端')}`);

/* 没密码就该拒绝干活 */
const noPw = await run(['--day', '2026-10-07', '--api', api, '--root', tmp3]);
check('不给站长密码 → 直接拒绝（不猜、不空跑）', noPw.code === 2 && /站长密码/.test(noPw.out), `exit=${noPw.code}`);

/* 这一天没人说话：不写文件 */
seen.length = 0;
const emptyFn = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ code: 0, day: '2026-01-01', count: 0, total: 0, messages: [], next: null }));
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
