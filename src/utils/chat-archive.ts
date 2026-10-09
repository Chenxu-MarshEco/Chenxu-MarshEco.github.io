/**
 * 聊天室**存档**（历史那一半）怎么读。
 *
 * 数据是 `tools/liyutang-archive.mjs` 每天搬进仓库的，两份：
 *   · `src/data/chat/index.json` —— 有哪些天、每天多少条 / 几张图 / 都有谁说话（**按日期倒序**）；
 *   · `src/data/chat/<日>.json` —— 那天一条一条的消息（按时间正序），
 *     图片和头像已经解成站内静态路径（`/img/chat/…`），云端的 base64 被抹掉了。
 *
 * 读它的地方：存档日页 `/liyutang/chatroom/<日>/`、历史搜索页 `…/search/`
 * 和它那份小索引 `/chat-search.json`、以及今天那一页左栏的「日子」轴。
 * 三个地方共用这一份，免得各写一遍「哪些天、怎么排、时间怎么显示」而对不上。
 *
 * ⚠ 两个约定，页面那边别绕过去：
 *   ① 用户写的东西（`nick` / `text`）**只当纯文本**渲染，绝不拼 HTML；
 *   ② `deleted: true` 的那条**照样在**（历史要完整），页面上标成「（撤回了）」。
 *
 * 为什么用 `import.meta.glob` 而不是一句 `import index from '../data/chat/index.json'`：
 * 存档还没跑过第一次（或者被清空）的时候那个文件压根不在，静态 import 会让
 * **整站构建**挂掉 —— 而这件事跟别的页面毫无关系。glob 读不到就是空表：
 * 一条存档日页都不生成，今天那一页的左栏只剩「今天」一个点，其余一切照旧。
 */
import { TODAY, pointParam, type Timeline, type TimelinePoint } from './timelines';
import { withBase } from './url';

/** 存档里的一条消息（字段见 `src/data/chat/<日>.json` 的 `_readme`） */
export interface ChatMessage {
  id: string;
  nick: string;
  /** 存档当时的昵称（没有就用用户名兜底） */
  alias?: string;
  text: string;
  /** 站内静态路径，没图就是空串 */
  image: string;
  /** 站内静态路径（头像按内容去重过），没有就是空串 */
  avatar: string;
  /** 毫秒时间戳 */
  createdAt: number;
  /** 当时撤回了。历史里**保留**这一条，页面上标出来 */
  deleted: boolean;
}

/** 某一天那一份存档文件（除了 `_readme`，那份是写给人看的） */
export interface ChatArchive {
  day: string;
  archivedAt: string;
  count: number;
  images: number;
  messages: ChatMessage[];
}

/** 索引 `index.json` 里的一行：那一天有多少条、几张图、都有谁 */
export interface ChatDayMeta {
  day: string;
  count: number;
  images: number;
  users: string[];
}

/* ============================================================ 读文件 */

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => !!v && typeof v === 'object';

/*
  一次把所有存档文件读进来（构建期就展开成静态 import，运行时不发请求）。
  文件名带日期的那种才是「某一天」，index.json 是索引，分开处理。
*/
const modules = import.meta.glob<{ default: unknown }>('../data/chat/*.json', { eager: true });

const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1);
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.json$/;

/** 一条消息规整成页面要的样子；没有 id 的丢掉（没有 id 就没有可落地的深链接，页面锚点也就无从谈起） */
function toMessage(raw: unknown): ChatMessage | null {
  if (!isObj(raw)) return null;
  const id = String(raw.id ?? '');
  if (!id) return null;
  return {
    id,
    nick: String(raw.nick ?? ''),
    alias: String(raw.alias ?? raw.nick ?? ''),
    text: String(raw.text ?? ''),
    image: String(raw.image ?? ''),
    avatar: String(raw.avatar ?? ''),
    createdAt: Number(raw.createdAt) || 0,
    deleted: raw.deleted === true,
  };
}

