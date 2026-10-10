/*
 * ============================================================================
 * 画板的「笔划」—— 几何、路径、以及把一堆笔划画成一张 SVG
 * ----------------------------------------------------------------------------
 * 用户原话（久昭卿茶绘）：
 *   「点进去以后是一个巨大的公共画板 有基本的画笔橡皮调色板等功能 …… 每天保存一次画 ……
 *    其他用户以后也可以点开一个日历页面 查看每一天的画板上都画了什么 最好参考一下网上
 *    比较成熟的在线画画网页 让画画的手感可以比较舒服丝滑」
 *
 * 这个文件是**纯函数**，一头两用：
 *   · 浏览器里：本地画（要顺滑）+ 把别人的笔划重画一遍；
 *   · node 里（tools/liyutang-archive.mjs）：把一天的笔划渲染成一张 SVG 存档。
 * 所以它是 .mjs 零依赖 —— 和 src/utils/liyutang-md.mjs 一个理由（node 不认 TypeScript）。
 *
 * 顺滑是怎么来的（这是"手感"的全部秘密）：
 *   ① **不是折线**：相邻两点的**中点**做锚点、原始点做控制点，拼成一串二次贝塞尔 ——
 *      鼠标的采样点是硬折线，直接连起来是一节一节的；走中点曲线才是笔画的样子。
 *   ② 起笔收笔单独处理（第一段 M→Q，最后一段补一条 Q 到终点），所以两头不会缺角。
 *   ③ 采样点在浏览器那侧按距离过滤（太密的点不记），既省体积也更接近真实笔迹。
 *
 * 输出的是 SVG `<path d="…">` —— 浏览器渲染 SVG 和 canvas 都能用同一份数据，
 * 存档也就是"把这些笔划写成一张 SVG"，不需要在服务器上跑画布。
 * ============================================================================
 */

/**
 * 画板内部坐标系（笔划的坐标都以这个为准，跟屏幕大小无关）。
 *
 * 2026-10-09 从 2400×1500 放大到 3600×2250 —— 用户原话：「画布现在太小了 在保留今天绘画
 * 内容的同时扩大画布」。**长宽都 ×1.5、比例还是 1.6，而且原点仍在左上角** —— 这是"今天
 * 已经画上去的笔划位置一个都不变"的全部原因：老笔划的坐标没被改过，多出来的 1200×750
 * 只是长在右边和下边（所以 stage 的 aspect-ratio 2400/1500 也不用动）。
 * ⚠ 云端那份（tools/liyutang-backend/index.js 里的 BOARD_W/BOARD_H）是**抄过去的**
 * （云函数单文件部署、import 不了这里），改这里必须同步改那边，否则右下角会被夹回来。
 */
export const BOARD_W = 3600;
export const BOARD_H = 2250;

/**
 * 网格线间距（**画板坐标**里的 300）。
 * 线本身是画在屏幕上的（见 liyutang-draw.ts 里那段"网格为什么画成一层 div"），
 * 这个数只表示"每隔 300 画板像素一条线"，所以在任何缩放下格子对应的画板范围都一样。
 */
export const GRID_STEP = 300;

/**
 * 网格线落在画板的哪些坐标上（**纯几何**，给调试口和验收用）。
 *
 * 只算"板子内部"的线：0 和板子边缘那两条不算（边缘本身就是界线）。
 *   · 3600 / 300 = 12 列 → 内部竖线 11 条（300…3300）；
 *   · 2250 / 300 = 7.5   → 内部横线 7 条（300…2100），最下面剩**半格 150**。
 * 那个半格**不补线到板底**：补一条刚好压在板子下边框上的线，既难看又和边框重叠，
 * 而"最后一行只有半格高"本来就是这块板子的真实比例。半格有多高放在 `half` 里。
 * @param {number} [w] 画板宽
 * @param {number} [h] 画板高
 * @param {number} [step] 线距
 * @returns {{step: number, w: number, h: number, xs: number[], ys: number[], cols: number, rows: number, half: number}}
 */
export function gridLines(w = BOARD_W, h = BOARD_H, step = GRID_STEP) {
  const s = Math.max(1, Number(step) || GRID_STEP);
  const xs = [];
  const ys = [];
  for (let x = s; x < w; x += s) xs.push(Math.round(x * 10) / 10);
  for (let y = s; y < h; y += s) ys.push(Math.round(y * 10) / 10);
  return {
    step: s,
    w,
    h,
    xs,
    ys,
    /** 整格列数（3600/300 = 12） */
    cols: Math.ceil(w / s),
    /** 整格行数（2250/300 = 7，余一个半格） */
    rows: Math.floor(h / s),
    /** 最下面那一格剩下的高度（2250 % 300 = 150；整除时是 0） */
    half: Math.round((h % s) * 10) / 10,
  };
}

