/*
 * ============================================================================
 * 久昭卿茶绘的「画板」—— 浏览器这一侧（2026-10-09 建；2026-10-10 加了重做/移动/取色/调色盘等）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「点进去以后是一个巨大的公共画板 有基本的画笔橡皮调色板等功能 所有注册后通过审核的用户
 *    都可以在上面画画 并且有一个折叠栏可以打开今天所有画过画的用户列表 点击其他用户头像可以
 *    开关是否显示由他们画的笔划 每天保存一次画 …… 最好参考一下网上比较成熟的在线画画网页
 *    让画画的手感可以比较舒服丝滑」
 *
 * 手感是这么堆出来的（每一条都别省）：
 *   ① 笔划是**矢量**的：一次按下→抬起 = 一根笔划（点集），不是"往位图上刷颜料"。
 *      所以逐人显隐、撤销、存档全是"筛一堆笔划再重画一遍"，谁也改不了别人的像素。
 *   ② 平滑走**中点二次贝塞尔**（几何在 src/utils/liyutang-strokes.mjs，和存档 SVG 共用一份）——
 *      直接把鼠标采样点连起来是一节一节的折线，走中点曲线才是笔画的样子。
 *   ③ **本地先画**：抬笔立刻出现在自己屏幕上（不等服务器来回），后台再把这一笔发上去；
 *      发失败才把它撤掉并说明原因。
 *   ④ **两层画布**：已经定下来的笔划画在一张离屏缓存上；正在画的那一笔每帧单独叠上去。
 *      ⚠ 缓存的重建（整块 2400×1500 重画）**只在"集合变了"的时候做**（显隐 / 撤销 / 换天 /
 *      别人的线条被拖动）；新笔划一律**增量画进缓存**（见 paintIntoCache），
 *      而且**自己正在画的时候不做远端轮询带来的重建**（推迟到抬笔之后）——
 *      2026-10-10 用户要求的就是这一条：「网络差的时候轮询整块重画会卡手」。
 *   ⑤ 采样按距离过滤（画板坐标里 1.2px 以内不留点）—— 又省体积又更像笔迹。
 *   ⑥ `requestAnimationFrame` 合帧：pointermove 的频率比屏幕刷新高，直接同步重画会白烧 CPU。
 *
 * 坐标：画板内部是固定 2400×1500（`BOARD_W/BOARD_H`），屏幕上按容器宽度等比缩放 ——
 * 所以不同屏幕看到的是同一块板，笔划坐标跟屏幕无关（存档也就不用管访问者的屏幕）。
 *
 * 坐标与视野（2026-10-09 晚上加的缩放/平移，别把它当装饰）：
 *   画板内部是固定 2400×1500；**画布的像素尺寸跟着"它显示多大 × DPR"走**，
 *   渲染时把"看得见的那一块画板"贴上去 —— 所以放大是**真的按更高分辨率重画**，不是把位图拉大。
 *   笔划缓存按画板坐标画、和缩放无关，于是滚轮缩放/拖动平移都不用重画缓存。
 *   最小缩放 = "整块板正好装下"（读数 1.0×），最大 4×；缩放钉住光标底下那一点。
 *   ⚠ 初版把最小缩放写成 1（1 画板像素 = 1 屏幕像素）—— 画布才一千来像素宽，
 *     于是"全览"只看得见左上角一块。这个错是被像素验收逮住的。
 *
 * 2026-10-10 这一轮加的东西（用户逐条要的，注释里写清取舍）：
 *   · **重做**：撤销在服务端是**软删**（LT_DRAW_DELETE），原始那一条回不来了，
 *     所以"取消撤回"只能是**照原样再画一笔新的**（工具/颜色/粗细/点集一模一样，id 会变）。
 *     取舍写在 doRedo() 里：观感完全一样，但它不是"原来那一条"。
 *   · **移动工具**：单独拖一根线条（命中测试按笔划粗细给阈值），拖动时本地实时预览，
 *     松手才发**一次** LT_DRAW_MOVE；只能挪自己画的（后端也拒别人的）。
 *   · **取色工具**：读**渲染出来的画布像素**（不是笔划数据），所以取到的是"你眼睛看到的那一块"。
 *   · **调色盘**：内置色 + 用户收藏（跟着账号走，存在账号的 prefs 里，换设备也在）。
 *   · **画笔/橡皮各自一个粗细** + 数字直接输入；连调色盘一起存进 LT_PREFS_SET。
 *   · **电脑端画线时页面乱滚**：真原因在 wheel 那里（见那段注释），修完之后
 *     画布上的滚轮**一律**归画板，页面不会在笔画中途被滚动。
 *   · 指针事件的 move/up **挂在 window 上**（不是只挂 canvas）：pointer capture 万一没设上、
 *     被浏览器收走、或者某一笔拖到画布外面松手，笔划照样跟手、照样提交。
 *     老版本靠 canvas 上的 pointerup 收尾 —— capture 一失效，那一笔直接**丢掉**（验收里量过）。
 *
 * ⚠ 这里**不做**的事（想加的时候先想清楚）：压感（协议是一笔一个粗细）、
 *   旋转、图层、清除整块板（一天一块板，存档之后再清 —— 见存档脚本）。
 * ============================================================================
 */
import { call, formatTime, getToken } from './liyutang-client';
import { BOARD_H, BOARD_W, MAX_POINTS, paintersOf, strokeSegments } from './liyutang-strokes.mjs';

/** 画布纸色 —— 和存档 SVG、forum.css 里 .lyt-draw__stage 的底色必须是同一个值 */
export const PAPER = '#fbf6ee';

/** 调色板：一眼能看懂的落日色（第一个是默认） */
export const PALETTE = ['#1d1430', '#ff4d6d', '#ff9f1c', '#ffd166', '#8ac926', '#2ec4b6', '#3a86ff', '#b5179e'];

/** 橡皮在协议里也带一个颜色（服务端要求 #rrggbb），就发纸色 —— 和存档 SVG 的画法一致 */
const ERASER_COLOR = PAPER;

/** 一个账号最多往调色盘里收藏多少个颜色（和服务端 checkPrefs 的上限一致，超了服务端会砍） */
export const MAX_SAVED = 24;

/** 粗细的范围（和服务端夹的 1~64 对齐，两边不一致的话会"我明明设了 70 怎么变了 64"） */
const SIZE_MIN = 1;
const SIZE_MAX = 64;

/** 画笔默认粗细 */
const PEN_SIZE_DEFAULT = 6;
/** 橡皮默认粗细 —— 比画笔粗一截：橡皮是"擦一块"，不是"描一条" */
const ERASER_SIZE_DEFAULT = 20;

/** 移动的命中阈值 = 笔划半宽 + 这么多个**画板像素**（手没那么准，光按线宽点不中） */
const HIT_SLACK = 8;

export interface LtStroke {
  id: string;
  uk: string;
  /** 用户名（登录用，不拿来显示） */
  nick: string;
  /** 昵称：显示用的就是它（后端 publicStroke 里 `alias || nick`）；老数据可能没有这个字段 */
  alias?: string;
  avatar: string;
  tool: string;
  color: string;
  size: number;
  points: number[][];
  createdAt: number;
  /** 增量同步的游标（服务端按它算 after）—— 线条被拖动过之后它也变 */
  updatedAt?: number;
  mine: boolean;
}

/** 一根"要画上去的笔划"（还没进服务端，或者要重做的一根） */
interface Drawn {
  tool: string;
  color: string;
  size: number;
  points: number[][];
}

