/*
 * ============================================================================
 * 久昭卿茶绘的「画板」—— 浏览器这一侧（2026-10-09 建；2026-10-09 加了重做/移动/取色/调色盘等）
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
 *      2026-10-09 用户要求的就是这一条：「网络差的时候轮询整块重画会卡手」。
 *   ⑤ 采样按距离过滤（画板坐标里 1.2px 以内不留点）—— 又省体积又更像笔迹。
 *   ⑥ `requestAnimationFrame` 合帧：pointermove 的频率比屏幕刷新高，直接同步重画会白烧 CPU。
 *
 * 坐标：画板内部是固定 3600×2250（`BOARD_W/BOARD_H`，2026-10-09 从 2400×1500 放大过，
 * 长宽都 ×1.5、原点仍在左上角），屏幕上按容器宽度等比缩放 ——
 * 所以不同屏幕看到的是同一块板，笔划坐标跟屏幕无关（存档也就不用管访问者的屏幕）。
 *
 * 坐标与视野（2026-10-09 晚上加的缩放/平移，别把它当装饰）：
 *   画板内部是固定 3600×2250；**画布的像素尺寸跟着"它显示多大 × DPR"走**，
 *   渲染时把"看得见的那一块画板"贴上去 —— 所以放大是**真的按更高分辨率重画**，不是把位图拉大。
 *   笔划缓存按画板坐标画、和缩放无关，于是滚轮缩放/拖动平移都不用重画缓存。
 *   最小缩放 = "整块板正好装下"（读数 1.0×），最大 4×；缩放钉住光标底下那一点。
 *   ⚠ 初版把最小缩放写成 1（1 画板像素 = 1 屏幕像素）—— 画布才一千来像素宽，
 *     于是"全览"只看得见左上角一块。这个错是被像素验收逮住的。
 *
 * 2026-10-09 这一轮加的东西（用户逐条要的，注释里写清取舍）：
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
 * 2026-10-09 第二批（用户逐条要的，取舍都写在对应那段注释里）：
 *   · **粗细圆**：跟着指针一个圆，直径 = 工具粗细 × 视野缩放 —— 选中的多粗，屏幕上看着就多粗
 *     （见下面"光标圆"那段：为什么是 div 而不是画在画布上）。
 *   · **板子放大到 3600×2250 + 网格线**：网格**画在画布下面的一层 div 上**（不是画进画布），
 *     所以它永远盖不住用户的画、也不会污染"读画布像素"那套东西（见"网格"那段）。
 *   · **快捷键** B/E/1~9/C/T/Ctrl+Z/Ctrl+R（见"快捷键"那段；输入框里打字一律不认）。
 *   · **工具条悬停卡片**：功能名 + 快捷键，视觉照花涧堂时间轴那个事件卡片
 *     （底色/描边/字号都照它；页面上写死的按钮由 .astro 那边给，动态的色块由这里补）。
 *   · **橡皮两种模式**：默认"只擦自己的"= 碰到自己的笔划就**软删**（LT_DRAW_DELETE，
 *     云端只认自己的，所以别人那边也真的没了）；打开「擦所有人」才回到"画一条纸色笔划盖住"
 *     （见 doErase 那段：为什么默认不能是"盖住"，以及为什么不是 destination-out）。
 *
 * 2026-10-10（用户原话：「橡皮优化为两种 一种是擦除接触到的整根该笔画的线条 一种是仅
 * 去除划过的地方的像素 …… 两种下面都分别有个按钮开关控制能否擦别人的」）：
 *   · **整笔**（eraserMode = 'stroke'）：碰到哪根就整根擦掉 —— 自己的走 LT_DRAW_DELETE，
 *     别人的要那颗「擦别人的」开关打开（发 `others: true`，服务端另有一道上限）；
 *   · **像素**（eraserMode = 'pixel'）：只去掉划过的地方 ——
 *       - 只擦自己：**把自己那几笔按擦到的位置裁开**（LT_DRAW_REPLACE：一根换成 0~n 段），
 *         所以它真的动的是自己的数据，不需要"按人裁剪"的遮罩魔法；
 *       - 擦别人的：这一趟走的是**一根 `tool='erase'` 的笔划**（画布上 destination-out、
 *         存档 SVG 上是一层 `<mask>`），谁画的墨都会被它去掉 —— 也就是老「擦所有人」的位置。
 *     ⚠ 为什么两种模式的"擦别人"是两套机制：整笔本来就是删一根（服务端一句话），
 *       像素要"去掉一片"，而那一片**不可能只属于某个人**（一根线常常是几个人叠着画的，
 *       见下面 doErase 那段的老注释）—— 所以像素擦别人的是"挖掉那一块墨"，不是"删某人的笔划"。
 *     ⚠ 老偏好 `eraserAll`（10-09 那套"画纸色盖住"）照旧认：读到时映射成"像素 + 擦别人的"，
 *       旧账号进来不会觉得开关丢了。
 *
 * ⚠ 这里**不做**的事（想加的时候先想清楚）：压感（协议是一笔一个粗细）、
 *   旋转、图层、清除整块板（一天一块板，存档之后再清 —— 见存档脚本）。
 * ============================================================================
 */
import { call, formatTime, getToken } from './liyutang-client';
import { BOARD_H, BOARD_W, GRID_STEP, MAX_POINTS, gridLines, paintersOf, strokeSegments } from './liyutang-strokes.mjs';

/** 画布纸色 —— 和存档 SVG、forum.css 里 .lyt-draw__stage 的底色必须是同一个值 */
export const PAPER = '#fbf6ee';

/**
 * 网格线的颜色 —— 克制到"能看出格子、但不抢画面"。
 * 它画在画布**下面**那一层上（纸色是 stage 的底色 #fbf6ee），所以这里给的是**不透明**的
 * 实色：不透明才在截图里读得出准确像素（验收就是靠截图取色的）。
 */
export const GRID_COLOR = '#e6ddcd';

/**
 * 调色板：**默认只有黑白两个**（2026-10-09 用户原话：「调色盘默认选色只保留黑白二色
 * 其他都交给用户自己选上」）。
 * 所以现在没有"一眼能看懂的落日色"内置色了 —— 想要什么色就自己调、自己「＋收藏」，
 * 收藏跟着账号走（LT_PREFS_SET / LT_ME），换设备也在。`1~9` 快捷键选的就是
 * 「当前可见顺序」（内置黑白 + 自己收藏的）里的前 9 个。
 */
export const PALETTE = ['#000000', '#ffffff'];

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
  /**
   * 像素橡皮（只擦自己）裁出来的**临时碎片**才有：它原来是哪一笔（原始 id）。
   * 抬笔时按它分组发 LT_DRAW_REPLACE；服务端回来的真笔划没有这个字段。
   */
  cutFrom?: string;
  /** 服务端回的**墓碑**（撤销/擦除掉的）：客户端看到就把本地那一根删掉，别画 */
  deleted?: boolean;
}

/** 一根"要画上去的笔划"（还没进服务端，或者要重做的一根） */
interface Drawn {
  tool: string;
  color: string;
  size: number;
  points: number[][];
}

/** 橡皮的两种方式（2026-10-10） */
export type EraserMode = 'stroke' | 'pixel';