/**
 * 允许的工具。
 *
 *   · `pen`    画笔（正常的一笔）；
 *   · `eraser` **橡皮的老写法**：一条**纸色**的笔划，画在别人的画上面把它盖住
 *              （2026-10-09 的"擦所有人"就是这么实现的）。存档重放照样画纸色，
 *              所以历史存档（10-09 / 10-10）一个像素都不会变；
 *   · `erase`  **像素橡皮**（2026-10-10 加的第二种橡皮）：不是"画纸色"，而是
 *             真的把**底下已经画上去的墨**去掉一片 ——
 *               · 浏览器：`globalCompositeOperation = 'destination-out'`；
 *               · 存档 SVG：用它做一层 `<mask>`（黑笔画过的地方挖掉）。
 *              两边同一份几何、同一个先后顺序，所以"存档长得和当时一模一样"这条还成立。
 */
export const TOOLS = ['pen', 'eraser', 'erase'];

/** 一根笔划最多多少个点（服务端也会拿这个数卡一道） */
export const MAX_POINTS = 2000;

/**
 * 颜色只收 `#rrggbb`（画板不给用户写 CSS 的机会 —— 那是一条注入路子）。
 * @param {unknown} c 待检颜色
 * @returns {string} 规整后的颜色，或者空串
 */
export function safeColor(c) {
  const s = String(c ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('');
  return '';
}

/** 数字夹在范围内（坐标越界的一律夹回来，别让一根笔划把画布撑爆） */
const clamp = (v, min, max) => Math.min(max, Math.max(min, Number(v) || 0));

/**
 * 把一笔的点规整成 `[[x, y], …]`：夹进画布、去掉重复点。
 * @param {unknown} points 原始点集
 * @param {{w?: number, h?: number}} [box] 画布尺寸
 * @returns {number[][]} 规整后的点
 */
export function cleanPoints(points, box = {}) {
  const w = box.w ?? BOARD_W;
  const h = box.h ?? BOARD_H;
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Math.round(clamp(p[0], 0, w) * 10) / 10;
    const y = Math.round(clamp(p[1], 0, h) * 10) / 10;
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
    if (out.length >= MAX_POINTS) break;
  }
  return out;
}

/**
 * 一笔的点 → 曲线段（**SVG 和画布都从这里出**，免得两边各写一套、画出来不一样）。
 *
 * 返回 `{start, curves}`：
 *   · `start` 是起点；
 *   · `curves` 每一项是 `[控制点x, 控制点y, 终点x, 终点y]`（二次贝塞尔的三个参数里的后三个）。
 * 一个点的情况给一条 0.1 长的水平线段（配合圆头 linecap 看起来就是一个点）。
 * @param {number[][]} points 规整过的点
 * @param {{smooth?: boolean}} [opts] smooth=false 就退化成折线（每段控制点=起点）
 * @returns {{start: number[], curves: number[][]}} 曲线段
 */
export function strokeSegments(points, opts = {}) {
  const pts = Array.isArray(points) ? points : [];
  const n = (v) => Math.round(v * 10) / 10;
  if (!pts.length) return { start: [], curves: [] };
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return { start: [n(x), n(y)], curves: [[n(x + 0.1), n(y), n(x + 0.1), n(y)]] };
  }
  if (pts.length === 2 || opts.smooth === false) {
    /* 折线：每段用"控制点 = 上一段终点"的二次贝塞尔等价表示 —— 画布和 SVG 都不用分支 */
    const curves = [];
    for (let i = 1; i < pts.length; i += 1) {
      const [px, py] = pts[i - 1];
      const [x, y] = pts[i];
      curves.push([n(px), n(py), n(x), n(y)]);
    }
    return { start: [n(pts[0][0]), n(pts[0][1])], curves };
  }
  const curves = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    curves.push([n(x0), n(y0), n((x0 + x1) / 2), n((y0 + y1) / 2)]);
  }
  const [lx, ly] = pts[pts.length - 1];
  const [px, py] = pts[pts.length - 2];
  curves.push([n(px), n(py), n(lx), n(ly)]);
  return { start: [n(pts[0][0]), n(pts[0][1])], curves };
}

/**
 * 一笔的点 → SVG path 的 `d`（薄薄一层，几何全在 strokeSegments 里）。
 * @param {number[][]} points 规整过的点
 * @param {{smooth?: boolean}} [opts] smooth=false 就画折线（对照用）
 * @returns {string} path 的 d
 */