/** 账号里存的那份画板偏好（形状见云函数 checkPrefs） */
export interface LtPrefs {
  palette?: string[];
  penSize?: number;
  eraserSize?: number;
  color?: string;
  tool?: string;
}

export interface BoardOpts {
  api: string;
  canvas: HTMLCanvasElement;
  /** 「今天画过画的人」那张表的容器 */
  faces: HTMLElement;
  /** 状态行（连上了没 / 今天多少笔 / 出错原因） */
  status?: HTMLElement;
  pen?: HTMLButtonElement;
  eraser?: HTMLButtonElement;
  /** 「抓手」：整块板拖着看（也可以按住空格、或者用鼠标中键） */
  pan?: HTMLButtonElement;
  /** 「移动」：单独拖一根线条（只能挪自己画的） */
  move?: HTMLButtonElement;
  /** 「取色」：点画布取那一点渲染出来的颜色 */
  pick?: HTMLButtonElement;
  /** 「全览」：缩放回 1×、回到左上角 */
  reset?: HTMLButtonElement;
  swatches?: HTMLElement;
  colorInput?: HTMLInputElement;
  /** 「＋ 收进调色盘」：把当前颜色存进账号的调色盘 */
  colorAdd?: HTMLButtonElement;
  /** 粗细（滑块） */
  sizeInput?: HTMLInputElement;
  /** 粗细（数字输入，能精确回到 12 这种值） */
  sizeNumber?: HTMLInputElement;
  undo?: HTMLButtonElement;
  redo?: HTMLButtonElement;
  /**
   * 账号里那份画板偏好（调色盘收藏 + 画笔/橡皮各自的粗细）。
   * 页面手上的 user 对象里就有；引擎另外还会问一次 LT_ME 兜底（那份可能是缓存里的旧值）。
   */
  prefs?: unknown;
  /** 缩放变了就叫一声（页面拿它显示"1.0×"这种读数） */
  onView?: (scale: number) => void;
  /** 每几秒问一次别人画了什么 */
  pollMs?: number;
}

export interface BoardHandle {
  refresh(): Promise<void>;
  redraw(): void;
  stop(): void;
}

/**
 * 把画板挂起来：能画、能擦、能调色、能撤、能重做、能挪线条、能取色、能看别人画的、能按人显隐。
 * @param opts 配置
 * @returns 句柄
 */