/** 账号里存的那份画板偏好（形状见云函数 checkPrefs） */
export interface LtPrefs {
  palette?: string[];
  penSize?: number;
  eraserSize?: number;
  color?: string;
  tool?: string;
  /** 网格线开着没有（切换按钮的状态跟着账号走） */
  grid?: boolean;
  /**
   * 老字段（2026-10-09 的「擦所有人」：画一条纸色笔划盖住）。
   * 现在不再有这颗按钮了，但旧账号里存着它 —— 读进来映射成"像素 + 擦别人的"（见 applyPrefs）。
   */
  eraserAll?: boolean;
  /** 橡皮的方式：整笔 / 像素 */
  eraserMode?: string;
  /** 橡皮**整笔**那种方式：能不能擦别人画的（默认不能） */
  eraserStrokeOthers?: boolean;
  /** 橡皮**像素**那种方式：能不能擦别人画的（默认不能） */
  eraserPixelOthers?: boolean;
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
  /** 「拖动画布」：整块板拖着看（也可以按住空格、或者用鼠标中键） */
  pan?: HTMLButtonElement;
  /** 「移动」：单独拖一根线条（只能挪自己画的） */
  move?: HTMLButtonElement;
  /** 「取色」：点画布取那一点渲染出来的颜色 */
  pick?: HTMLButtonElement;
  /** 「全览」：缩放回 1×、回到左上角 */
  reset?: HTMLButtonElement;
  /** 「网格」：网格线开关（默认开着） */
  gridToggle?: HTMLButtonElement;
  /**
   * 「橡皮方式」按钮（2026-10-10）：点一下在**整笔 / 像素**之间切。
   * 按钮上的字由引擎写（`整笔擦` / `像素擦`），所以页面那边不用管文案。
   */
  eraserMode?: HTMLButtonElement;
  /**
   * 「擦别人的」开关（2026-10-10）：橡皮**当前这种方式**能不能擦别人画的。
   * 两种方式各记各的（用户原话：「两种下面都分别有个按钮开关控制能否擦别人的」），
   * 切换方式时这颗按钮显示的就是那一种方式自己的状态。
   */
  eraserOthers?: HTMLButtonElement;
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
  /**
   * 「今天画过画的人」一个都没有时显示的那句话。
   * **代码里不写死**：页面从 copy 区（`board.empty`）读进来，站长在编辑器里填；留空就什么都不显示。
   */
  emptyText?: string;
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
    （2026-10-09 顺着"重做/移动"改这一块时发现的，别再退回去）。
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
  /** 复合游标的第二半（updatedAt 相同时按 id 排；见 refresh() 里那段） */
  let cursorId = '';
  /**
   * 服务端说的"今天是哪天"（`LT_DRAW_LIST` 回的那个 `today`）。
   * ⚠ 页面**不自己算日期**：切天点是云函数里的（北京时间凌晨 4 点），
   * 两边各算一份迟早会打架 —— 只认服务端回的这一天，变了就跨天自清（见 refresh）。
   */
  let day = '';
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
  /**
   * 橡皮的方式（2026-10-10 用户要求，两种）：
   *   · `stroke` **整笔**：碰到哪根线就整根擦掉；
   *   · `pixel`  **像素**：只去掉划过的地方（划过哪块墨就少哪块）。
   * 两种方式**各有一颗「擦别人的」开关**（见下面两个 booleans），互不影响。
   */
  let eraserMode: EraserMode = 'stroke';
  /** 整笔橡皮能不能擦别人画的（默认不能：碰到别人的线条只说一句，不动它） */
  let eraserStrokeOthers = false;
  /** 像素橡皮能不能擦别人画的（默认不能：这时它只把自己那几笔裁开） */
  let eraserPixelOthers = false;
  /** 当前这种方式允不允许擦别人的 —— 界面上那颗按钮显示的就是它 */
  const othersAllowed = () => (eraserMode === 'stroke' ? eraserStrokeOthers : eraserPixelOthers);
  /**
   * 正在"擦（只擦自己的）"这一趟：记下这一趟已经删过谁（同一根笔划别连点着删好几次）。
   * 默认模式下橡皮**不画东西**，它只是在指针底下找自己的笔划然后软删 ——
   * 所以它既没有 live 笔划、也没有要提交的东西。
   * `kind` 分两种：`stroke` = 整笔软删；`pixel` = 把自己那几笔按擦到的位置**裁开**
   * （裁的结果先在本地当预览，抬笔时一次性发 LT_DRAW_REPLACE）。
   */
  let erasing: { kind: 'stroke' | 'pixel'; done: Set<string>; last: number[] } | null = null;
  /**
   * 像素橡皮（只擦自己）这一趟动了哪几根：原笔划 id → 原来的样子（发失败要还原）。
   * ⚠ 只按**原笔划**记账：裁出来的碎片挂在原笔划名下（`cutFrom`），下一刀接着裁它们。
   */
  const cutJobs = new Map<string, LtStroke>();
  /** 这一趟"擦到别人的墨但没动手"提示过没有（一趟一句，见 cutAt 末尾） */
  let hintedOtherPixel = false;
  /** 已经发出、还没回来的删除请求（防止同一根笔划被连发两次） */
  const deleting = new Set<string>();
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
    /*
      像素橡皮（tool = 'erase'）走 **destination-out**：不是往画上添颜色，而是把
      **底下已经有的墨**按这条路径去掉一片（去掉之后透出纸色和网格 —— 画布本身是透明的）。
      这和老橡皮（'eraser'：画一条纸色笔划盖住）是两回事，两种都要留着：
        · 老存档里那些 'eraser' 笔划重放出来必须还是当年的样子（纸色覆盖）；
        · 'erase' 是 2026-10-10 新加的，存档 SVG 那边用一层 <mask> 做同一件事。
      ⚠ save/restore 一定包着：不然这个 composite operation 会漏给后面画的每一根笔划。
    */
    if (s.tool === 'erase') c.globalCompositeOperation = 'destination-out';
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
    /*
      ⚠ 这里**只清空、不刷纸色**（2026-10-09 第二批改的）：纸色现在来自 .lyt-draw__stage
      的底色，画布本身是**透明**的 —— 就是为了让网格那一层（在画布下面）能透出来。
      刷成纸色的话它就成了一块不透明底板，网格那层永远被压在下面看不见。
      （存档 SVG 那边照旧刷纸色，见 liyutang-strokes.mjs 的 strokesToSvg。）
    */
    cctx.clearRect(0, 0, BOARD_W, BOARD_H);
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
    /*
      ⚠ 只清空、不刷纸色（纸色是 stage 的底色）：画布保持透明，下面那层网格才看得见。
      见 rebuildCache 里那段注释 —— 两处必须一致，不然网格会一会儿有一会儿没有。
    */
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    /* 网格和指针圆都不是"画布上的像素"：一格一格的线画在画布下面那层 div 上 */
    syncGrid();
    paintRing();
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

  /**
   * **节流**的重建（2026-10-10 加的，只给"像素橡皮 · 只擦自己"用）：
   * 裁点是跟着指针每一帧来的，每一帧都整块重建缓存谁也受不了 ——
   * 这里保证两次重建之间至少隔 PREVIEW_MS（默认 120ms ≈ 8 帧一次），
   * 抬笔时会再调一次不节流的 schedule()，所以最后落定的画面一定是准的。
   */
  const PREVIEW_MS = 120;
  let lastPreviewAt = 0;
  let previewTimer = 0;
  const scheduleThrottled = () => {
    const since = performance.now() - lastPreviewAt;
    if (since >= PREVIEW_MS) {
      lastPreviewAt = performance.now();
      schedule();
      return;
    }
    if (previewTimer) return;
    previewTimer = window.setTimeout(() => {
      previewTimer = 0;
      lastPreviewAt = performance.now();
      schedule();
    }, PREVIEW_MS - since);
  };

  /* ------------------------------------------------------------ 网格线（画布下面那一层） */