export function strokePath(points, opts = {}) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return '';
  const n = (v) => Math.round(v * 10) / 10;
  /*
    ⚠ 2026-10-10：改成**相对命令**（`q` / `l` 里写增量），并且省掉命令后面那个空格。
    缘由：存档那天的 SVG 是仓库里最大的东西（10-09：1.34MB，比压完的 JSON 还大）——
    绝对坐标每个点要写两个好几位的大数（"Q 673.2 212.7 672.2 213.7"），
    相对坐标只是几像素的小增量（"q-1 1-1.2 1"）。几何**一模一样**，只是换个写法；
    日历页那些缩略图也跟着一起瘦（它们就是这些 SVG）。
  */
  if (pts.length === 1) {
    const [x, y] = pts[0];
    return `M${n(x)} ${n(y)}l.1 0`;
  }
  if (pts.length === 2 || opts.smooth === false) {
    let d = `M${n(pts[0][0])} ${n(pts[0][1])}`;
    for (let i = 1; i < pts.length; i += 1) {
      d += `l${n(pts[i][0] - pts[i - 1][0])} ${n(pts[i][1] - pts[i - 1][1])}`;
    }
    return d;
  }
  const { start, curves } = strokeSegments(pts);
  let d = `M${n(start[0])} ${n(start[1])}`;
  let px = start[0];
  let py = start[1];
  for (const [cx, cy, x, y] of curves) {
    d += `q${n(cx - px)} ${n(cy - py)} ${n(x - px)} ${n(y - py)}`;
    px = x;
    py = y;
  }
  return d;
}

/**
 * 校验一根笔划（服务端和前端各用一份同样的规矩；⚠ 云函数那份是**抄过去的**，
 * 因为它单文件部署、没法 import 这个模块 —— 改这里记得去 tools/liyutang-backend/index.js 同步）。
 * @param {object} stroke 待检笔划
 * @param {{w?: number, h?: number}} [box] 画布尺寸
 * @returns {{ok: true, stroke: object}|{ok: false, why: string}} 结果
 */
export function checkStroke(stroke, box = {}) {
  const s = stroke && typeof stroke === 'object' ? stroke : {};
  const tool = TOOLS.includes(String(s.tool)) ? String(s.tool) : '';
  if (!tool) return { ok: false, why: '工具只能是 pen / eraser / erase' };
  const color = safeColor(s.color);
  if (!color) return { ok: false, why: '颜色要是 #rrggbb' };
  const size = Math.round(clamp(s.size, 1, 64) * 10) / 10;
  const points = cleanPoints(s.points, box);
  if (!points.length) return { ok: false, why: '这根笔划一个点都没有' };
  return { ok: true, stroke: { tool, color, size, points } };
}

/** SVG 里的文本要转义（笔划里只有颜色/数字，按说用不上，但别留口子） */
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/**
 * 一堆笔划 → 一张 SVG（存档和日历缩略图都用它）。
 *
 * 两种"擦"在存档里是两种写法（顺序天然被数组顺序保住，所以重放一遍就是当时的画面）：
 *   · `eraser`（老写法）：`stroke="#fbf6ee"`（画布的纸色）照原样画一遍 —— 谁都会被它盖住；
 *   · `erase`（像素橡皮，2026-10-10）：**一层 `<mask>`** —— 黑笔画过的地方被挖掉，
 *     和画布上 `destination-out` 是一个意思。
 *     ⚠ 方向别搞反（2026-10-10 在真浏览器里读像素逮住过一次）：它擦的是**已经画上去的**墨，
 *     所以要把**它之前**攒下来的内容整块包进这一层遮罩，而**不是**包它后面的内容 ——
 *     包后面的话，红线（在它之前画的）一点没少、而擦完又画的蓝线反倒被挖掉，正好反了。
 *     包法：`parts = [<g mask>…之前那一坨…</g>]`，之后再画的笔划照常加在这层**外面**；
 *     再往后的 erase 又把"到目前为止的所有东西"整个再包一层 —— 嵌套 = 顺序。
 * （画布纸色变了这里也要改；和 src/styles/forum.css 里 .lyt-draw__stage 的底色是同一个值。）
 * @param {Array<object>} strokes 笔划表（顺序 = 画上去的顺序）
 * @param {{w?: number, h?: number, background?: string}} [opts] 参数
 * @returns {string} SVG 文本
 */