export function mountBoard(opts: BoardOpts): BoardHandle {
  const { api, canvas, faces, status } = opts;
  const pollMs = opts.pollMs ?? 3000;
  const ctx = canvas.getContext('2d');
  /** 离屏缓存：已经定下来的笔划画在这上面，只有集合变了才重画 */
  const cache = document.createElement('canvas');
  cache.width = BOARD_W;
  cache.height = BOARD_H;
  const cctx = cache.getContext('2d');

  /*
    这一趟挂上去的所有监听都挂在这个 controller 上（stop() 一 abort 就全摘掉）。
    为什么要这个：页面在账号状态来回变的时候会 stop() 再 mountBoard()，
    而老版本的 stop() 只停了轮询 —— 上一份引擎还挂在画布上，于是**画一笔会提交两次**
    （2026-10-10 顺着"重做/移动"改这一块时发现的，别再退回去）。
  */
  const ac = new AbortController();
  const on = <T extends EventTarget>(target: T, type: string, fn: EventListener, add: AddEventListenerOptions = {}) =>
    target.addEventListener(type, fn, { ...add, signal: ac.signal });

  /*
    视野（缩放 + 平移）—— 2026-10-09 晚上加的。
    为什么要它：画板是 2400×1500 的固定坐标系，一屏看全时一支"6 号笔"落到屏幕上只有两三个像素，
    想画细一点非常难受。所以：
      · **画布的内部像素尺寸跟着"它显示多大"走**（CSS 尺寸 × devicePixelRatio），
        而不是固定 2400×1500 —— 这样放大是真的按更高分辨率重画，不是把位图拉大（后者会糊）；
      · 笔划缓存仍然按**画板坐标**（2400×1500）画、和缩放无关，所以缩放/平移不用重画缓存，
        只是把缓存里"当前看得见的那一块"贴到画布上；
      · `view.x / view.y` = 画布左上角对应画板上的哪一点（画板坐标）。
  */
  const dpr = () => Math.min(3, Math.max(1, window.devicePixelRatio || 1));
  const view = { scale: 1, x: 0, y: 0 };

  /**
   * 「全览」的缩放：让整块板正好放进画布。
   *
   * ⚠ 这里踩过一个坑（2026-10-09 晚上，退出验收时被像素逮住的）：
   * 一开始把最小缩放写成 1，意思是"1 画板像素 = 1 屏幕像素" —— 可画布只有一千来像素宽，
   * 于是 1× 时**只看得见左上角一块**，用户一进来（和点「全览」之后）看到的是一张残缺的板。
   * 正确的最小缩放是"装得下整块板"；读数也按**相对全览**的倍数显示（全览 = 1.0×）。
   */
  const fitScale = () => {
    const rect = canvas.getBoundingClientRect();
    return Math.max(0.05, rect.width / BOARD_W);
  };
  const maxScale = () => fitScale() * 4;
  /** 读数：1.0× = 全览 */
  const zoomText = () => view.scale / fitScale();

  /** 画布的像素尺寸 = 它显示的大小 × DPR（清晰不清晰就看这一步） */
  const fitCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr()));
    const h = Math.max(1, Math.round(rect.height * dpr()));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };

  /** 视野夹在画板里（不让人把板子拖到屏幕外，也不让边角露出空白） */
  const clampView = () => {
    const rect = canvas.getBoundingClientRect();
    const vw = Math.max(1, rect.width) / view.scale;
    const vh = Math.max(1, rect.height) / view.scale;
    view.x = Math.min(Math.max(0, view.x), Math.max(0, BOARD_W - vw));
    view.y = Math.min(Math.max(0, view.y), Math.max(0, BOARD_H - vh));
  };

  /** 画板坐标 → 画布上的设备像素（读像素 / 调试用） */
  const boardToDevice = (x: number, y: number): number[] => [
    Math.round((x - view.x) * view.scale * dpr()),
    Math.round((y - view.y) * view.scale * dpr()),
  ];

  let strokes: LtStroke[] = [];
  /** 被"点灭了"的人（uk）：他们的笔划不画 */
  const hidden = new Set<string>();
  let cursor = 0;
  let stop = false;
  let raf = 0;
  let cacheDirty = true;
  /** 正在画的那一笔（还没抬笔） */
  let live: { tool: string; color: string; size: number; points: number[][] } | null = null;

  let tool = 'pen';
  let color = PALETTE[0];
  /** 画笔的粗细 */
  let penSize = PEN_SIZE_DEFAULT;
  /** 橡皮的粗细（和画笔**分开记** —— 用户要的就是"切到橡皮用橡皮那个粗细"） */
  let eraserSize = ERASER_SIZE_DEFAULT;
  /** 用户自己收藏进调色盘的颜色（跟着账号走，最多 MAX_SAVED 个） */
  let saved: string[] = [];
  /**
   * 「取消撤回」的栈：每一项是"被撤掉的那一笔的样子"（工具/颜色/粗细/点集）。
   * 服务端是软删，原来的 id 已经回不来，所以重做 = 照这个样子**再画一笔新的**（见 doRedo）。
   */
  let redoStack: Drawn[] = [];

  /** 正在拖的那一根线条（本地实时预览，松手才发一次 LT_DRAW_MOVE） */
  let moving: { id: string; base: number[][]; dx: number; dy: number; moved: boolean; tool: string; color: string; size: number } | null = null;

  /**
   * 这一趟网络活儿"被推迟过" —— 画的过程中轮询先不干活（见 refresh）。
   * 抬笔之后照这个记号补一次，不然别人的新笔划要等到下一个轮询周期才出现。
   */
  let deferredRefresh = false;

  /** 量给验收看的（也用来说明"到底有没有整块重建"） */
  const stats = { rebuilds: 0, incremental: 0, deferred: 0, lastRebuildMs: 0, rebuildMs: 0 };

  const say = (text: string, ok = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-ok', ok);
  };

  const clampSize = (v: unknown) => Math.min(SIZE_MAX, Math.max(SIZE_MIN, Math.round(Number(v) || PEN_SIZE_DEFAULT)));
  /** 当前工具该用哪个粗细（只有画笔/橡皮吃这个值） */
  const sizeOf = (t = tool) => (t === 'eraser' ? eraserSize : penSize);

  /** 一根笔划的"形"是不是一样（用来判断"服务端回来的这条要不要重画"） */
  const sameShape = (a: LtStroke, b: Partial<LtStroke>) =>
    String(a.tool) === String(b.tool) &&
    String(a.color) === String(b.color) &&
    Number(a.size) === Number(b.size) &&
    JSON.stringify(a.points) === JSON.stringify(b.points);

  /* ------------------------------------------------------------ 画 */

  /** 把一根笔划描到某个 2d 上下文上 */
  const paintStroke = (c: CanvasRenderingContext2D, s: { tool: string; color: string; size: number; points: number[][] }) => {
    const pts = s.points;
    if (!pts.length) return;
    c.save();
    c.lineCap = 'round';
    c.lineJoin = 'round';
    c.lineWidth = s.size;
    c.strokeStyle = s.tool === 'eraser' ? PAPER : s.color;
    c.beginPath();
    if (pts.length === 1) {
      /* 点一下：一个极短的线段（和存档 SVG 里那根 0.1 一致） */
      const [x, y] = pts[0];
      c.moveTo(x, y);
      c.lineTo(x + 0.1, y);
    } else {
      const { start, curves } = strokeSegments(pts, { smooth: pts.length > 2 });
      c.moveTo(start[0], start[1]);
      let px = start[0];
      let py = start[1];
      for (const [cx, cy, x, y] of curves) {
        if (cx === px && cy === py) c.lineTo(x, y);
        else c.quadraticCurveTo(cx, cy, x, y);
        px = x;
        py = y;
      }
    }
    c.stroke();
    c.restore();
  };

  /**
   * **增量**把一根新笔划画进缓存（不整块重建）。
   * 这正是"网络差时不卡手"的关键：远端轮询拿到的新笔划只多描一条线，
   * 而不是把 2400×1500 上已有的几百笔全部重描一遍。
   * 前提是"它比现有最新的那笔还新"（z 序才不会被搅乱）——不满足的话调用方走全量重建。
   */
  const paintIntoCache = (s: LtStroke) => {
    if (!cctx || hidden.has(s.uk)) return;
    paintStroke(cctx, s);
    stats.incremental += 1;
  };

  /** 整块重建缓存（只在"集合变了"的时候做：显隐 / 撤销 / 挪动 / 换天） */
  const rebuildCache = () => {
    if (!cctx) return;
    const t0 = performance.now();
    cctx.setTransform(1, 0, 0, 1, 0, 0);
    cctx.fillStyle = PAPER;
    cctx.fillRect(0, 0, BOARD_W, BOARD_H);
    for (const s of strokes) {
      if (hidden.has(s.uk)) continue;
      /* 正在拖的那一根从缓存里摘出去：它每帧以"平移后的样子"单独叠在最上面 */
      if (moving && moving.id === s.id) continue;
      paintStroke(cctx, s);
    }
    stats.rebuilds += 1;
    stats.lastRebuildMs = performance.now() - t0;
    stats.rebuildMs += stats.lastRebuildMs;
    cacheDirty = false;
  };

  /** 平移后的点（和云函数 LT_DRAW_MOVE 一样：整条挪、再逐点夹回画板） */
  const movedPoints = (base: number[][], dx: number, dy: number) =>
    base.map(([x, y]) => [
      Math.round(Math.min(BOARD_W, Math.max(0, x + dx)) * 10) / 10,
      Math.round(Math.min(BOARD_H, Math.max(0, y + dy)) * 10) / 10,
    ]);

  const redraw = () => {
    if (!ctx || !cctx) return;
    /* 画布内部尺寸跟着它显示多大走（缩放清晰的关键） */
    fitCanvas();
    if (cacheDirty) rebuildCache();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    /*
      把缓存里"当前看得见的那一块画板"贴到画布上：
      九参数 drawImage（源矩形 = 视野在画板上的范围）比先 setTransform 再整张贴更省一次重采样。
    */
    const k = view.scale * dpr();
    const sw = canvas.width / k;
    const sh = canvas.height / k;
    ctx.drawImage(cache, view.x, view.y, sw, sh, 0, 0, canvas.width, canvas.height);
    /* 正在拖的那一根：以平移后的点、按画板坐标描上去（本地实时预览） */
    if (moving) {
      ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
      paintStroke(ctx, { tool: moving.tool, color: moving.color, size: moving.size, points: movedPoints(moving.base, moving.dx, moving.dy) });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
    if (live) {
      /* 正在画的那一笔用**画板坐标**描，所以把变换设成"画板 → 画布" */
      ctx.setTransform(k, 0, 0, k, -view.x * k, -view.y * k);
      paintStroke(ctx, live);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }
  };

  const schedule = () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      redraw();
    });
  };

  /* ------------------------------------------------------------ 人表 */

  const paintFaces = () => {
    if (!faces) return;
    const list = paintersOf(strokes);
    faces.textContent = '';
    if (!list.length) {
      faces.append(Object.assign(document.createElement('p'), { className: 'lyt-form__hint', textContent: '还没有人动笔 —— 你可以先画两笔。' }));
      return;
    }
    for (const p of list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lyt-draw__face' + (hidden.has(p.key) ? ' is-off' : '');
      b.title = hidden.has(p.key) ? `显示 ${p.nick} 画的` : `先不看 ${p.nick} 画的`;
      const face = document.createElement('span');
      face.className = 'lt-avatar';
      face.setAttribute('aria-hidden', 'true');
      if (p.avatar) {
        const img = document.createElement('img');
        img.className = 'lt-avatar__img';
        img.src = p.avatar;
        img.alt = '';
        face.append(img);
      } else {
        face.textContent = (p.nick || '?').slice(0, 1).toUpperCase();
      }
      b.append(face, document.createTextNode(`${p.nick} · ${p.count} 笔`));
      b.addEventListener('click', () => {
        if (hidden.has(p.key)) hidden.delete(p.key);
        else hidden.add(p.key);
        /* 显隐是"集合变了"：必须整块重建（增量画没法把某个人的笔划从缓存里抠掉） */
        cacheDirty = true;
        paintFaces();
        schedule();
      });
      faces.append(b);
    }
  };

  /* ------------------------------------------------------------ 收发 */

  /**
   * 把服务端拉来的笔划并进本地。
   *
   * 两条路，别混：
   *   · **没见过的 id** → 增量画进缓存（只多描一条线）；
   *   · **见过的 id 但内容变了**（别人拖动了他自己那根）→ 必须整块重建 ——
   *     因为"改一根已有的线"等于"先把旧的从缓存里擦掉"，而缓存上没法只擦一根
   *     （会连带擦掉压在它下面的别人）。这种是少数情况，重建一次可以接受。
   */
  const absorb = (list: LtStroke[]) => {
    let added = 0;
    let needFull = false;
    const newest = strokes.reduce((m, s) => Math.max(m, Number(s.createdAt) || 0), 0);
    for (const s of list) {
      if (!s || !s.id) continue;
      const i = strokes.findIndex((x) => x.id === s.id);
      if (i >= 0) {
        if (!sameShape(strokes[i], s)) {
          strokes[i] = s;
          needFull = true;
        }
        continue;
      }
      strokes.push(s);
      added += 1;
      /* 只有"比现有最新那笔还新"的才能增量叠上去，否则 z 序会和别人看到的不一样 */
      if ((Number(s.createdAt) || 0) < newest) needFull = true;
      else paintIntoCache(s);
    }
    if (added) {
      strokes.sort((a, b) => a.createdAt - b.createdAt);
      paintFaces();
    }
    if (needFull) cacheDirty = true;
    if (added || needFull) schedule();
    return added;
  };

  const refresh = async () => {
    /*
      ⚠ 正在画 / 正在拖的时候**不做远端这一趟**（2026-10-10 用户要求）：
      拉回来的新笔划要重画缓存 —— 老版本一律整块重建，网络一抖就正好卡在笔尖上。
      记个记号，抬手（finish）之后补一次，笔划一条都不会少。
    */
    if (drawing || moving) {
      stats.deferred += 1;
      deferredRefresh = true;
      return;
    }
    const body: Record<string, unknown> = { event: 'LT_DRAW_LIST', ltToken: getToken() };
    if (cursor) body.after = cursor;
    let r: Record<string, any>;
    try {
      r = await call(api, body);
    } catch (err) {
      say('连不上服务器：' + String((err as Error)?.message ?? err));
      return;
    }
    if (r.code !== 0) {
      say(
        /站长密码/.test(String(r.message ?? ''))
          ? '画板还没开 —— 云函数那份代码要重新粘一次（见 tools/liyutang-backend/README.md）。'
          : String(r.message ?? '读不到画')
      );
      return;
    }
    const got = (r.strokes ?? []) as LtStroke[];
    absorb(got);
    /*
      游标按 **updatedAt** 算（不是 createdAt）：别人拖动过的线条 updatedAt 会变新，
      按 createdAt 算的话它就永远拉不到了（云函数那边也是按 updatedAt 过滤的）。
    */
    if (got.length) cursor = Math.max(cursor, ...got.map((s) => Number(s.updatedAt ?? s.createdAt) || 0));
    /* 这一趟拉满了：立刻再要一趟（一小时的画可能上千笔，一趟拉不完） */
    if (r.more) void refresh();
    say(`今天这块板上已经有 ${strokes.filter((s) => !hidden.has(s.uk)).length} 笔（你自己看到的）`, true);
  };

  /** 抬笔之后把这一笔送上去；失败就把它从本地撤掉，别让人以为画上去了 */
  const commit = async (s: Drawn, okWord = ''): Promise<boolean> => {
    const temp: LtStroke = {
      id: 'local-' + Date.now().toString(36),
      uk: '__me__',
      nick: '你',
      avatar: '',
      tool: s.tool,
      color: s.color,
      size: s.size,
      points: s.points,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mine: true,
    };
    strokes.push(temp);
    /* ★ 增量：只把这一根描进缓存，不整块重建（抬笔这一下最不能卡） */
    paintIntoCache(temp);
    paintFaces();
    schedule();
    try {
      const r = await call(api, { event: 'LT_DRAW_ADD', ltToken: getToken(), ...s });
      if (r.code !== 0) throw new Error(String(r.message ?? '这一笔没送上去'));
      /* 用服务端给的那条替掉本地临时那条（id / uk / 时间都以服务端为准） */
      const got = r.stroke as LtStroke;
      const i = strokes.findIndex((x) => x.id === temp.id);
      if (i >= 0 && got) {
        /* 服务端会把坐标再夹一遍：真的被改过才需要重画（这里退回整块重建，但那是抬笔之后的事） */
        if (!sameShape(temp, got)) cacheDirty = true;
        strokes[i] = got;
      }
      /* 轮询有可能抢先把服务端那一份拉回来了（id 和临时 id 不一样）—— 去重 */
      const dup = strokes.findIndex((x, k) => k !== i && x.id === (got?.id ?? ''));
      if (dup >= 0) {
        strokes.splice(dup, 1);
        cacheDirty = true;
      }
      cursor = Math.max(cursor, Number(got?.updatedAt ?? got?.createdAt) || temp.updatedAt || temp.createdAt);
      paintFaces();
      schedule();
      if (okWord) say(okWord, true);
      return true;
    } catch (err) {
      strokes = strokes.filter((x) => x.id !== temp.id);
      /* 少了一根 = 集合变了：只能整块重建（缓存上没有"擦掉一根"的办法） */
      cacheDirty = true;
      paintFaces();
      schedule();
      say('这一笔没画上：' + String((err as Error)?.message ?? err));
      return false;
    }
  };

  /* ------------------------------------------------------------ 偏好（跟着账号走） */

  /**
   * 把账号里那份偏好装进来。
   * ⚠ 一边读一边校验：服务端虽然会夹，但页面手上这份可能是缓存里的旧值/别人的手改值，
   * 让非法值进到画笔里（比如 size = NaN）会画出一堆看不见的线。
   */
  const applyPrefs = (raw: unknown) => {
    const p = (raw && typeof raw === 'object' ? raw : {}) as LtPrefs;
    if (Array.isArray(p.palette)) {
      const out: string[] = [];
      for (const c of p.palette) {
        const v = String(c ?? '').trim().toLowerCase();
        if (!/^#[0-9a-f]{6}$/.test(v) || out.includes(v)) continue;
        out.push(v);
        if (out.length >= MAX_SAVED) break;
      }
      saved = out;
    }
    if (Number.isFinite(Number(p.penSize))) penSize = clampSize(p.penSize);
    if (Number.isFinite(Number(p.eraserSize))) eraserSize = clampSize(p.eraserSize);
    if (/^#[0-9a-f]{6}$/i.test(String(p.color ?? ''))) color = String(p.color).toLowerCase();
    if (p.tool === 'pen' || p.tool === 'eraser' || p.tool === 'pan') tool = p.tool;
  };

  /** 把偏好存回账号（拖动粗细会连发很多次 input，所以攒一下再发） */
  let prefsTimer = 0;
  const savePrefs = (soon = 450) => {
    window.clearTimeout(prefsTimer);
    prefsTimer = window.setTimeout(() => {
      void (async () => {
        const prefs = {
          palette: [...saved],
          penSize,
          eraserSize,
          color,
          /* 服务端只认 pen / eraser / pan：移动和取色是纯本地工具，存的时候归到画笔 */
          tool: tool === 'move' || tool === 'pick' ? 'pen' : tool,
        };
        try {
          const r = await call(api, { event: 'LT_PREFS_SET', ltToken: getToken(), prefs });
          if (r.code !== 0) say('偏好没存上：' + String(r.message ?? ''));
        } catch (err) {
          say('偏好没存上：' + String((err as Error)?.message ?? err));
        }
      })();
    }, soon);
  };

  /* ------------------------------------------------------------ 工具条 */

  /** 内置色 + 收藏色（去重，顺序：先内置后收藏） */
  const paletteColors = () => {
    const out: string[] = [];
    for (const c of PALETTE) out.push(c.toLowerCase());
    for (const c of saved) if (!out.includes(c)) out.push(c);
    return out;
  };

  /** 重画调色盘（收藏变了才需要重建 DOM；选中态由 paintBar 负责） */
  const paintSwatches = () => {
    const box = opts.swatches;
    if (!box) return;
    const own = new Set(saved);
    box.textContent = '';
    for (const c of paletteColors()) {
      const chip = document.createElement('span');
      chip.className = 'lyt-draw__chip';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lyt-draw__swatch';
      b.dataset.color = c;
      if (own.has(c)) b.dataset.saved = '1';
      b.style.background = c;
      b.title = own.has(c) ? `${c}（你收藏的）` : c;
      b.addEventListener('click', () => {
        color = c;
        tool = 'pen';
        paintBar();
        savePrefs();
      });
      chip.append(b);
      if (own.has(c)) {
        /* 只有**自己收藏的**才给删；内置色删不掉（删了下次还得回来） */
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'lyt-draw__swatch-del';
        del.textContent = '×';
        del.title = `把 ${c} 从调色盘里删掉`;
        del.setAttribute('aria-label', `把 ${c} 从调色盘里删掉`);
        del.addEventListener('click', (ev) => {
          ev.stopPropagation();
          saved = saved.filter((x) => x !== c);
          paintSwatches();
          paintBar();
          savePrefs(0);
          say(`把 ${c} 从调色盘里删掉了。`, true);
        });
        chip.append(del);
      }
      box.append(chip);
    }
  };

  /** 工具条上的选中态 / 颜色 / 粗细数字 / 重做能不能点 */
  const paintBar = () => {
    opts.pen?.classList.toggle('is-on', tool === 'pen');
    opts.eraser?.classList.toggle('is-on', tool === 'eraser');
    opts.pan?.classList.toggle('is-on', tool === 'pan');
    opts.move?.classList.toggle('is-on', tool === 'move');
    opts.pick?.classList.toggle('is-on', tool === 'pick');
    if (opts.colorInput && /^#[0-9a-f]{6}$/i.test(color)) opts.colorInput.value = color;
    for (const b of opts.swatches?.querySelectorAll<HTMLElement>('[data-color]') ?? []) {
      b.classList.toggle('is-on', String(b.dataset.color).toLowerCase() === color.toLowerCase());
    }
    /* 粗细：滑块和数字两个控件都显示**当前工具**那个值（画笔 30 / 橡皮 8 各存各的） */
    const now = sizeOf();
    if (opts.sizeInput && opts.sizeInput.value !== String(now)) opts.sizeInput.value = String(now);
    if (opts.sizeNumber) {
      /* 正在这个框里打字的时候别去覆盖人家（不然"30"打到一半被改掉） */
      if (document.activeElement !== opts.sizeNumber && opts.sizeNumber.value !== String(now)) opts.sizeNumber.value = String(now);
      opts.sizeNumber.max = String(SIZE_MAX);
      opts.sizeNumber.min = String(SIZE_MIN);
    }
    if (opts.redo) opts.redo.disabled = !redoStack.length;
  };

  /** 切工具（画笔/橡皮各自带着自己的粗细） */
  const useTool = (t: string) => {
    tool = t;
    paintBar();
    savePrefs();
  };

  /* ⚠ 工具条这些监听也挂在 abort 上：stop() 之后它们不该再响应（不然新旧两份引擎会各干一遍） */
  if (opts.pen) on(opts.pen, 'click', () => useTool('pen'));
  if (opts.eraser) on(opts.eraser, 'click', () => useTool('eraser'));
  /* 「抓手」：整块板拖来拖去（也可以按住空格临时当抓手、或者用鼠标中键） */
  if (opts.pan) on(opts.pan, 'click', () => useTool('pan'));
  if (opts.move) {
    on(opts.move, 'click', () => {
      useTool('move');
      say('「移动」：按住一根**自己画的**线条拖走（松手才发出去）。');
    });
  }
  if (opts.pick) {
    on(opts.pick, 'click', () => {
      useTool('pick');
      say('「取色」：点画布上任意一点，取那一点**渲染出来的**颜色当画笔。');
    });
  }
  /*
    ⚠ 接线这里有个坑（2026-10-10 被真浏览器验收逮住，画板对过审用户整个不工作）：
    这一段排在文件**前面**，而 resetView / finish / doUndo… 都是后面才 `const` 声明的。
    直接把函数名交给 addEventListener，等于**当场就要求它已经初始化** → 
    `ReferenceError: Cannot access 'resetView' before initialization`，mountBoard 半路断掉
    （画布、工具条、人表一个都没挂上，window.__ltBoard 也不存在）。
    所以规矩是：**回调一律包一层箭头函数**（箭头体要等到事件真的发生才求值，那时早就初始化好了）。
  */
  if (opts.reset) on(opts.reset, 'click', () => resetView());

  /** 改粗细：只动当前工具那一份（画笔的改动不该把橡皮也跟着改了） */
  const setSize = (v: unknown, save = true) => {
    const n = clampSize(v);
    if (tool === 'eraser') eraserSize = n;
    else penSize = n;
    paintBar();
    if (save) savePrefs();
  };
  if (opts.sizeInput) on(opts.sizeInput, 'input', () => setSize(opts.sizeInput?.value));
  if (opts.sizeNumber) {
    on(opts.sizeNumber, 'input', () => {
      /* 空着的时候别急着夹成 1（人家在删掉重打） */
      if (String(opts.sizeNumber?.value ?? '').trim() === '') return;
      setSize(opts.sizeNumber?.value);
    });
    on(opts.sizeNumber, 'change', () => paintBar());
  }

  if (opts.colorInput) {
    on(opts.colorInput, 'input', () => {
      const v = String(opts.colorInput?.value ?? '').toLowerCase();
      if (/^#[0-9a-f]{6}$/.test(v)) {
        color = v;
        tool = 'pen';
        paintBar();
        savePrefs();
      }
    });
  }

  /** 「＋ 收进调色盘」：把当前颜色存进账号（换设备也在） */
  if (opts.colorAdd) {
    on(opts.colorAdd, 'click', () => {
      const c = String(color).toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(c)) {
        say('当前颜色不是 #rrggbb，收不了。');
        return;
      }
      if (saved.includes(c)) {
        say(`${c} 已经在你的调色盘里了。`);
        return;
      }
      if (saved.length >= MAX_SAVED) {
        say(`收藏最多 ${MAX_SAVED} 个 —— 先删掉一个再加。`);
        return;
      }
      saved = [...saved, c];
      paintSwatches();
      paintBar();
      savePrefs(0);
      say(`把 ${c} 收进调色盘了（跟着账号走，换设备也在）。`, true);
    });
  }

  /**
   * 撤销：删自己最后画的那一笔（服务端只认你的），并把它的"样子"推进重做栈。
   */
  const doUndo = async () => {
    const mine = [...strokes].reverse().find((s) => s.mine && !String(s.id).startsWith('local-'));
    if (!mine) {
      say('没有可以撤的（你还没画，或者都撤完了）。');
      return;
    }
    try {
      const r = await call(api, { event: 'LT_DRAW_DELETE', ltToken: getToken(), id: mine.id });
      if (r.code !== 0) throw new Error(String(r.message ?? '撤不掉'));
      strokes = strokes.filter((s) => s.id !== mine.id);
      redoStack.push({ tool: mine.tool, color: mine.color, size: mine.size, points: mine.points.map(([x, y]) => [x, y]) });
      if (redoStack.length > 50) redoStack.shift();
      /* 少了一根 = 集合变了：整块重建 */
      cacheDirty = true;
      paintFaces();
      paintBar();
      schedule();
      say('撤回了一笔 —— 想反悔就点「重做」。', true);
    } catch (err) {
      say('撤不掉：' + String((err as Error)?.message ?? err));
    }
  };

  /**
   * 重做（"取消撤回"）。
   *
   * ⚠ 取舍写在明处：撤回在服务端是**软删**（`deleted: true`），原来那一条回不来了 ——
   * 所以重做只能"**用同样的工具/颜色/粗细/点集重新画一笔新的**"：
   * 观感一模一样，但 **id 会变**（它是一根新笔划），而且会排在最上面（paint 顺序按 createdAt）。
   * 想要"真的恢复原来那条"，后端就得给 undelete —— 那不在这次的契约里。
   * 好处是 undo / redo 可以**反复来回**：重做出来的那根又是一根正常的"我的笔划"，
   * 再撤还是删它。
   */
  const doRedo = async () => {
    const back = redoStack.pop();
    paintBar();
    if (!back) {
      say('没有可重做的（你还没撤过，或者已经重做完了）。');
      return;
    }
    const ok = await commit(back, '重做了一笔（照原样重新画的一笔，id 是新的）。');
    /* 没成功就放回去，别把用户那笔弄丢了 */
    if (!ok) redoStack.push(back);
    paintBar();
  };

  if (opts.undo) on(opts.undo, 'click', () => void doUndo());
  if (opts.redo) on(opts.redo, 'click', () => void doRedo());
  /* ------------------------------------------------------------ 输入 */

  /** 屏幕坐标 → 画板坐标（要过视野：缩放 + 平移） */
  const toBoard = (e: PointerEvent): number[] => {
    const rect = canvas.getBoundingClientRect();
    const x = view.x + (e.clientX - rect.left) / view.scale;
    const y = view.y + (e.clientY - rect.top) / view.scale;
    return [Math.round(Math.min(BOARD_W, Math.max(0, x)) * 10) / 10, Math.round(Math.min(BOARD_H, Math.max(0, y)) * 10) / 10];
  };

  /** 点到线段的距离（命中测试用） */
  const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const len = dx * dx + dy * dy;
    if (!len) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * dx + (py - ay) * dy) / len;
    t = Math.min(1, Math.max(0, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  };

  /**
   * 命中测试：谁在这附近？从**最上面**那根开始找（后来画的压在上面，抓的该是它）。
   * 阈值 = 笔划半宽 + HIT_SLACK —— 一条 6 号的线只有 3 个画板像素宽，
   * 光按线宽点，用户得"像素级"瞄准，根本抓不住。
   */
  const hitTest = (x: number, y: number): LtStroke | null => {
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const s = strokes[i];
      if (hidden.has(s.uk)) continue;
      const pts = s.points;
      if (!pts || !pts.length) continue;
      const r = Number(s.size) / 2 + HIT_SLACK;
      if (pts.length === 1) {
        if (Math.hypot(pts[0][0] - x, pts[0][1] - y) <= r) return s;
        continue;
      }
      for (let j = 1; j < pts.length; j += 1) {
        if (distToSeg(x, y, pts[j - 1][0], pts[j - 1][1], pts[j][0], pts[j][1]) <= r) return s;
      }
    }
    return null;
  };

  /**
   * 读画布上某一点**渲染出来的**颜色（取色器用）。
   * 3×3 取众数：一条 6 号笔在"全览"下只有两三个设备像素宽，
   * 直接读最近那一个像素很容易落在抗锯齿的边上 —— 取回来的颜色会淡一截。
   */
  const readPixel = (bx: number, by: number): string => {
    if (!ctx) return '';
    const [dx, dy] = boardToDevice(bx, by);
    if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) return '';
    const R = 1;
    const x0 = Math.max(0, dx - R);
    const y0 = Math.max(0, dy - R);
    const w = Math.min(canvas.width - x0, R * 2 + 1);
    const h = Math.min(canvas.height - y0, R * 2 + 1);
    if (w < 1 || h < 1) return '';
    const d = ctx.getImageData(x0, y0, w, h).data;
    const count = new Map<string, number>();
    let best = '';
    let bestN = 0;
    for (let i = 0; i < w * h; i += 1) {
      const hex = '#' + [d[i * 4], d[i * 4 + 1], d[i * 4 + 2]].map((v) => v.toString(16).padStart(2, '0')).join('');
      const n = (count.get(hex) ?? 0) + 1;
      count.set(hex, n);
      if (n > bestN) {
        bestN = n;
        best = hex;
      }
    }
    return best;
  };

  let drawing = false;
  /** 平移中：记住"按下时的指针位置 + 当时的视野"，拖动时按位移反推 */
  let panning: { px: number; py: number; vx: number; vy: number } | null = null;
  /** 空格按住 = 临时当"抓手"（和画图软件一个习惯） */
  let spaceHeld = false;
  /** 拖动那根线条时，按下那一刻的"抓手点"（画板坐标） */
  let grab: number[] | null = null;

  /** 缩放：把光标底下那个画板点**钉住不动**（不然一滚就跑，很难用） */
  const zoomAt = (clientX: number, clientY: number, factor: number) => {
    const rect = canvas.getBoundingClientRect();
    const before = { x: view.x + (clientX - rect.left) / view.scale, y: view.y + (clientY - rect.top) / view.scale };
    const next = Math.min(maxScale(), Math.max(fitScale(), view.scale * factor));
    view.scale = Math.round(next * 1000) / 1000;
    view.x = before.x - (clientX - rect.left) / view.scale;
    view.y = before.y - (clientY - rect.top) / view.scale;
    clampView();
    schedule();
    opts.onView?.(zoomText());
  };

  /** 全览（回到 1.0×、左上角对齐） */
  const resetView = () => {
    view.scale = fitScale();
    view.x = 0;
    view.y = 0;
    schedule();
    opts.onView?.(zoomText());
  };

  /*
    ---- 画布上的滚轮（2026-10-10 修的就是这里）----

    用户原话：「电脑端画线时页面异常滚动、把线条画歪」。真原因是**精密触控板的小数 delta**：
    老代码第一句是 `if (!ctrl && !meta && |deltaY| < 1) return;` —— 那**不是"不管"，
    是"把这一下让给页面"**（没有 preventDefault）。而触控板慢慢滚/惯性滚动时，
    deltaY 正好是 0.2~0.6 这种小数 → 页面滚了、画布在指针底下位移，
    笔画到一半画布跑掉，看起来就是"页面乱滚 + 线条画歪/断开"。

    实验（headless 真浏览器，2026-10-10，见 tools/checks/liyutang-draw-check.mjs 的那两条）：
      deltaY=0.6 连发 6 下 → window.scrollY 244 → 248；deltaY=0.2 → 244 → 245；
      deltaY=4（>= 1）时页面纹丝不动。所以规矩改成：**画布上的滚轮一律归画板**，
     deltaY 为 0（纯横向滑动）也吃掉、但不动缩放 —— 页面绝不在这里被滚。
  */
  on(canvas, 'wheel', ((e: WheelEvent) => {
    e.preventDefault();
    const dy = Number(e.deltaY) || 0;
    if (!dy) return;
    zoomAt(e.clientX, e.clientY, dy < 0 ? 1.15 : 1 / 1.15);
  }) as EventListener, { passive: false });

  /*
    ---- 双指缩放 / 平移（2026-10-09 晚上补的）----
    手机上**没有滚轮** —— 上面那个 wheel 处理器对触摸屏等于不存在，不补这一段，
    手机用户就只能看全览那一张板、画不了细节（用户要的正是"巨大的公共画板 + 顺手"）。
    做法是标准的双指手势：
      · 两个手指的距离 → 缩放（夹在 [全览, 4×] 之间）；
      · 两个手指的中点 → 平移（并把中点底下那个画板点钉住）；
      · **双指一上来，就把第一根手指刚才起的那一笔丢掉** —— 不然捏一下会顺手画一道。
  */
  const pointers = new Map<number, { x: number; y: number }>();
  let pinch: { dist: number; cx: number; cy: number; scale: number; bx: number; by: number } | null = null;
  /** 这一笔被双指手势接管了（抬指时不要再提交） */
  let strokeCancelled = false;

  const twoFinger = () => {
    const pts = [...pointers.values()];
    if (pts.length < 2) return null;
    const [a, b] = pts;
    return { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
  };

  const startPinch = () => {
    const p = twoFinger();
    if (!p) return;
    const rect = canvas.getBoundingClientRect();
    pinch = {
      dist: p.dist,
      cx: p.cx,
      cy: p.cy,
      scale: view.scale,
      /* 锚点 = 双指中点底下那个画板点（缩放和平移都要把它钉住） */
      bx: view.x + (p.cx - rect.left) / view.scale,
      by: view.y + (p.cy - rect.top) / view.scale,
    };
    if (drawing || live) {
      drawing = false;
      live = null;
      strokeCancelled = true;
      schedule();
    }
  };

  const movePinch = () => {
    if (!pinch) return;
    const p = twoFinger();
    if (!p) return;
    const rect = canvas.getBoundingClientRect();
    view.scale = Math.min(maxScale(), Math.max(fitScale(), pinch.scale * (p.dist / pinch.dist)));
    view.x = pinch.bx - (p.cx - rect.left) / view.scale;
    view.y = pinch.by - (p.cy - rect.top) / view.scale;
    clampView();
    schedule();
    opts.onView?.(zoomText());
  };

  on(window, 'keydown', (e) => {
    if ((e as KeyboardEvent).code === 'Space') spaceHeld = true;
  });
  on(window, 'keyup', (e) => {
    if ((e as KeyboardEvent).code === 'Space') spaceHeld = false;
  });

  /** 松开指针的捕获（设没设上都无所谓） */
  const uncapture = (id: number) => {
    try {
      if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
    } catch {
      /* 无所谓 */
    }
  };

  /** 「取色」：读渲染出来的像素，把它设成当前画笔颜色 */
  const pickAt = (e: PointerEvent) => {
    const [bx, by] = toBoard(e);
    const got = readPixel(bx, by);
    if (!got) {
      say('这一点读不到颜色（不在画布上）。');
      return;
    }
    color = got;
    tool = 'pen';
    paintBar();
    savePrefs(0);
    say(
      got === PAPER.toLowerCase()
        ? `取到了纸色 ${got} —— 想画白色的话换个颜色（纸色画上去等于擦掉）。`
        : `取到了 ${got}，已经当画笔颜色。`,
      got !== PAPER.toLowerCase()
    );
  };

  on(canvas, 'pointerdown', ((e: PointerEvent) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* 第二根手指落下 → 交给双指手势（并且把刚才起的那一笔丢掉） */
    if (pointers.size === 2) {
      startPinch();
      e.preventDefault();
      return;
    }
    /* 中键 / 抓手工具 / 按住空格 → 平移，而不是画 */
    const wantPan = e.button === 1 || tool === 'pan' || spaceHeld;
    if (wantPan) {
      panning = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      canvas.classList.add('is-panning');
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture 没设上也不要紧：move/up 挂在 window 上（见下面那段注释） */
      }
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    /* 先把默认行为挡掉（文本选中 / 原生拖拽都会顺手把页面滚起来），再看是什么工具 */
    e.preventDefault();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 有的浏览器不支持 —— 无所谓，move/up 挂在 window 上 */
    }
    if (tool === 'pick') {
      pickAt(e);
      return;
    }
    if (tool === 'move') {
      const [bx, by] = toBoard(e);
      const hit = hitTest(bx, by);
      if (!hit) {
        say('这里没有线条 —— 点在墨迹近旁才算抓住（也可以先放大一点再抓）。');
        return;
      }
      /* 别人的线条：本地就能看出来（服务端也会拒），直接说人话，不做"拖了再弹回来"那种体验 */
      if (!hit.mine) {
        say('只能挪自己画的。');
        return;
      }
      grab = [bx, by];
      moving = { id: hit.id, base: hit.points.map(([x, y]) => [x, y]), dx: 0, dy: 0, moved: false, tool: hit.tool, color: hit.color, size: hit.size };
      /* 把这一根从缓存里摘掉（重建一次），之后每帧只把它平移后的样子叠上去 —— 拖动期间一帧一条线 */
      cacheDirty = true;
      canvas.classList.add('is-moving');
      schedule();
      return;
    }
    drawing = true;
    live = { tool, color: tool === 'eraser' ? ERASER_COLOR : color, size: sizeOf(), points: [toBoard(e)] };
    schedule();
  }) as EventListener);

  /*
    ---- move / up **挂在 window 上**（2026-10-10 改的）----
    老版本只挂在 canvas 上、靠 pointer capture 兜住"指针跑到画布外面"的情况。
    可 capture 是会失效的：有的内核不认（老代码的 catch 写着"无所谓"），
    浏览器也可能中途把它收走。量过的后果（验收里那两条）：capture 一失效，
    出了画布的采样点全丢，**连抬笔都收不到** —— 那一笔压根不会提交，白画。
    挂在 window 上之后：指针在哪都跟手，抬笔一定收得到；
    状态机（drawing / moving / panning / pinch）本来就管着"该不该理这一下"，挂哪儿都一样安全。
  */
  on(window, 'pointermove', (e) => {
    const pe = e as PointerEvent;
    if (pointers.has(pe.pointerId)) pointers.set(pe.pointerId, { x: pe.clientX, y: pe.clientY });
    if (pinch && pointers.size >= 2) {
      movePinch();
      pe.preventDefault();
      return;
    }
    if (panning) {
      view.x = panning.vx - (pe.clientX - panning.px) / view.scale;
      view.y = panning.vy - (pe.clientY - panning.py) / view.scale;
      clampView();
      pe.preventDefault();
      schedule();
      return;
    }
    if (moving && grab) {
      const [bx, by] = toBoard(pe);
      moving.dx = Math.round((bx - grab[0]) * 10) / 10;
      moving.dy = Math.round((by - grab[1]) * 10) / 10;
      if (Math.abs(moving.dx) > 0.5 || Math.abs(moving.dy) > 0.5) moving.moved = true;
      pe.preventDefault();
      schedule();
      return;
    }
    if (!drawing || !live) return;
    const p = toBoard(pe);
    const last = live.points[live.points.length - 1];
    /* 采样过滤：画板坐标里 1.2px 以内不留点（既省体积，也更像笔迹） */
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return;
    if (live.points.length >= MAX_POINTS) return;
    live.points.push(p);
    pe.preventDefault();
    schedule();
  });

  /**
   * 松手：把正在拖的那根线条落定（**这时候才发一次 LT_DRAW_MOVE**）。
   * 本地先按平移结果画好（用户立刻看到结果），服务端拒了就回滚并说明原因。
   */
  const finishMove = async () => {
    const m = moving;
    moving = null;
    grab = null;
    canvas.classList.remove('is-moving');
    if (!m) return;
    const s = strokes.find((x) => x.id === m.id);
    /* 没真挪动（按下就松开）—— 把"从缓存里摘掉"那一步收回，一次网络都不发 */
    if (!m.moved || (!m.dx && !m.dy) || !s) {
      cacheDirty = true;
      schedule();
      return;
    }
    const back = s.points.map(([x, y]) => [x, y]);
    const next = movedPoints(m.base, m.dx, m.dy);
    s.points = next;
    cacheDirty = true;
    schedule();
    try {
      const r = await call(api, { event: 'LT_DRAW_MOVE', ltToken: getToken(), id: m.id, dx: m.dx, dy: m.dy });
      if (r.code !== 0) throw new Error(String(r.message ?? '没挪动'));
      const got = r.stroke as LtStroke | undefined;
      if (got) {
        /* 服务端算出来的点应该和本地一模一样；真不一样才再重建一次 */
        if (!sameShape(s, got)) cacheDirty = true;
        Object.assign(s, got);
        s.points = (got.points ?? next).map(([x, y]) => [x, y]);
      }
      schedule();
      say(`挪好了（${m.dx > 0 ? '+' : ''}${m.dx}, ${m.dy > 0 ? '+' : ''}${m.dy}）。`, true);
    } catch (err) {
      s.points = back;
      cacheDirty = true;
      schedule();
      /* 服务端的原话最准（比如"只能挪自己画的。"） */
      say('没挪成：' + String((err as Error)?.message ?? err));
    }
  };

  const finish = (e: Event) => {
    const pe = e as PointerEvent;
    pointers.delete(pe.pointerId);
    if (pointers.size < 2) pinch = null;
    if (strokeCancelled) {
      /* 这一笔被双指手势接管了：别提交 */
      strokeCancelled = false;
      drawing = false;
      live = null;
      uncapture(pe.pointerId);
      return;
    }
    if (panning) {
      panning = null;
      canvas.classList.remove('is-panning');
      uncapture(pe.pointerId);
      return;
    }
    if (moving) {
      uncapture(pe.pointerId);
      void finishMove().then(() => {
        if (deferredRefresh) {
          deferredRefresh = false;
          void refresh();
        }
      });
      return;
    }
    if (!drawing || !live) return;
    drawing = false;
    const done = live;
    live = null;
    uncapture(pe.pointerId);
    schedule();
    if (!done.points.length) return;
    /*
      ⚠ 画了新的一笔 → **作废重做栈**（2026-10-10 静态审计逮到的）：
      标准编辑器都这样（"撤销 → 又画了新的 → 重做"不该复活被撤掉的那一笔）。
      这一句只能放在**用户自己画**的这条路上 —— 放进 commit() 会把 doRedo 自己
      （它也走 commit）也清掉，重做就永远失效了。
    */
    redoStack = [];
    if (opts.redo) opts.redo.disabled = true;
    void commit(done).then(() => {
      /* 画的过程中被压住的那趟轮询，抬笔之后补上（别人的新笔划一条都不会少） */
      if (deferredRefresh) {
        deferredRefresh = false;
        void refresh();
      }
    });
  };
  /* ⚠ 同样包一层：finish 是后面才 const 声明的（见上面"接线这里的坑"） */
  on(window, 'pointerup', (e) => finish(e));
  on(window, 'pointercancel', (e) => finish(e));
  /* 手指/笔在画布上别被浏览器当成滚动（touch-action:none 是主防线，这里是双保险） */
  on(canvas, 'touchstart', (e) => e.preventDefault(), { passive: false });

  /* ------------------------------------------------------------ 轮询 */

  let timer = 0;
  const tick = async () => {
    if (stop) return;
    if (document.visibilityState === 'visible') await refresh();
    timer = window.setTimeout(() => void tick(), pollMs);
  };
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stop) void refresh();
  });

  /* 调色盘 + 工具条（先把偏好装好再画，不然会先闪一下默认色） */
  applyPrefs(opts.prefs);
  paintSwatches();
  paintBar();
  /* 进场就是"全览"：整块板正好放进画布（不是 1:1 —— 那只会看见左上角一块） */
  view.scale = fitScale();
  opts.onView?.(zoomText());
  /* ⚠ 先把纸色刷上去：画布在第一次重画之前是**黑的**，而"干净的板子"要等第一次重画 ——
     没有这一句，用户进来会看到一块黑板，直到他画下第一笔（2026-10-09 验收里逮住的）。 */
  redraw();
  /* 画布显示大小会变（切屏、窄栏、横竖屏）—— 变了就把画布内部尺寸和视野重算一遍 */
  let ro: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      /* 比"全览"还小的话（比如窗口变宽了）补回来 */
      view.scale = Math.max(view.scale, fitScale());
      clampView();
      schedule();
      opts.onView?.(zoomText());
    });
    ro.observe(canvas);
  }
  void tick();

  /*
    偏好以**服务端那份**为准再问一次：页面手上那个 user 可能是上次登录时缓存下来的
    （头像和昵称还能用，调色盘却可能是旧的/别的设备改过之前的）。一次 LT_ME，很便宜。
  */
  void (async () => {
    try {
      const r = await call(api, { event: 'LT_ME', ltToken: getToken() });
      if (r.code === 0 && r.user) {
        applyPrefs((r.user as { prefs?: unknown }).prefs);
        paintSwatches();
        paintBar();
      }
    } catch {
      /* 读不到就先用页面递进来的那份 */
    }
  })();

  /*
    给"读像素"用的调试口（验收脚本靠它证明"画上去的东西真的在画布那一点上"）。
    站里已有先例（LiyutangAccount 会把账号状态挂到 window.__ltState），所以这里不算破例；
    真实用户不会用到它 —— 页面自己也不需要。
    state / stats 是 2026-10-10 给验收加的（读当前工具/颜色/两份粗细/重做栈，
    以及"缓存到底整块重建了几次"——同步那一条就是靠它证明"画的过程中没有全量重建"）。
  */
  (window as unknown as { __ltBoard?: unknown }).__ltBoard = {
    get view() {
      return { ...view, dpr: dpr(), fit: fitScale(), zoom: zoomText() };
    },
    reset: resetView,
    /** 画板坐标 → 画布设备像素 */
    device: (x: number, y: number) => boardToDevice(x, y),
    /** 读画布上某一点（**画板坐标**）的颜色，例如 '#1d1430' */
    pixelAt(x: number, y: number) {
      const c2 = canvas.getContext('2d');
      if (!c2) return '';
      const [dx, dy] = boardToDevice(x, y);
      if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) return '';
      const d = c2.getImageData(dx, dy, 1, 1).data;
      return '#' + [d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    },
    get state() {
      return {
        tool,
        color,
        penSize,
        eraserSize,
        saved: [...saved],
        redo: redoStack.length,
        drawing,
        moving: !!moving,
        strokes: strokes.length,
        mine: strokes.filter((s) => s.mine).map((s) => s.id),
        cursor,
      };
    },
    get stats() {
      return { ...stats };
    },
  };

  return {
    refresh,
    redraw: () => {
      cacheDirty = true;
      schedule();
    },
    stop: () => {
      stop = true;
      window.clearTimeout(timer);
      window.clearTimeout(prefsTimer);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      /* ★ 监听全摘掉：只停轮询的话，上一份引擎还挂在画布上（画一笔提交两次） */
      ac.abort();
    },
  };
}

export { formatTime };