  /*
    网格为什么是"画布**下面**的一层 div"，而不是画进画布：
      ① 画进画布只有两种分辨率可选，两种都难受：画在**画板坐标**里，全览（≈0.29×）时
         1 画板像素的线落到屏幕上不到半个像素（基本看不见），放到 4× 又粗成一条带子；
         画在**屏幕像素**里，就得每帧重描几十条线，而且它会**变成画布上的像素** ——
         取色器会取到网格色，"这一点是什么颜色"的那套验收也全被污染。
      ② 放在画布下面，它**从结构上就不可能盖住用户的画**（画布在它上面）；
         开关只是 display 一下：不用重建笔划缓存、不会闪一下。
    代价：网格不在画布像素里 —— 存档 SVG 和"从画布读像素"的东西都没有格子。
    这恰好是想要的：存档要存的是"画了什么"，不是"当时 UI 长什么样"。
  */
  const stage = canvas.parentElement;
  const gridLayer = document.createElement('div');
  gridLayer.className = 'lyt-draw__grid';
  gridLayer.setAttribute('data-lt-grid', '1');
  gridLayer.setAttribute('aria-hidden', 'true');
  gridLayer.setAttribute('role', 'presentation');
  /* 线只在这里定义一次（颜色只有 GRID_COLOR 一处）；之后每次只改 size / position */
  gridLayer.style.backgroundImage =
    `linear-gradient(to right, ${GRID_COLOR} 1px, transparent 1px),` +
    `linear-gradient(to bottom, ${GRID_COLOR} 1px, transparent 1px)`;
  if (stage) stage.insertBefore(gridLayer, canvas);

  /** 网格默认**开着**（用户要求） */
  let gridOn = true;

  /** 把网格对到视野上：一格 = 300 画板像素 × 缩放，整层跟着视野平移 */
  const syncGrid = () => {
    if (!stage) return;
    gridLayer.style.display = gridOn ? '' : 'none';
    if (!gridOn) return;
    const step = GRID_STEP * view.scale;
    gridLayer.style.backgroundSize = `${step}px ${step}px`;
    gridLayer.style.backgroundPosition = `${-view.x * view.scale}px ${-view.y * view.scale}px`;
  };

  /** 网格开关（和粗细一样存进账号偏好，换设备也在） */
  const setGrid = (on: boolean, save = true) => {
    gridOn = !!on;
    syncGrid();
    paintBar();
    if (save) savePrefs(0);
  };
  if (opts.gridToggle) on(opts.gridToggle, 'click', () => setGrid(!gridOn));

  /* ------------------------------------------------------------ 光标圆（和粗细一样大的那个圈） */

  /*
    为什么是 div 而不是画在画布上（三条理由，第一条最要紧）：
      ① **它不该变成画布像素**：画布上每个像素都被"取色器"和 `pixelAt` 当作"这一点是什么颜色"，
         把圈画进去，取色就会取到圈的颜色，读像素的验收也会被那一圈污染。
      ② 指针一动它就得跟手：div 只改 left/top（合成层，不用重绘画布），
         画在画布上等于每个 pointermove 都清一层重画一遍 —— 正在画的时候最不该干这个。
      ③ 它本来就是"屏幕上的东西"（直径 = 粗细 × 缩放），和网格一样属于 UI，不属于画面。
    直径 = sizeOf() × view.scale：选中的多粗，屏幕上看着就多粗；缩放之后跟着一起变。
  */
  const ring = document.createElement('div');
  ring.className = 'lyt-draw__ring';
  ring.setAttribute('data-lt-ring', '1');
  ring.setAttribute('aria-hidden', 'true');
  /* 插在画布之后（定位元素压在上面），但 pointer-events: none —— 一个输入都不挡 */
  if (stage) stage.append(ring);

  let pointerInside = false;
  let pointerType = 'mouse';

  /** 圆的直径（CSS 像素）：画笔读 penSize、橡皮读 eraserSize，都要过一遍视野缩放 */
  const ringSize = () => sizeOf() * view.scale;

  const paintRing = () => {
    const d = ringSize();
    ring.style.width = `${d}px`;
    ring.style.height = `${d}px`;
    ring.style.margin = `${-d / 2}px 0 0 ${-d / 2}px`;
    /*
      什么时候显示：画笔/橡皮（有粗细可言）、指针在画布上、**不是触摸**（手指没有"光标"这回事），
      而且不是按住空格临时当拖动画布的时候（那时是拖动画布的形状）。
      拖动画布 / 移动线条不显示：那两个已经是 grab / move 光标了，再画个圈反而碍事。
    */
    const on = (tool === 'pen' || tool === 'eraser') && pointerInside && pointerType !== 'touch' && !spaceHeld;
    ring.classList.toggle('is-on', on);
  };

