/*
 * ============================================================================
 * 久昭卿茶绘的「画板」—— 浏览器这一侧（2026-10-09）
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
 *   ④ **两层画布**：已经定下来的笔划画在一张离屏缓存上，只有"笔划集合变了"才重画缓存；
 *      正在画的那一笔每帧单独叠上去。所以画得再多，每一帧也只画一根。
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

export interface LtStroke {
  id: string;
  uk: string;
  nick: string;
  avatar: string;
  tool: string;
  color: string;
  size: number;
  points: number[][];
  createdAt: number;
  mine: boolean;
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
  /** 「全览」：缩放回 1×、回到左上角 */
  reset?: HTMLButtonElement;
  swatches?: HTMLElement;
  colorInput?: HTMLInputElement;
  sizeInput?: HTMLInputElement;
  undo?: HTMLButtonElement;
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
 * 把画板挂起来：能画、能擦、能调色、能撤、能看别人画的、能按人显隐。
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
   * 于是 1× 时**只看得见左上角那一块**，用户一进来（和点「全览」之后）看到的是一张残缺的板。
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
  let size = 6;

  const say = (text: string, ok = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-ok', ok);
  };

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

  const redraw = () => {
    if (!ctx || !cctx) return;
    /* 画布内部尺寸跟着它显示多大走（缩放清晰的关键） */
    fitCanvas();
    if (cacheDirty) {
      cctx.setTransform(1, 0, 0, 1, 0, 0);
      cctx.fillStyle = PAPER;
      cctx.fillRect(0, 0, BOARD_W, BOARD_H);
      for (const s of strokes) {
        if (hidden.has(s.uk)) continue;
        paintStroke(cctx, s);
      }
      cacheDirty = false;
    }
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
        cacheDirty = true;
        paintFaces();
        schedule();
      });
      faces.append(b);
    }
  };

  /* ------------------------------------------------------------ 收发 */

  const absorb = (list: LtStroke[]) => {
    let added = 0;
    for (const s of list) {
      if (!s || !s.id) continue;
      if (strokes.some((x) => x.id === s.id)) continue;
      strokes.push(s);
      added += 1;
    }
    if (added) {
      strokes.sort((a, b) => a.createdAt - b.createdAt);
      cacheDirty = true;
      paintFaces();
      schedule();
    }
    return added;
  };

  const refresh = async () => {
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
    if (got.length) cursor = Math.max(cursor, ...got.map((s) => Number(s.createdAt) || 0));
    /* 这一趟拉满了：立刻再要一趟（一小时的画可能上千笔，一趟拉不完） */
    if (r.more) void refresh();
    say(`今天这块板上已经有 ${strokes.filter((s) => !hidden.has(s.uk)).length} 笔（你自己看到的）`, true);
  };

  /** 抬笔之后把这一笔送上去；失败就把它从本地撤掉，别让人以为画上去了 */
  const commit = async (s: { tool: string; color: string; size: number; points: number[][] }) => {
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
      mine: true,
    };
    strokes.push(temp);
    cacheDirty = true;
    paintFaces();
    schedule();
    try {
      const r = await call(api, { event: 'LT_DRAW_ADD', ltToken: getToken(), ...s });
      if (r.code !== 0) throw new Error(String(r.message ?? '这一笔没送上去'));
      /* 用服务端给的那条替掉本地临时那条（id / uk / 时间都以服务端为准） */
      const i = strokes.findIndex((x) => x.id === temp.id);
      if (i >= 0 && r.stroke) strokes[i] = r.stroke as LtStroke;
      cursor = Math.max(cursor, Number(r.stroke?.createdAt) || temp.createdAt);
      cacheDirty = true;
      paintFaces();
      schedule();
    } catch (err) {
      strokes = strokes.filter((x) => x.id !== temp.id);
      cacheDirty = true;
      paintFaces();
      schedule();
      say('这一笔没画上：' + String((err as Error)?.message ?? err));
    }
  };

  /* ------------------------------------------------------------ 输入 */

  /** 屏幕坐标 → 画板坐标（要过视野：缩放 + 平移） */
  const toBoard = (e: PointerEvent): number[] => {
    const rect = canvas.getBoundingClientRect();
    const x = view.x + (e.clientX - rect.left) / view.scale;
    const y = view.y + (e.clientY - rect.top) / view.scale;
    return [Math.round(Math.min(BOARD_W, Math.max(0, x)) * 10) / 10, Math.round(Math.min(BOARD_H, Math.max(0, y)) * 10) / 10];
  };

  let drawing = false;
  /** 平移中：记住"按下时的指针位置 + 当时的视野"，拖动时按位移反推 */
  let panning: { px: number; py: number; vx: number; vy: number } | null = null;
  /** 空格按住 = 临时当"抓手"（和画图软件一个习惯） */
  let spaceHeld = false;

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

  canvas.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < 1) return;
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

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

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') spaceHeld = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') spaceHeld = false;
  });

  canvas.addEventListener('pointerdown', (e) => {
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
        /* 无所谓 */
      }
      e.preventDefault();
      return;
    }
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    drawing = true;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      /* 有的浏览器不支持，无所谓 */
    }
    live = { tool, color: tool === 'eraser' ? ERASER_COLOR : color, size, points: [toBoard(e)] };
    e.preventDefault();
    schedule();
  });

  canvas.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      movePinch();
      e.preventDefault();
      return;
    }
    if (panning) {
      view.x = panning.vx - (e.clientX - panning.px) / view.scale;
      view.y = panning.vy - (e.clientY - panning.py) / view.scale;
      clampView();
      e.preventDefault();
      schedule();
      return;
    }
    if (!drawing || !live) return;
    const p = toBoard(e);
    const last = live.points[live.points.length - 1];
    /* 采样过滤：画板坐标里 1.2px 以内不留点（既省体积，也更像笔迹） */
    if (last && Math.hypot(p[0] - last[0], p[1] - last[1]) < 1.2) return;
    if (live.points.length >= MAX_POINTS) return;
    live.points.push(p);
    e.preventDefault();
    schedule();
  });

  const finish = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (strokeCancelled) {
      /* 这一笔被双指手势接管了：别提交 */
      strokeCancelled = false;
      drawing = false;
      live = null;
      return;
    }
    if (panning) {
      panning = null;
      canvas.classList.remove('is-panning');
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* 无所谓 */
      }
      return;
    }
    if (!drawing || !live) return;
    drawing = false;
    const done = live;
    live = null;
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      /* 无所谓 */
    }
    schedule();
    if (!done.points.length) return;
    void commit(done);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
  /* 手指/笔在画布上别被浏览器当成滚动 */
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });

  /* ------------------------------------------------------------ 工具条 */

  const paintTools = () => {
    opts.pen?.classList.toggle('is-on', tool === 'pen');
    opts.eraser?.classList.toggle('is-on', tool === 'eraser');
    opts.pan?.classList.toggle('is-on', tool === 'pan');
    if (opts.colorInput && /^#[0-9a-f]{6}$/i.test(color)) opts.colorInput.value = color;
    for (const b of opts.swatches?.querySelectorAll<HTMLElement>('[data-color]') ?? []) {
      b.classList.toggle('is-on', String(b.dataset.color).toLowerCase() === color.toLowerCase());
    }
  };

  opts.pen?.addEventListener('click', () => {
    tool = 'pen';
    paintTools();
  });
  opts.eraser?.addEventListener('click', () => {
    tool = 'eraser';
    paintTools();
  });
  /* 「抓手」：整块板拖来拖去（也可以按住空格临时当抓手、或者用鼠标中键） */
  opts.pan?.addEventListener('click', () => {
    tool = 'pan';
    paintTools();
  });
  opts.reset?.addEventListener('click', resetView);
  if (opts.swatches) {
    for (const c of PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lyt-draw__swatch';
      b.dataset.color = c;
      b.style.background = c;
      b.title = c;
      b.addEventListener('click', () => {
        color = c;
        tool = 'pen';
        paintTools();
      });
      opts.swatches.append(b);
    }
  }
  opts.colorInput?.addEventListener('input', () => {
    const v = String(opts.colorInput?.value ?? '').toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(v)) {
      color = v;
      tool = 'pen';
      paintTools();
    }
  });
  opts.sizeInput?.addEventListener('input', () => {
    size = Math.min(64, Math.max(1, Number(opts.sizeInput?.value) || 6));
  });
  opts.undo?.addEventListener('click', async () => {
    /* 撤销 = 删自己最后那一笔（服务端只认你的） */
    const mine = [...strokes].reverse().find((s) => s.mine && !String(s.id).startsWith('local-'));
    if (!mine) {
      say('没有可以撤的（你还没画，或者都撤完了）。');
      return;
    }
    try {
      const r = await call(api, { event: 'LT_DRAW_DELETE', ltToken: getToken(), id: mine.id });
      if (r.code !== 0) throw new Error(String(r.message ?? '撤不掉'));
      strokes = strokes.filter((s) => s.id !== mine.id);
      cacheDirty = true;
      paintFaces();
      schedule();
      say('撤回了一笔。', true);
    } catch (err) {
      say('撤不掉：' + String((err as Error)?.message ?? err));
    }
  });

  /* ------------------------------------------------------------ 轮询 */

  let timer = 0;
  const tick = async () => {
    if (stop) return;
    if (document.visibilityState === 'visible') await refresh();
    timer = window.setTimeout(() => void tick(), pollMs);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stop) void refresh();
  });

  paintTools();
  /* 进场就是"全览"：整块板正好放进画布（不是 1:1 —— 那只会看见左上角一块） */
  view.scale = fitScale();
  opts.onView?.(zoomText());
  /* ⚠ 先把纸色刷上去：画布在第一次重画之前是**黑的**，而"干净的板子"要等第一次重画 ——
     没有这一句，用户进来会看到一块黑板，直到他画下第一笔（2026-10-09 验收里逮住的）。 */
  redraw();
  /* 画布显示大小会变（切屏、窄栏、横竖屏）—— 变了就把画布内部尺寸和视野重算一遍 */
  if (typeof ResizeObserver === 'function') {
    const ro = new ResizeObserver(() => {
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
    给"读像素"用的调试口（验收脚本靠它证明"画上去的东西真的在画布那一点上"）。
    站里已有先例（LiyutangAccount 会把账号状态挂到 window.__ltState），所以这里不算破例；
    真实用户不会用到它 —— 页面自己也不需要。
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
      if (raf) cancelAnimationFrame(raf);
    },
  };
}

export { formatTime };