export function strokesToSvg(strokes, opts = {}) {
  const w = opts.w ?? BOARD_W;
  const h = opts.h ?? BOARD_H;
  const bg = opts.background ?? '#fbf6ee';
  const masks = [];
  /** 到目前为止的内容（碰到一根 erase 就把这整个包进一层遮罩，见上面那段 ⚠） */
  let parts = [];
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || s.deleted) continue;
    const got = checkStroke(s, { w, h });
    if (!got.ok) continue;
    const d = strokePath(got.stroke.points);
    if (!d) continue;
    const size = esc(got.stroke.size);
    if (got.stroke.tool === 'erase') {
      /*
        像素橡皮：把它**之前**攒下来的内容整块包进一层遮罩（方向见文件头那段 ⚠）。
        maskUnits="userSpaceOnUse" 是关键：遮罩里的坐标就是画板坐标，
        默认的 objectBoundingBox 会按"被遮罩元素的外框"换算，白底矩形就对不上了。
        白底 = 全都能看见，黑笔 = 划过的这一条挖掉（黑的那条自己也用圆头圆角，和画布一致）。
      */
      if (!parts.length) continue; /* 前面什么都没有：这一擦没有对象，不留空壳 */
      const id = `lt-erase-${masks.length + 1}`;
      masks.push(
        `<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="${h}">` +
          `<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" />` +
          `<path d="${esc(d)}" fill="none" stroke="#000000" stroke-width="${size}" stroke-linecap="round" stroke-linejoin="round" />` +
          `</mask>`
      );
      parts = [`<g mask="url(#${id})">${parts.join('')}</g>`];
      continue;
    }
    const color = got.stroke.tool === 'eraser' ? bg : got.stroke.color;
    parts.push(
      /*
        data-by 用**昵称 alias**（后端 publicStroke 会发），没设过昵称时后端已经兜底等于用户名 ——
        这样"用户改了昵称，存档里的署名也跟着变"（2026-10-09 用户要求）。
        fill / stroke-linecap / stroke-linejoin 是**可继承**的，写到外层那个 <g> 上就够：
        一条笔划省 50 来个字节，一天一两千笔就是几十 KB（2026-10-10）。
      */
      `<path d="${esc(d)}" stroke="${esc(color)}" stroke-width="${size}" ` +
        `data-by="${esc(s.alias || s.nick || '')}" />`
    );
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
    `<rect width="${w}" height="${h}" fill="${esc(bg)}" />` +
    /* 笔划共用的表现属性放这一层（可继承）：fill / 圆头圆角，省掉每条 path 上的重复 */
    (parts.length ? `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${parts.join('')}</g>` : '') +
    /* 遮罩定义放最后（SVG 里引用在定义之前是允许的），免得一天几百笔的 path 被 defs 隔开 */
    (masks.length ? `<defs>${masks.join('')}</defs>` : '') +
    `</svg>`
  );
}

/**
 * 按人归一下笔划（"今天画过画的人"那张表，以及逐人显隐）。
 *
 * ⚠ 只算**画得出来**的笔划（先过一遍 checkStroke）：删掉的不算，
 * 颜色/工具不合法、一个点都没有的也不算 —— 否则表里会冒出一个人，
 * 而他的笔划在画布上根本不存在（那样"点他头像显隐"会毫无反应）。
 * @param {Array<object>} strokes 笔划表
 * @param {{w?: number, h?: number}} [box] 画布尺寸
 * @returns {Array<{key: string, nick: string, avatar: string, count: number}>} 人表（按笔划数倒序）
 */
export function paintersOf(strokes, box = {}) {
  const map = new Map();
  for (const s of Array.isArray(strokes) ? strokes : []) {
    if (!s || s.deleted) continue;
    if (!checkStroke(s, box).ok) continue;
    /*
      ⚠ 键的优先级是 **uk → userId → nick**，不是随便挑一个：
      页面拿到的笔划里带的是服务端发的 `uk`（账号 id 的短哈希），而渲染时"这个人的笔划要不要画"
      也是按 `uk` 判的（见 src/utils/liyutang-draw.ts 的 hidden 集合）。两边键不一样，
      点人头像就会**开关无效**——2026-10-09 的真浏览器验收就是拿"点一下之后那个像素还蓝着"
      逮住这个 bug 的。
    */
    const key = String(s.uk || s.userId || s.nick || '');
    if (!key) continue;
    /*
      显示名用**昵称 alias**（后端 publicStroke 里就是 `alias || nick`）——
      键仍旧按 uk 算：昵称随时能改，改完不该把"这个人"变成另一个人
      （不然他原来那些笔划会突然显不出来，人表里也会冒出两个他）。
    */
    const cur = map.get(key) ?? {
      key,
      nick: String(s.alias || s.nick || ''),
      avatar: String(s.avatar || ''),
      count: 0,
    };
    cur.count += 1;
    if (!cur.avatar && s.avatar) cur.avatar = String(s.avatar);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