  /** 圆的中心跟着指针（坐标相对 stage：stage 的 padding 盒左上角就是画布左上角） */
  const moveRing = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect();
    ring.style.left = `${clientX - r.left}px`;
    ring.style.top = `${clientY - r.top}px`;
  };

  /** 记下指针在哪、用的什么设备（只有"该不该显示"真变了才去动样式，别每帧都写） */
  const trackPointer = (pe: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    const inside = pe.clientX >= r.left && pe.clientX <= r.right && pe.clientY >= r.top && pe.clientY <= r.bottom;
    const type = pe.pointerType || 'mouse';
    const changed = inside !== pointerInside || type !== pointerType;
    pointerInside = inside;
    pointerType = type;
    if (inside) moveRing(pe.clientX, pe.clientY);
    if (changed) paintRing();
  };
  /* 指针出了画布（有时候根本不再发 move）圈也得立刻消失 */
  on(canvas, 'pointerleave', () => {
    pointerInside = false;
    paintRing();
  });

  /**
   * 画布上的光标：画笔/橡皮**没有光标**（就看那个圈），拖动画布是 grab / grabbing，
   * 移动线条是 move。
   * ⚠ 走**行内样式**：forum.css 里 `.lyt-draw__canvas` 写死了 cursor: crosshair
   * （全站共用的文件，不去动它）；行内样式一定压得过它，也压得过 `.is-panning` 那条。
   */
  const syncCursor = () => {
    canvas.style.cursor =
      tool === 'pan' ? (panning ? 'grabbing' : 'grab') : tool === 'move' ? 'move' : tool === 'pick' ? 'crosshair' : 'none';
  };

  /* ------------------------------------------------------------ 人表 */

  const paintFaces = () => {
    if (!faces) return;
    const list = paintersOf(strokes);
    faces.textContent = '';
    if (!list.length) {
      /* 这句话由站长在编辑器里填（copy.board.empty）；没填就什么都不显示 —— 不在代码里写死。 */
      if (opts.emptyText) {
        faces.append(Object.assign(document.createElement('p'), { className: 'lyt-form__hint', textContent: opts.emptyText }));
      }
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
    let removed = 0;
    let needFull = false;
    const newest = strokes.reduce((m, s) => Math.max(m, Number(s.createdAt) || 0), 0);
    for (const s of list) {
      if (!s || !s.id) continue;
      const i = strokes.findIndex((x) => x.id === s.id);
      /*
        **墓碑**（2026-10-10 加）：服务端把"撤掉的 / 被擦掉的"笔划也发下来了（带 deleted: true），
        谁撤的都能传到所有人屏幕上 —— 老版本不发墓碑，于是别人撤销/擦掉之后，
        你这边那根线会一直挂到刷新为止（那时只擦自己的，问题不明显；现在能擦别人的了，
        不补这一条，"擦了别人的画他却还看得见"就太怪了）。
      */
      if (s.deleted) {
        if (i >= 0) {
          strokes.splice(i, 1);
          removed += 1;
          needFull = true;
        }
        continue;
      }
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
    if (added || removed) {
      strokes.sort((a, b) => a.createdAt - b.createdAt);
      paintFaces();
    }
    if (needFull) cacheDirty = true;
    if (added || removed || needFull) schedule();
    return added;
  };

  const refresh = async () => {
    /*
      ⚠ 正在画 / 正在拖的时候**不做远端这一趟**（2026-10-09 用户要求）：
      拉回来的新笔划要重画缓存 —— 老版本一律整块重建，网络一抖就正好卡在笔尖上。
      记个记号，抬手（finish）之后补一次，笔划一条都不会少。
    */
    if (drawing || moving || erasing) {
      stats.deferred += 1;
      deferredRefresh = true;
      return;
    }
    const body: Record<string, unknown> = { event: 'LT_DRAW_LIST', ltToken: getToken() };
    /*
      复合游标 `(updatedAt, id)`（2026-10-10）：
      只带一个 updatedAt 的话，同一毫秒画下的几笔会被 `updatedAt > 游标` 漏掉 ——
      画得快的时候（或者批量补数据）真的会撞上。云函数那边按 `(updatedAt, id)` 排序/过滤，
      并把下一批的游标放在 `next` 里；老云函数没有 next，就退回按 updatedAt 取最大（行为同旧版）。
    */
    if (cursor) {
      body.after = cursor;
      body.afterId = cursorId;
    }
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
    /*
      ---- 跨天自清（2026-10-09 用户要求）----

      用户原话：「每天凌晨四点存完，网页上的画板就清空，方便第二天画别的」。
      服务端**早就是**这个行为：凌晨四点的存档脚本搬完就调 LT_ADMIN_DRAW_CLEAR 把云端那天的
      笔划删掉。可客户端是**按 updatedAt 游标增量拉**的 —— 删掉的那些不会出现在"增量"里
      （没有墓碑），于是页面会一直显示已经被清掉的那些笔划，非刷新不可。这就是要补的一环。

      规矩：**只认服务端回的 `today`**（切天点是北京时间凌晨 4 点，写死在云函数里；
      页面**绝不自己算日期**，不然两边切天点一旦不一样就会互相打架）。发现 today 变了就
      把本地笔划全部丢掉、游标归零、整块重画，然后立刻按新的一天重新拉一遍。

      顺带把两种情况一起覆盖了：① 开着页面熬到凌晨四点（下一次轮询就发现 today 变了）；
      ② 页面被切到后台过了一夜 —— visibilitychange 那条路也是走 refresh()，同一段逻辑。
    */
    const today = String(r.today ?? '');
    if (today && day && today !== day) {
      /* 换天了：旧的一批（今天的）全部作废 —— 不 clear 的话会一直挂在画布上 */
      const wasDay = day;
      day = today;
      strokes = [];
      hidden.clear();
      cursor = 0;
      cursorId = '';
      redoStack = [];
      cacheDirty = true;
      paintFaces();
      schedule();
      say(`已经是新的一天了（${wasDay} → ${today}），板子重新开始。`, true);
      /* 游标归零之后得按"一整天"重新拉一遍（这一趟的增量对新的一天已经没意义了） */
      return refresh();
    }
    if (today) day = today;
    const got = (r.strokes ?? []) as LtStroke[];
    absorb(got);
    /*
      游标按 **updatedAt** 算（不是 createdAt）：别人拖动过的线条 updatedAt 会变新，
      按 createdAt 算的话它就永远拉不到了（云函数那边也是按这个排序的）。
      优先用服务端给的 `next`（复合游标，精确到同一毫秒里的第几条）；
      老云函数没有 next 才退回"自己算最大 updatedAt"。
    */
    if (r.next && Number(r.next.ts)) {
      cursor = Number(r.next.ts) || 0;
      cursorId = String(r.next.id || '');
    } else if (got.length) {
      let best = cursor;
      let bestId = cursorId;
      for (const s of got) {
        const ts = Number(s.updatedAt ?? s.createdAt) || 0;
        const id = String(s.id || '');
        if (ts > best || (ts === best && id > bestId)) {
          best = ts;
          bestId = id;
        }
      }
      cursor = best;
      cursorId = bestId;
    }
    /* 这一趟拉满了（或者被字节预算截断了）：立刻再要一趟 —— 一天的画分几批到，但一定能拉完 */
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
      /*
        ⚠ 这里**故意不推进游标**（2026-10-10 改的）：原来写成
        `cursor = Math.max(cursor, got.updatedAt)`，等于"我刚画的这一笔之后的内容都别拉"——
        同一毫秒里别人画的那几笔（id 比我的小）就会被永久跳过。
        反正这一笔已经在本地了，下一趟轮询即使把它再拉一次，absorb() 按 id 去重，不会有副作用。
      */
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
    /* 开关也照账号恢复（换设备也在）：网格线、橡皮的方式、两种方式各自"擦别人的" */
    if (typeof p.grid === 'boolean') gridOn = p.grid;
    if (p.eraserMode === 'pixel' || p.eraserMode === 'stroke') eraserMode = p.eraserMode;
    if (typeof p.eraserStrokeOthers === 'boolean') eraserStrokeOthers = p.eraserStrokeOthers;
    if (typeof p.eraserPixelOthers === 'boolean') eraserPixelOthers = p.eraserPixelOthers;
    /*
      老账号里那个 `eraserAll`（2026-10-09 的「擦所有人」= 画一条纸色笔划盖住）：
      它和今天这套里的"**像素 + 擦别人的**"是同一件事（都是"连别人的墨一起弄掉"），
      所以读到 true 就把它打开 —— 用户升级之后不会觉得那颗开关莫名其妙丢了。
      ⚠ 只在**新字段一个都没有**的时候才这么映射，免得把人家新存的设置盖回去。
    */
    if (
      p.eraserAll === true &&
      p.eraserStrokeOthers === undefined &&
      p.eraserPixelOthers === undefined &&
      p.eraserMode === undefined
    ) {
      eraserPixelOthers = true;
    }
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
          /* 开关们（服务端 checkPrefs 放行了这些字段） */
          grid: gridOn,
          eraserMode,
          eraserStrokeOthers,
          eraserPixelOthers,
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
    const list = paletteColors();
    box.textContent = '';
    for (const c of list) {
      const chip = document.createElement('span');
      chip.className = 'lyt-draw__chip';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lyt-draw__swatch';
      b.dataset.color = c;
      if (own.has(c)) b.dataset.saved = '1';
      b.style.background = c;
      /*
        色块也是"工具条按钮"：一样要有悬停卡片。前 9 个把快捷键一起写上
        （1~9 选的就是**当前可见顺序**里的第 1~9 个 —— 内置黑白在前，自己收藏的在后）。
      */
      const key = list.indexOf(c) + 1;
      const tip = document.createElement('span');
      tip.className = 'lyt-tip';
      tip.setAttribute('role', 'tooltip');
      tip.id = `lt-tip-swatch-${c.slice(1)}`;
      const tipName = document.createElement('b');
      const tipNameText = own.has(c) ? `${c}（你收藏的）` : c;
      tipName.textContent = tipNameText;
      const tipKey = document.createElement('em');
      tip.append(tipName);
      if (key <= 9) {
        tipKey.textContent = String(key);
        tip.append(tipKey);
        b.setAttribute('aria-keyshortcuts', String(key));
        b.title = own.has(c) ? `${c}（你收藏的，按 ${key} 也能选）` : `${c}（按 ${key} 也能选）`;
      } else {
        b.title = own.has(c) ? `${c}（你收藏的）` : c;
      }
      b.setAttribute('aria-describedby', tip.id);
      b.addEventListener('click', () => {
        color = c;
        tool = 'pen';
        paintBar();
        savePrefs();
      });
      chip.append(b, tip);
      if (own.has(c)) {
        /* 只有**自己收藏的**才给删；内置色删不掉（删了下次还得回来） */
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'lyt-draw__swatch-del';
        del.textContent = '×';
        del.title = `把 ${c} 从调色盘里删掉`;
        del.setAttribute('aria-label', `把 ${c} 从调色盘里删掉`);
        /*
          × 也是工具条上的一个按钮，一样要有卡片（验收里"每个按钮都挂了自己的卡片"那条会数到它）。
          但一个色块上**只留一张卡**：指针/焦点落到 × 上时把这张卡的内容换成"删掉"，
          离开再换回颜色名 —— 两张卡叠着弹会看不清。
        */
        del.setAttribute('aria-describedby', tip.id);
        const showColorTip = () => {
          tipName.textContent = tipNameText;
          if (key <= 9) tipKey.textContent = String(key);
        };
        const showDelTip = () => {
          tipName.textContent = '删掉这个收藏色';
          if (key <= 9) tipKey.textContent = c;
        };
        for (const evName of ['mouseenter', 'focus']) del.addEventListener(evName, showDelTip);
        for (const evName of ['mouseleave', 'blur']) del.addEventListener(evName, showColorTip);
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

  /** 工具条上的选中态 / 颜色 / 粗细数字 / 重做能不能点 / 那几个开关 / 光标 */
  const paintBar = () => {
    opts.pen?.classList.toggle('is-on', tool === 'pen');
    opts.eraser?.classList.toggle('is-on', tool === 'eraser');
    opts.pan?.classList.toggle('is-on', tool === 'pan');
    opts.move?.classList.toggle('is-on', tool === 'move');
    opts.pick?.classList.toggle('is-on', tool === 'pick');
    /* 网格线开关 */
    if (opts.gridToggle) {
      opts.gridToggle.classList.toggle('is-on', gridOn);
      opts.gridToggle.setAttribute('aria-pressed', gridOn ? 'true' : 'false');
    }
    /*
      橡皮那两颗（2026-10-10）：
        · 「橡皮方式」按钮上写**当前是哪种**（整笔擦 / 像素擦）——
          用户原话要的是"两种"，一颗按钮切比两颗按钮省地方，也让"现在到底是哪种"一眼看得见；
        · 「擦别人的」开关显示的是**当前这种方式自己**记着的那个值（两种各记各的），
          关着的时候按钮上那句说明也跟着换（整笔 = 碰谁的整根都擦；像素 = 只挖划过的那块墨）。
    */
    if (opts.eraserMode) {
      opts.eraserMode.textContent = eraserMode === 'pixel' ? '像素擦' : '整笔擦';
      opts.eraserMode.dataset.ltEraserMode = eraserMode;
      opts.eraserMode.setAttribute('aria-label', eraserMode === 'pixel' ? '橡皮方式：像素（只去掉划过的地方）' : '橡皮方式：整笔（碰到哪根就整根擦掉）');
      opts.eraserMode.title = eraserMode === 'pixel' ? '橡皮方式：像素 —— 点一下切成「整笔」' : '橡皮方式：整笔 —— 点一下切成「像素」';
    }
    if (opts.eraserOthers) {
      const on = othersAllowed();
      opts.eraserOthers.classList.toggle('is-on', on);
      opts.eraserOthers.setAttribute('aria-pressed', on ? 'true' : 'false');
      opts.eraserOthers.title = on
        ? '现在连别人画的也能擦 —— 点一下关掉（只管当前这种橡皮方式）'
        : eraserMode === 'pixel'
          ? '现在只擦自己画的 —— 点一下连别人的墨也挖掉'
          : '现在只擦自己画的 —— 点一下连别人的整根线条也擦掉';
    }
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
    /* 光标和那个粗细圆都跟着"当前工具 / 粗细 / 缩放"走 */
    syncCursor();
    paintRing();
  };

  /** 切工具（画笔/橡皮各自带着自己的粗细） */
  const useTool = (t: string) => {
    tool = t;
    paintBar();
    savePrefs();
  };

  /* ⚠ 工具条这些监听也挂在 abort 上：stop() 之后它们不该再响应（不然新旧两份引擎会各干一遍） */
  if (opts.pen) on(opts.pen, 'click', () => useTool('pen'));
  if (opts.eraser) {
    on(opts.eraser, 'click', () => useTool('eraser'));
  }
  /* 「拖动画布」：整块板拖来拖去（也可以按住空格临时当拖动画布、或者用鼠标中键） */
  if (opts.pan) on(opts.pan, 'click', () => useTool('pan'));
  if (opts.move) {
    on(opts.move, 'click', () => useTool('move'));
  }
  if (opts.pick) {
    on(opts.pick, 'click', () => useTool('pick'));
  }
  /* 「橡皮方式」：整笔 ⇄ 像素（两颗开关各记各的，切回来还是刚才那个状态） */
  if (opts.eraserMode) {
    on(opts.eraserMode, 'click', () => {
      eraserMode = eraserMode === 'pixel' ? 'stroke' : 'pixel';
      /* 切过去就顺手把橡皮选上：点这颗按钮的人一定是想擦东西 */
      tool = 'eraser';
      paintBar();
      savePrefs(0);
      say(eraserMode === 'pixel' ? '橡皮：像素 —— 只去掉划过的地方。' : '橡皮：整笔 —— 碰到哪根就整根擦掉。', true);
    });
  }
  /* 「擦别人的」：只改**当前这种方式**那个值（用户要的就是两种各一个开关） */
  if (opts.eraserOthers) {
    on(opts.eraserOthers, 'click', () => {
      if (eraserMode === 'stroke') eraserStrokeOthers = !eraserStrokeOthers;
      else eraserPixelOthers = !eraserPixelOthers;
      paintBar();
      savePrefs(0);
      say(othersAllowed() ? '现在连别人画的也能擦了（再点一下关掉）。' : '现在只擦自己画的。', true);
    });
  }
  /*
    ⚠ 接线这里有个坑（2026-10-09 被真浏览器验收逮住，画板对过审用户整个不工作）：
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
   * 阈值 = 笔划半宽 + pad —— 一条 6 号的线只有 3 个画板像素宽，
   * 光按线宽点，用户得"像素级"瞄准，根本抓不住。
   * @param pad 除笔划半宽之外再放宽多少**画板像素**（移动线条用 HIT_SLACK；
   *   橡皮传的是自己那个半径：橡皮是个圆盘，半径多大就够得着多远）
   */
  const hitTest = (x: number, y: number, pad: number = HIT_SLACK): LtStroke | null => {
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      const s = strokes[i];
      if (hidden.has(s.uk)) continue;
      /* 像素橡皮那一笔没有墨（它只会把别人的墨挖掉）：抓它 / 挪它都没有意义，跳过 */
      if (s.tool === 'erase') continue;
      const pts = s.points;
      if (!pts || !pts.length) continue;
      const r = Number(s.size) / 2 + pad;
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
   *
   * ⚠ 画布现在是**透明**的（纸色来自 .lyt-draw__stage 的底色，为的是让下面那层网格透出来），
   * 所以这里要把每个像素**合成到纸色上**再算 —— 不然点空白处取到的是"透明黑" #000000，
   * 用户点一下干净的板子会被告知"取到了 #000000"。
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
      const hex = overPaper(d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]);
      const n = (count.get(hex) ?? 0) + 1;
      count.set(hex, n);
      if (n > bestN) {
        bestN = n;
        best = hex;
      }
    }
    return best;
  };

  /*
    ---- 橡皮（2026-10-10 起是"两种方式 × 一颗擦别人的开关"）----

    用户原话：「橡皮优化为两种 一种是擦除接触到的整根该笔画的线条 一种是仅去除划过的地方的
    像素 …… 两种下面都分别有个按钮开关控制能否擦别人的」。

      ┌ 方式 ─┬ 擦别人的关着 ─────────────────┬ 擦别人的打开 ────────────────────┐
      │ 整笔  │ 碰到自己的整根 → 软删自己的      │ 碰到谁的整根都软删（others: true）│
      │ 像素  │ 只把自己那几笔按擦到的位置裁开   │ 挖掉划过的那一块墨（别人的也没了）│
      └──────┴────────────────────────────────┴─────────────────────────────────┘

    为什么"只擦自己的"不能用"盖纸色"实现（这是 2026-10-09 想清楚的一条，今天仍然成立）：
    自己那根和别人的那根经常交叉，笔尖落在交叉点上时，"盖纸色"会连别人的线条一起盖掉 ——
    看起来就像擦了别人的画；而整笔软删只动自己那一条，别人的线条从底下露出来，干干净净。

    为什么像素橡皮"只擦自己"要**裁点**（LT_DRAW_REPLACE）而不是挖一块墨：
    挖墨（destination-out / SVG mask）是"面向像素"的，它分不清哪一块墨是谁画的 ——
    两个人叠着画的地方，挖一下就把别人的也挖掉了。而"只擦自己"的语义必须精确到自己的笔划，
    所以那一路走的是**改自己的数据**：把擦到的那几个点从笔划里去掉、断成几段，一根换成几段。
    好处还有两个：① 存档里不会多出一堆 mask；② 撤销/重做那条路和别的改动一样。
  */

  /** 把画布上一个像素合成到纸色上（画布透明，纸色在 stage 上） */
  const overPaper = (r: number, g: number, b: number, a: number): string => {
    if (a >= 255) return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
    const bg = [251, 246, 238];
    const k = Math.max(0, Math.min(255, a)) / 255;
    const mix = [0, 1, 2].map((i) => Math.round([r, g, b][i] * k + bg[i] * (1 - k)));
    return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
  };

  /** 软删一笔（整笔橡皮用；和撤销不同：不进重做栈）。擦别人的要带 others: true（服务端另有限制） */
  const softDelete = async (s: LtStroke) => {
    const other = !s.mine;
    deleting.add(s.id);
    try {
      const r = await call(api, {
        event: 'LT_DRAW_DELETE',
        ltToken: getToken(),
        id: s.id,
        ...(other ? { others: true } : {}),
      });
      if (r.code !== 0) throw new Error(String(r.message ?? '擦不掉'));
      strokes = strokes.filter((x) => x.id !== s.id);
      /* 少了一根 = 集合变了：只能整块重建（缓存上没法"擦掉一根"） */
      cacheDirty = true;
      paintFaces();
      schedule();
      say(other ? '擦掉了别人的一笔。' : '擦掉了自己的一笔。', true);
    } catch (err) {
      say('擦不掉：' + String((err as Error)?.message ?? err));
    } finally {
      deleting.delete(s.id);
    }
  };

  /** 笔尖（画板坐标）底下那一根——够得着的判定按**橡皮自己的半径**来 */
  const eraseUnder = (bx: number, by: number) => {
    const hit = hitTest(bx, by, eraserSize / 2);
    if (!hit) return;
    /* 别人的笔划：开关关着就不动（这是"只擦自己的"的核心） */
    if (!hit.mine && !othersAllowed()) {
      say('这是别人画的 —— 想擦别人的，先把「擦别人的」打开（像素橡皮也能只擦划过的那一点）。');
      return;
    }
    /* 还没落到服务端的那一笔（本地临时 id）删不了 —— 等它拿到 id 再说 */
    if (String(hit.id).startsWith('local-')) return;
    if (erasing?.done.has(hit.id) || deleting.has(hit.id)) return;
    erasing?.done.add(hit.id);
    void softDelete(hit);
  };

  /**
   * 像素橡皮（只擦自己）：把一笔的点里、落在橡皮圆内的那些去掉，断成几段。
   * @param pts 这一笔的点（画板坐标）
   * @param cx 橡皮圆心 x
   * @param cy 橡皮圆心 y
   * @param r 橡皮半径（= eraserSize / 2）
   * @returns `runs` 剩下的一段段点（每段自己就是一笔），`hit` 有没有真的擦到
   */
  const cutCircle = (pts: number[][], cx: number, cy: number, r: number) => {
    const runs: number[][][] = [];
    let cur: number[][] = [];
    let hit = false;
    for (const p of pts) {
      if (Math.hypot(p[0] - cx, p[1] - cy) <= r) {
        hit = true;
        if (cur.length) {
          runs.push(cur);
          cur = [];
        }
        continue;
      }
      cur.push([p[0], p[1]]);
    }
    if (cur.length) runs.push(cur);
    return { runs, hit };
  };

  /**
   * 像素橡皮（只擦自己）擦到的一点：把指针底下**自己**的笔划裁开。
   *
   * 裁的结果**先在本地当预览**（把原来的那一笔换成几段临时笔划，集合变了就重建一次缓存）;
   * 抬笔时按原笔划分组、一次性发 LT_DRAW_REPLACE（一根换成几段），失败再还原。
   * ⚠ 重建是节流的（见 previewTick）：裁点是跟着指针每帧来的，一分钟重建六十次谁也受不了 ——
   *   反正橡皮那个圆一直在提示"擦到哪儿了"。
   */
  const cutAt = (cx: number, cy: number) => {
    const r = eraserSize / 2;
    let touched = false;
    /* 这一趟擦到**别人的**没有（只擦自己那一档：说一句"想擦别人的得先打开那颗开关" ，一次就够） */
    let metOther = false;
    for (const s of [...strokes]) {
      if (hidden.has(s.uk)) continue;
      /* 橡皮自己画出来的东西（纸色笔划 / 挖墨的笔划）不裁：裁它没有意义，还会把老存档弄乱 */
      if (s.tool === 'eraser' || s.tool === 'erase') continue;
      /* 还没拿到服务端 id 的临时笔划（正在提交）先不碰 */
      if (String(s.id).startsWith('local-') && !s.cutFrom) continue;
      if (!s.mine) {
        /* 别人的墨：这一档（像素 + 只擦自己）不碰它 —— 但擦到了就提示一下，别让人以为橡皮坏了 */
        if (!metOther && cutCircle(s.points, cx, cy, r).hit) metOther = true;
        continue;
      }
      const { runs, hit } = cutCircle(s.points, cx, cy, r);
      if (!hit) continue;
      touched = true;
      const key = String(s.cutFrom || s.id);
      if (!cutJobs.has(key)) {
        /*
          第一次动到这一根：把**原来的样子**记下来（还原用）。
          碎片身上带着 cutFrom，所以第二刀、第三刀都还挂在同一笔名下 ——
          抬手时拿到的就是"这一笔最后剩成什么样"，一次请求发出去。
        */
        const orig = s.cutFrom ? cutJobs.get(String(s.cutFrom)) : undefined;
        cutJobs.set(key, {
          ...(orig ?? s),
          id: key,
          points: (orig?.points ?? s.points).map(([x, y]) => [x, y]),
        });
      }
      const i = strokes.indexOf(s);
      const pieces: LtStroke[] = runs.map((run, k) => ({
        id: `local-cut-${key}-${k}`,
        cutFrom: key,
        uk: s.uk,
        nick: s.nick,
        alias: s.alias,
        avatar: s.avatar,
        tool: s.tool,
        color: s.color,
        size: s.size,
        points: run,
        createdAt: s.createdAt,
        updatedAt: Date.now(),
        mine: true,
      }));
      strokes.splice(i, 1, ...pieces);
    }
    if (touched) {
      cacheDirty = true;
      /* ⚠ 这里**不**刷「今天画过画的人」那张表：它每次都重建一串按钮，而裁点是跟着指针来的
         （一秒几十下）。表上的"笔数"在抬笔 commitCuts 里会一次性对齐 —— 差那几百毫秒没人在意。 */
      scheduleThrottled();
    } else if (metOther && !hintedOtherPixel) {
      /*
        这一档只动自己的墨：擦到别人的线条时**什么都不做**（连数据都不发）——
        不说一句的话，用户会以为橡皮坏了。一趟只说一次（hintedOtherPixel 在 pointerdown 里清零）。
      */
      hintedOtherPixel = true;
      say('这是别人画的 —— 想擦别人的，先把「擦别人的」打开（像素橡皮也能只擦划过的那一点）。');
    }
  };

  /** 像素橡皮（只擦自己）抬笔：把这一趟裁过的那几根一次性换掉 */
  const commitCuts = async () => {
    if (!cutJobs.size) return;
    const edits: { id: string; parts: { tool: string; color: string; size: number; points: number[][] }[] }[] = [];
    const byKey = new Map<string, LtStroke[]>();
    for (const s of strokes) {
      const key = String(s.cutFrom || '');
      if (!key || !cutJobs.has(key)) continue;
      const list = byKey.get(key) ?? [];
      list.push(s);
      byKey.set(key, list);
    }
    for (const [key] of cutJobs) {
      const parts = (byKey.get(key) ?? []).map((s) => ({ tool: s.tool, color: s.color, size: s.size, points: s.points }));
      edits.push({ id: key, parts });
    }
    const backup = [...cutJobs.entries()];
    cutJobs.clear();
    if (!edits.length) return;
    try {
      const r = await call(api, { event: 'LT_DRAW_REPLACE', ltToken: getToken(), edits });
      if (r.code !== 0) throw new Error(String(r.message ?? '擦不掉'));
      /* 服务端回来的才是真的：按 cutFrom 把本地那些临时碎片换成它给的几段 */
      const got = (r.strokes ?? []) as LtStroke[];
      const keys = new Set(edits.map((e) => e.id));
      strokes = strokes.filter((s) => !(s.cutFrom && keys.has(String(s.cutFrom))));
      strokes.push(...got);
      strokes.sort((a, b) => a.createdAt - b.createdAt);
      cacheDirty = true;
      paintFaces();
      schedule();
      const cut = edits.reduce((n, e) => n + e.parts.length, 0);
      say(`像素橡皮擦掉了 ${edits.length} 处（剩下 ${cut} 段）。`, true);
    } catch (err) {
      /* 没成：把原样放回去，别让人以为擦掉了 */
      const keys = new Set(edits.map((e) => e.id));
      strokes = strokes.filter((s) => !(s.cutFrom && keys.has(String(s.cutFrom))));
      for (const [, orig] of backup) strokes.push(orig);
      strokes.sort((a, b) => a.createdAt - b.createdAt);
      cacheDirty = true;
      paintFaces();
      schedule();
      say('没擦成：' + String((err as Error)?.message ?? err));
    }
  };

  /** 橡皮拖过去的一整条路径：按 4 个画板像素采样着擦（太密没意义，太疏会漏） */
  const eraseAlong = (pe: PointerEvent) => {
    if (!erasing) return;
    const [bx, by] = toBoard(pe);
    const last = erasing.last;
    if (last && Math.hypot(bx - last[0], by - last[1]) < 4) return;
    erasing.last = [bx, by];
    if (erasing.kind === 'pixel') cutAt(bx, by);
    else eraseUnder(bx, by);
  };

  let drawing = false;
  /** 平移中：记住"按下时的指针位置 + 当时的视野"，拖动时按位移反推 */
  let panning: { px: number; py: number; vx: number; vy: number } | null = null;
  /** 空格按住 = 临时当"拖动画布"（和画图软件一个习惯） */
  let spaceHeld = false;
  /** 拖动那根线条时，按下那一刻的"抓住点"（画板坐标） */
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
    ---- 画布上的滚轮（2026-10-09 修的就是这里）----

    用户原话：「电脑端画线时页面异常滚动、把线条画歪」。真原因是**精密触控板的小数 delta**：
    老代码第一句是 `if (!ctrl && !meta && |deltaY| < 1) return;` —— 那**不是"不管"，
    是"把这一下让给页面"**（没有 preventDefault）。而触控板慢慢滚/惯性滚动时，
    deltaY 正好是 0.2~0.6 这种小数 → 页面滚了、画布在指针底下位移，
    笔画到一半画布跑掉，看起来就是"页面乱滚 + 线条画歪/断开"。

    实验（headless 真浏览器，2026-10-09，见 tools/checks/liyutang-draw-check.mjs 的那两条）：
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
    if (drawing || live || erasing) {
      drawing = false;
      live = null;
      /*
        双指一上来，"擦"那一趟也算作废（不然捏合时手指划过去会连删好几根）。
        ⚠ 像素橡皮（只擦自己）那种要**先把已经裁过的发出去**：它的改动已经落在本地
        （strokes 里现在是几段临时碎片），不发就是把板子留在"只有我看得见"的状态。
      */
      if (erasing?.kind === 'pixel') void commitCuts();
      erasing = null;
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

  /*
    ---- 快捷键（2026-10-09 第二批加）----
      B 画笔 / E 橡皮 / 1~9 选调色盘里第 1~9 个颜色 / C 拖动画布 / T 移动线条 /
      Ctrl+Z 撤回 / Ctrl+R 重做。
    三条讲究：
      ① **焦点在输入框里就一个都不认**：粗细那个数字框、颜色框里打字就是打字 ——
         不然想在数字框里打个 "e"（指数），工具先被切走了；Ctrl+Z 在输入框里也该是
         "撤销我刚打的字"，不是"撤掉板上一笔"。
      ② **Ctrl+R 要 preventDefault**：浏览器默认是刷新页面，按一下整块板重来（还没画完就白画了）。
         同理 Ctrl+Z 也吃掉（页面本身没有别的可撤的，让给画板）。
      ③ 只在**这块画板挂着的时候**生效：这些监听挂在 mountBoard 的 abort 上，
         页面一 stop（没登录 / 退到访客）就全摘了，别的页面更没有它。
  */
  const typingIn = (el: Element | null) => {
    const t = el as HTMLElement | null;
    if (!t) return false;
    const tag = String(t.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable === true;
  };

  on(window, 'keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.code === 'Space') {
      spaceHeld = true;
      /* 按住空格 = 临时当"拖动画布"：光标立刻变拖动画布的形状，那个粗细圆跟着收起来 */
      syncCursor();
      paintRing();
    }
    if (typingIn(document.activeElement)) return;
    if (ke.ctrlKey || ke.metaKey) {
      /* 只认 Ctrl+Z / Ctrl+R；别的组合键（Ctrl+C 复制之类）一个都别碰 */
      if (ke.code === 'KeyZ') {
        ke.preventDefault();
        void doUndo();
      } else if (ke.code === 'KeyR') {
        ke.preventDefault();
        void doRedo();
      }
      return;
    }
    if (ke.altKey) return;
    const tools: Record<string, string> = { KeyB: 'pen', KeyE: 'eraser', KeyC: 'pan', KeyT: 'move' };
    const want = tools[ke.code];
    if (want) {
      ke.preventDefault();
      useTool(want);
      return;
    }
    const digit = /^Digit([1-9])$/.exec(ke.code);
    if (digit) {
      const list = paletteColors();
      const c = list[Number(digit[1]) - 1];
      if (!c) return;
      ke.preventDefault();
      color = c;
      tool = 'pen';
      paintBar();
      savePrefs();
      say(`调色盘第 ${digit[1]} 个：${c}。`, true);
    }
  });
  on(window, 'keyup', (e) => {
    if ((e as KeyboardEvent).code === 'Space') {
      spaceHeld = false;
      /* 空格松开 → 光标从拖动画布的形状变回画笔那一套 */
      syncCursor();
      paintRing();
    }
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
      got === PAPER.toLowerCase() ? `取到了纸色 ${got}。` : `取到了 ${got}，已经当画笔颜色。`,
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
    /* 中键 / 拖动画布工具 / 按住空格 → 平移，而不是画 */
    const wantPan = e.button === 1 || tool === 'pan' || spaceHeld;
    if (wantPan) {
      panning = { px: e.clientX, py: e.clientY, vx: view.x, vy: view.y };
      canvas.classList.add('is-panning');
      /* 按住的一瞬间光标就从 grab 变成 grabbing（画图软件都是这个手感） */
      syncCursor();
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
    /*
      橡皮的两种"不画东西"的路（见上面那段表）：
        · **整笔**：在指针底下找笔划、软删它 —— 没有 live 笔划，也没有要提交的东西；
        · **像素 + 只擦自己**：把自己那几笔按擦到的位置裁开（本地先当预览，抬笔才发 REPLACE）。
      只有"像素 + 擦别人的"才继续往下走，当成一笔 tool='erase' 来画（挖墨）。
    */
    if (tool === 'eraser' && (eraserMode === 'stroke' || !othersAllowed())) {
      const [bx, by] = toBoard(e);
      if (eraserMode === 'pixel') {
        erasing = { kind: 'pixel', done: new Set<string>(), last: [bx, by] };
        cutJobs.clear();
        cutAt(bx, by);
      } else {
        erasing = { kind: 'stroke', done: new Set<string>(), last: [bx, by] };
        eraseUnder(bx, by);
      }
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
    /*
      像素橡皮（擦别人的那一档）在这里变成**一根 tool='erase' 的笔划**：
      redraw 每帧把它以 destination-out 叠在画面上 = 实时看着墨被挖掉；
      抬笔 commit() 把它送上去，别人那边重放同一根笔划，看到的也一模一样。
      老橡皮（'eraser' = 画一条纸色笔划）不再由界面产生，但**存档里那些还得照原样重放** ——
      所以 paintStroke 里对两种 tool 的处理都留着。
    */
    const liveTool = tool === 'eraser' ? 'erase' : tool;
    live = { tool: liveTool, color: liveTool === 'erase' ? ERASER_COLOR : color, size: sizeOf(), points: [toBoard(e)] };
    schedule();
  }) as EventListener);

  /*
    ---- move / up **挂在 window 上**（2026-10-09 改的）----
    老版本只挂在 canvas 上、靠 pointer capture 兜住"指针跑到画布外面"的情况。
    可 capture 是会失效的：有的内核不认（老代码的 catch 写着"无所谓"），
    浏览器也可能中途把它收走。量过的后果（验收里那两条）：capture 一失效，
    出了画布的采样点全丢，**连抬笔都收不到** —— 那一笔压根不会提交，白画。
    挂在 window 上之后：指针在哪都跟手，抬笔一定收得到；
    状态机（drawing / moving / panning / pinch）本来就管着"该不该理这一下"，挂哪儿都一样安全。
  */
  on(window, 'pointermove', (e) => {
    const pe = e as PointerEvent;
    /* 光标圆：先更新"指针在哪、什么设备、该不该显示"（不挡任何输入，纯显示） */
    trackPointer(pe);
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
    /* 橡皮"只擦自己的"：沿着路径擦过去（采样在 eraseAlong 里做） */
    if (erasing) {
      eraseAlong(pe);
      pe.preventDefault();
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
      /* 松手 → 光标从 grabbing 变回 grab */
      syncCursor();
      uncapture(pe.pointerId);
      return;
    }
    /* 橡皮那两种"不画东西"的趟收了：整笔那一种本来就没有要提交的东西；
       像素（只擦自己）那一种要把裁过的几笔发出去 —— 见 commitCuts */
    if (erasing) {
      const kind = erasing.kind;
      erasing = null;
      uncapture(pe.pointerId);
      void (kind === 'pixel' ? commitCuts() : Promise.resolve()).then(() => {
        /* 擦的这一趟里被压住的那次轮询，收工之后补上 */
        if (deferredRefresh) {
          deferredRefresh = false;
          void refresh();
        }
      });
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
      ⚠ 画了新的一笔 → **作废重做栈**（2026-10-09 静态审计逮到的）：
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
    state / stats 是 2026-10-09 给验收加的（读当前工具/颜色/两份粗细/重做栈，
    以及"缓存到底整块重建了几次"——同步那一条就是靠它证明"画的过程中没有全量重建"）。
    grid / ring 是第二批加的（网格开着没有、格子怎么切；光标圆多大、该不该显示）——
    ⚠ 契约是"**只加不改**"：view / reset / device / pixelAt 的签名和含义一个字都没动。
  */
  (window as unknown as { __ltBoard?: unknown }).__ltBoard = {
    get view() {
      return { ...view, dpr: dpr(), fit: fitScale(), zoom: zoomText() };
    },
    reset: resetView,
    /** 画板坐标 → 画布设备像素 */
    device: (x: number, y: number) => boardToDevice(x, y),
    /**
     * 读画布上某一点（**画板坐标**）的颜色，例如 '#000000'。
     * ⚠ 画布是透明的（纸色在 stage 的底色上），所以透明的地方**按纸色算** ——
     * 这个口子的含义还是"这一点看上去是什么颜色"，只是把合成那一步补上了。
     */
    pixelAt(x: number, y: number) {
      const c2 = canvas.getContext('2d');
      if (!c2) return '';
      const [dx, dy] = boardToDevice(x, y);
      if (dx < 0 || dy < 0 || dx >= canvas.width || dy >= canvas.height) return '';
      const d = c2.getImageData(dx, dy, 1, 1).data;
      return overPaper(d[0], d[1], d[2], d[3]);
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
        day,
        grid: gridOn,
        /* 橡皮那两颗（2026-10-10）：方式 + 两种方式各自的"擦别人的"；eraserAll 只是兼容老验收的读法 */
        eraserMode,
        eraserStrokeOthers,
        eraserPixelOthers,
        eraserOthers: othersAllowed(),
        eraserAll: othersAllowed(),
        palette: paletteColors(),
      };
    },
    /** 网格：开关、线距、格子怎么切、以及那一层现在对到哪儿了 */
    get grid() {
      return {
        on: gridOn,
        color: GRID_COLOR,
        ...gridLines(BOARD_W, BOARD_H, GRID_STEP),
        css: {
          display: gridLayer.style.display,
          size: gridLayer.style.backgroundSize,
          pos: gridLayer.style.backgroundPosition,
          image: gridLayer.style.backgroundImage,
        },
      };
    },
    /** 光标圆：开关、直径（CSS 像素）、当前粗细、指针是什么设备 */
    get ring() {
      return { on: ring.classList.contains('is-on'), d: ringSize(), size: sizeOf(), pointerType, inside: pointerInside };
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
      window.clearTimeout(previewTimer);
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect();
      /* ★ 监听全摘掉：只停轮询的话，上一份引擎还挂在画布上（画一笔提交两次） */
      ac.abort();
      /*
        ★ 网格层和光标圆是这一趟自己造出来的 DOM，也得一起撤掉：
        页面在账号状态反复变化时会 stop() 再 mountBoard()，不撤的话 stage 里会叠上
        **第二层网格**（同色还好）和**第二个圆**（那个停在上一次的位置，很明显）。
      */
      gridLayer.remove();
      ring.remove();
    },
  };
}

export { formatTime };
