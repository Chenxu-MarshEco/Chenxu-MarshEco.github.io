/*
 * ============================================================================
 * 久昭卿茶绘「画板」的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「点进去以后是一个巨大的公共画板 有基本的画笔橡皮调色板等功能 所有注册后通过审核的用户
 *    都可以在上面画画 并且有一个折叠栏可以打开今天所有画过画的用户列表 点击其他用户头像可以
 *    开关是否显示由他们画的笔划 …… 让画画的手感可以比较舒服丝滑」
 *
 * 三段：
 *   ① 静态：云函数里那几个事件 + 限额；前端引擎里那几件"手感"的东西（中点平滑、两层画布、
 *      采样过滤、逐人隐藏）都在；
 *   ② 真跑（内存 MongoDB 跑整份云函数）：没登录 / 没过审拉不到也画不上 → 过审能画 →
 *      列表带 uk 和 mine → 游标增量 → 各种脏笔划被拒 → 画太快被拒 → 一小时上限 →
 *      只能撤自己的 → 站长取某天 / 清某天；
 *   ③ 真浏览器（假云函数 + 真构建产物 + **真画布像素**）：访客锁着 → 过审能画 →
 *      **画上去的颜色真的出现在画布那一点上** → 别人的笔划被轮询拉来并画出来 →
 *      **点一下那个人的头像，他的笔划就没了（像素变回纸色）** → 橡皮擦掉 →
 *      撤销会真的请求删除。
 *
 * 用法：node tools/checks/liyutang-draw-check.mjs [dist目录]
 * 说明：② 需要 mongodb-memory-server（在 %TEMP%\huajiantang-twikoofn 里），没装就跳过②。
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const BACKEND = path.join(SRC, 'tools', 'liyutang-backend', 'index.js');
const ROOT = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist')
);
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const DEBUG_PORT = 9403;
const PAPER = '#fbf6ee';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/*
  画板坐标系和网格几何**从那份共用的模块里读**（src/utils/liyutang-strokes.mjs）——
  验收里一个数字都不许写死：2026-10-09 板子从 2400×1500 放大到 3600×2250 时，
  写死 2400 的那两条断言就假红过（红得毫无意义：功能是好的，是断言自己过期了）。
*/
const strokesMod = await import(pathToFileURL(path.join(SRC, 'src', 'utils', 'liyutang-strokes.mjs')).href);
const { BOARD_W, BOARD_H, GRID_STEP, gridLines } = strokesMod;

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`SKIP  ${name}   :: ${why}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (rel) => {
  const f = path.join(SRC, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

/* ============================================================ ① 静态 */

console.log('=== ① 静态：事件、限额、以及那几件"手感" ===');
const backend = read('tools/liyutang-backend/index.js');
check('云函数里有画板集合与三个用户事件',
  /const DRAW = 'lt_draw'/.test(backend) &&
  ['LT_DRAW_LIST', 'LT_DRAW_ADD', 'LT_DRAW_DELETE'].every((e) => backend.includes(e)));
check('站长那两个（取某天 / 清某天）也在',
  backend.includes('LT_ADMIN_DRAW_DAY') && backend.includes('LT_ADMIN_DRAW_CLEAR'));
check('★ 走的是和聊天室同一个门槛（过审才画得上）', /async function handleDrawEvent/.test(backend) && /await chatWho\(payload\)/.test(backend));
check('★ 颜色只收 #rrggbb（不给用户写 CSS 的机会）', /function drawColor/.test(backend) && /\^#\[0-9a-f\]\{6\}\$/.test(backend));
check('坐标夹进画板、点数有上限', /function cleanDrawPoints/.test(backend) && /DRAW_MAX_POINTS/.test(backend));
check('限速：80 毫秒一笔、一小时 4000 笔', /DRAW_GAP_MS = 80/.test(backend) && /DRAW_PER_HOUR = 4000/.test(backend));
check('★ 发出去的是账号 id 的短哈希（逐人显隐要稳定键，但不泄露账号 id）',
  /const drawUk = \(id\) => crypto\.createHash\('sha1'\)/.test(backend));

const engine = read(path.join('src', 'utils', 'liyutang-draw.ts'));
check('前端引擎在（mountBoard）', /export function mountBoard/.test(engine));
check('★ 平滑走共享几何（strokeSegments，和存档 SVG 同一份）', /strokeSegments/.test(engine));
check('★ 两层画布：定下来的笔划进离屏缓存，只有集合变了才重画', /const cache = document\.createElement\('canvas'\)/.test(engine) && /cacheDirty/.test(engine));
check('★ 本地先画（抬笔立刻出现在自己屏幕上，后台再送）', /const commit = async/.test(engine) && /local-/.test(engine));
check('采样过滤（画板坐标里 1.2px 以内不留点）', /< 1\.2/.test(engine));
check('★ 逐人显隐（hidden 集合 + 重画）', /const hidden = new Set<string>\(\)/.test(engine) && /hidden\.has\(s\.uk\)/.test(engine));
check('橡皮按纸色画（和服务端 / 存档 SVG 一个规矩）', /ERASER_COLOR = PAPER/.test(engine));
check('页面接上了：工具条 + 画布 + 人表', /mountBoard\(/.test(read(path.join('src', 'pages', 'liyutang', 'teahouse.astro'))));
/*
  ⚠ 这一条 2026-10-09 改过（旧断言是 `/BOARD_W = 2400/`）：板子被用户要求放大到 3600×2250，
  旧数字必然过期。现在**从模块里读**（BOARD_W/BOARD_H 已经在文件顶部 import），
  并且要求两处（浏览器 + 云函数那份抄走的）一致 —— 不一致的后果是"右下角画不上去"。
*/
check('画板尺寸是固定坐标系（3600×2250，长宽都 ×1.5、原点仍在左上角）',
  BOARD_W === 3600 && BOARD_H === 2250 && BOARD_W / BOARD_H === 2400 / 1500 &&
    new RegExp(`BOARD_W = ${BOARD_W}`).test(read(path.join('src', 'utils', 'liyutang-strokes.mjs'))) &&
    new RegExp(`BOARD_H = ${BOARD_H}`).test(read(path.join('src', 'utils', 'liyutang-strokes.mjs'))),
  `模块里读到 ${BOARD_W}×${BOARD_H}`);
check('★ 云函数里抄走的那两个常量也是同一对数（两边不一致右下角就画不上去）',
  new RegExp(`const BOARD_W = ${BOARD_W}\\b`).test(backend) && new RegExp(`const BOARD_H = ${BOARD_H}\\b`).test(backend));

/* ---- 2026-10-09 这一轮的新功能：先来一遍静态的（真跑的在那三段之后） ---- */
const page = read(path.join('src', 'pages', 'liyutang', 'teahouse.astro'));
check('★ 重做是"照原样再画一笔新的"（服务端软删，原来那条回不来）',
  /const doRedo = async/.test(engine) && /commit\(back/.test(engine) && /redoStack/.test(engine));
check('★ 拖动一根线条：命中测试按笔粗给阈值 + 松手才发一次 LT_DRAW_MOVE',
  /HIT_SLACK/.test(engine) && /const hitTest = /.test(engine) && /LT_DRAW_MOVE/.test(engine) && /finishMove/.test(engine));
check('★ 只能挪自己画的（本地先说人话，服务端还会再拒一次）', /只能挪自己画的/.test(engine));
check('★ 取色读的是渲染出来的画布像素', /const readPixel = /.test(engine) && /getImageData/.test(engine));
check('★ 调色盘跟着账号走（LT_PREFS_SET 存 / LT_ME 读 prefs）',
  /LT_PREFS_SET/.test(engine) && /applyPrefs/.test(engine) && /MAX_SAVED/.test(engine));
check('★ 画笔和橡皮各自的粗细（penSize / eraserSize 分开存，切工具各自取）',
  /let penSize = PEN_SIZE_DEFAULT/.test(engine) && /let eraserSize = ERASER_SIZE_DEFAULT/.test(engine) && /const sizeOf/.test(engine));
check('★ 粗细能直接填数字（数字框接进 setSize）', /sizeNumber/.test(engine) && /const setSize = /.test(engine));
check('★ 画的过程中不做远端轮询带来的重画（记下来、抬笔之后补）',
  /deferredRefresh/.test(engine) && /stats\.deferred/.test(engine));
check('★ 新笔划增量画进缓存（只有集合变了才整块重建，重建次数可量）',
  /const paintIntoCache = /.test(engine) && /const rebuildCache = /.test(engine) && /stats\.rebuilds/.test(engine));
check('★ 画布上的滚轮一律 preventDefault（触控板的小数 delta 曾经把页面滚走）',
  /on\(canvas, 'wheel'/.test(engine) && /e\.preventDefault\(\);/.test(engine) && !/Math\.abs\(e\.deltaY\) < 1/.test(engine));
check('★ 指针 move/up 挂在 window 上（capture 失效也不丢笔）',
  /on\(window, 'pointermove'/.test(engine) && /on\(window, 'pointerup'/.test(engine));
check('★ 同步游标按 updatedAt（别人拖动过的线条才拉得到）', /s\.updatedAt \?\? s\.createdAt/.test(engine));
check('★ stop() 会把监听一起摘掉（老版本只停轮询，重挂之后一笔提交两次）', /ac\.abort\(\)/.test(engine));
check('茶绘页面把新控件都接上了（移动/取色/＋收藏/粗细数字/重做）',
  ['data-lt-tool="move"', 'data-lt-tool="pick"', 'data-lt-color-add', 'data-lt-size-num', 'data-lt-redo'].every((k) => page.includes(k)));
check('★ 新控件的样式写在茶绘自己的 <style> 里（没往 forum.css 加）',
  /<style is:global>/.test(page) && /lyt-draw__swatch-del/.test(page) &&
    !/lyt-draw__swatch-del/.test(read(path.join('src', 'styles', 'forum.css'))));

/* ---- 2026-10-09 第二批（用户逐条要的）：光标圆 / 网格 / 快捷键 / 悬停卡片 / 橡皮两种模式 ---- */
console.log('\n--- 静态：第二批那几件 ---');
check('★ 网格线距是画板坐标里的 300，几何只有一份（gridLines 导出）',
  GRID_STEP === 300 && typeof gridLines === 'function' && /export const GRID_STEP = 300/.test(read(path.join('src', 'utils', 'liyutang-strokes.mjs'))));
const ggrid = gridLines(BOARD_W, BOARD_H, GRID_STEP);
check('★ 格子数对得上：12 列整格（11 条内部竖线）、7 行整格 + 最下面半格 150（不补线到板底）',
  ggrid.cols === 12 && ggrid.rows === 7 && ggrid.half === 150 &&
    ggrid.xs.length === 11 && ggrid.ys.length === 7 &&
    ggrid.xs[0] === 300 && ggrid.xs[10] === 3300 && ggrid.ys[6] === 2100,
  JSON.stringify({ cols: ggrid.cols, rows: ggrid.rows, half: ggrid.half, xs: ggrid.xs.length, ys: ggrid.ys.length }));
check('★ 网格画在画布**下面**那一层 div 上（不是画进画布：不然它会变成"画面上的像素"）',
  /lyt-draw__grid/.test(engine) && /insertBefore\(gridLayer, canvas\)/.test(engine) &&
    /lyt-draw__grid/.test(page) && /data-lt-grid-toggle/.test(page));
check('★ 画布不再刷纸色（纸色来自 stage 的底色），透明处读像素按纸色合成',
  /ctx\.clearRect\(0, 0, canvas\.width, canvas\.height\)/.test(engine) && /cctx\.clearRect\(0, 0, BOARD_W, BOARD_H\)/.test(engine) &&
    /overPaper/.test(engine));
check('★ 网格默认开着 + 状态存账号偏好（grid）', /let gridOn = true/.test(engine) && /grid: gridOn/.test(engine));
check('★ 光标圆：直径 = 当前工具粗细 × 视野缩放（画笔读 penSize、橡皮读 eraserSize）',
  /lyt-draw__ring/.test(engine) && /const ringSize = \(\) => sizeOf\(\) \* view\.scale/.test(engine));
check('★ 画布上不用十字光标（画笔/橡皮 cursor: none），拖动画布 grab/grabbing、移动线条 move',
  /cursor: none/.test(page) && /'grabbing'/.test(engine) && /'grab'/.test(engine) && /'move'/.test(engine));
check("★ 触摸设备上不显示那个圆（pointerType === 'touch'）", /pointerType !== 'touch'/.test(engine));
check('★ 快捷键：B 画笔 / E 橡皮 / 1~9 调色盘 / C 拖动画布 / T 移动线条 / Ctrl+Z 撤回 / Ctrl+R 重做',
  /KeyB/.test(engine) && /KeyE/.test(engine) && /KeyC/.test(engine) && /KeyT/.test(engine) &&
    /Digit\(\[1-9\]\)/.test(engine) && /KeyZ/.test(engine) && /KeyR/.test(engine));
check('★ Ctrl+R 被 preventDefault（不然按一下变成刷新页面，没画完就白画）',
  /ke\.code === 'KeyR'[\s\S]{0,120}?preventDefault/.test(engine));
check('★ 焦点在输入框里时快捷键一律不认（输入框里打字不能切工具）',
  /const typingIn = /.test(engine) && /isContentEditable/.test(engine) && /typingIn\(document\.activeElement\)/.test(engine));
check('★ 工具条按钮的悬停卡片：功能名 + 快捷键，键盘 focus 也能弹（:focus-within）',
  /lyt-tip/.test(page) && /role="tooltip"/.test(page) && /aria-describedby/.test(page) && /:focus-within/.test(page));
check('★ 卡片的视觉照花涧堂时间轴那个浮层（同底色 / 同描边 / 同圆角字号，不另起一套）',
  /rgba\(24, 3, 36, 0\.96\)/.test(page) && /rgba\(255, 120, 190, 0\.6\)/.test(page) && /border-radius: 7px/.test(page) &&
    /rgba\(24, 3, 36, 0\.96\)/.test(read(path.join('src', 'components', 'Timeline.astro'))));
check('★ 调色盘默认只剩黑白二色（其余靠用户自己收藏）', /PALETTE = \['#000000', '#ffffff'\]/.test(engine));
check('★「抓手」这个叫法全没了（按钮文字 / 提示 / 注释都改成「拖动画布」）',
  !/抓手/.test(engine) && !/抓手/.test(page) && /拖动画布/.test(page) && /data-lt-tool="pan"/.test(page));
/*
  ★★ 2026-10-10：橡皮改成"两种方式 × 一颗擦别人的开关"（用户原话：
  「橡皮优化为两种 一种是擦除接触到的整根该笔画的线条 一种是仅去除划过的地方的像素
    …… 两种下面都分别有个按钮开关控制能否擦别人的」）。
  下面这几条钉的是**设计意图**（真浏览器那一段在 ③ 里一条条量像素）。
*/
check('★ 橡皮两种方式都在：整笔（stroke）/ 像素（pixel），各有自己的状态',
  /type EraserMode = 'stroke' \| 'pixel'/.test(engine) && /let eraserMode: EraserMode = 'stroke'/.test(engine) &&
    /let eraserStrokeOthers = false/.test(engine) && /let eraserPixelOthers = false/.test(engine) &&
    /const othersAllowed = \(\) => \(eraserMode === 'stroke' \? eraserStrokeOthers : eraserPixelOthers\)/.test(engine));
check('★「整笔」= 碰到哪根整根擦掉（软删 LT_DRAW_DELETE；别人的要显式 others: true）',
  /const softDelete = async/.test(engine) && /others: true/.test(engine) &&
    /if \(!hit\.mine && !othersAllowed\(\)\)/.test(engine));
check('★「像素」+ 只擦自己 = 把自己那几笔**裁开**（LT_DRAW_REPLACE），不是挖别人的墨',
  /const cutCircle = /.test(engine) && /const cutAt = /.test(engine) && /const commitCuts = async/.test(engine) &&
    /event: 'LT_DRAW_REPLACE'/.test(engine) && /edits/.test(engine));
check('★「像素」+ 擦别人的 = 一根 tool=erase 的笔划（画布 destination-out / 存档 SVG mask）',
  /const liveTool = tool === 'eraser' \? 'erase' : tool/.test(engine) &&
    /if \(s\.tool === 'erase'\) c\.globalCompositeOperation = 'destination-out'/.test(engine));
check('★ 界面两颗按钮：橡皮方式（字由引擎写）+ 擦别人的（aria-pressed）',
  /data-lt-eraser-mode/.test(page) && /data-lt-eraser-others/.test(page) &&
    !/data-lt-eraser-all/.test(page) &&
    /opts\.eraserMode\.textContent = eraserMode === 'pixel' \? '像素擦' : '整笔擦'/.test(engine) &&
    /opts\.eraserOthers\.setAttribute\('aria-pressed'/.test(engine));
check('★ 两种方式的"擦别人的"是各记各的，都跟着账号走（LT_PREFS_SET / applyPrefs 各读各写）',
  /eraserStrokeOthers/.test(engine) && /eraserPixelOthers/.test(engine) &&
    /if \(typeof p\.eraserStrokeOthers === 'boolean'\)/.test(engine) &&
    /if \(typeof p\.eraserPixelOthers === 'boolean'\)/.test(engine) &&
    /eraserMode,\n\s+eraserStrokeOthers,\n\s+eraserPixelOthers,/.test(engine));
check('★ 老账号里的 eraserAll 映射成"像素 + 擦别人的"（升级不丢那颗开关）',
  /p\.eraserAll === true &&/.test(engine) && /eraserPixelOthers = true;/.test(engine));
check('★ 像素橡皮那一笔不是墨：命中测试 / 移动线条都跳过它（tool === \'erase\'）',
  /if \(s\.tool === 'erase'\) continue;/.test(engine));
check('★ 墓碑：别人撤销 / 被擦掉的笔划靠增量拉下来后就地删掉（absorb 认 deleted）',
  /if \(s\.deleted\) \{/.test(engine) && /removed \+= 1;/.test(engine));
check('★ 跨天自清：只认服务端回的 today，变了就把本地笔划全丢掉重拉（不自己算日期）',
  /if \(today && day && today !== day\)/.test(engine) && /strokes = \[\];/.test(engine) && /let day = ''/.test(engine));
check('★ 页面文案从 copy() 读（board.lead/hint/note），空的不渲染；生造的介绍句一个都没有',
  /import \{ copy, forum \} from '\.\.\/\.\.\/utils\/liyutang'/.test(page) &&
    /const cp = copy\(\)\.board/.test(page) && /const lead = cp\.lead/.test(page) &&
    /\{lead && <p class="lyt-lead">\{lead\}<\/p>\}/.test(page) && /\{hint && /.test(page) && /\{note && /.test(page) &&
    !/一块大家共用的画板/.test(page) && !/滚轮在画布上缩放（1×~4×）/.test(page));
check('★ 第二批没往 forum.css 里加东西（新控件的样式都在茶绘自己的 <style> 里）',
  /lyt-tip__wrap/.test(page) && !/lyt-tip/.test(read(path.join('src', 'styles', 'forum.css'))) &&
    !/lyt-draw__ring/.test(read(path.join('src', 'styles', 'forum.css'))));

/* ============================================================ ② 真跑 */

console.log('\n=== ② 真跑：内存里的 MongoDB，把云函数整份跑一遍 ===');
const candidates = [
  path.join(process.env.TEMP ?? '', 'huajiantang-twikoofn', 'node_modules'),
  path.join(SRC, '.tmp', 'twikoofn', 'node_modules'),
  path.join(SRC, 'node_modules'),
];
let MongoMemoryServer = null;
let mongodBinary = '';
for (const dir of candidates) {
  try {
    const req = createRequire(path.join(dir, 'x.js'));
    MongoMemoryServer = req('mongodb-memory-server').MongoMemoryServer;
    for (const cache of [
      path.join(dir, '.cache', 'mongodb-memory-server'),
      path.join(process.env.USERPROFILE ?? '', '.cache', 'mongodb-binaries'),
    ]) {
      if (!fs.existsSync(cache)) continue;
      const hit = fs.readdirSync(cache).find((f) => /^mongod-.*\.exe$/i.test(f));
      if (hit) {
        mongodBinary = path.join(cache, hit);
        process.env.MONGOMS_SYSTEM_BINARY = mongodBinary;
        break;
      }
    }
    break;
  } catch {
    /* 换下一个 */
  }
}

if (!MongoMemoryServer || !mongodBinary) {
  skip('画板那一整套的真跑', '这台机器上没有现成的 mongodb-memory-server / mongod 二进制');
} else {
  const mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri('twikoo');
  process.env.MONGODB_URI = uri;
  process.env.LT_SECRET = 'draw-check-secret';
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const req2 = createRequire(path.join(candidates[0], 'x.js'));
  const app = req2(BACKEND);
  const call = (body) => app.main(body);
  const { MongoClient } = req2('mongodb');
  const cli = new MongoClient(uri);
  await cli.connect();
  const raw = cli.db('twikoo').collection('lt_draw');

  await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'h@example.com', pass: 'hoshi123456' });
  await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'a@example.com', pass: 'arc123456789' });
  const tokHoshi = (await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' })).token;
  const tokArc = (await call({ event: 'LT_LOGIN', nick: 'arcarlight', pass: 'arc123456789' })).token;

  check('★ 没登录拉画板 → 被拒', (await call({ event: 'LT_DRAW_LIST' })).code !== 0);
  check('★ 没过审拉画板 → 被拒（会员画板）', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi })).code !== 0);
  check('没过审画一笔 → 被拒',
    (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ff0000', size: 4, points: [[10, 10], [20, 20]] })).code !== 0);

  await call({ event: 'SET_PASSWORD', password: createHash('md5').update('admin-pass-123').digest('hex') });
  const users = (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users;
  const idHoshi = users.find((u) => u.nick === 'hoshi').id;
  await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'approved' });

  const one = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#FF0000', size: 999, points: [[10, 10], [50, 10], [90, 40]] });
  check('★ 过审之后能画一笔', one.code === 0 && !!one.stroke?.id, String(one.stroke?.id));
  check('颜色被规整成小写、粗细夹到 64', one.stroke?.color === '#ff0000' && one.stroke?.size === 64, `${one.stroke?.color} / ${one.stroke?.size}`);
  check('★ 返回里带 uk（短哈希）而不是账号 id', /^[0-9a-f]{8}$/.test(String(one.stroke?.uk)) && !JSON.stringify(one.stroke).includes(idHoshi), String(one.stroke?.uk));
  check('自己画的标成 mine', one.stroke?.mine === true);

  const tooFast = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ff0000', size: 4, points: [[1, 1], [2, 2]] });
  check('★ 画太快 → 被拒（80 毫秒一笔）', tooFast.code !== 0, String(tooFast.message));
  await sleep(150);

  check('工具只能是 pen / eraser / erase', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'spray', color: '#ffffff', size: 4, points: [[1, 1]] })).code !== 0);
  await sleep(150);
  check('★ 颜色不是 #rrggbb → 被拒', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: 'red', size: 4, points: [[1, 1]] })).code !== 0);
  await sleep(150);
  check('一个点都没有 → 被拒', (await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ffffff', size: 4, points: [] })).code !== 0);
  await sleep(150);
  const clamp = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#00ff00', size: 3, points: [[-999, -999], [99999, 99999]] });
  /* ⚠ 这一条 2026-10-09 改过（旧断言写死 2400/1500）：数字一律从模块里取，别再写死 */
  check(`★ 越界坐标被夹进画板（${BOARD_W}×${BOARD_H}）`,
    clamp.code === 0 && clamp.stroke.points[0][0] === 0 && clamp.stroke.points[1][0] === BOARD_W && clamp.stroke.points[1][1] === BOARD_H,
    JSON.stringify(clamp.stroke?.points));

  const list = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  check('列表读得到今天的笔划（按时间正序）', list.code === 0 && list.strokes.length === 2, `${list.strokes?.length} 笔`);
  check('列表带 today / serverNow（页面判断跨零点）', /^\d{4}-\d{2}-\d{2}$/.test(String(list.today)) && !!list.serverNow);
  const cur = list.strokes[list.strokes.length - 1].createdAt;
  check('★ 游标增量：没有新笔划时是空的', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: cur })).strokes.length === 0);
  await sleep(150);
  await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'eraser', color: PAPER, size: 20, points: [[5, 5], [6, 6]] });
  check('★ 有新的时只回新的那笔', (await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: cur })).strokes.length === 1);

  check('★ 撤自己那笔 → 成功', (await call({ event: 'LT_DRAW_DELETE', ltToken: tokHoshi, id: one.stroke.id })).code === 0);
  const after = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  check('撤完列表里就没有了', !after.strokes.some((s) => s.id === one.stroke.id), `${after.strokes.length} 笔`);
  check('★ 撤别人画的不行（先塞一笔别人的）', await (async () => {
    await raw.insertOne({
      id: 'other1',
      day: new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10),
      userId: 'someone-else',
      uk: 'deadbeef',
      nick: '别人',
      avatar: '',
      tool: 'pen',
      color: '#000000',
      size: 3,
      points: [[1, 1], [2, 2]],
      createdAt: Date.now(),
      deleted: false,
    });
    return (await call({ event: 'LT_DRAW_DELETE', ltToken: tokHoshi, id: 'other1' })).code !== 0;
  })());

  /* ==========================================================================
     2026-10-10：像素橡皮 / 整笔擦别人的 —— 服务端这一半
     ========================================================================== */
  await sleep(150);
  const eraseAdd = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'erase', color: PAPER, size: 40, points: [[300, 300], [400, 300]] });
  check('★ 像素橡皮那一笔（tool=erase）服务端收得下（它也是一种笔划）',
    eraseAdd.code === 0 && eraseAdd.stroke?.tool === 'erase', JSON.stringify(eraseAdd.stroke ?? eraseAdd.message));

  /*
    「擦别人的」（整笔）：显式 others: true 才准，而且墓碑要带新的 updatedAt ——
    客户端是按 updatedAt 增量拉的，不抬这个值，别人屏幕上那根线就删不掉。
  */
  const delOtherOk = await call({ event: 'LT_DRAW_DELETE', ltToken: tokHoshi, id: 'other1', others: true });
  check('★ 整笔擦别人的：带 others: true → 允许（用户要的这颗开关）', delOtherOk.code === 0, String(delOtherOk.message));
  const tomb = await raw.findOne({ id: 'other1' });
  check('★ 擦掉别人那一笔之后留了墓碑，而且 updatedAt 抬到了删除那一刻（别人轮询才拉得到）',
    tomb?.deleted === true && Number(tomb?.updatedAt) > 0 && Number(tomb.updatedAt) >= Number(tomb.createdAt),
    JSON.stringify({ deleted: tomb?.deleted, updatedAt: tomb?.updatedAt, createdAt: tomb?.createdAt }));
  const incTomb = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: 1 });
  check('★ 增量那一趟**不过滤 deleted**（把墓碑发下来），而且带 deleted: true 标记',
    incTomb.code === 0 && incTomb.strokes.some((s) => s.id === 'other1' && s.deleted === true),
    JSON.stringify(incTomb.strokes?.filter((s) => s.id === 'other1')));
  const fullList = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  check('★ 第一趟（整块板）照旧**不给**墓碑（"整块板长什么样"里没有已经没了的笔划）',
    fullList.code === 0 && !fullList.strokes.some((s) => s.id === 'other1'),
    `${fullList.strokes?.length} 笔`);

  /* 像素橡皮（只擦自己）：一根换成 0~n 段 —— 原子、只给自己、继承原来那一笔的时间 */
  const mineForCut = await (async () => {
    await sleep(150);
    return call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#ff0000', size: 10, points: [[100, 100], [200, 100], [300, 100]] });
  })();
  /* ⚠ 每一次 REPLACE 之间都要让过 80 毫秒那道限速，否则测到的是"画太快了"，不是要测的那条规矩 */
  await sleep(150);
  const cut = await call({
    event: 'LT_DRAW_REPLACE',
    ltToken: tokHoshi,
    edits: [{ id: mineForCut.stroke.id, parts: [
      { tool: 'pen', color: '#ff0000', size: 10, points: [[100, 100], [180, 100]] },
      { tool: 'pen', color: '#ff0000', size: 10, points: [[220, 100], [300, 100]] },
    ] }],
  });
  check('★ 像素橡皮（只擦自己）：LT_DRAW_REPLACE 把一根换成两段，返回新的那两段',
    cut.code === 0 && cut.strokes?.length === 2 && cut.deleted?.includes(mineForCut.stroke.id),
    JSON.stringify({ code: cut.code, message: cut.message, n: cut.strokes?.length, deleted: cut.deleted }));
  check('★ 裁出来的段**继承原来那一笔的时间**（z 序不能因为擦一下就跳到最后面）',
    cut.strokes?.[0]?.createdAt === mineForCut.stroke.createdAt && cut.strokes?.[1]?.createdAt === mineForCut.stroke.createdAt,
    JSON.stringify({ 原: mineForCut.stroke.createdAt, 新: cut.strokes?.map((s) => s.createdAt) }));
  check('★ 被裁的那一根留了墓碑（它"没了"，别人也要跟着删掉它）',
    (await raw.findOne({ id: mineForCut.stroke.id }))?.deleted === true);
  check('★ 只准改自己画的（改别人的一根 → 被拒）', await (async () => {
    await raw.insertOne({
      id: 'other2',
      day: new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10),
      userId: 'someone-else',
      uk: 'deadbeef',
      nick: '别人',
      avatar: '',
      tool: 'pen',
      color: '#000000',
      size: 3,
      points: [[1, 1], [2, 2]],
      createdAt: Date.now(),
      deleted: false,
    });
    await sleep(150);
    const r = await call({ event: 'LT_DRAW_REPLACE', ltToken: tokHoshi, edits: [{ id: 'other2', parts: [] }] });
    return r.code !== 0 && !/画太快/.test(String(r.message));
  })());
  const cutBefore = await raw.countDocuments({ deleted: { $ne: true }, userId: idHoshi });
  await sleep(150);
  const badPart = await call({
    event: 'LT_DRAW_REPLACE',
    ltToken: tokHoshi,
    edits: [
      { id: cut.strokes[0].id, parts: [{ tool: 'pen', color: '#00ff00', size: 4, points: [[1, 1], [2, 2]] }] },
      { id: cut.strokes[1].id, parts: [{ tool: 'spray', color: '#00ff00', size: 4, points: [[1, 1]] }] },
    ],
  });
  check('★ 一次改多根时**要么全成、要么一个都不动**（第二根不合法 → 第一根也没被改）',
    badPart.code !== 0 && !/画太快/.test(String(badPart.message)) &&
      (await raw.countDocuments({ deleted: { $ne: true }, userId: idHoshi })) === cutBefore,
    JSON.stringify({ code: badPart.code, message: badPart.message, 笔数: cutBefore }));
  await sleep(150);
  const cutAll = await call({ event: 'LT_DRAW_REPLACE', ltToken: tokHoshi, edits: [{ id: cut.strokes[0].id, parts: [] }] });
  check('★ parts 给空数组 = 整根擦掉（像素橡皮把那一小段全擦没了的情况）',
    cutAll.code === 0 && cutAll.strokes?.length === 0 && (await raw.findOne({ id: cut.strokes[0].id }))?.deleted === true,
    JSON.stringify({ code: cutAll.code, message: cutAll.message }));

  /* 偏好：橡皮的方式 + 两份"擦别人的" */
  await call({
    event: 'LT_PREFS_SET',
    ltToken: tokHoshi,
    prefs: { eraserMode: 'pixel', eraserStrokeOthers: true, eraserPixelOthers: false, grid: false, penSize: 12 },
  });
  const prefDoc = await cli.db('twikoo').collection('lt_users').findOne({ nick: 'hoshi' });
  check('★ 橡皮的方式 + 两份开关都存进了账号（服务端白名单认这三个字段）',
    prefDoc?.prefs?.eraserMode === 'pixel' && prefDoc?.prefs?.eraserStrokeOthers === true && prefDoc?.prefs?.eraserPixelOthers === false,
    JSON.stringify(prefDoc?.prefs ?? {}));
  await call({ event: 'LT_PREFS_SET', ltToken: tokHoshi, prefs: { eraserMode: '喷枪', eraserStrokeOthers: 'yes' } });
  const prefDoc2 = await cli.db('twikoo').collection('lt_users').findOne({ nick: 'hoshi' });
  check('不认识的 eraserMode / 不是布尔的开关一律丢掉（不写坏数据）',
    prefDoc2?.prefs?.eraserMode !== '喷枪' && prefDoc2?.prefs?.eraserStrokeOthers !== 'yes',
    JSON.stringify(prefDoc2?.prefs ?? {}));


  /* 一小时上限：直接塞 4000 笔（接口造不出来，因为限速） */
  const now = Date.now();
  /* 这一天的标签照云函数 dayKey 写（now + 4h 的 UTC 日期）—— 用 now + 8h 的话半夜跑会差一天 */
  const todayDay = new Date(now + 4 * 3600 * 1000).toISOString().slice(0, 10);
  await raw.insertMany(
    Array.from({ length: 4000 }, (_, i) => ({
      id: 'bulk' + i,
      day: todayDay,
      userId: idHoshi,
      uk: one.stroke.uk,
      nick: 'hoshi',
      avatar: '',
      tool: 'pen',
      color: '#123456',
      size: 2,
      points: [[i % 100, i % 50]],
      createdAt: now - 1000 - i,
      deleted: false,
    }))
  );
  await sleep(200);
  const over = await call({ event: 'LT_DRAW_ADD', ltToken: tokHoshi, tool: 'pen', color: '#123456', size: 2, points: [[1, 1]] });
  check('★ 一小时超过 4000 笔 → 被拒（脚本刷不动）', over.code !== 0 && /4000/.test(String(over.message)), String(over.message));

  /*
    ★★ 用户报的"画多了就超 6MB"（原话：「这个非常严重」）就在这里量。
    `LT_DRAW_LIST` 原来默认一次给 1500 笔 —— 一天的画多了之后响应体能到 10MB，
    撞上腾讯云 **6MB 上限** → 云函数抛 FUNCTIONS_INVOCATION_FAILED →
    **所有人打开画板都是一片空白**（画得越多越打不开）。现在按 2MB 字节预算分批，
    并用 more / next 让页面续着拉。下面把这条路一步步量出来（这批 4000 笔还特意**不带 updatedAt**，
    顺带验"老文档也不能被游标漏掉"那条）。
  */
  const live1 = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi });
  const live1Bytes = JSON.stringify(live1).length;
  check('★★ 一次拉全天的响应体被字节预算压住了（远小于网关 6144KB 上限）',
    live1Bytes < 3 * 1024 * 1024, `${Math.round(live1Bytes / 1024)}KB / ${live1.strokes.length} 笔`);
  check('★★ 它明说"还有更多"（more=true），而不是硬发一坨超限的',
    live1.more === true && live1.strokes.length < 4000, JSON.stringify({ more: live1.more, n: live1.strokes.length }));
  const walked = new Set(live1.strokes.map((s) => s.id));
  let liveCur = live1.next;
  let livePages = 1;
  let liveMax = live1Bytes;
  while (liveCur && livePages < 80) {
    const p = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: liveCur.ts, afterId: liveCur.id });
    if (p.code !== 0) break;
    livePages += 1;
    liveMax = Math.max(liveMax, JSON.stringify(p).length);
    for (const s of p.strokes) walked.add(s.id);
    if (!p.more || !p.next) break;
    liveCur = p.next;
  }
  check('★★ 一路翻页能把那天拉完（4000 笔一笔不漏，含没有 updatedAt 的老文档）',
    walked.size >= 4000, `${walked.size} 笔 / ${livePages} 批`);
  check('★ 每一批都在预算之内（没有哪一批偷偷超上去）', liveMax < 3 * 1024 * 1024, `最大一批 ${Math.round(liveMax / 1024)}KB`);

  /* 同一毫秒画下的多笔：只按 updatedAt 过滤会漏掉后面几笔，复合游标 (updatedAt, id) 才不会 */
  const tieTs = now - 500000;
  await raw.insertMany(
    Array.from({ length: 7 }, (_, i) => ({
      id: 'tie' + i, day: todayDay, userId: idHoshi, uk: one.stroke.uk, nick: 'hoshi', avatar: '',
      tool: 'pen', color: '#123456', size: 2, points: [[i, i]], createdAt: tieTs, updatedAt: tieTs, deleted: false,
    }))
  );
  const tieSeen = new Set();
  let tieCur = null;
  let tiePages = 0;
  for (;;) {
    const p = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, limit: 2, ...(tieCur ? { after: tieCur.ts, afterId: tieCur.id } : {}) });
    if (p.code !== 0 || !p.strokes.length) break;
    for (const s of p.strokes) if (String(s.id).startsWith('tie')) tieSeen.add(s.id);
    tiePages += 1;
    if (!p.more || !p.next || tiePages > 80) break;
    tieCur = p.next;
  }
  check('★★ 同一毫秒画下的 7 笔一笔都不漏（复合游标 (updatedAt, id)）', tieSeen.size === 7, `${tieSeen.size}/7`);

  /*
    ★★ 真正挡 6MB 的是**字节预算**，不是条数上限：上面那 4000 笔每笔只有一两个点（很小），
    条数上限就先把它截住了。这里塞一批"胖笔划"（每笔 200 个点，约 3KB）——2000 笔合计 6MB 上下，
    要是还按条数一次吐出去，线上就是那条 FUNCTIONS_INVOCATION_FAILED。把条数上限放到最大（2000）
    再看：响应必须仍然被预算压住，而且一路翻页要能把这 2000 笔全捞回来。
  */
  const fatCount = 2000;
  await raw.insertMany(
    Array.from({ length: fatCount }, (_, i) => ({
      id: 'fat' + String(i).padStart(4, '0'),
      day: todayDay,
      userId: idHoshi,
      uk: one.stroke.uk,
      nick: 'hoshi',
      avatar: '',
      tool: 'pen',
      color: '#123456',
      size: 2,
      points: Array.from({ length: 200 }, (_, k) => [100 + k * 10, 200 + ((k * 7 + i) % 500)]),
      createdAt: now + 100 + i,
      updatedAt: now + 100 + i,
      deleted: false,
    }))
  );
  const fat1 = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: now + 99, limit: 2000 });
  const fat1Bytes = JSON.stringify(fat1).length;
  const fatPerStroke = fat1Bytes / Math.max(1, fat1.strokes.length);
  check('★★ 胖笔划也不会一次吐出去：条数上限放到 2000，响应仍被字节预算压住',
    fat1Bytes < 3 * 1024 * 1024 && fat1.more === true && fat1.strokes.length < fatCount,
    `${Math.round(fat1Bytes / 1024)}KB / ${fat1.strokes.length} 笔；这 ${fatCount} 笔一次给约 ${(fatPerStroke * fatCount / 1024 / 1024).toFixed(1)}MB（网关上限 6MB）`);
  const fatSeen = new Set(fat1.strokes.map((s) => s.id));
  let fatCur = fat1.next;
  let fatPages = 1;
  let fatMax = fat1Bytes;
  while (fatCur && fatPages < 40) {
    const p = await call({ event: 'LT_DRAW_LIST', ltToken: tokHoshi, after: fatCur.ts, afterId: fatCur.id, limit: 2000 });
    if (p.code !== 0) break;
    fatPages += 1;
    fatMax = Math.max(fatMax, JSON.stringify(p).length);
    for (const s of p.strokes) fatSeen.add(s.id);
    if (!p.more || !p.next) break;
    fatCur = p.next;
  }
  check('★★ 胖笔划一路翻页也一笔不漏（2000 笔全部到手）',
    fatSeen.size >= fatCount, `${fatSeen.size}/${fatCount}，共 ${fatPages} 批，最大一批 ${Math.round(fatMax / 1024)}KB`);

  /*
    这一天的标签必须和云函数 `dayKey()` **一模一样**：`new Date(now + 4h)` 的 UTC 日期
    （＝北京时间凌晨四点切天）。这里原来写的是 `now + 8h`（北京自然日）——
    在 00:00~04:00 之间跑验收时两者差一天，那会是个"一过半夜就假红"的坑。
  */
  const today = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 10);
  /*
    ⚠ 2026-10-10 改的：取某天的笔划原来是"一次全给你"。10-09 那天量太大，响应体超过腾讯云 **6MB** 上限，
    云函数抛 FUNCTIONS_INVOCATION_FAILED，存档那一枪整个失败；而它排在聊天室之后，
    于是"聊天室搬好、云端图片也抹了"的那次运行连提交都没走到 —— 用户第二天看到
    "昨天的画和聊天都没保存"。现在按 (createdAt, id) 游标 + 字节预算分页，下面把这条协议逐条量出来。
  */
  const page1 = await call({ event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today, limit: 50 });
  check('★ 站长取某天的笔划是**分页**给的（第一批只给 limit 条，还带 total / next）',
    page1.code === 0 && page1.count === 50 && page1.total >= 4002 && !!page1.next,
    `count=${page1.count} total=${page1.total} next=${JSON.stringify(page1.next)}`);
  let acc = [...page1.strokes];
  let cursor = page1.next;
  let pages = 1;
  let maxBytes = JSON.stringify(page1).length;
  while (cursor && pages < 300) {
    const p = await call({
      event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today,
      limit: 50, after: cursor.ts, afterId: cursor.id,
    });
    if (p.code !== 0) break;
    maxBytes = Math.max(maxBytes, JSON.stringify(p).length);
    acc.push(...p.strokes);
    cursor = p.next;
    pages += 1;
  }
  check('★★ 一直翻页能把那一天取完（累计 = total，一笔都不少）',
    acc.length === page1.total && acc.length >= 4002, `${acc.length}/${page1.total}，共 ${pages} 批`);
  check('★★ 单批响应体远小于腾讯云 6MB 上限 —— 这就是 10-09 那次失败的根因，现在这条路走得通',
    maxBytes < 3 * 1024 * 1024, `最大一批 ${Math.round(maxBytes / 1024)}KB（网关上限 6144KB）`);
  check('翻页不重不漏（id 去重之后条数一样）', new Set(acc.map((s) => s.id)).size === acc.length, `${acc.length} 条`);
  check('取出来的带着 tool / color / points（够画回一张 SVG）',
    acc.every((s) => s.tool && s.color && Array.isArray(s.points)), '');
  /* CLEAR 的对账闸门：云端那份是**唯一**的一份，条数对不上就必须拒清 */
  const badClear = await call({ event: 'LT_ADMIN_DRAW_CLEAR', password: 'admin-pass-123', day: today, expect: 3 });
  const stillThere = await call({ event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today, limit: 1 });
  check('★★ 清云端要先报对数：条数对不上就拒清，而且云端一笔没少',
    badClear.code !== 0 && /对不上/.test(String(badClear.message)) && stillThere.total >= 4002,
    `message=${badClear.message} 云端还剩 ${stillThere.total} 笔`);
  const cleared = await call({ event: 'LT_ADMIN_DRAW_CLEAR', password: 'admin-pass-123', day: today, expect: acc.length });
  check('★ 站长清某天（搬进仓库之后把云端删掉）', cleared.code === 0 && cleared.cleared >= 4002, String(cleared.cleared));
  check('清完之后那天真的空了', (await call({ event: 'LT_ADMIN_DRAW_DAY', password: 'admin-pass-123', day: today })).count === 0);

  /*
    聊天室那条路同一天也加了分页（2026-10-10）：一张图最大 ~533KB 的 data URL，
    一天里十几张图就会撞上**同一个 6MB 上限** —— 画板已经真栽过一次，聊天室没理由等它再栽。
    这里对着**真云函数 + 内存 MongoDB** 量：翻页取完必须等于 total，一条不重不漏。
    ⚠ 发消息之间要留够 1.5 秒：聊天室有自己的"1.5 秒一条"限速，连着发第二句会被拒（这条踩过一次）。
  */
  for (let i = 1; i <= 2; i += 1) {
    await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: `分页测试 ${i}` });
    if (i < 2) await sleep(1700);
  }
  const c1 = await call({ event: 'LT_ADMIN_CHAT_DAY', password: 'admin-pass-123', day: today, limit: 1 });
  check('★ 站长取某天的聊天记录也是**分页**给的（第一批只给 limit 条，还带 total / next）',
    c1.code === 0 && c1.count === 1 && c1.total >= 2 && !!c1.next,
    `count=${c1.count} total=${c1.total} next=${JSON.stringify(c1.next)}`);
  const cAcc = [...c1.messages];
  let cCur = c1.next;
  let cPages = 1;
  while (cCur && cPages < 50) {
    const p = await call({
      event: 'LT_ADMIN_CHAT_DAY', password: 'admin-pass-123', day: today,
      limit: 1, after: cCur.ts, afterId: cCur.id,
    });
    if (p.code !== 0) break;
    cAcc.push(...p.messages);
    cCur = p.next;
    cPages += 1;
  }
  check('★★ 聊天室翻页取完 = total（不重不漏，和画板同一套协议）',
    cAcc.length === c1.total && new Set(cAcc.map((m) => m.id)).size === c1.total,
    `${cAcc.length}/${c1.total}，共 ${cPages} 批`);

  /*
    ★★ 聊天室那条路的**字节预算**（同一类事故）：一条带图的 data URL 能到 ~400KB
    （页面把图压到 1000px 的 WebP），十几条就是 6MB —— 和画板一样会把整个页面打死。
    这里发 6 条胖消息（每条 ~380KB 的假图），量"一次响应绝不会把这一天全吐出来"。
    ⚠ 聊天室有 1.5 秒一条的限速，所以这一步要等 10 秒左右。
  */
  const bigImg = 'data:image/png;base64,' + 'A'.repeat(380 * 1024);
  const bigIds = [];
  /* 要凑够 8 条（8 × 380KB ≈ 3MB > 2MB 预算，这样才真的能验到"预算把这一批截住"）。
     聊天室 1.5 秒一条的限速偶尔会顶掉一条，所以多试几次、够了就停。 */
  for (let i = 1; i <= 12 && bigIds.length < 8; i += 1) {
    const r = await call({ event: 'LT_CHAT_SEND', ltToken: tokHoshi, text: `胖消息 ${i}`, image: bigImg });
    if (r.code === 0 && r.message?.id) bigIds.push(r.message.id);
    await sleep(1800);
  }
  const bigList = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi, day: today, limit: 500 });
  const bigBytes = JSON.stringify(bigList).length;
  check('★★ 聊天室一次响应也被字节预算压住（8 条 380KB 的图 ≈ 3MB，没被一次吐完）',
    bigIds.length >= 8 && bigBytes < 2.5 * 1024 * 1024 && bigList.more === true,
    `${Math.round(bigBytes / 1024)}KB / ${bigList.messages.length} 条（胖消息 ${bigIds.length} 条）`);
  const bigSeen = new Set(bigList.messages.map((m) => m.id));
  let bigCur = bigList.next;
  let bigPages = 1;
  while (bigCur && bigPages < 20) {
    const p = await call({ event: 'LT_CHAT_LIST', ltToken: tokHoshi, day: today, after: bigCur.ts, afterId: bigCur.id, limit: 500 });
    if (p.code !== 0) break;
    bigPages += 1;
    for (const m of p.messages) bigSeen.add(m.id);
    if (!p.more || !p.next) break;
    bigCur = p.next;
  }
  check('★★ 聊天室翻页也一条不漏（刚发的胖消息全取回来了）',
    bigIds.length >= 8 && bigIds.every((id) => bigSeen.has(id)),
    `${bigIds.filter((id) => bigSeen.has(id)).length}/${bigIds.length}，共 ${bigPages} 批`);

  check('站长密码不对 → 取不到 / 清不掉',
    (await call({ event: 'LT_ADMIN_DRAW_DAY', password: '乱猜', day: today })).code !== 0 &&
    (await call({ event: 'LT_ADMIN_DRAW_CLEAR', password: '乱猜', day: today })).code !== 0);

  await cli.close();
  await mongod.stop();
}

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ③ 真浏览器：假云函数 + 真画布像素 ===');
const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo.envId ?? '';
  } catch {
    return '';
  }
})();

/* 假后端：自己画的记下来；轮询时给一笔"别人画的"（在 1800,1100，蓝色） */
const seen = { add: [], del: [], moves: [], prefs: [], replace: [], chatSends: [], chatLists: 0, lists: 0 };
/*
  茶绘右栏那个聊天框（2026-10-10 加的）用的假聊天后端：一条历史消息 + 之后发进来的。
  ⚠ 增量那一趟必须**按游标过滤**（mountChat 在带游标时是"追加"，不去重）——
  不然每 4 秒轮询一次就会把同一条消息重画一遍，测试自己把自己搞乱。
*/
const chatMsgs = [
  { id: 'chat0', day: '2026-10-09', nick: '虹星', alias: '虹星', avatar: '', text: '茶绘这边也能聊。', image: '', createdAt: Date.now() - 5000, mine: false },
];
/*
  假后端自己记一份"服务端那一条"：LT_DRAW_MOVE 要按 id 把这根找回来、算出新位置再发回去
  （引擎会拿服务端返回的点去比"和本地算的一样不一样"，一样就不再重建缓存）。
*/
const created = new Map();
/*
  测试中途注入的"别人画的"笔划。updatedAt 故意给到很远的未来：
  · 永远能过游标那一关（3 秒一轮的时序不会把测试弄脆）；
  · 又比现有最新的那笔"新"，所以引擎应该**增量**画进缓存，而不是整块重建 —— 这正是要量的事。
*/
const extra = [];
const remoteStroke = (s) => ({ ...s, createdAt: Date.now() + 30000, updatedAt: Date.now() + 30000, mine: false });
/*
  **墓碑**（2026-10-10）：真后端在增量那一趟会把"撤掉的 / 被擦掉的"也发下来（带 deleted: true），
  客户端见到就把本地那一根删掉。这一段就是拿来量这条路的 ——
  测试中途往这里塞一条，看画布上那一根是不是真的消失了（第 5 段 (g)）。
*/
const tombstones = [];
/* 账号里那份偏好（LT_ME 会带出去）——"重开页面收藏还在"那条就靠它 */
let prefsState = {};
/*
  假云端说的"今天是哪天"（真后端按北京时间凌晨 4 点切天，页面**只认服务端回的这个值**）。
  跨天自清那一条就是把它换掉、再让列表返回空的 —— 模拟"凌晨四点存档搬完 + 清空云端"。
*/
/*
  ⚠ 这个值**故意跟今天不一样**：它就是"换天"那个夹具（下面第 6 段把它换掉、模拟凌晨四点存档搬完）。
  别拿它当日期声明、也别在批量改日期时顺手把它改成今天 —— 2026-10-09 晚上就栽过一次：
  一次盲改把这里和下面的期望值一起改成同一天，跨天自清那两条立刻假红（功能是好的）。
*/
const NEXT_DAY = '2026-10-11';
let servedToday = '2026-10-09';
let servedWiped = false;
const OTHER = { id: 'other-stroke', uk: 'beef1234', nick: '虹星', avatar: '', tool: 'pen', color: '#3a86ff', size: 24, points: [[1750, 1050], [1850, 1100], [1950, 1150]], createdAt: 0, mine: false };
const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') {
    return { code: 0, user: { nick: '测试者', alias: '测试者', mail: '', status: 'approved', avatar: '', label: '', prefs: { ...prefsState } }, posts: 0 };
  }
  if (event === 'LT_DRAW_LIST') {
    seen.lists += 1;
    const after = Number(body?.after) || 0;
    const afterId = String(body?.afterId || '');
    /*
      ⚠ 2026-10-10 改：这个夹具原来**只在带了游标时**才回"别人画的"那一笔，而当时客户端靠
      **本地**推进游标（抬笔就把游标推到自己那一笔），所以看着是通的。客户端改成"不自己推游标"之后
      （那条改动是为了不跳过同一毫秒里别人画的笔划），夹具就必须像**真后端**那样：
      把 `updatedAt > 游标` 的所有笔划都回给轮询 —— **包括你自己刚画的那几笔**。
      真后端本来就是这么干的；`absorb()` 按 id 去重，自己的笔划再吸一次不会有副作用。
    */
    const all = [
      ...[...created.values()],
      ...extra,
      ...tombstones,
      ...(after ? [{ ...OTHER, createdAt: after + 1, updatedAt: after + 1 }] : []),
    ];
    const strokes = servedWiped
      ? []
      : all.filter((s) => {
          const ts = Number(s.updatedAt ?? s.createdAt) || 0;
          return ts > after || (!!after && ts === after && String(s.id) > afterId);
        });
    const last = strokes[strokes.length - 1];
    return {
      code: 0,
      day: servedToday,
      today: servedToday,
      serverNow: Date.now(),
      more: false,
      /* "今天这块板已经被存档搬空/换天了" → 一条都不给（客户端该照 today 自清） */
      strokes,
      /* 复合游标（和真后端一个形状）：客户端拿它当下一趟的游标 */
      next: last ? { ts: Number(last.updatedAt ?? last.createdAt) || 0, id: String(last.id) } : null,
    };
  }
  if (event === 'LT_DRAW_ADD') {
    seen.add.push(body);
    const stroke = {
      id: 'mine' + seen.add.length,
      uk: 'aaaa1111',
      nick: '测试者',
      alias: '测试者',
      avatar: '',
      tool: body.tool,
      color: body.color,
      size: body.size,
      points: body.points,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mine: true,
    };
    created.set(stroke.id, { ...stroke, points: stroke.points.map(([x, y]) => [x, y]) });
    return { code: 0, stroke };
  }
  if (event === 'LT_DRAW_DELETE') {
    seen.del.push(body);
    created.delete(String(body.id));
    return { code: 0, id: body.id };
  }
  /*
    像素橡皮（只擦自己）那一路（2026-10-10）：一根换成 0~n 段。
    假后端照着真后端的样子做：原笔划从"盘上"拿掉，每段拿一个新 id 放进来，
    返回**新的那几段**（客户端要用它们替换本地那些临时碎片）。
  */
  if (event === 'LT_DRAW_REPLACE') {
    seen.replace.push(body);
    const out = [];
    for (const e of Array.isArray(body?.edits) ? body.edits : []) {
      const s = created.get(String(e.id));
      created.delete(String(e.id));
      for (const part of Array.isArray(e.parts) ? e.parts : []) {
        const stroke = {
          id: 'cut' + seen.replace.length + '-' + out.length,
          uk: 'aaaa1111',
          nick: '测试者',
          alias: '测试者',
          avatar: '',
          tool: part.tool,
          color: part.color,
          size: part.size,
          points: part.points,
          /* 继承原来那一笔的时间：z 序不能因为"擦了一下"就跳到最后面 */
          createdAt: s ? Number(s.createdAt) || Date.now() : Date.now(),
          updatedAt: Date.now(),
          mine: true,
        };
        created.set(stroke.id, { ...stroke, points: stroke.points.map(([x, y]) => [x, y]) });
        out.push(stroke);
      }
    }
    return { code: 0, strokes: out, deleted: (body?.edits ?? []).map((e) => e.id), serverNow: Date.now() };
  }
  /* 拖动一根线条：整条平移、逐点夹回画板（和云函数那份一个规矩） */
  if (event === 'LT_DRAW_MOVE') {
    seen.moves.push(body);
    const s = created.get(String(body.id));
    if (!s) return { code: 1000, message: '这一笔已经不在了。' };
    const dx = Number(body.dx) || 0;
    const dy = Number(body.dy) || 0;
    s.points = s.points.map(([x, y]) => [
      Math.round(Math.min(BOARD_W, Math.max(0, x + dx)) * 10) / 10,
      Math.round(Math.min(BOARD_H, Math.max(0, y + dy)) * 10) / 10,
    ]);
    s.updatedAt = Date.now();
    return { code: 0, stroke: { ...s, points: s.points.map(([x, y]) => [x, y]) }, serverNow: s.updatedAt };
  }
  /* 画板偏好：存下来，下次 LT_ME 带出去 */
  if (event === 'LT_PREFS_SET') {
    seen.prefs.push(body);
    prefsState = { ...(body.prefs || {}) };
    return { code: 0, prefs: prefsState };
  }
  /* 茶绘右栏那个聊天框走的就是聊天室那一套事件（LT_CHAT_*），这里给个最小的假后端 */
  if (event === 'LT_CHAT_LIST') {
    seen.chatLists += 1;
    const after = Number(body?.after) || 0;
    const list = after ? chatMsgs.filter((m) => Number(m.createdAt) > after) : chatMsgs;
    return { code: 0, day: servedToday, today: servedToday, serverNow: Date.now(), messages: list, more: false, next: null };
  }
  if (event === 'LT_CHAT_SEND') {
    seen.chatSends.push(body);
    const m = {
      id: 'chatmine' + seen.chatSends.length,
      day: servedToday,
      nick: '测试者',
      alias: '测试者',
      avatar: '',
      text: String(body.text ?? ''),
      image: String(body.image ?? ''),
      createdAt: Date.now(),
      mine: true,
    };
    chatMsgs.push(m);
    return { code: 0, message: m };
  }
  return { code: 0 };
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__lt') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        /* 空 */
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fakeBackend(body)));
    });
    return;
  }
  const p = decodeURIComponent(url.pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      let buf = fs.readFileSync(f);
      if (ext === '.html' && liveApi) {
        buf = Buffer.from(buf.toString('utf8').split(liveApi).join(`http://127.0.0.1:${server.address().port}/__lt`), 'utf8');
      }
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      return res.end(buf);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytdraw-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 140));
      /* 未捕获的异常也记下来（原来只记 console.error）：引擎挂载时炸掉就是这样暴露的 ——
         页面上一片安静，只有 window.__ltBoard 不见了。 */
      if (m.method === 'Runtime.exceptionThrown') {
        const ex = m.params.exceptionDetails;
        const d = String(ex.exception?.description || ex.text || '').split('\n').slice(0, 3).join(' | ');
        this.errors.push(`未捕获异常: ${d.slice(0, 200)}`);
      }
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    return new CDP(ws);
  }
  send(m, p = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) {
      /* 2026-10-09：原来只抛 exceptionDetails.text（永远是一句"Uncaught"），
         排查"引擎没挂上"时等于没说 —— 把页面里的异常描述和最近几条 console.error 一起带上。 */
      const d = r.exceptionDetails;
      const desc = String(d.exception?.description || d.exception?.value || '').split('\n').slice(0, 3).join(' | ');
      const recent = this.errors.length ? `  ｜页面里最近报的错：${this.errors.slice(-3).join(' ;; ')}` : '';
      throw new Error(`${d.text}${desc ? ` :: ${desc}` : ''}${recent}  ｜表达式：${String(e).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
    return r.result.value;
  }
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(200);
    }
    return false;
  }
  async go(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

/*
  画布上某一点的颜色（**画板坐标**）。
  2026-10-09 起画布的内部像素尺寸跟着"它显示多大 × DPR"走、还带缩放平移，
  所以读像素要走引擎给的那个调试口 `window.__ltBoard.pixelAt`（它自己会把画板坐标换算成设备像素）。
  ——这不影响"量的是真画出来的像素"：读的还是 canvas 的 getImageData。
*/
const pixelAt = (x, y) => `(() => (window.__ltBoard ? window.__ltBoard.pixelAt(${x}, ${y}) : '(没有 __ltBoard)'))()`;

/** 画板坐标 → 屏幕坐标（要过视野：缩放 + 平移） */
const toScreen = (x, y) => `(() => {
  const c = document.querySelector('[data-lt-canvas]');
  const r = c.getBoundingClientRect();
  const v = (window.__ltBoard && window.__ltBoard.view) || { scale: 1, x: 0, y: 0 };
  return { x: Math.round(r.left + (${x} - v.x) * v.scale), y: Math.round(r.top + (${y} - v.y) * v.scale) };
})()`;

/** 当前视野（缩放 + 平移 + DPR） */
const viewOf = `(() => (window.__ltBoard ? window.__ltBoard.view : null))()`;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  const base = `http://127.0.0.1:${PORT}`;

  /** 在画布上画一笔（合成的真鼠标事件：按下 → 走几段 → 抬起） */
  /** 把画布滚到视口中间（合成事件的坐标必须落在视口里，不然点了也白点） */
  const showCanvas = async () => {
    await cdp.ev("document.querySelector('[data-lt-canvas]').scrollIntoView({ block: 'center', behavior: 'instant' })");
    await sleep(400);
  };

  /**
   * 选一个颜色当画笔。
   *
   * ⚠ 2026-10-09 改的：调色盘**默认只剩黑白二色**（用户要求"其他都交给用户自己选上"），
   * 所以旧写法"点那个内置色块"（`find(b => b.dataset.color === '#1d1430')`）会点空 ——
   * 现在一律走「别的颜色」那个输入框（和用户自己调色走的是同一条路，语义没变）。
   * 色块**存在**时仍旧点色块（顺带把"点色块能改颜色"这条也一起验了）。
   */
  const setInk = async (hex) => {
    const hit = await cdp.ev(`(() => {
        const b = [...document.querySelectorAll('.lyt-draw__swatch')].find((x) => x.dataset.color === '${hex}');
        if (b) { b.click(); return 'swatch'; }
        const el = document.querySelector('[data-lt-color]');
        el.value = '${hex}';
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return 'input';
      })()`);
    await sleep(120);
    return hit;
  };

  const drawOn = async (points) => {
    await showCanvas();
    const first = await cdp.ev(toScreen(points[0][0], points[0][1]));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1, buttons: 1 });
    for (const [bx, by] of points.slice(1)) {
      const s = await cdp.ev(toScreen(bx, by));
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
      await sleep(25);
    }
    const last = await cdp.ev(toScreen(points[points.length - 1][0], points[points.length - 1][1]));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
  };

  /* ---- 访客 ---- */
  await cdp.go(`${base}/liyutang/teahouse/`);
  await cdp.wait(`(() => { const a = document.querySelector('[data-lt-account]'); return !!(a && a.dataset.state); })()`);
  const guest = await cdp.ev(`(() => ({
      state: (document.querySelector('[data-lt-account]')||{}).dataset?.state || '',
      gate: (document.querySelector('[data-lt-draw-gate]')||{}).textContent || '',
      locked: [...document.querySelectorAll('.lyt-draw__bar button, .lyt-draw__bar input')].every((el) => el.disabled),
      pointerEvents: getComputedStyle(document.querySelector('[data-lt-canvas]')).pointerEvents,
    }))()`);
  info('访客看到：' + JSON.stringify(guest));
  check('★ 访客：工具条全锁着、画布也点不动', guest.locked === true && guest.pointerEvents === 'none', `${guest.locked} / ${guest.pointerEvents}`);
  check('访客：说明白了要先登录 / 过审', /登录/.test(guest.gate) && !/正在看登录状态/.test(guest.gate), guest.gate.slice(0, 40));

  /* ---- 过审的人 ---- */
  /*
    ⚠ 除了令牌，还要把"上次确认过的身份"缓存（lt_user）一起写上 —— 真用户登录一次就有它。
    为什么验收也必须有：账号组件在网络偶发抖动（连着三次 LT_ME 没成）时会退回缓存里的身份；
    **没有缓存**就只能 paint('guest')，那一句会把引擎 stop 掉、恢复之后再挂一份新的 ——
    于是"撤销 → 重做"这种跨几步的断言会莫名其妙地红一片（2026-10-09 那次就是栽在这上面，
    排查了半天才发现不是画板的问题）。有缓存时它按过审画，引擎一动不动。
  */
  await cdp.ev(
    `localStorage.setItem('lt_token','fake-token');` +
      `localStorage.setItem('lt_user', JSON.stringify({ nick: '测试者', alias: '测试者', status: 'approved', avatar: '', label: '' }))`
  );
  await cdp.go(`${base}/liyutang/teahouse/`);
  const ready = await cdp.wait(`(() => {
      const b = document.querySelector('[data-lt-tool="pen"]');
      /* ⚠ 2026-10-09：内置调色盘只剩黑白两个（旧断言写的是 >= 6） */
      return !!b && !b.disabled && document.querySelectorAll('.lyt-draw__swatch').length >= 2;
    })()`, 20000);
  check('★ 过审账号进来：工具条解锁 + 调色板画出来了', ready === true);
  const empty = await cdp.ev(pixelAt(600, 375));
  check('一开始画布是干净的（纸色）', empty === PAPER, empty);

  /* 画一笔：从左到右一条水平线，正好经过 (600,375) */
  await setInk('#1d1430');
  await drawOn([[400, 375], [500, 375], [600, 375], [700, 375]]);
  const myPix = await cdp.ev(pixelAt(600, 375));
  check('★ 画上去的墨色真的出现在画布那一点上（不是"看着像"）', myPix === '#1d1430', myPix);
  check('★ 发上去的是笔划（事件 / 令牌 / 工具 / 颜色 / 点集都对）',
    seen.add.length === 1 && seen.add[0].event === 'LT_DRAW_ADD' && seen.add[0].ltToken === 'fake-token' &&
      seen.add[0].tool === 'pen' && seen.add[0].color === '#1d1430' && seen.add[0].points.length >= 3,
    JSON.stringify({ ev: seen.add[0]?.event, tool: seen.add[0]?.tool, color: seen.add[0]?.color, pts: seen.add[0]?.points?.length }));
  check('点集是画板坐标系（2400 宽那块板），不是屏幕像素',
    seen.add[0].points.every(([x, y]) => x >= 0 && x <= 2400 && y >= 0 && y <= 1500), JSON.stringify(seen.add[0].points.slice(0, 3)));

  /* 轮询：别人的那一笔（1800,1100 附近，蓝色）要被拉下来画出来 */
  const gotOther = await cdp.wait(
    `(() => (window.__ltBoard ? window.__ltBoard.pixelAt(1850, 1100) : '') === '#3a86ff')()`,
    20000
  );
  const otherPix = await cdp.ev(pixelAt(1850, 1100));
  check('★ 别人画的笔划被轮询拉到、并画在画布上（像素是那个蓝）', gotOther === true, otherPix);
  const faces = await cdp.ev(`[...document.querySelectorAll('.lyt-draw__face')].map((b) => b.textContent.trim())`);
  check('★「今天画过画的人」那张表里有两个人', faces.length === 2, JSON.stringify(faces));

  /* 点那个人的头像 → 他的笔划看不见了（像素变回纸色） */
  const toggled = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('.lyt-draw__face')].find((x) => x.textContent.includes('虹星'));
      if (!b) return false;
      b.click();
      return true;
    })()`);
  await sleep(700);
  const offPix = await cdp.ev(pixelAt(1850, 1100));
  check('★ 点一下那个人的头像 → 他的笔划就不画了（像素变回纸色）', toggled === true && offPix === PAPER, offPix);
  const backOn = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('.lyt-draw__face')].find((x) => x.textContent.includes('虹星'));
      b.click();
      return true;
    })()`);
  await sleep(700);
  const onPix = await cdp.ev(pixelAt(1850, 1100));
  check('再点一下 → 又回来了（开关是双向的）', backOn === true && onPix !== PAPER, onPix);

  /* ---- 缩放 / 平移（2026-10-09 晚上加的） ---- */
  const v0 = await cdp.ev(viewOf);
  check('★ 进来时是"全览"：整块板正好装下（缩放 = fit）、原点在左上角、读数 1.0×',
    v0 && Math.abs(v0.scale - v0.fit) < 0.002 && v0.x === 0 && v0.y === 0 && Math.abs(v0.zoom - 1) < 0.02,
    JSON.stringify(v0));
  check('画布的像素尺寸 = 显示大小 × DPR（不是死板的 2400×1500）',
    await cdp.ev(`(() => {
      const c = document.querySelector('[data-lt-canvas]');
      const r = c.getBoundingClientRect();
      const d = (window.__ltBoard && window.__ltBoard.view.dpr) || 1;
      return Math.abs(c.width - Math.round(r.width * d)) <= 1 && Math.abs(c.height - Math.round(r.height * d)) <= 1;
    })()`), '');

  /* 把光标放在"我已经画了那一点"上滚轮放大：那一点的颜色必须还在光标底下（缩放钉住光标） */
  await showCanvas();
  const hold = await cdp.ev(toScreen(600, 375));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hold.x, y: hold.y, button: 'none' });
  for (let i = 0; i < 6; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: hold.x, y: hold.y, deltaX: 0, deltaY: -120 });
    await sleep(150);
  }
  await sleep(400);
  const v1 = await cdp.ev(viewOf);
  /*
    ⚠ 门槛放宽到 1.4：滚轮一格放大多少是**实现细节**（现在是 1.15/格），
    真正要钉住的是"滚轮确实能放大、而且光标底下那一点不跑"（下面那条）。写死 1.75 只会假红。
  */
  check('★ 滚轮能放大（全览 → >1.4×）', v1 && v1.zoom > 1.4, JSON.stringify({ zoom: v1?.zoom, x: v1?.x, y: v1?.y }));
  const underCursor = await cdp.ev(`(() => {
    const c = document.querySelector('[data-lt-canvas]');
    const r = c.getBoundingClientRect();
    const v = window.__ltBoard.view;
    /* 光标那一点对应的画板坐标（就是把 toBoard 反过来算一遍） */
    const bx = v.x + (${hold.x} - r.left) / v.scale;
    const by = v.y + (${hold.y} - r.top) / v.scale;
    return { bx: Math.round(bx * 10) / 10, by: Math.round(by * 10) / 10, color: window.__ltBoard.pixelAt(bx, by) };
  })()`);
  check('★ 放大的时候光标底下那一点没跑（还是那条线的墨色）',
    underCursor.color === '#1d1430', JSON.stringify(underCursor));
  check('页面上的缩放读数跟着变', await cdp.ev(`/\\d\\.\\d×/.test((document.querySelector('[data-lt-zoom]')||{}).textContent||'')`),
    await cdp.ev(`(document.querySelector('[data-lt-zoom]')||{}).textContent||''`));

  /* 放大状态留一张截图（人眼看"放大之后是什么样"） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'teahouse-board-zoom.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  /* 放大状态下画一笔：坐标要还是**画板坐标**（不能把屏幕像素当成画板坐标发上去） */
  const beforeZoomDraw = seen.add.length;
  await cdp.ev(`document.querySelector('[data-lt-tool="pan"]').classList.remove('is-on'); [...document.querySelectorAll('.lyt-draw__bar button')].find((b) => b.textContent.trim() === '画笔').click()`);
  await setInk('#8ac926');
  await drawOn([[500, 500], [560, 500], [620, 500]]);
  const zoomStroke = seen.add[seen.add.length - 1];
  check('★ 放大之后画的笔划，坐标依旧是画板坐标（不是屏幕像素）',
    seen.add.length === beforeZoomDraw + 1 &&
      zoomStroke.points.every(([x, y]) => Math.abs(y - 500) <= 6 && x >= 495 && x <= 625),
    JSON.stringify(zoomStroke?.points?.slice(0, 4)));
  check('放大之后画上去的颜色也在画布上（那一点是新的绿色）',
    (await cdp.ev(pixelAt(560, 500))) === '#8ac926', await cdp.ev(pixelAt(560, 500)));

  /* 「拖动画布」拖动：板子跟着走 */
  await cdp.ev(`document.querySelector('[data-lt-tool="pan"]').click()`);
  const vBeforePan = await cdp.ev(viewOf);
  await showCanvas();
  const p0 = await cdp.ev(toScreen(1200, 750));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p0.x, y: p0.y, button: 'left', clickCount: 1, buttons: 1 });
  /*
    ⚠ 拖动要**多步**发（真人拖是连续的）。
    早先这里只发一次"从起点直接跳到终点"，结果两种实现会给出完全不同的结果：
    有的实现在第一次 move 上只登记起点（防误触死区），那一下就被算成 0 —— 我的验收因此假红过一次。
  */
  for (let i = 1; i <= 8; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(p0.x - (120 * i) / 8),
      y: Math.round(p0.y - (60 * i) / 8),
      button: 'left',
      buttons: 1,
    });
    await sleep(20);
  }
  await sleep(200);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p0.x - 120, y: p0.y - 60, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(400);
  const vAfterPan = await cdp.ev(viewOf);
  check('★ 拖动画布能把板子拖走（平移量 ≈ 拖动距离 / 缩放）',
    vAfterPan.x > vBeforePan.x && vAfterPan.y > vBeforePan.y &&
      Math.abs(vAfterPan.x - vBeforePan.x - 120 / vBeforePan.scale) < 6,
    JSON.stringify({ before: vBeforePan, after: vAfterPan }));
  check('拖动的时候不会顺手画出一笔（那一笔的笔划表没变长）', seen.add.length === beforeZoomDraw + 1, `${seen.add.length} 笔`);

  /* 双指捏合（手机上没滚轮，只有这一条路）—— 用 CDP 的真触摸事件驱动 */
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const center = await cdp.ev(`(() => {
    const r = document.querySelector('[data-lt-canvas]').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const anchors = `(() => {
    const c = document.querySelector('[data-lt-canvas]');
    const r = c.getBoundingClientRect();
    const v = window.__ltBoard.view;
    return { bx: Math.round((v.x + (${center.x} - r.left) / v.scale) * 10) / 10, by: Math.round((v.y + (${center.y} - r.top) / v.scale) * 10) / 10, zoom: v.zoom };
  })()`;
  const pinchBefore = await cdp.ev(anchors);
  const pinchStrokes = seen.add.length;
  const touchPts = (spread) => [
    { x: center.x - 60 - spread, y: center.y, id: 1 },
    { x: center.x + 60 + spread, y: center.y, id: 2 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touchPts(0) });
  for (const spread of [20, 45, 70, 95]) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: touchPts(spread) });
    await sleep(120);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(500);
  const pinchAfter = await cdp.ev(anchors);
  check('★ 双指张开能放大（手机上没滚轮，这是唯一的路）',
    pinchAfter.zoom > pinchBefore.zoom * 1.15, JSON.stringify({ before: pinchBefore.zoom, after: pinchAfter.zoom }));
  check('★ 双指缩放也把中点底下那个画板点钉住了（没跑偏）',
    Math.abs(pinchAfter.bx - pinchBefore.bx) <= 4 && Math.abs(pinchAfter.by - pinchBefore.by) <= 4,
    JSON.stringify({ before: [pinchBefore.bx, pinchBefore.by], after: [pinchAfter.bx, pinchAfter.by] }));
  check('★ 捏一下不会顺手画出一道（笔划一条没多）',
    seen.add.length === pinchStrokes, `${pinchStrokes} → ${seen.add.length}`);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });

  /* 「全览」按钮 */
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(400);
  const vReset = await cdp.ev(viewOf);
  check('★ 点「全览」回到 fit / 原点 / 读数 1.0×',
    vReset && Math.abs(vReset.scale - vReset.fit) < 0.002 && vReset.x === 0 && vReset.y === 0 && Math.abs(vReset.zoom - 1) < 0.02,
    JSON.stringify(vReset));

  /*
    橡皮（默认 = **整笔 + 只擦自己的**，2026-10-10 起是"两种方式"里的默认那种）：
    先用画笔画一条线，再用橡皮擦过去 → 那一点变回纸色、发出去的是**软删**。
    ⚠ 位置挑在 y=2050：上面那些检查在 (400..700, 375) 早就画过一条深色的线，
      在那个位置"擦完变纸色"是不成立的（擦掉上面那条，底下那条会露出来）。
  */
  await cdp.ev(`document.querySelector('[data-lt-tool="pen"]').click()`);
  await cdp.ev(`(() => { const el = document.querySelector('[data-lt-color]'); el.value = '#ff4d6d'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(120);
  await drawOn([[400, 2050], [500, 2050], [600, 2050], [700, 2050]]);
  const ownId = `mine${seen.add.length}`;
  check('（前置）画笔那条线真的画上去了（橡皮那几条才有意义）',
    (await cdp.ev(pixelAt(600, 2050))) === '#ff4d6d', await cdp.ev(pixelAt(600, 2050)));
  await cdp.ev(`document.querySelector('[data-lt-tool="eraser"]').click()`);
  await sleep(150);
  await drawOn([[600, 1980], [600, 2050], [600, 2120]]);
  const erased = await cdp.ev(pixelAt(600, 2050));
  check('★ 橡皮擦过之后那一点变回纸色', erased === PAPER, erased);
  /*
    ⚠ 这一条 2026-10-09 改过（旧断言：`最后一笔 tool=eraser 且 color=纸色`，即"橡皮=画一条纸色笔划"），
    2026-10-10 又核对了一遍：默认那种（整笔 + 只擦自己）碰到自己的笔划是**软删**
    （LT_DRAW_DELETE，云端只允许删自己的），所以它不画任何东西 ——
    "画一条纸色笔划盖住"那套老做法只留给**存档里的老笔划**重放（新的界面不再产生它，
    像素橡皮挖墨走的是 tool='erase'）。这里钉的仍旧是"软删 + 不画东西"这个契约。
  */
  const delAfterErase = seen.del[seen.del.length - 1];
  check('★ 默认的橡皮（整笔 + 只擦自己的）：软删的正是刚画的那一笔，而不是"画一条纸色笔划"',
    delAfterErase?.event === 'LT_DRAW_DELETE' && delAfterErase?.ltToken === 'fake-token' &&
      delAfterErase?.id === ownId && !delAfterErase?.others &&
      seen.add.filter((s) => s.tool === 'eraser').length === 0,
    JSON.stringify({ del: delAfterErase, 期望: ownId, eraserAdds: seen.add.filter((s) => s.tool === 'eraser').length }));

  /* ---- 撤销：删自己最后那一笔 ---- */
  await cdp.ev(`document.querySelector('[data-lt-undo]').click()`);
  await sleep(600);
  check('★ 撤销会真的请求删掉自己那一笔（LT_DRAW_DELETE）',
    /*
      ⚠ 看**最后一条**删除请求，不数总数：下面那一大段（重做/拖动/取色…）也会发删除请求，
      数"正好一条"就会假红 —— 这条要钉的是"点了撤销，确实发出了一次删除"。
    */
    seen.del.length >= 1 && seen.del[seen.del.length - 1].event === 'LT_DRAW_DELETE' && seen.del[seen.del.length - 1].ltToken === 'fake-token',
    JSON.stringify(seen.del[seen.del.length - 1] ?? {}));

  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

  /* ==================================================================
     2026-10-09 这一轮：重做 / 移动 / 取色 / 调色盘 / 粗细 / 滚动 / 增量同步
     （上面那 69 条一条都没改；这一段全在它们之后跑，同一套真浏览器 + 同一个假云端）
     ================================================================== */
  const errBefore = cdp.errors.length;
  const stateOf = `(() => (window.__ltBoard ? window.__ltBoard.state : null))()`;
  const statsOf = `(() => (window.__ltBoard ? window.__ltBoard.stats : null))()`;
  const scrollOf = `(() => ({ x: window.scrollX, y: window.scrollY }))()`;
  const zoomOf = `(() => (window.__ltBoard ? window.__ltBoard.view.zoom : 0))()`;
  const statusText = `(() => String((document.querySelector('[data-lt-draw-status]') || {}).textContent || ''))()`;
  const pickTool = async (name) => {
    await cdp.ev(`document.querySelector('[data-lt-tool="${name}"]').click()`);
    await sleep(150);
  };
  /*
    ⚠ 2026-10-09：`useSwatch` 改成走 setInk（内置色块只剩黑白两个了）——
    名字留着是因为后面十几处都在用它，语义（"把画笔换成这个色"）一个字没变。
  */
  const useSwatch = (hex) => setInk(hex);
  /** 往"粗细"那个数字框里直接填一个数（用户要的就是这一条：精确回到某个值） */
  const setSizeNum = async (n) => {
    await cdp.ev(
      `(() => { const el = document.querySelector('[data-lt-size-num]'); el.value = '${n}'; el.dispatchEvent(new Event('input', { bubbles: true })); return el.value; })()`
    );
    await sleep(150);
  };
  /** 真鼠标拖（和 drawOn 一样，但把每一步之后的滚动位置都记下来；可以让指针跑到画布外面） */
  const dragWithScroll = async (points, opts = {}) => {
    await showCanvas();
    const s0 = await cdp.ev(scrollOf);
    const first = await cdp.ev(toScreen(points[0][0], points[0][1]));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: first.x, y: first.y, button: 'left', clickCount: 1, buttons: 1 });
    const scrolls = [];
    let last = first;
    for (const [bx, by] of points.slice(1)) {
      const s = await cdp.ev(toScreen(bx, by));
      last = opts.outside ? { x: s.x, y: opts.outside(s) } : s;
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: last.x, y: last.y, button: 'left', buttons: 1 });
      scrolls.push(await cdp.ev(scrollOf));
      await sleep(opts.step ?? 25);
    }
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last.x, y: last.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(opts.wait ?? 600);
    const s1 = await cdp.ev(scrollOf);
    return { s0, s1, scrolls };
  };
  /** 点一下（取色器用） */
  const tapAt = async (bx, by) => {
    await showCanvas();
    const s = await cdp.ev(toScreen(bx, by));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 1 });
    await sleep(60);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: s.x, y: s.y, button: 'left', clickCount: 1, buttons: 0 });
    await sleep(500);
  };
  const waitBoard = async () =>
    cdp.wait(
      `(() => { const b = document.querySelector('[data-lt-tool="pen"]'); return !!b && !b.disabled && document.querySelectorAll('.lyt-draw__swatch').length >= 2; })()`,
      20000
    );
  /*
    状态行那句话会被下一趟轮询（"今天这块板上已经有 N 笔"）盖掉 ——
    所以不是"读完拉倒"，而是挂个 MutationObserver 把**每一句**都记下来再回头找。
    （第一版直接读 textContent，赶上 3 秒一次的轮询就假红。）
  */
  await cdp.ev(`(() => {
      const el = document.querySelector('[data-lt-draw-status]');
      window.__statusLog = [el.textContent];
      new MutationObserver(() => window.__statusLog.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);
  const statusSaid = async (re) => (await cdp.ev(`window.__statusLog`)).some((t) => re.test(String(t)));
  /**
   * 环境体检：账号还在过审、引擎还活着（这两条要是不成立，后面那些断言红得毫无意义）。
   * 打印出来是为了"红的时候一眼看出是环境抖了还是功能坏了"。
   */
  const envLine = async (where) => {
    const got = await cdp.ev(`(() => ({
        state: (document.querySelector('[data-lt-account]') || {}).dataset?.state || '',
        locked: (document.querySelector('[data-lt-tool="pen"]') || {}).disabled === true,
        strokes: window.__ltBoard ? window.__ltBoard.state.strokes : -1,
        pe: document.querySelector('[data-lt-canvas]') ? getComputedStyle(document.querySelector('[data-lt-canvas]')).pointerEvents : '',
      }))()`);
    info(`[${where}] 账号=${got.state} 工具条锁着=${got.locked} 画布 pointer-events=${got.pe} 本地笔划=${got.strokes}`);
    return got;
  };

  /* ---- 1. 画笔和橡皮各自的粗细 + 数字直接输入 ---- */
  await envLine('新功能段开始');
  await pickTool('pen');
  await setSizeNum(30);
  await pickTool('eraser');
  await setSizeNum(8);
  let stSize = await cdp.ev(stateOf);
  check('★ 画笔 30 / 橡皮 8：两份粗细分开记，切来切去各自保持',
    stSize.penSize === 30 && stSize.eraserSize === 8, JSON.stringify({ pen: stSize.penSize, eraser: stSize.eraserSize }));
  await pickTool('pen');
  const shownPen = await cdp.ev(
    `(() => ({ range: document.querySelector('[data-lt-size]').value, num: document.querySelector('[data-lt-size-num]').value }))()`
  );
  check('★ 粗细 UI 显示具体数字（切到画笔 → 滑块和数字框都是 30）',
    shownPen.range === '30' && shownPen.num === '30', JSON.stringify(shownPen));
  await pickTool('eraser');
  const shownEraser = await cdp.ev(
    `(() => ({ range: document.querySelector('[data-lt-size]').value, num: document.querySelector('[data-lt-size-num]').value }))()`
  );
  check('切到橡皮 → 那两个读数变成 8（互不干扰）', shownEraser.range === '8' && shownEraser.num === '8', JSON.stringify(shownEraser));
  await pickTool('pen');
  await sleep(900);
  const prefsLatest = seen.prefs[seen.prefs.length - 1];
  check('★ 两份粗细都发到了服务端（LT_PREFS_SET 的 penSize=30 / eraserSize=8）',
    !!prefsLatest && prefsLatest.event === 'LT_PREFS_SET' && prefsLatest.ltToken === 'fake-token' &&
      prefsLatest.prefs.penSize === 30 && prefsLatest.prefs.eraserSize === 8,
    JSON.stringify(prefsLatest?.prefs ?? {}));
  info(`LT_PREFS_SET 一共发了 ${seen.prefs.length} 次（粗细改动会攒 450 毫秒再发一次）`);

  /* ---- 2. 取色：读渲染出来的像素 ---- */
  await pickTool('pen');
  await useSwatch('#ff4d6d');
  await setSizeNum(16);
  await drawOn([[900, 1200], [1000, 1200], [1100, 1200]]);
  check('取色之前：那一笔的粉色真的在画布上', (await cdp.ev(pixelAt(1000, 1200))) === '#ff4d6d', await cdp.ev(pixelAt(1000, 1200)));
  await useSwatch('#1d1430');
  await pickTool('pick');
  await tapAt(1000, 1200);
  const stPick = await cdp.ev(stateOf);
  check('★ 取色器点那一笔 → 当前画笔颜色变成 #ff4d6d（并且自动切回画笔）',
    stPick.color === '#ff4d6d' && stPick.tool === 'pen', JSON.stringify({ color: stPick.color, tool: stPick.tool }));
  check('「别的颜色」那个输入框也跟着变成取到的色',
    (await cdp.ev(`document.querySelector('[data-lt-color]').value`)) === '#ff4d6d',
    await cdp.ev(`document.querySelector('[data-lt-color]').value`));
  const pickAdds = seen.add.length;
  await drawOn([[1900, 300], [1980, 300], [2060, 300]]);
  check('★ 取到的颜色真的用在了下一笔上（发出去的 color 就是 #ff4d6d）',
    seen.add.length === pickAdds + 1 && seen.add[seen.add.length - 1].color === '#ff4d6d',
    JSON.stringify({ color: seen.add[seen.add.length - 1]?.color }));

  /* ---- 3. 移动：只能挪自己画的 + 像素真的动了 + 松手才发一次 ---- */
  await pickTool('pen');
  await useSwatch('#b5179e');
  await setSizeNum(10);
  await drawOn([[900, 1300], [1000, 1300], [1100, 1300]]);
  const myMoveId = 'mine' + seen.add.length;
  check('移动之前：那条线在 (1000,1300)', (await cdp.ev(pixelAt(1000, 1300))) === '#b5179e', await cdp.ev(pixelAt(1000, 1300)));
  await pickTool('move');
  const moves0 = seen.moves.length;
  const dragOwn = await dragWithScroll([[1000, 1300], [1000, 1340], [1000, 1380]]);
  await sleep(600);
  const mv = seen.moves[seen.moves.length - 1];
  /*
    ⚠ 容差按**缩放**算（2026-10-10）：合成鼠标事件的坐标是整数屏幕像素（`toScreen` 里 Math.round），
    而画板坐标 = 屏幕像素 / 缩放 —— 2026-10-10 茶绘那一页变宽、画板那一栏窄了一些（右边接了聊天栏），
    缩放从 0.29 掉到 ~0.24，于是"1 个屏幕像素"从 3.4 画板像素变成 4.2。
    原来写死 ±3 就会被这点取整弄红（功能是好的）。给 2 个屏幕像素的余量。
  */
  const px = (await cdp.ev(viewOf))?.scale || 0.25;
  const mvTol = Math.max(3, 2 / px);
  check('★ 挪自己那一根：服务端正好收到一条 LT_DRAW_MOVE（id / dx / dy 都对）',
    seen.moves.length === moves0 + 1 && mv.event === 'LT_DRAW_MOVE' && mv.id === myMoveId && Math.abs(mv.dx) <= mvTol && Math.abs(mv.dy - 80) <= mvTol,
    `${JSON.stringify(mv)}（容差 ±${mvTol.toFixed(1)} 画板像素）`);
  check('★ 像素上那条线真的移了：原位置变回纸色',
    (await cdp.ev(pixelAt(1000, 1300))) === PAPER, await cdp.ev(pixelAt(1000, 1300)));
  /*
    新位置也按"取整允许的误差"找：那条线现在落在 1300 + dy 处（dy 可能差几个画板像素），
    所以在 1300 下面扫一小段，找到那条墨就算过（比"钉死读 1380"稳）。
  */
  const movedY = await cdp.ev(`(() => {
      const b = window.__ltBoard;
      for (let y = 1305; y <= 1400; y += 1) if (b.pixelAt(1000, y) === '#b5179e') return y;
      return -1;
    })()`);
  check('★ 新位置是那条线的颜色（在 1300 下面找到了它，误差不超过取整那点）',
    movedY > 0 && Math.abs(movedY - (1300 + (mv?.dy ?? 80))) <= 6, `找到 y=${movedY}，请求里 dy=${mv?.dy}`);
  check('拖动的时候页面没有跟着滚（拖线也不该滚页面）',
    dragOwn.s0.y === dragOwn.s1.y && dragOwn.scrolls.every((s) => s.y === dragOwn.s0.y),
    JSON.stringify({ before: dragOwn.s0, after: dragOwn.s1 }));
  /* 别人的那一根（虹星的蓝线）——本地就得说人话，而且一次网络都不发 */
  const moves1 = seen.moves.length;
  await pickTool('move');
  await dragWithScroll([[1850, 1100], [1850, 1140], [1850, 1180]]);
  const saidRefuse = await statusSaid(/只能挪自己画的/);
  check('★ 挪别人的线条：被拒 + 人话提示（"只能挪自己画的"），没有发 LT_DRAW_MOVE',
    seen.moves.length === moves1 && saidRefuse === true,
    JSON.stringify({ moves: seen.moves.length - moves1, log: (await cdp.ev(`window.__statusLog`)).slice(-3) }));
  check('别人的线条一点没动（像素还在原处）',
    (await cdp.ev(pixelAt(1850, 1100))) === '#3a86ff', await cdp.ev(pixelAt(1850, 1100)));

  /* ---- 4. 调色盘：收藏 / 删除 / 跟着账号走 ---- */
  await pickTool('pen');
  await cdp.ev(`(() => { const el = document.querySelector('[data-lt-color]'); el.value = '#123456'; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(120);
  const prefs0 = seen.prefs.length;
  await cdp.ev(`document.querySelector('[data-lt-color-add]').click()`);
  await sleep(500);
  const addedPrefs = seen.prefs[seen.prefs.length - 1];
  check('★ 点「＋收藏」→ 服务端收到 LT_PREFS_SET，palette 里有那个色',
    seen.prefs.length > prefs0 && !!addedPrefs?.prefs?.palette?.includes('#123456'), JSON.stringify(addedPrefs?.prefs ?? {}));
  const chips = await cdp.ev(
    `(() => ({ saved: document.querySelectorAll('.lyt-draw__swatch[data-saved="1"]').length, del: document.querySelectorAll('.lyt-draw__swatch-del').length, color: (document.querySelector('.lyt-draw__swatch[data-saved="1"]') || {}).dataset?.color || '' }))()`
  );
  check('画面上多了一个"你收藏的"色块，而且带删除小×（内置色没有×）',
    chips.saved === 1 && chips.del === 1 && chips.color === '#123456', JSON.stringify(chips));
  await cdp.ev(`document.querySelector('.lyt-draw__swatch-del').click()`);
  await sleep(500);
  const afterDel = seen.prefs[seen.prefs.length - 1];
  const chips2 = await cdp.ev(`document.querySelectorAll('.lyt-draw__swatch[data-saved="1"]').length`);
  /*
    ⚠ 2026-10-09 改过（旧断言是 `=== 8`，那时内置有 8 个颜色）：
    现在内置调色盘**只有黑白两个**（用户要求），删掉收藏的之后板子上就该剩这两个 ——
    顺手把"默认就是黑白"这条新契约钉在这里（值的顺序也要对：#000000 在前）。
  */
  const restColors = await cdp.ev(`[...document.querySelectorAll('.lyt-draw__swatch')].map((b) => b.dataset.color)`);
  check('★ 删得掉收藏的：palette 里没了，画面上也没了；剩下的内置色正好是黑白两个',
    !afterDel?.prefs?.palette?.includes('#123456') && chips2 === 0 &&
      restColors.length === 2 && restColors[0] === '#000000' && restColors[1] === '#ffffff',
    JSON.stringify({ palette: afterDel?.prefs?.palette ?? [], saved: chips2, rest: restColors }));
  /* 再加回去，给"重开页面还在"那条用 */
  await cdp.ev(`document.querySelector('[data-lt-color-add]').click()`);
  await sleep(500);
  /*
    模拟"云端那个账号里本来就有这些偏好"（另一台设备存的）：
    prefsState 是假后端 LT_ME 会带出去的那一份。
  */
  prefsState = { palette: ['#123456'], penSize: 30, eraserSize: 8, color: '#123456', tool: 'pen' };
  await cdp.go(`${base}/liyutang/teahouse/`);
  /* 等"收藏色回来了 + 粗细也恢复了"：引擎进场后自己会再问一次 LT_ME，这里等的就是那一趟 */
  const backReady = await cdp.wait(
    `(() => {
        const b = window.__ltBoard;
        return !!b && b.state.penSize === 30 && b.state.eraserSize === 8 && !!document.querySelector('.lyt-draw__swatch[data-color="#123456"]');
      })()`,
    20000
  );
  const kept = await cdp.ev(`(() => {
      const b = [...document.querySelectorAll('.lyt-draw__swatch')].find((x) => x.dataset.color === '#123456');
      return { saved: b ? b.dataset.saved : '', num: document.querySelector('[data-lt-size-num]').value, state: window.__ltBoard.state };
    })()`);
  check('★ 重开页面：收藏的颜色还在（跟着账号走，不是只存在本机）',
    backReady === true && kept.saved === '1', JSON.stringify({ ready: backReady, saved: kept.saved }));
  check('★ 重开页面：两份粗细也照账号恢复（画笔 30 / 橡皮 8，数字框显示 30）',
    kept.state.penSize === 30 && kept.state.eraserSize === 8 && kept.num === '30',
    JSON.stringify({ pen: kept.state.penSize, eraser: kept.state.eraserSize, num: kept.num }));

  /* ---- 5. 重做（取消撤回）：软删之后只能"照原样再画一笔新的" ---- */
  await envLine('重做那一段之前');
  await pickTool('pen');
  await useSwatch('#2ec4b6');
  await setSizeNum(12);
  const nRedo0 = seen.add.length;
  await drawOn([[600, 1000], [700, 1000], [800, 1000]]);
  const redoOrig = seen.add[seen.add.length - 1];
  const redoId1 = 'mine' + seen.add.length;
  check('重做那一套之前：绿色那一笔在画布上，粗细是 12',
    (await cdp.ev(pixelAt(700, 1000))) === '#2ec4b6' && redoOrig.size === 12,
    JSON.stringify({ pix: await cdp.ev(pixelAt(700, 1000)), size: redoOrig.size }));
  await cdp.ev(`document.querySelector('[data-lt-undo]').click()`);
  await sleep(700);
  check('★ 撤销之后那一点变回纸色（服务端是软删 LT_DRAW_DELETE）',
    (await cdp.ev(pixelAt(700, 1000))) === PAPER && seen.del[seen.del.length - 1]?.id === redoId1,
    JSON.stringify({ pix: await cdp.ev(pixelAt(700, 1000)), del: seen.del[seen.del.length - 1]?.id }));
  check('撤完「重做」按钮亮了（有东西可以取消撤回）', (await cdp.ev(`!document.querySelector('[data-lt-redo]').disabled`)) === true);
  const nRedoAdd = seen.add.length;
  await cdp.ev(`document.querySelector('[data-lt-redo]').click()`);
  await sleep(900);
  const redoStroke = seen.add[seen.add.length - 1];
  check('★ 重做之后画布像素上那一点的颜色回来了',
    (await cdp.ev(pixelAt(700, 1000))) === '#2ec4b6', await cdp.ev(pixelAt(700, 1000)));
  check('★ 重做走的是 LT_DRAW_ADD，而且是一个**新的 id**（软删之后原来那条回不来）',
    seen.add.length === nRedoAdd + 1 && redoStroke.event === 'LT_DRAW_ADD' && ('mine' + seen.add.length) !== redoId1,
    JSON.stringify({ id: 'mine' + seen.add.length, was: redoId1 }));
  check('重做那一笔和原来一模一样（工具 / 颜色 / 粗细 / 点集都照原样）',
    redoStroke.tool === redoOrig.tool && redoStroke.color === redoOrig.color && redoStroke.size === redoOrig.size &&
      JSON.stringify(redoStroke.points) === JSON.stringify(redoOrig.points),
    JSON.stringify({ tool: redoStroke.tool, color: redoStroke.color, size: redoStroke.size, n: redoStroke.points.length }));
  /* 反复来回：再撤一次、再重做一次 */
  await cdp.ev(`document.querySelector('[data-lt-undo]').click()`);
  await sleep(700);
  const goneAgain = await cdp.ev(pixelAt(700, 1000));
  await cdp.ev(`document.querySelector('[data-lt-redo]').click()`);
  await sleep(900);
  const backAgain = await cdp.ev(pixelAt(700, 1000));
  check('★ undo → redo 能反复来回（第二趟一样：撤掉变纸色、重做又回来）',
    goneAgain === PAPER && backAgain === '#2ec4b6', JSON.stringify({ afterUndo: goneAgain, afterRedo: backAgain }));
  check('重做栈用完就空了（按钮又变回不可点）',
    (await cdp.ev(`document.querySelector('[data-lt-redo]').disabled`)) === true &&
      (await cdp.ev(stateOf)).redo === 0, JSON.stringify({ redo: (await cdp.ev(stateOf)).redo }));

  /* ---- 6. 电脑端画长线：页面不许滚 + 点集要跟指针轨迹一致 ---- */
  /* 先把页面弄成真的滚得动（不然"scrollY 不变"这句话没有意义） */
  await cdp.ev(`(() => { if (!document.querySelector('[data-lt-spacer]')) { const d = document.createElement('div'); d.setAttribute('data-lt-spacer', '1'); d.style.height = '3000px'; document.body.append(d); } return true; })()`);
  await pickTool('pen');
  await useSwatch('#8ac926');
  await setSizeNum(8);
  const traj = [];
  for (let i = 0; i <= 24; i += 1) traj.push([300 + i * 50, 800]);
  const nTraj = seen.add.length;
  const trajRes = await dragWithScroll(traj);
  const trajPts = seen.add[seen.add.length - 1]?.points ?? [];
  const trajYs = trajPts.map((p) => p[1]);
  check('★ 画长线的时候 window.scrollY 一动不动（每一帧都没动）',
    trajRes.s0.y === trajRes.s1.y && trajRes.scrolls.every((s) => s.y === trajRes.s0.y) && trajRes.s0.y > 0,
    JSON.stringify({ before: trajRes.s0, after: trajRes.s1, frames: trajRes.scrolls.length }));
  check('★ 点集跟指针轨迹一致：24 段全落在 y=800 上、x 从头走到尾（没有中途跳/歪）',
    seen.add.length === nTraj + 1 && trajPts.length >= 20 &&
      Math.abs(Math.min(...trajYs) - 800) <= 2.5 && Math.abs(Math.max(...trajYs) - 800) <= 2.5 &&
      Math.abs(trajPts[0][0] - 300) <= 3 && Math.abs(trajPts[trajPts.length - 1][0] - 1500) <= 3,
    JSON.stringify({ n: trajPts.length, y: [Math.min(...trajYs), Math.max(...trajYs)], x: [trajPts[0]?.[0], trajPts[trajPts.length - 1]?.[0]] }));
  /* 真原因那一条：触控板的小数滚轮曾经把页面滚走（老代码 |deltaY|<1 时直接 return、不 preventDefault） */
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(300);
  await showCanvas();
  const wheelBefore = { ...(await cdp.ev(scrollOf)), zoom: await cdp.ev(zoomOf) };
  const wheelAt = await cdp.ev(toScreen(1200, 700));
  for (let i = 0; i < 12; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: wheelAt.x, y: wheelAt.y, deltaX: 0, deltaY: 0.6 });
    await sleep(60);
  }
  await sleep(400);
  const wheelAfter = { ...(await cdp.ev(scrollOf)), zoom: await cdp.ev(zoomOf) };
  check('★ 触控板的小数滚轮（deltaY=0.6 × 12）不再把页面滚走 —— "电脑端画线时页面乱滚"的真原因就是它',
    wheelAfter.x === wheelBefore.x && wheelAfter.y === wheelBefore.y,
    JSON.stringify({ before: wheelBefore, after: wheelAfter }));
  check('小数滚轮也不会把缩放搞乱（全览状态还是 1.0×）',
    Math.abs(wheelAfter.zoom - 1) < 0.02, JSON.stringify({ zoom: wheelAfter.zoom }));

  /* ---- 7. 同步：画的过程中注入远端笔划 → 一次全量重建都不许有 ---- */
  await envLine('同步那一段之前');
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(300);
  await pickTool('pen');
  await useSwatch('#3a86ff');
  await setSizeNum(8);
  const stStats0 = await cdp.ev(statsOf);
  const injected = remoteStroke({
    id: 'remote-1', uk: 'beef9999', nick: '远端的人', avatar: '',
    tool: 'pen', color: '#ff9f1c', size: 20, points: [[1560, 600], [1700, 600], [1840, 600]],
  });
  await showCanvas();
  const slowStart = await cdp.ev(toScreen(300, 600));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: slowStart.x, y: slowStart.y, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 50; i += 1) {
    const s = await cdp.ev(toScreen(300 + i * 10, 600));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'left', buttons: 1 });
    /* 画到一半，别人在板子上添了一笔（下一趟轮询就会拿到它） */
    if (i === 10) extra.push(injected);
    await sleep(100);
  }
  const stDuring = await cdp.ev(statsOf);
  const remotePixDuring = await cdp.ev(pixelAt(1700, 600));
  const slowEnd = await cdp.ev(toScreen(800, 600));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: slowEnd.x, y: slowEnd.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(1600);
  const stStats1 = await cdp.ev(statsOf);
  const remotePixAfter = await cdp.ev(pixelAt(1700, 600));
  check('★ 画的过程中轮询确实跑过、而且被推迟了（deferred 计数涨了 —— 这是"推迟"的直接证据）',
    stDuring.deferred > stStats0.deferred, JSON.stringify({ before: stStats0.deferred, during: stDuring.deferred }));
  check('★ 画的过程中注入远端笔划 → 一次全量重建都没有（rebuilds 不变）',
    stDuring.rebuilds === stStats0.rebuilds, JSON.stringify({ before: stStats0.rebuilds, during: stDuring.rebuilds }));
  check('★ 画的过程中远端那一笔也不许画上来（推迟到抬笔之后）',
    remotePixDuring === PAPER, remotePixDuring);
  check('★ 抬笔之后远端那一笔出现了，而且依旧是**增量**画进缓存的（rebuilds 还是没变）',
    remotePixAfter === '#ff9f1c' && stStats1.rebuilds === stStats0.rebuilds,
    JSON.stringify({ pix: remotePixAfter, rebuilds: stStats1.rebuilds }));
  check('增量计数确实在涨（"只多描一条线"，不是把整块板重画一遍）',
    stStats1.incremental > stStats0.incremental,
    JSON.stringify({ before: stStats0.incremental, after: stStats1.incremental }));
  info(`缓存全量重建共 ${stStats1.rebuilds} 次，最后一次 ${stStats1.lastRebuildMs.toFixed(1)} ms，累计 ${stStats1.rebuildMs.toFixed(1)} ms；增量描线 ${stStats1.incremental} 次`);

  /* ---- 8. pointer capture 不生效 + 拖到画布外面：这一笔也不能丢 ---- */
  await cdp.ev(`(() => { const c = document.querySelector('[data-lt-canvas]'); c.setPointerCapture = () => { throw new Error('这个环境不支持 pointer capture'); }; return true; })()`);
  await pickTool('pen');
  await useSwatch('#b5179e');
  await setSizeNum(8);
  const nCapture = seen.add.length;
  await showCanvas();
  const canvasBottom = await cdp.ev(`Math.round(document.querySelector('[data-lt-canvas]').getBoundingClientRect().bottom)`);
  const outsideY = (pad) => Math.min(canvasBottom + pad, 985);
  const capStart = await cdp.ev(toScreen(400, 400));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: capStart.x, y: capStart.y, button: 'left', clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i += 1) {
    const s = await cdp.ev(toScreen(400 + i * 60, 400));
    const y = i <= 4 ? s.y : outsideY(30 + i * 5);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y, button: 'left', buttons: 1 });
    await sleep(35);
  }
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: capStart.x + 480, y: outsideY(70), button: 'left', clickCount: 1, buttons: 0 });
  await sleep(800);
  const capStroke = seen.add[seen.add.length - 1];
  check('★ capture 不生效、指针还拖到画布外面松手：这一笔照样跟手、照样提交（老版本这一笔直接丢）',
    seen.add.length === nCapture + 1 && (capStroke?.points?.length ?? 0) >= 7,
    JSON.stringify({ added: seen.add.length - nCapture, pts: capStroke?.points?.length ?? 0 }));

  /*
    ---- 9. 引擎重挂之后不许"一笔提交两次" ----
    页面在账号状态反复变化时会 stop() 再 mountBoard()。老版本的 stop() 只停了轮询，
    上一份引擎的监听还挂在画布上 → 画一笔会提交两次（这是改这一块时读代码发现的）。
    这里用页面自己的 lt-account 事件把它复现一遍：先退回访客（挂着的引擎被 stop），
    再过审（挂第二份引擎），然后画一笔 —— 只准有一次 LT_DRAW_ADD。
  */
  const beforeRemount = seen.add.length;
  await cdp.ev(`document.dispatchEvent(new CustomEvent('lt-account', { detail: { state: 'guest', user: null, fake: false } }))`);
  await sleep(400);
  await cdp.ev(`document.dispatchEvent(new CustomEvent('lt-account', { detail: { state: 'approved', user: { nick: '测试者', alias: '测试者', status: 'approved' }, fake: false } }))`);
  const remounted = await waitBoard();
  await pickTool('pen');
  await useSwatch('#2ec4b6');
  await setSizeNum(10);
  await drawOn([[2000, 1100], [2080, 1100], [2160, 1100]]);
  check('★ 引擎重挂之后画一笔只提交一次（stop() 把旧监听一起摘掉了）',
    remounted === true && seen.add.length === beforeRemount + 1, `${seen.add.length - beforeRemount} 次提交`);

  /* ==================================================================
     2026-10-09 第二批：光标圆 / 网格 / 快捷键 + 悬停卡片 / 橡皮两种模式 / 跨天自清
     位置在"引擎重挂"那一段之后（它会把引擎重启、本地笔划清零），所以从一块干净的板子开始；
     坐标都挑在没画过东西的地方（y=1600 以下、x=2600 往右是这一批新扩出来的区域）。
     ================================================================== */
  const errBefore2 = cdp.errors.length;
  await envLine('第二批开始');
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(300);

  /** 一个颜色和另一个颜色近不近（截图取色会有 ±1 的抖动，给个容差） */
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(String(hex).slice(i, i + 2), 16));
  const nearHex = (a, b, tol = 12) => rgbOf(a).every((v, i) => Math.abs(v - rgbOf(b)[i]) <= tol);
  /** 把指针挪出画布（截图上不能出现那个光标圆） */
  const hidePointer = async () => {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 640, y: 5, button: 'none' });
    await sleep(140);
  };
  /**
   * 截一小块屏、把每个像素的颜色读回来。
   * 为什么要绕这么一圈：网格画在**画布下面的一层 div** 上（不进画布像素），
   * 所以只有"真的截屏"才能证明"开关一按，屏幕上那一格真的出现了/消失了"。
   * 做法是把 PNG 塞回页面里当 <img>、画进一个 canvas 再 getImageData —— 不引任何图像库。
   */
  const shotPixels = async (cssX, cssY, half = 3) => {
    /*
      ⚠ toScreen() 给的是**视口**坐标（getBoundingClientRect），CDP 的 clip 要的是**页面**坐标。
      这一页为了验"画线时页面不许滚"被垫高过、而且真滚过（scrollY > 0），不加这一段就会截到别的地方 ——
      2026-10-09 那两条"网格 / 墨色 截图级证据"就是这么假红的（功能是好的，是断言自己截错了地方）。
    */
    const sc = await cdp.ev(`(() => ({ x: window.scrollX, y: window.scrollY }))()`);
    const clip = {
      x: Math.max(0, Math.round(cssX + sc.x - half)),
      y: Math.max(0, Math.round(cssY + sc.y - half)),
      width: half * 2 + 1,
      height: half * 2 + 1,
      scale: 1,
    };
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
    return cdp.ev(`(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${shot.data}';
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const out = [];
        for (let i = 0; i < c.width * c.height; i += 1) {
          out.push('#' + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
        }
        return { w: c.width, h: c.height, px: out };
      })()`);
  };

  /* ---- 1. 光标 = 和粗细等大的圆 ---- */
  await pickTool('pen');
  await setSizeNum(30);
  await showCanvas();
  /** 把指针放到画布上某一点，读那个圆的**真实宽度**（getBoundingClientRect，不是引擎自报的） */
  const ringAt = async (bx, by) => {
    const s = await cdp.ev(toScreen(bx, by));
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: s.x, y: s.y, button: 'none' });
    await sleep(180);
    return cdp.ev(`(() => {
        const r = document.querySelector('[data-lt-ring]');
        const v = window.__ltBoard.view;
        const cs = getComputedStyle(r);
        return {
          d: Math.round(r.getBoundingClientRect().width * 100) / 100,
          on: r.classList.contains('is-on'),
          vis: cs.visibility,
          size: window.__ltBoard.ring.size,
          expect: Math.round(window.__ltBoard.ring.size * v.scale * 100) / 100,
          scale: Math.round(v.scale * 10000) / 10000,
        };
      })()`);
  };
  const ringPen = await ringAt(900, 400);
  info('光标圆（画笔 30）：' + JSON.stringify(ringPen));
  check('★ 画笔粗细 30 → 那个圆直径 ≈ 30 × 视缩放（给数值：量的是 div 的真实外径）',
    ringPen.on === true && ringPen.vis === 'visible' && Math.abs(ringPen.d - 30 * ringPen.scale) < 1 &&
      Math.abs(ringPen.d - ringPen.expect) < 0.5,
    `d=${ringPen.d} 期望=${(30 * ringPen.scale).toFixed(2)}（30 × ${ringPen.scale}）`);
  const cursorPen = await cdp.ev(`getComputedStyle(document.querySelector('[data-lt-canvas]')).cursor`);
  check('★ 画布上不再是十字光标（画笔/橡皮 cursor: none —— 改看那个圆）', cursorPen === 'none', cursorPen);

  await pickTool('eraser');
  await setSizeNum(8);
  const ringEraser = await ringAt(900, 400);
  info('光标圆（橡皮 8）：' + JSON.stringify(ringEraser));
  check('★ 切到橡皮（设 8）→ 直径跟着变成 8 × 缩放（明显比画笔那个小）',
    Math.abs(ringEraser.d - 8 * ringEraser.scale) < 1 && ringEraser.d < ringPen.d * 0.5,
    `d=${ringEraser.d} 期望=${(8 * ringEraser.scale).toFixed(2)}（画笔那边 ${ringPen.d}）`);

  /* 缩放之后直径要跟着变（钉住"乘的是 view.scale，不是写死的粗细值"） */
  const zoomPt = await cdp.ev(toScreen(900, 400));
  for (let i = 0; i < 4; i += 1) {
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: zoomPt.x, y: zoomPt.y, deltaX: 0, deltaY: -120 });
    await sleep(150);
  }
  const ringZoom = await ringAt(1500, 1200);
  check('★ 缩放之后直径跟着缩放走（还是 8 × 缩放，数值变大了）',
    Math.abs(ringZoom.d - 8 * ringZoom.scale) < 1.2 && ringZoom.scale > ringEraser.scale * 1.3,
    `d=${ringZoom.d} 期望=${(8 * ringZoom.scale).toFixed(2)}；缩放 ${ringEraser.scale} → ${ringZoom.scale}`);
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(300);

  /* 拖动画布 / 移动线条：不显示圆，而且光标变成 grab / grabbing / move */
  await pickTool('pan');
  const cursorPan = await cdp.ev(`getComputedStyle(document.querySelector('[data-lt-canvas]')).cursor`);
  const panPt = await cdp.ev(toScreen(2200, 1400));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: panPt.x, y: panPt.y, button: 'left', clickCount: 1, buttons: 1 });
  await sleep(160);
  const cursorPanning = await cdp.ev(`getComputedStyle(document.querySelector('[data-lt-canvas]')).cursor`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: panPt.x, y: panPt.y, button: 'left', clickCount: 1, buttons: 0 });
  await sleep(200);
  const cursorPanBack = await cdp.ev(`getComputedStyle(document.querySelector('[data-lt-canvas]')).cursor`);
  check('★ 拖动画布：光标是 grab，按住那一瞬间 grabbing，松手回到 grab',
    cursorPan === 'grab' && cursorPanning === 'grabbing' && cursorPanBack === 'grab',
    JSON.stringify({ 平时: cursorPan, 按住: cursorPanning, 松手: cursorPanBack }));
  await pickTool('move');
  const cursorMove = await cdp.ev(`getComputedStyle(document.querySelector('[data-lt-canvas]')).cursor`);
  const ringMove = await ringAt(900, 400);
  check('★ 移动线条：光标是 move，而且那时候不显示那个圆', cursorMove === 'move' && ringMove.on === false,
    JSON.stringify({ cursor: cursorMove, ring: ringMove.on }));

  /* 指针离开画布 → 圆消失 */
  await pickTool('pen');
  await cdp.ev(`(() => { const r = document.querySelector('[data-lt-tool="pen"]').getBoundingClientRect(); window.__tipPt = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; return true; })()`);
  const tipPt = await cdp.ev('window.__tipPt');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipPt.x, y: tipPt.y, button: 'none' });
  await sleep(200);
  const ringAway = await cdp.ev(`(() => { const r = document.querySelector('[data-lt-ring]'); return { on: r.classList.contains('is-on'), vis: getComputedStyle(r).visibility }; })()`);
  check('★ 指针离开画布（挪到工具条上）→ 那个圆立刻消失', ringAway.on === false && ringAway.vis === 'hidden', JSON.stringify(ringAway));

  /* 触摸设备：不许显示这个圆（手指没有"光标"） */
  await pickTool('eraser');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const touchAt = await cdp.ev(`(() => { const r = document.querySelector('[data-lt-canvas]').getBoundingClientRect(); return { x: Math.round(r.left + r.width * 0.78), y: Math.round(r.top + r.height * 0.82) }; })()`);
  const addsBeforeTouch = seen.add.length;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: touchAt.x, y: touchAt.y, id: 1 }] });
  await sleep(100);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: touchAt.x + 40, y: touchAt.y, id: 1 }] });
  await sleep(200);
  const ringTouch = await cdp.ev(`(() => { const r = document.querySelector('[data-lt-ring]'); return { on: r.classList.contains('is-on'), type: window.__ltBoard.ring.pointerType }; })()`);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await sleep(250);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  check('★ 触摸（手指）不显示那个圆：pointerType 是 touch、圆关着',
    ringTouch.type === 'touch' && ringTouch.on === false, JSON.stringify(ringTouch));
  check('顺手：手指在空板上划过去，橡皮（默认只擦自己的）一条请求都不发',
    seen.add.length === addsBeforeTouch, `add ${addsBeforeTouch} → ${seen.add.length}`);

  /* ---- 2. 网格线：默认开着、300 一格、画在画布下面 ---- */
  await cdp.ev(`document.querySelector('[data-lt-reset]').click()`);
  await sleep(300);
  const gridInfo = await cdp.ev(`(() => {
      const g = window.__ltBoard.grid;
      const layer = document.querySelector('[data-lt-grid]');
      const c = document.querySelector('[data-lt-canvas]');
      const v = window.__ltBoard.view;
      const lr = layer.getBoundingClientRect();
      const cr = c.getBoundingClientRect();
      return {
        on: g.on, step: g.step, cols: g.cols, rows: g.rows, half: g.half, color: g.color,
        xs: g.xs.length, ys: g.ys.length, size: g.css.size, pos: g.css.pos,
        display: getComputedStyle(layer).display,
        /* 网格那一层的盒子必须和画布严丝合缝（不然格子会和画错位） */
        sameBox: Math.abs(lr.left - cr.left) < 0.6 && Math.abs(lr.top - cr.top) < 0.6 &&
                 Math.abs(lr.width - cr.width) < 0.6 && Math.abs(lr.height - cr.height) < 0.6,
        /* DOM 顺序：网格在画布**前面** → 它在下层，永远盖不住画 */
        before: !!(layer.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING),
        wantSize: ${GRID_STEP} * v.scale,
      };
    })()`);
  info('网格：' + JSON.stringify(gridInfo));
  check('★ 网格默认开着，线距 300 画板像素，12 列 / 7 行 + 半格 150，颜色克制（不是墨色）',
    gridInfo.on === true && gridInfo.display !== 'none' && gridInfo.step === GRID_STEP &&
      gridInfo.cols === 12 && gridInfo.rows === 7 && gridInfo.half === 150 && gridInfo.xs === 11 && gridInfo.ys === 7 &&
      gridInfo.color !== PAPER,
    JSON.stringify({ on: gridInfo.on, step: gridInfo.step, cols: gridInfo.cols, rows: gridInfo.rows, half: gridInfo.half, color: gridInfo.color }));
  check('★ 网格那一层贴着画布、而且在画布**下面**（DOM 顺序在前 → 盖不住用户的画）',
    gridInfo.sameBox === true && gridInfo.before === true, JSON.stringify({ sameBox: gridInfo.sameBox, before: gridInfo.before }));
  check('★ 网格对到视野上：背景格 = 300 × 缩放（缩放后跟着变）',
    Math.abs(parseFloat(gridInfo.size) - gridInfo.wantSize) < 0.5 &&
      Math.abs(parseFloat(gridInfo.pos) - 0) < 0.6,
    JSON.stringify({ css: gridInfo.size, 期望: gridInfo.wantSize.toFixed(2) }));

  /* 截真的屏：开 → 那一格看得见；关 → 看不见 */
  await hidePointer();
  const gridPt = await cdp.ev(toScreen(2700, 1650));
  const shotOn = await shotPixels(gridPt.x, gridPt.y, 3);
  /*
    网格线只有 1 CSS 像素宽、而一格在屏幕上约 86 像素 —— 那条线是**亚像素**渲染，
    屏幕上读到的是"纸色和网格色之间"的混色（实测 #f1eade），不是纯网格色。
    所以判法不能是"等于网格色"（那是死板容差），而是：
      · 至少有一个像素**比纸色暗**（网格真的画出来了）；
      · 而且每个像素都落在"网格色 ≤ 像素 ≤ 纸色"这个区间里（只可能是那条线，不是别的东西）。
    关掉网格那一趟仍然是"全等于纸色"（下面那条断言），一开一关对照，证据就闭合了。
  */
  const gridRgb = rgbOf(gridInfo.color);
  const paperRgb = rgbOf(PAPER);
  const darkened = shotOn.px.filter((h) => rgbOf(h).some((v, i) => v < paperRgb[i]));
  const inRange = (h) => rgbOf(h).every((v, i) => v >= gridRgb[i] - 2 && v <= paperRgb[i] + 2);
  check('★ 截图取色：网格开着的时候，那一格上真有"把纸色压暗"的网格像素（截图级证据）',
    darkened.length >= 1 && darkened.every(inRange),
    `${shotOn.w}x${shotOn.h} 里 ${darkened.length} 个像素比纸色暗（网格色 ${gridInfo.color}，纸色 ${PAPER}），样本 ${shotOn.px.slice(0, 6).join(' ')}`);
  await cdp.ev(`document.querySelector('[data-lt-grid-toggle]').click()`);
  await sleep(400);
  await hidePointer();
  const shotOff = await shotPixels(gridPt.x, gridPt.y, 3);
  const gridHitOff = shotOff.px.filter((h) => nearHex(h, gridInfo.color, 14));
  check('★ 关掉网格：同一格里一个网格色像素都没有了（全变回纸色）',
    gridHitOff.length === 0 && shotOff.px.every((h) => nearHex(h, PAPER, 6)),
    `命中 ${gridHitOff.length} 个；像素样本 ${[...new Set(shotOff.px)].slice(0, 4).join(' ')}`);
  const gridPrefs = seen.prefs[seen.prefs.length - 1];
  check('★ 网格开关跟着账号走（LT_PREFS_SET 里 grid=false）',
    !!gridPrefs && gridPrefs.prefs.grid === false, JSON.stringify(gridPrefs?.prefs ?? {}));
  /* 再开回来，并验"网格盖不住画" */
  await cdp.ev(`document.querySelector('[data-lt-grid-toggle]').click()`);
  await sleep(400);
  const gridBack = await cdp.ev(`window.__ltBoard.grid.on`);
  await pickTool('pen');
  await setInk('#000000');
  await setSizeNum(14);
  /* 竖着画一条穿过 y=1200 那条横网格线的线 */
  await drawOn([[2600, 1140], [2600, 1200], [2600, 1260]]);
  const gridCrossCanvas = await cdp.ev(pixelAt(2600, 1200));
  await hidePointer();
  const crossPt = await cdp.ev(toScreen(2600, 1200));
  const shotCross = await shotPixels(crossPt.x, crossPt.y, 2);
  const crossHasInk = shotCross.px.some((h) => nearHex(h, '#000000', 40));
  const crossHasGrid = shotCross.px.some((h) => nearHex(h, gridInfo.color, 10));
  check('★ 网格盖不住用户的画：笔划正好压着一条网格线时，画布像素和**截图像素**都是墨色',
    gridBack === true && gridCrossCanvas === '#000000' && crossHasInk === true,
    JSON.stringify({ 画布: gridCrossCanvas, 截图里有墨色: crossHasInk, 截图里有网格色: crossHasGrid }));

  /* ---- 3. 快捷键 ---- */
  const VK = { b: 66, e: 69, c: 67, t: 84, z: 90, r: 82, 1: 49, 2: 50, 3: 51, 4: 52, 5: 53, 6: 54, 7: 55, 8: 56, 9: 57 };
  const press = async (ch, modifiers = 0) => {
    const code = /^[0-9]$/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`;
    const p = { code, key: ch, windowsVirtualKeyCode: VK[ch], nativeVirtualKeyCode: VK[ch], modifiers };
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...p });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...p });
    await sleep(200);
  };
  /** 快捷键要打在"没聚焦在输入框"的状态上：先点到画布上（这也会把焦点从 input 上拿走） */
  const clearFocus = async () => {
    await cdp.ev(`document.activeElement && document.activeElement.blur && document.activeElement.blur()`);
    await sleep(80);
  };
  await clearFocus();
  await press('b');
  const keyB = (await cdp.ev(stateOf)).tool;
  await press('e');
  const keyE = (await cdp.ev(stateOf)).tool;
  await press('c');
  const keyC = (await cdp.ev(stateOf)).tool;
  await press('t');
  const keyT = (await cdp.ev(stateOf)).tool;
  await press('b');
  check('★ 快捷键 B/E/C/T 真的切了工具（画笔 / 橡皮 / 拖动画布 / 移动线条）',
    keyB === 'pen' && keyE === 'eraser' && keyC === 'pan' && keyT === 'move',
    JSON.stringify({ B: keyB, E: keyE, C: keyC, T: keyT }));

  /* 1~9 = 当前调色盘可见顺序（内置黑白在前，自己收藏的在后） */
  const palNow = (await cdp.ev(stateOf)).palette;
  const digitSeen = [];
  for (const d of ['1', '2', '3']) {
    await press(d);
    digitSeen.push((await cdp.ev(stateOf)).color);
  }
  check('★ 数字键 1~9 选的是调色盘里的第 1~9 个（顺序：内置黑白 + 自己收藏的）',
    digitSeen[0] === palNow[0] && digitSeen[1] === palNow[1] && digitSeen[2] === palNow[2] &&
      palNow[0] === '#000000' && palNow[1] === '#ffffff',
    JSON.stringify({ 调色盘: palNow, 按下123选到: digitSeen }));

  /* Ctrl+Z / Ctrl+R：真的撤回 / 重做，而且服务端收到对应请求 */
  await pickTool('pen');
  await setInk('#8ac926');
  await setSizeNum(18);
  const kzPt = [2780, 1900];
  const addsBeforeKz = seen.add.length;
  await drawOn([[kzPt[0] - 80, kzPt[1]], [kzPt[0], kzPt[1]], [kzPt[0] + 80, kzPt[1]]]);
  const kzPix = await cdp.ev(pixelAt(kzPt[0], kzPt[1]));
  await clearFocus();
  const delsBeforeKz = seen.del.length;
  await press('z', 2);
  await sleep(500);
  const kzAfter = await cdp.ev(pixelAt(kzPt[0], kzPt[1]));
  check('★ Ctrl+Z 真的撤回了那一笔（发的是 LT_DRAW_DELETE，画布上变回纸色）',
    kzPix === '#8ac926' && seen.del.length === delsBeforeKz + 1 && kzAfter === PAPER &&
      seen.del[seen.del.length - 1].id === `mine${addsBeforeKz + 1}`,
    JSON.stringify({ 画之前: kzPix, 撤回后: kzAfter, 删的是: seen.del[seen.del.length - 1]?.id }));
  const addsBeforeKr = seen.add.length;
  await press('r', 2);
  await sleep(700);
  check('★ Ctrl+R 真的重做了（发的是 LT_DRAW_ADD，画布上那一点又回来了）—— 而且它没被浏览器当成刷新页面',
    seen.add.length === addsBeforeKr + 1 && (await cdp.ev(pixelAt(kzPt[0], kzPt[1]))) === '#8ac926' &&
      (await cdp.ev(`!!window.__ltBoard && window.__ltBoard.state.strokes > 0`)) === true,
    JSON.stringify({ 重做后: await cdp.ev(pixelAt(kzPt[0], kzPt[1])), adds: seen.add.length - addsBeforeKr }));

  /* 焦点在输入框里 → 快捷键一律不认 */
  await clearFocus();
  await pickTool('pen');
  await cdp.ev(`document.querySelector('[data-lt-size-num]').focus()`);
  await press('e');
  const afterTypeE = await cdp.ev(stateOf);
  check('★ 焦点在输入框里打字时快捷键不生效（按 E 不会切到橡皮）',
    afterTypeE.tool === 'pen', JSON.stringify({ tool: afterTypeE.tool }));
  await clearFocus();

  /* ---- 4. 悬停卡片（功能名 + 快捷键）---- */
  const tipOf = async (sel) =>
    cdp.ev(`(() => {
        const b = document.querySelector('${sel}');
        const id = b.getAttribute('aria-describedby');
        const t = id ? document.getElementById(id) : null;
        if (!t) return null;
        const cs = getComputedStyle(t);
        return { id, role: t.getAttribute('role'), text: t.textContent.trim(), vis: cs.visibility, op: Number(cs.opacity), bg: cs.backgroundColor, border: cs.borderTopColor };
      })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tipPt.x, y: tipPt.y, button: 'none' });
  await sleep(350);
  const tipPen = await tipOf('[data-lt-tool="pen"]');
  info('悬停画笔的卡片：' + JSON.stringify(tipPen));
  check('★ 鼠标移到按钮上弹出卡片，卡片里有功能名和快捷键（画笔 + B）',
    !!tipPen && tipPen.vis === 'visible' && tipPen.op > 0.9 && /画笔/.test(tipPen.text) && /B/.test(tipPen.text),
    JSON.stringify(tipPen));
  check('★ 卡片的视觉就是花涧堂时间轴那套浮层（同底色 / 同描边 / role=tooltip）',
    tipPen?.role === 'tooltip' && tipPen?.bg === 'rgba(24, 3, 36, 0.96)' && tipPen?.border === 'rgba(255, 120, 190, 0.6)',
    JSON.stringify({ bg: tipPen?.bg, border: tipPen?.border, role: tipPen?.role }));
  const tipUndo = await tipOf('[data-lt-undo]');
  check('★ 撤销那张卡片写的是 Ctrl+Z', /撤销/.test(tipUndo?.text ?? '') && /Ctrl\+Z/.test(tipUndo?.text ?? ''), tipUndo?.text);
  /* 键盘 focus 也能弹（无障碍） */
  await hidePointer();
  await cdp.ev(`document.querySelector('[data-lt-tool="pen"]').focus()`);
  await sleep(320);
  const tipFocus = await tipOf('[data-lt-tool="pen"]');
  check('★ 键盘 Tab 聚焦到按钮上，卡片一样会弹出来（:focus-within）',
    tipFocus?.vis === 'visible' && tipFocus?.op > 0.9, JSON.stringify(tipFocus));
  await clearFocus();
  const tipAll = await cdp.ev(`(() => {
      const btns = [...document.querySelectorAll('.lyt-draw__bar button')].filter((b) => !b.classList.contains('lyt-draw__swatch'));
      const bad = [];
      for (const b of btns) {
        const id = b.getAttribute('aria-describedby');
        const t = id ? document.getElementById(id) : null;
        if (!t || t.getAttribute('role') !== 'tooltip') bad.push(b.textContent.trim() || '(无名)');
      }
      return { n: btns.length, bad };
    })()`);
  check('★ 工具条上每个按钮都挂了自己的卡片（aria-describedby → role=tooltip）',
    tipAll.n >= 11 && tipAll.bad.length === 0, JSON.stringify(tipAll));

  /* ---- 5. 橡皮：两种方式 × 一颗"擦别人的"开关（2026-10-10） ----
     用户原话：「橡皮优化为两种 一种是擦除接触到的整根该笔画的线条 一种是仅去除划过的地方的
               像素 …… 两种下面都分别有个按钮开关控制能否擦别人的」。
     这一段一条条量**像素**：四种组合各自"动了什么、没动什么"。 */
  const eraserState = `(() => { const s = window.__ltBoard.state; return { mode: s.eraserMode, stroke: s.eraserStrokeOthers, pixel: s.eraserPixelOthers, others: s.eraserOthers }; })()`;
  const clickEraserMode = async () => {
    await cdp.ev(`document.querySelector('[data-lt-eraser-mode]').click()`);
    await sleep(300);
  };
  const clickEraserOthers = async () => {
    await cdp.ev(`document.querySelector('[data-lt-eraser-others]').click()`);
    await sleep(300);
  };
  /** 把橡皮设成想要的那一档（方式 + 擦别人的），不管现在是什么状态 —— 后面每条都从确定的起点开始 */
  const setEraser = async (mode, others) => {
    for (let i = 0; i < 6; i += 1) {
      const s = await cdp.ev(eraserState);
      if (s.mode === mode && s.others === others) return s;
      if (s.mode !== mode) await clickEraserMode();
      else await clickEraserOthers();
    }
    return cdp.ev(eraserState);
  };
  const modeBtnText = `(() => String((document.querySelector('[data-lt-eraser-mode]') || {}).textContent || ''))()`;
  const othersPressed = `(() => { const b = document.querySelector('[data-lt-eraser-others]'); return { pressed: b.getAttribute('aria-pressed'), cls: b.classList.contains('is-on') }; })()`;
  /*
    ⚠ 状态行那个观察器是**这一页刚打开时**挂的，中间那段"重开页面看偏好还在不在"把页面刷过一遍 ——
    window.__statusLog 跟着没了，statusSaid 会抛 "Cannot read properties of undefined (reading 'some')"。
    所以这一段自己重新挂一次（下面 (a) 要用它证明"别人的线条被拒时说了人话"）。
  */
  await cdp.ev(`(() => {
      const el = document.querySelector('[data-lt-draw-status]');
      window.__statusLog = [el.textContent];
      new MutationObserver(() => window.__statusLog.push(el.textContent)).observe(el, { childList: true, characterData: true, subtree: true });
      return true;
    })()`);

  /* (a) 整笔 + 只擦自己：擦到**别人的**笔划 → 一个请求都不发、像素一动不动 */
  const otherInk = '#cc00aa';
  extra.push(remoteStroke({
    id: 'other-for-eraser', uk: 'beefcafe', nick: '别人', avatar: '',
    tool: 'pen', color: otherInk, size: 26, points: [[2600, 1600], [2700, 1600], [2800, 1600]],
  }));
  const otherThere = await cdp.wait(`(() => (window.__ltBoard ? window.__ltBoard.pixelAt(2700, 1600) : '') === '${otherInk}')()`, 15000);
  check('（前置）别人的那条笔划已经拉下来画在画板上了', otherThere === true, await cdp.ev(pixelAt(2700, 1600)));
  const stA = await setEraser('stroke', false);
  check('★ 默认档 = 整笔 + 只擦自己的（引擎状态和按钮文字都对得上）',
    stA.mode === 'stroke' && stA.others === false && (await cdp.ev(modeBtnText)) === '整笔擦', JSON.stringify(stA));
  await pickTool('eraser');
  await setSizeNum(30);
  const beforeOther = { del: seen.del.length, add: seen.add.length };
  await dragWithScroll([[2700, 1560], [2700, 1600], [2700, 1640]]);
  await sleep(600);
  check('★ 整笔 + 只擦自己：擦到**别人的**笔划 → 一个请求都不发，也不盖纸色',
    seen.del.length === beforeOther.del && seen.add.length === beforeOther.add,
    JSON.stringify({ del: seen.del.length - beforeOther.del, add: seen.add.length - beforeOther.add }));
  check('★ 别人的笔划像素一点没动（还是那个颜色）',
    (await cdp.ev(pixelAt(2700, 1600))) === otherInk, await cdp.ev(pixelAt(2700, 1600)));
  check('顺手说明了原因（"先把「擦别人的」打开"）', await statusSaid(/擦别人的/));

  /* (b) 整笔 + 擦别人的：同一笔 → 整根删掉（others: true），像素变纸色 */
  const stB = await setEraser('stroke', true);
  check('★「擦别人的」打开了（aria-pressed=true、状态进了引擎）',
    stB.others === true && (await cdp.ev(othersPressed)).pressed === 'true' && (await cdp.ev(othersPressed)).cls === true,
    JSON.stringify({ state: stB, btn: await cdp.ev(othersPressed) }));
  const delBeforeAll = seen.del.length;
  await pickTool('eraser');
  await dragWithScroll([[2700, 1560], [2700, 1600], [2700, 1640]]);
  await sleep(700);
  const delOther = seen.del[seen.del.length - 1];
  check('★ 整笔 + 擦别人的：整根删掉，删的是**别人那一笔**的 id，而且带 others: true',
    seen.del.length === delBeforeAll + 1 && delOther?.id === 'other-for-eraser' && delOther?.others === true,
    JSON.stringify(delOther ?? {}));
  check('★ 别人的那条线整根从画布上没了（像素变回纸色）',
    (await cdp.ev(pixelAt(2700, 1600))) === PAPER && (await cdp.ev(pixelAt(2620, 1600))) === PAPER,
    JSON.stringify({ 中: await cdp.ev(pixelAt(2700, 1600)), 旁: await cdp.ev(pixelAt(2620, 1600)) }));

  /* (c) 像素 + 只擦自己：自己那几笔**被裁开**（LT_DRAW_REPLACE），别人的墨不动 */
  await setEraser('pixel', false);
  await pickTool('pen');
  await setInk('#0044cc');
  await setSizeNum(24);
  /*
    ⚠ 这条线要**画得够密**（每 20 画板像素一个点）：像素橡皮是"把落在橡皮圆里的**采样点**去掉"，
    而画一笔时引擎按 1.2 画板像素过滤采样点 —— 只给 4 个点的话，40 号橡皮（半径 20）
    在中间那一下根本碰不到任何点，什么都没裁（第一版就是这么假红的）。
  */
  const densePath = [];
  for (let x = 2000; x <= 2600; x += 20) densePath.push([x, 400]);
  await drawOn(densePath);
  const myCutId = `mine${seen.add.length}`;
  check('（前置）自己那条线画上去了', (await cdp.ev(pixelAt(2100, 400))) === '#0044cc', await cdp.ev(pixelAt(2100, 400)));
  await pickTool('eraser');
  await setSizeNum(40);
  const beforeCut = { add: seen.add.length, replace: seen.replace.length, del: seen.del.length };
  await dragWithScroll([[2300, 330], [2300, 400], [2300, 470]]);
  await sleep(900);
  const cutReq = seen.replace[seen.replace.length - 1];
  check('★ 像素 + 只擦自己：发的是 LT_DRAW_REPLACE（一根换成几段），不是 ADD / DELETE',
    seen.replace.length === beforeCut.replace + 1 && seen.add.length === beforeCut.add && seen.del.length === beforeCut.del,
    JSON.stringify({ replace: seen.replace.length - beforeCut.replace, add: seen.add.length - beforeCut.add, del: seen.del.length - beforeCut.del }));
  check('★ 换的正是自己那一笔，断开成两段（擦到的地方去掉，两头留下）',
    cutReq?.edits?.length === 1 && cutReq.edits[0].id === myCutId && cutReq.edits[0].parts.length === 2 &&
      cutReq.edits[0].parts.every((p) => p.tool === 'pen' && p.color === '#0044cc' && p.points.length >= 2),
    JSON.stringify({ edits: cutReq?.edits?.map((e) => ({ id: e.id, parts: e.parts.length, pts: e.parts.map((p) => p.points.length) })) }));
  check('★ 像素上：擦过的那一点变纸色，两头**还留着**（这就是"仅去除划过的地方"）',
    (await cdp.ev(pixelAt(2300, 400))) === PAPER && (await cdp.ev(pixelAt(2100, 400))) === '#0044cc' &&
      (await cdp.ev(pixelAt(2500, 400))) === '#0044cc',
    JSON.stringify({ 擦过: await cdp.ev(pixelAt(2300, 400)), 左: await cdp.ev(pixelAt(2100, 400)), 右: await cdp.ev(pixelAt(2500, 400)) }));

  /* (d) 像素 + 擦别人的：别人的线被**挖掉一块**（tool=erase），两头还在 */
  const pixelInk = '#0a9396';
  extra.push(remoteStroke({
    id: 'other-for-pixel', uk: 'beefcafe', nick: '别人', avatar: '',
    tool: 'pen', color: pixelInk, size: 26, points: [[1500, 1900], [1800, 1900], [2100, 1900]],
  }));
  const pixelThere = await cdp.wait(`(() => (window.__ltBoard ? window.__ltBoard.pixelAt(1800, 1900) : '') === '${pixelInk}')()`, 15000);
  check('（前置）第二条别人的笔划也画上来了', pixelThere === true, await cdp.ev(pixelAt(1800, 1900)));
  await setEraser('pixel', true);
  const addsBeforePixel = seen.add.length;
  await pickTool('eraser');
  await setSizeNum(36);
  await dragWithScroll([[1800, 1840], [1800, 1900], [1800, 1960]]);
  await sleep(800);
  const eraseAdd = seen.add[seen.add.length - 1];
  check('★ 像素 + 擦别人的：发出去的是一根 tool=erase 的笔划（不是纸色笔划、也不是删别人的笔划）',
    seen.add.length === addsBeforePixel + 1 && eraseAdd?.tool === 'erase' && eraseAdd?.color === PAPER,
    JSON.stringify({ tool: eraseAdd?.tool, color: eraseAdd?.color }));
  check('★ 别人的那条线**只少了划过的那一块**（中间变纸色，两头还是他的颜色）',
    (await cdp.ev(pixelAt(1800, 1900))) === PAPER && (await cdp.ev(pixelAt(1560, 1900))) === pixelInk &&
      (await cdp.ev(pixelAt(2050, 1900))) === pixelInk,
    JSON.stringify({ 擦过: await cdp.ev(pixelAt(1800, 1900)), 左: await cdp.ev(pixelAt(1560, 1900)), 右: await cdp.ev(pixelAt(2050, 1900)) }));

  /* (e) 两种方式的"擦别人的"是**各记各的**：切过去看的是那一种自己的值 */
  const stE1 = await cdp.ev(eraserState);
  await clickEraserMode();
  const stE2 = await cdp.ev(eraserState);
  check('★ 切到「整笔」→ 按钮显示的是**整笔**那一份设置（不是像素那一份）',
    stE1.pixel === true && stE2.mode === 'stroke' && stE2.others === stE2.stroke && stE2.stroke === true,
    JSON.stringify({ 像素档: stE1, 整笔档: stE2 }));
  await clickEraserOthers();
  const stE3 = await cdp.ev(eraserState);
  await clickEraserMode();
  const stE4 = await cdp.ev(eraserState);
  check('★ 在「整笔」里关掉它，切回「像素」→ 像素那一份**没被动过**（两种各记各的）',
    stE3.stroke === false && stE4.mode === 'pixel' && stE4.pixel === true && stE4.others === true,
    JSON.stringify({ 关完整笔: stE3, 回到像素: stE4 }));
  check('橡皮方式按钮上的字跟着切（像素擦 ⇄ 整笔擦）',
    (await cdp.ev(modeBtnText)) === '像素擦', await cdp.ev(modeBtnText));

  /* (f) 这四样都跟着账号走（LT_PREFS_SET 里有方式 + 两份开关） */
  await sleep(900);
  const prefsEr = seen.prefs[seen.prefs.length - 1];
  check('★ 橡皮的方式和两份"擦别人的"都存进了账号偏好',
    !!prefsEr && prefsEr.prefs.eraserMode === 'pixel' && prefsEr.prefs.eraserPixelOthers === true &&
      prefsEr.prefs.eraserStrokeOthers === false,
    JSON.stringify(prefsEr?.prefs ?? {}));

  /* (g) 墓碑：别人撤掉 / 擦掉的那一笔，靠增量拉下来之后就地从画布上消失 */
  await pickTool('pen');
  await setInk('#8a2be2');
  await setSizeNum(20);
  await drawOn([[600, 1900], [800, 1900], [1000, 1900]]);
  const tombId = `mine${seen.add.length}`;
  check('（前置）待会儿要被"别人擦掉"的那一笔画上去了',
    (await cdp.ev(pixelAt(800, 1900))) === '#8a2be2', await cdp.ev(pixelAt(800, 1900)));
  const beforeTomb = await cdp.ev(stateOf);
  tombstones.push({ id: tombId, deleted: true, updatedAt: Date.now() + 60000, createdAt: Date.now() + 60000 });
  const tombGone = await cdp.wait(
    `(() => { const b = window.__ltBoard; return !!b && b.pixelAt(800, 1900) === '${PAPER}' && b.state.strokes < ${beforeTomb.strokes}; })()`,
    20000
  );
  check('★ 增量里带回来的墓碑（deleted: true）→ 本地那一笔被删掉、像素回到纸色',
    tombGone === true,
    JSON.stringify({ 之前: beforeTomb.strokes, 现在: (await cdp.ev(stateOf)).strokes, 像素: await cdp.ev(pixelAt(800, 1900)) }));
  check('这一趟没有未捕获的 JS 异常', cdp.errors.length === errBefore, cdp.errors.slice(errBefore, errBefore + 2).join(' | '));

  /* ---- 6. 跨天自清（凌晨四点存档搬完 / 换天，都不用刷新页面）---- */
  await envLine('跨天自清之前');
  const beforeWipe = await cdp.ev(stateOf);
  servedToday = NEXT_DAY;
  servedWiped = true;
  const wiped = await cdp.wait(
    `(() => { const b = window.__ltBoard; return !!b && b.state.strokes === 0 && b.state.day === '${NEXT_DAY}'; })()`,
    20000
  );
  await sleep(400);
  check('★ 服务端说换天了（today 变了）→ 本地笔划全部清掉、游标归零重拉（跨天自清）',
    wiped === true && beforeWipe.strokes > 0 && beforeWipe.day !== NEXT_DAY,
    JSON.stringify({ 之前: { strokes: beforeWipe.strokes, day: beforeWipe.day }, 清完: await cdp.ev(stateOf) }));
  check('★ 清掉之后画布上那些笔划的像素回到纸色（不是"本地数变了、屏幕还留着"）',
    (await cdp.ev(pixelAt(2700, 1600))) === PAPER && (await cdp.ev(pixelAt(2600, 1200))) === PAPER,
    JSON.stringify({ 2700_1600: await cdp.ev(pixelAt(2700, 1600)), 2600_1200: await cdp.ev(pixelAt(2600, 1200)) }));
  /* 换天之后新拉的笔划照常显示（游标归零之后这条路必须是通的） */
  servedWiped = false;
  const day2Ink = '#00a86b';
  extra.push(remoteStroke({
    id: 'after-new-day', uk: 'beef8888', nick: '第二天的人', avatar: '',
    tool: 'pen', color: day2Ink, size: 26, points: [[2900, 1900], [3050, 1900], [3200, 1900]],
  }));
  const day2Shown = await cdp.wait(`(() => (window.__ltBoard ? window.__ltBoard.pixelAt(3050, 1900) : '') === '${day2Ink}')()`, 20000);
  check('★ 换天之后新拉到的那一笔照常画出来（自清没有把轮询弄坏）',
    day2Shown === true && (await cdp.ev(stateOf)).strokes > 0,
    JSON.stringify({ 像素: await cdp.ev(pixelAt(3050, 1900)), 本地: (await cdp.ev(stateOf)).strokes }));

  check('第二批这一整段没有未捕获的 JS 异常', cdp.errors.length === errBefore2, cdp.errors.slice(errBefore2, errBefore2 + 3).join(' | '));

  /* ==================================================================
     7. 茶绘的版式：**左边画画、右边聊天**（2026-10-10）
     用户原话：「将茶绘当前UI全部向左挪一些 然后在右边接入聊天室的聊天框 下面也可以发送文字和图片
               但是没有聊天室的时间轴和看往期等功能 仅方便群友一边画画一边聊天即可」。
     量四件事：① 整页放宽（"向左挪"的做法）+ 两栏并排；② 右栏**没有**时间轴/往期/搜索；
     ③ 消息多了右栏不长高（只在自己框里滚）；④ 在茶绘这边能发一条（走聊天室那套事件）。
     ================================================================== */
  const layoutOf = `(() => {
    const r = (s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { top: Math.round(b.top), left: Math.round(b.left), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const log = document.querySelector('.lyt-draw__chat .lyt-chat__log');
    const main = document.querySelector('main');
    return {
      draw: r('.lyt-draw'), chat: r('.lyt-draw__chat'), log: r('.lyt-draw__chat .lyt-chat__log'),
      compose: r('.lyt-draw__chat .lyt-chat__compose'), stage: r('.lyt-draw__stage'),
      cols: getComputedStyle(document.querySelector('.lyt-drawWrap')).gridTemplateColumns,
      mainMax: getComputedStyle(main).maxWidth,
      mainW: Math.round(main.getBoundingClientRect().width),
      wide: main.classList.contains('forum__main--wide'),
      hasTimeline: !!document.querySelector('.lyt-draw__chat .lyt-chat__tl'),
      hasFind: !!document.querySelector('.lyt-draw__chat .lyt-chat__find'),
      links: [...document.querySelectorAll('.lyt-draw__chat a')].map((a) => a.getAttribute('href')),
      msgs: document.querySelectorAll('.lyt-draw__chat .lyt-msg').length,
      logScroll: log ? { scroll: Math.round(log.scrollHeight), client: Math.round(log.clientHeight) } : null,
      docScroll: Math.round(document.scrollingElement.scrollHeight),
      overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
    };
  })()`;
  await showCanvas();
  const lay1 = await cdp.ev(layoutOf);
  info('茶绘版式：' + JSON.stringify({ draw: lay1.draw, chat: lay1.chat, cols: lay1.cols, mainMax: lay1.mainMax }));
  check('★ 整页放宽了（.forum__main--wide：正文区上限 68rem → 104rem=1664px）——"整块向左挪"就是这么做的',
    lay1.wide === true && /1664px/.test(lay1.mainMax) && lay1.mainW > 1088,
    JSON.stringify({ maxWidth: lay1.mainMax, 实际宽: lay1.mainW, wide: lay1.wide }));
  check('★ 两栏并排：右栏在画板那一栏的**右边**',
    !!lay1.chat && !!lay1.draw && lay1.chat.left >= lay1.draw.right - 2,
    JSON.stringify({ drawRight: lay1.draw?.right, chatLeft: lay1.chat?.left }));
  check('右栏宽度就是那个 22rem（352px ± 2）', !!lay1.chat && Math.abs(lay1.chat.w - 352) <= 2, String(lay1.chat?.w));
  check('★ 右栏里只有聊天框：**没有**时间轴、没有搜索框、没有往期/日历链接',
    lay1.hasTimeline === false && lay1.hasFind === false &&
      !lay1.links.some((h) => /chatroom|calendar|teahouse\/\d/.test(String(h))),
    JSON.stringify({ tl: lay1.hasTimeline, find: lay1.hasFind, links: lay1.links }));
  check('聊天框 + 输入区都在右栏里（输入区在框下面）',
    !!lay1.log && !!lay1.compose && lay1.log.w > 200 && lay1.compose.top >= lay1.log.bottom - 2,
    JSON.stringify({ log: lay1.log, compose: lay1.compose }));
  check('桌面端没有横向溢出', lay1.overflowX <= 1, `${lay1.overflowX}px`);
  check('（前置）右栏已经把聊天室那条历史消息画出来了', lay1.msgs >= 1, `${lay1.msgs} 条`);

  /* 消息多了：右栏不长高（框里自己滚），整页也不被拉长 —— 和聊天室今天那一页同一条规矩 */
  chatMsgs.push(
    ...Array.from({ length: 40 }, (_, i) => ({
      id: 'bulkchat' + i,
      day: servedToday,
      nick: '虹星',
      alias: '虹星',
      avatar: '',
      text: `第 ${i + 1} 条：这一条是拿来量右栏会不会被撑高的。`,
      image: '',
      createdAt: Date.now() + 1000 + i,
      mine: false,
    }))
  );
  const chatGrew = await cdp.wait(`document.querySelectorAll('.lyt-draw__chat .lyt-msg').length >= 40`, 20000);
  await sleep(300);
  const lay2 = await cdp.ev(layoutOf);
  check('40 条消息都画进右栏了', chatGrew === true, `${lay2.msgs} 条`);
  check('★ 消息变多了，聊天框**一点没长高**（差 ≤ 2px）',
    Math.abs(lay2.log.h - lay1.log.h) <= 2, `${lay1.log.h} → ${lay2.log.h}`);
  check('★ 整页也没被拉长（差 ≤ 2px）', Math.abs(lay2.docScroll - lay1.docScroll) <= 2, `${lay1.docScroll} → ${lay2.docScroll}`);
  check('★ 消息多了在聊天框**里面**滚（内容比框高）',
    !!lay2.logScroll && lay2.logScroll.scroll > lay2.logScroll.client + 50, JSON.stringify(lay2.logScroll));
  const chatScrolled = await cdp.ev(`(() => { const l = document.querySelector('.lyt-draw__chat .lyt-chat__log'); l.scrollTop = 1e6; return Math.round(l.scrollTop); })()`);
  check('滚到底能看见最后那一条（框里滚得动）', chatScrolled > 0, String(chatScrolled));

  /* 在茶绘这边发一条：和聊天室是同一个消息流（同一套 LT_CHAT_* 事件） */
  const sendsBefore = seen.chatSends.length;
  await cdp.ev(`(() => {
      const t = document.querySelector('.lyt-draw__chat [data-lt-chat-text]');
      t.value = '茶绘这边发的';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return true;
    })()`);
  await sleep(900);
  const chatStats = await cdp.ev(`(() => ({
      inDom: /茶绘这边发的/.test(String((document.querySelector('.lyt-draw__chat') || {}).textContent || '')),
      msgs: document.querySelectorAll('.lyt-draw__chat .lyt-msg').length,
      status: String((document.querySelector('.lyt-draw__chat [data-lt-chat-status]') || {}).textContent || ''),
      input: String((document.querySelector('.lyt-draw__chat [data-lt-chat-text]') || {}).value || ''),
    }))()`);
  check('★ 在茶绘右栏回车就能发（走的是聊天室那套 LT_CHAT_SEND），而且立刻出现在框里',
    seen.chatSends.length === sendsBefore + 1 && seen.chatSends[seen.chatSends.length - 1].text === '茶绘这边发的' &&
      chatStats.inDom === true,
    JSON.stringify({ 新发了几条: seen.chatSends.length - sendsBefore, ...chatStats }));

  /* 截图留一张给人看：左边画板 + 右边聊天框（.tmp/shots/teahouse-chat.png） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'teahouse-chat.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }

  /* 这一段自己的异常账在这一步结（下面窄屏 / 访客要换页面，页面一换异常账就不干净了） */
  check('新增这一整段没有未捕获的 JS 异常', cdp.errors.length === errBefore, cdp.errors.slice(errBefore, errBefore + 2).join(' | '));

  /* 窄屏：两栏塌成一列（聊天框搬到画板下面），别溢出 */
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const lay3 = await cdp.ev(layoutOf);
  info('窄屏 700：' + JSON.stringify({ draw: lay3.draw, chat: lay3.chat, cols: lay3.cols }));
  check('★ 窄屏（700px）两栏塌成一列：聊天框搬到画板那一栏**下面**',
    !!lay3.chat && !!lay3.draw && lay3.chat.top >= lay3.draw.bottom - 2,
    JSON.stringify({ drawBottom: lay3.draw?.bottom, chatTop: lay3.chat?.top }));
  check('窄屏也没有横向溢出', lay3.overflowX <= 1, `${lay3.overflowX}px`);
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
  await sleep(500);

  /* 访客（没登录）：右栏那三件和工具条一样是锁着的（同一道闸门） */
  await cdp.ev(`localStorage.removeItem('lt_token'); localStorage.removeItem('lt_user');`);
  await cdp.go(`${base}/liyutang/teahouse/`);
  const guestChat = await cdp.wait(`(() => {
      const t = document.querySelector('.lyt-draw__chat [data-lt-chat-text]');
      const s = document.querySelector('[data-lt-draw-gate]');
      return !!t && t.disabled === true && /登录|审核/.test(String(s && s.textContent));
    })()`, 20000);
  const guestState = await cdp.ev(`(() => ({
      text: !!document.querySelector('.lyt-draw__chat [data-lt-chat-text]')?.disabled,
      send: !!document.querySelector('.lyt-draw__chat [data-lt-chat-send]')?.disabled,
      img: !!document.querySelector('.lyt-draw__chat [data-lt-chat-image]')?.disabled,
      gate: String((document.querySelector('[data-lt-draw-gate]') || {}).textContent || ''),
    }))()`);
  check('★ 访客：右栏那三件（输入框 / 发出去 / 传图）全是锁着的，而且说明了要先登录过审',
    guestChat === true && guestState.text && guestState.send && guestState.img, JSON.stringify(guestState));

  /* 截图留一张（人眼看） */
  try {
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.mkdirSync(path.join(SRC, '.tmp', 'shots'), { recursive: true });
    fs.writeFileSync(path.join(SRC, '.tmp', 'shots', 'teahouse-board.png'), Buffer.from(shot.data, 'base64'));
  } catch {
    /* 截不到不影响验收 */
  }
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