/** <日>.json 的路径 → 那一天（文件名和里面的 `day` 不一致时以里面的为准，都没有就用文件名） */
const archives = new Map<string, ChatArchive>();
for (const [path, mod] of Object.entries(modules)) {
  const m = DAY_FILE.exec(fileName(path));
  if (!m) continue;
  const raw = isObj(mod?.default) ? mod.default : {};
  const day = String(raw.day ?? m[1]);
  const messages = (Array.isArray(raw.messages) ? raw.messages : [])
    .map(toMessage)
    .filter((x): x is ChatMessage => x !== null);
  archives.set(day, {
    day,
    archivedAt: String(raw.archivedAt ?? ''),
    count: messages.length,
    images: messages.filter((x) => !!x.image).length,
    messages,
  });
}

/** 索引里那些天（原样，先不排序） */
const indexedDays: ChatDayMeta[] = (() => {
  const raw = Object.entries(modules).find(([p]) => fileName(p) === 'index.json')?.[1]?.default;
  const days = isObj(raw) && Array.isArray(raw.days) ? raw.days : [];
  return days.filter(isObj).map((d) => ({
    day: String(d.day ?? ''),
    count: Number(d.count) || 0,
    images: Number(d.images) || 0,
    users: Array.isArray(d.users) ? d.users.map(String) : [],
  }));
})();

/** 新的在前：日期是 `yyyy-mm-dd` 定长，比字符串就是比日期 */
const newestFirst = <T extends { day: string }>(list: T[]): T[] =>
  [...list].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));

/* ============================================================ 给页面用 */

/**
 * 有存档的日子，新的在前。
 *
 * 以 `index.json` 为准（那是存档脚本写的「有哪些天」），但**只保留真的有文件的**：
 * 索引写了、文件没下来（存档跑了一半，或者用户正在换磁盘路径）时，
 * 让那一天凭空出现在侧栏和搜索结果里、点进去却 500，比少列一天糟得多。
 *
 * 索引整个读不到（第一次存档之前）时退一步用文件名：这样存档脚本哪怕只写出了
 * 一天的 JSON、还没来得及更新索引，页面也能先把那一天显示出来。
 */
export function chatDays(): ChatDayMeta[] {
  const seen = new Set<string>();
  const out: ChatDayMeta[] = [];
  for (const d of indexedDays) {
    const file = archives.get(d.day);
    if (!DAY_FILE.test(`${d.day}.json`) || seen.has(d.day) || !file) continue;
    seen.add(d.day);
    out.push({
      day: d.day,
      count: d.count || file.messages.length,
      images: d.images || file.messages.filter((x) => !!x.image).length,
      users: d.users,
    });
  }
  if (!out.length) {
    for (const a of archives.values()) {
      out.push({
        day: a.day,
        count: a.messages.length,
        images: a.messages.filter((x) => !!x.image).length,
        users: [...new Set(a.messages.map((m) => m.alias || m.nick).filter(Boolean))],
      });
    }
  }
  return newestFirst(out).filter((d) => DAY_FILE.test(`${d.day}.json`));
}

/** 某一天那一条消息都不少的那份存档；没有文件就是 undefined */
export const chatArchive = (day: string): ChatArchive | undefined => archives.get(day);

/** 所有存档，新的在前（搜索索引按这个顺序写出来，页面就不用再排一遍） */
export const chatArchives = (): ChatArchive[] => newestFirst([...archives.values()]);

/* ============================================================ 时间 */

/**
 * 消息上的时刻（`HH:MM`）。
 *
 * 用**北京时间**（+8）而不是访问者本地时间：存档的「哪一天」就是按北京时间切的
 * （云函数 `dayKey`），页面标题也写那一天的日期。按本地时间印的话，
 * 一个在伦敦的人看 10-07 那一页，晚上 23:30 那句话会显示成 15:30 —— 对不上标题。
 */
export function chatClock(at: number): string {
  const t = Number(at) || 0;
  if (!t) return '';
  const d = new Date(t + 8 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/* ============================================================ 网址 */

/** 某一天的存档页 */
export const chatDayUrl = (day: string): string => withBase(`/liyutang/chatroom/${day}/`);
/** 今天的聊天室 */
export const chatTodayUrl = (): string => withBase('/liyutang/chatroom/');
/** 历史搜索页；带 q 就是「一进来就搜这个词」 */
export const chatSearchUrl = (q?: string): string =>
  withBase('/liyutang/chatroom/search/') + (q ? `?q=${encodeURIComponent(q)}` : '');

/* ============================================================ 左栏那条轴 */

/**
 * 左栏「日子」轴的数据（三页共用：今天那页、存档日页、搜索页）。
 *
 * 不往 `src/data/timelines.json` 里塞：那条轴上的点是**跟着存档自己长**的，
 * 每天一个，交给编辑器维护等于每天都要人去加一个点。这里按存档现算，
 * 存档脚本搬进来一天，轴上就多一个点，一个字都不用改。
 *
 * 两个刻意的选择：
 *   · `kind: 'event'`（小塔吊 + 小字）而不是默认的「时刻」：Timeline 里「时刻」的名字
 *     **默认是关着的**（DEFAULT_OFF，轴上一大堆大字最碍眼的就是它），而这一栏上的名字
 *     就是「3 条 / 5 条」这种条数 —— 名字看不见，这条轴就白画了。「事件」默认开着。
 *   · `side` 左右**轮流**：一天一个点本来就是一串，全挂在同一侧时相邻两天会挤成一根
 *     塔吊（组件会把 22px 以内的同名点合并掉），轮流挂两边就各差两天、各在自己的线上。
 *
 * 「今天」那个点用站里已有的哨兵日期 `today`：构建期先按构建那天算，
 * 页面打开时组件会按**访问者当天**把整条轴重排一遍（存档是昨天的，今天总会往后走一天）。
 */
export function chatTimeline(): Timeline {
  const days = chatDays();
  const points: TimelinePoint[] = days.map((d, i) => ({
    id: `day-${d.day}`,
    side: i % 2 === 0 ? 'left' : 'right',
    kind: 'event',
    date: d.day,
    label: `${d.count} 条`,
    href: `/liyutang/chatroom/${d.day}/`,
  }));
  points.push({
    id: 'chat-today',
    side: days.length % 2 === 0 ? 'left' : 'right',
    kind: 'event',
    date: TODAY,
    label: '今天',
    href: '/liyutang/chatroom/',
  });
  return {
    id: 'liyutang-chat',
    title: '聊天室的日子',
    /* 两侧都是「存档」：这条轴没有双线叙事，左边右边只是轮流挂点、别挤在一起 */
    leftName: '存档',
    rightName: '存档',
    /*
      一刻度一天（滑块最左，也就是这条轴最"放大"的一档）。
      存档天生是短跨度的：两天存档在默认的 19 天/格下只占三像素，几个点会重叠在一起；
      一天一格是这条轴能给出的最展开的样子，而且存档越攒越长、它自己就铺满一屏。
    */
    tickDays: 1,
    points,
    spans: [],
  };
}

/**
 * 一页的轴打开时弧顶停在哪（0~1）。
 * 给日期就停在那一天（存档日页：一进来就看见自己在轴上的哪一格），
 * 给不出（今天页 / 搜索页）就停在「今天」那个点上。
 */
export function chatApex(tl: Timeline, day?: string): number {
  const want = day ? tl.points.find((p) => p.date === day) : undefined;
  const live = tl.points.find((p) => p.date === TODAY);
  const at = want ?? live ?? tl.points[tl.points.length - 1];
  return at ? pointParam(tl, at) : 0;
}
