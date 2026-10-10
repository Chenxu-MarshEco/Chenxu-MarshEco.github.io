/**
 * ============================================================================
 * 黎语堂的云函数入口（花涧堂）
 * ----------------------------------------------------------------------------
 * 这份代码**跑在腾讯云开发的云函数里**（函数名 twikoo），线上那一份是把这个文件
 * 一字不差粘进控制台的在线编辑器。所以这里放一份进仓库：以前它只活在控制台里，
 * 改了没有历史、也没法审 —— 现在它是版本管理的。
 *
 * 它干两件事：
 *
 * 一、**把 Twikoo 装起来**，但数据库换成外部 MongoDB。
 *   为什么不是官方那一行 require：
 *     · 这台云开发环境没有「文档型数据库」（只有 SQL 型），而官方云开发适配器把数据库
 *       写死成云开发文档库、**不读 MONGODB_URI**（他们 README 把这项列在未验证的人工项里）；
 *     · 新版控制台把函数鉴权换成了 OPA，找不到旧的 JSON 安全规则入口，默认规则又不认
 *       「匿名登录」这个身份（EXCEED_AUTHORITY）—— 所以前端不走 SDK，改成从
 *       **HTTP 网关**那条免鉴权路由进来（官方文档：安全规则仅对客户端 SDK 调用生效）。
 *   装配方式与官方适配器逐行对齐（request / response / database / capabilities 四样必填），
 *   只换数据库；storage / mailer / notifier 由脚手架填空实现。
 *
 * 二、**黎语堂自己的账号与审核**（2026-10-07 用户要求）：
 *   「我要的不是每句话都给我审核 这样太累了 我要的是审核用户！！例如 A 在论坛上注册了
 *    两个号 一个叫 hoshi 一个叫 arcarlight 而我通过了 hoshi 这个账号的审核 那 hoshi 就可以
 *    随意在任何地方发贴发言 不再需要我的审核 而 arcarlight 因为我忘记审核了 所以它是注册了
 *    也不能发送任何东西的 一定要等到我同意这个账号过审了才能发东西」
 *   Twikoo 本身没有账号这回事（谁填昵称邮箱都能发），所以账号这层是我们自己加的：
 *     · 注册 / 登录自己的集合 lt_users（密码加盐哈希存）；
 *     · 新号状态是 pending，**发不了任何东西**；
 *     · 站长在编辑器的「黎语堂管理 → 用户」里点通过（approved）或封禁（banned）；
 *     · 发评论时**服务端硬拦**：COMMENT_SUBMIT 必须带一个已过审账号的令牌，
 *       否则直接拒绝 —— 就算有人绕开页面直接调接口也发不出去；
 *     · 顺手把昵称/邮箱按账号写死，防冒名。
 *   站长的身份用**你已经在 Twikoo 设的管理员密码**验证（内部发一次 LOGIN 事件），
 *   不额外引入第二个秘密。
 *
 * 三、**帖子与头像**（2026-10-07 晚上加）：用户能自己发帖了。
 *   用户原话：「用户可以选择发帖 帖子类似主网站的文章 可以传图写字 写好以后选择发在我
 *   已经建立的板块下」。所以：
 *     · 帖子存 lt_posts（一个帖子一篇 Markdown 正文，和主站文章一个手感）；
 *     · **图片内嵌在正文里**（前端压到 1600px 的 WebP，写成 `![图](data:image/webp;base64,…)`）——
 *       这台环境没有能用的对象存储（见下面 FLAGS.imageUpload 为什么是 false），
 *       而"发完立刻看得见"必须有地方放图，内嵌是最省事的一条路；代价（MongoDB 免费档 512MB）
 *       记在 src/data/liyutang.json 的 _readme 里；
 *     · 正文**原样存 Markdown，不做服务端渲染**：站点那边用自己写的、先转义再渲染的小解析器
 *       （src/utils/liyutang-md.mjs）—— 用户内容当 HTML 直接塞进页面是最容易出事的地方，
 *       那个解析器把一切 HTML 都当成字面文字，天然没有 XSS；
 *     · 头像也是内嵌的 data URL（前端压成 160×160 的 WebP，几 KB），存在 lt_users.avatar 上；
 *       发评论时顺手写进那条评论文档（Twikoo 的 getAvatar() 第一条就是"评论自带 avatar 就用它"）。
 *
 * 四、**聊天室**（2026-10-09 加）：一句话——"会员聊天室"，不是公开留言板。
 *   用户原话：「点进去以后所有注册后通过审核的用户只能和QQ聊天一样发一条一条的消息
 *   可以附带图片之类的 每天保存一次聊天记录」。
 *     · 消息存 lt_chat，一条一个文档；`day` 字段是**按北京时间切出来的那一天**
 *       （不是服务器时区 —— "每天保存一次"是按用户自己的自然日算的，见 dayKey()）；
 *     · **读和写都要过审**（chatWho() 那道闸门）：没登录 / 没过审的人连消息都读不到。
 *       这是刻意的：聊天室比帖子私密。要改成"路人也能读"只是一行的事；
 *     · 三道上限都在服务端：一条 800 字、一张图 ≤400KB（data URL 内嵌，和帖子一套压法）、
 *       同一个人 1.5 秒一条且一小时 ≤120 条；
 *     · 昵称 / 头像按账号写死（防冒名），`mine` 是"问的人是不是作者"，不把 userId 发出去；
 *     · **撤回**是软删（`deleted: true`，顺手把图清掉）：作者只能撤自己的；
 *     · 页面用**轮询 + 游标**（`after` = 已知最新那条的时间戳）增量拉，四秒一次，
 *       页面切到后台就停 —— 这套后端没有 WebSocket，论坛这个体量轮询足够且省额度。
 *
 * 五、**画板（久昭卿茶绘）**（2026-10-09 加）。
 *   用户原话：「点进去以后是一个巨大的公共画板 有基本的画笔橡皮调色板等功能 所有注册后通过
 *   审核的用户都可以在上面画画 …… 每天保存一次画 …… 让画画的手感可以比较舒服丝滑」。
 *     · 一笔一个文档，存 lt_draw：`{tool: pen|eraser, color: #rrggbb, size, points: [[x,y],…]}`，
 *       坐标是**画板自己的坐标系**（`BOARD_W`×`BOARD_H` = 3600×2250，和屏幕大小无关）；
 *     · **矢量笔划**（不是位图）：谁也改不了别人的像素，逐人显隐、撤销、存档都只是"筛一堆笔划"；
 *     · `uk` = 账号 id 的短哈希 —— 逐人显隐要一个稳定的键，但不该把账号 id 发给所有人；
 *     · **过审才进得来**（和聊天室同一个门槛 chatWho），限速 80 毫秒一笔、一小时 4000 笔；
 *     · 撤销 = 软删自己画的某一笔（别人的删不掉）；
 *     · 存档走 LT_ADMIN_DRAW_DAY + LT_ADMIN_DRAW_CLEAR：搬进仓库（JSON + 一张 SVG）之后
 *       **把云端那天的笔划删掉** —— 笔划在仓库里已经是完整记录了，云端留着纯占地方。
 *
 * 环境变量：MONGODB_URI（必填）、MONGODB_DB_NAME（可选，默认 twikoo）、
 *          LT_SECRET（可选，令牌签名密钥；不设就用 MONGODB_URI 派生一个）
 * ============================================================================
 */
const crypto = require('node:crypto');
const { MongoClient } = require('mongodb');
const common = require('@twikoojs/common');
const { MongoDatabase, createHandler, scaffoldAdapters } = common;
const { toTkRequest, fromTkResponse } = require('twikoo-func');

/* ============================================================ 基础配置 */

const URI = process.env.MONGODB_URI || '';
const DB_NAME = process.env.MONGODB_DB_NAME || 'twikoo';
/** 账号集合名 */
const USERS = 'lt_users';
/** 帖子集合名（用户发的帖子；Twikoo 的评论在它自己的 comment 集合里，两边互不干涉） */
const POSTS = 'lt_posts';
/** 聊天室集合名（一条消息一个文档） */
const CHAT = 'lt_chat';
/** 一条消息的字数上限 */
const CHAT_TEXT_MAX = 800;
/** 一条消息里图片的上限（前端压到 1000px 的 WebP，通常 60~120KB，这里给到 400KB 余量） */
const CHAT_IMAGE_MAX = 400 * 1024;
/** 同一个人的两条之间至少隔这么久（毫秒），以及一小时的条数上限 —— 防手抖和刷屏 */
const CHAT_GAP_MS = 1500;
const CHAT_PER_HOUR = 120;

/* ---- 画板（久昭卿茶绘）----
   ⚠ 下面这几个常量和校验，和浏览器那份 src/utils/liyutang-strokes.mjs **是同一套规矩**，
   但这里必须**抄一份**：云函数是单文件粘到控制台部署的，import 不了仓库里的模块。
   改一边记得改另一边（浏览器那份有 26 条验收盯着，见 tools/checks/liyutang-strokes-check.mjs）。 */
/** 画板集合名 */
const DRAW = 'lt_draw';
/** 画板内部坐标系（笔划坐标以它为准，和屏幕大小无关） */
/* 画板坐标系：2026-10-09 从 2400×1500 放大到 3600×2250（用户："画布现在太小了"）。
   长宽都 ×1.5、比例不变，**原点仍在左上角** —— 所以老笔划的坐标不用动、位置也不变。
   ⚠ 必须和 src/utils/liyutang-strokes.mjs 里的 BOARD_W/BOARD_H 一致，不然右下角画不上去。 */
const BOARD_W = 3600;
const BOARD_H = 2250;
/** 一根笔划最多多少个点 */
const DRAW_MAX_POINTS = 2000;
/** 画笔 / 橡皮 */
const DRAW_TOOLS = ['pen', 'eraser'];
/** 画得再快也有个谱：两根之间至少 80 毫秒，一小时最多 4000 笔 */
const DRAW_GAP_MS = 80;
const DRAW_PER_HOUR = 4000;
/**
 * 一条帖子的正文上限（字符数）。
 * 图片是内嵌进正文的 data URL，所以正文会随图片一起变胖；4MB 的正文 ≈ 3MB 的原图，
 * 一篇文章放十几张压过的图绰绰有余，同时离 MongoDB 单文档 16MB 的硬上限还很远。
 */
const POST_MAX_CHARS = 4 * 1024 * 1024;
/** 标题长度上限 */
const POST_TITLE_MAX = 80;
/** 头像上限（160×160 的 WebP 大约 8KB，这里给到 200KB 是留余量） */
const AVATAR_MAX_CHARS = 200 * 1024;
/** 令牌签名密钥：没配 LT_SECRET 就用连接串派生一个（换连接串会让已登录的人重新登录） */
const SECRET =
  process.env.LT_SECRET || crypto.createHash('sha256').update('liyutang|' + URI).digest('hex');
/** 令牌有效期：90 天 */
const TOKEN_DAYS = 90;

const FLAGS = {
  /* 能在云函数里独立跑起来的：留着 */
  mail: true,
  domPurify: true,
  ip2region: true,
  akismet: true,
  qqAvatar: true,
  /* 需要接云开发自己的服务（内容审核 / 图床 / AI）—— 这台环境没有，关掉免得点了报错 */
  tencentTms: false,
  imageUpload: false,
  ai: false,
};
/** defineCapabilities 在老版本里可能没有，那就直接用字面量 */
const capabilities =
  typeof common.defineCapabilities === 'function' ? common.defineCapabilities(FLAGS) : FLAGS;

/** Twikoo 那条数据库（它自己管 comment / config / counter / cap_kv 四个集合）
 *  ⚠ 那两个超时是 2026-10-09 加上去的：默认 5 秒对**冷启动**太紧 ——
 *  函数闲一阵之后第一枪要先跟 Atlas 建 TLS 连接，5 秒不够时会回一句
 *  「Socket 'secureConnect' timed out」，用户看到的就是"评论/登录突然坏了"，
 *  再点一次又好了。给到 12 秒（云函数执行超时是 30 秒，装得下）。 */
const twikooDb = new MongoDatabase({
  uri: URI,
  dbName: DB_NAME,
  serverSelectionTimeoutMS: 12000,
  connectTimeoutMS: 12000,
});

/** 空实现占位（官方云开发适配器也这么占位） */
const noop = async () => {};
const storageStub = {
  challenges: { store: noop, read: async () => null, delete: noop, deleteExpired: noop },
  tokens: { store: noop, get: async () => null, delete: noop, deleteExpired: noop },
};

/* ============================================================ 我们自己的 Mongo 连接 */

/**
 * 我们自己的那条连接：**账号和帖子共用一条**（Twikoo 那条是它自己管的，插不进去）。
 * 单例 + 懒建：冷实例第一次用到才连，之后复用；顺手把索引建掉（建过就是空操作）。
 * @returns {Promise<import('mongodb').Db>} 数据库
 */
let dbPromise = null;
function ourDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const client = new MongoClient(URI, {
        maxPoolSize: 5,
        /* 和 Twikoo 那条一样：冷启动建 TLS 连接有时要 6~10 秒，5 秒太紧（见上面那段注释） */
        serverSelectionTimeoutMS: 12000,
        connectTimeoutMS: 12000,
      });
      await client.connect();
      const db = client.db(DB_NAME);
      await Promise.all([
        /* 昵称唯一（大小写不敏感：存一份小写副本做键） */
        db.collection(USERS).createIndex({ nickLower: 1 }, { unique: true }),
        db.collection(POSTS).createIndex({ id: 1 }, { unique: true }),
        db.collection(POSTS).createIndex({ board: 1, createdAt: -1 }),
        db.collection(POSTS).createIndex({ authorId: 1, createdAt: -1 }),
        /* 聊天室：按"哪一天 + 时间"查（翻某天的记录），以及按人查（限速用） */
        db.collection(CHAT).createIndex({ id: 1 }, { unique: true }),
        db.collection(CHAT).createIndex({ day: 1, createdAt: 1 }),
        db.collection(CHAT).createIndex({ userId: 1, createdAt: -1 }),
        /* 画板：按天拉笔划（今天那块板），以及按人查（限速 / 撤销） */
        db.collection(DRAW).createIndex({ id: 1 }, { unique: true }),
        db.collection(DRAW).createIndex({ day: 1, createdAt: 1 }),
        db.collection(DRAW).createIndex({ userId: 1, createdAt: -1 }),
      ]).catch(() => {
        /* 索引建不上不该挡住正事（比如权限只给了读写没给建索引） */
      });
      return db;
    })();
  }
  return dbPromise;
}

/** @returns {Promise<import('mongodb').Collection>} lt_users 集合 */
const users = async () => (await ourDb()).collection(USERS);
/** @returns {Promise<import('mongodb').Collection>} lt_posts 集合 */
const posts = async () => (await ourDb()).collection(POSTS);
/** @returns {Promise<import('mongodb').Collection>} lt_chat 集合（聊天室的消息） */
const chat = async () => (await ourDb()).collection(CHAT);
/** @returns {Promise<import('mongodb').Collection>} lt_draw 集合（画板的笔划） */
const draw = async () => (await ourDb()).collection(DRAW);

/* ============================================================ 账号：密码 / 令牌 */

/**
 * 密码加盐哈希（scrypt，32 字节）。
 * @param {string} pass 明文密码
 * @param {string} salt 盐
 * @returns {string} 十六进制哈希
 */
function hashPass(pass, salt) {
  return crypto.scryptSync(String(pass), String(salt), 32).toString('hex');
}

/**
 * 比较密码（恒定时间）。
 * @param {string} pass 明文
 * @param {object} user 用户文档
 * @returns {boolean} 对不对
 */
function passOk(pass, user) {
  const got = Buffer.from(hashPass(pass, user.salt), 'hex');
  const want = Buffer.from(String(user.pass || ''), 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

/**
 * 签发令牌：`base64url(JSON).HMAC` —— 无状态，不用存表。
 * @param {string} id 用户 id
 * @returns {string} 令牌
 */
function sign(id) {
  const payload = Buffer.from(JSON.stringify({ id, exp: Date.now() + TOKEN_DAYS * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}

/**
 * 校验令牌。
 * @param {string} token 令牌
 * @returns {{id:string, exp:number}|null} 载荷或 null
 */
function verify(token) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig.length !== want.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p || !p.id || !p.exp || p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

/**
 * 一批文档（聊天消息 / 帖子 / 笔划）→ userId → **当前**昵称 的映射。
 *
 * 为什么要"读的时候查一次"而不是只存快照：用户改了昵称之后，他以前说过的话、发过的贴
 * 也该显示新昵称（用户原话是"在各种页面里那个用户都会显示昵称"）。一次 $in 查询就够
 * （一屏最多几十个作者），比给每条消息烤一个名字便宜得多。
 * @param {object[]} docs 带 userId 的文档
 * @returns {Promise<Map<string,string>>} userId → 昵称
 */
async function aliasMapOf(docs) {
  const ids = [...new Set((docs ?? []).map((d) => d && d.userId).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const rows = await (await users()).find({ id: { $in: ids } }).project({ id: 1, nick: 1, alias: 1 }).toArray();
  for (const u of rows) out.set(u.id, u.alias || u.nick);
  return out;
}

/** 用户文档 → 给页面看的字段（不带密码/盐） */
const publicUser = (u) =>
  u
    ? {
        /*
          id / uk：用户页和常驻栏需要一个"能放进 URL 的公开标识"。
          uk 是账号 id 的短哈希（笔划里用的是同一个，不把原始 id 到处发）；
          id 也一起发，方便直接写 /liyutang/u/?id=…。
        */
        id: u.id,
        uk: drawUk(u.id),
        nick: u.nick,
        /*
          「用户名」和「昵称」是两回事（2026-10-09 晚上按用户要求加的）：
            · nick   = 用户名：注册时定的、用来登录、**不能改**；
            · alias  = 昵称：随时能改，页面上到处显示的都是它（没设过就等于用户名）。
          所以对外一律发 `alias`（下面已经兜过底），页面不用自己判断。
        */
        alias: u.alias || u.nick,
        mail: u.mail,
        status: u.status,
        label: u.label || '',
        /* 头像是一张 data URL（前端压过的小图），页面直接塞进 <img src> */
        avatar: u.avatar || '',
        createdAt: u.createdAt,
        /* 画板的个人偏好（调色盘里收藏的颜色、画笔/橡皮各自的粗细）—— 跟着账号走 */
        prefs: u.prefs && typeof u.prefs === 'object' ? u.prefs : {},
      }
    : null;

/* ============================================================ 帖子：几个小工具 */

/**
 * Markdown → 一行纯文本摘要（列表里显示用）。
 * 正式渲染成 HTML 是前端的事（src/utils/liyutang-md.mjs），这里只是把图、代码块、记号去掉。
 * @param {string} md 正文
 * @param {number} [max] 最长多少字
 * @returns {string} 摘要
 */
function excerptOf(md, max = 90) {
  const text = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * 是不是一张能用的 data URL 图片（头像和封面都走这一条）。
 * @param {unknown} s 待检字符串
 * @returns {boolean} 行不行
 */
const imageDataUrl = (s) => /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(String(s || ''));

/** 正文里内嵌了几张图（Markdown 图片语法，地址是 data URL 或 http） */
const countImages = (md) => (String(md).match(/!\[[^\]]*\]\((?:data:image\/|https?:\/\/)[^)]*\)/g) || []).length;

/**
 * 版块 id 的规矩。**和站点上 src/utils/liyutang.ts 里那份保持一致。**
 * ⚠ 版块表在 src/data/liyutang.json 里，云函数看不到它 —— 所以这里只能校验**形状**；
 *   "这个版块到底存不存在"由页面负责（页面只会给出自己列出来的版块）。
 * @param {unknown} id 版块 id
 * @returns {boolean} 行不行
 */
const boardOk = (id) => /^[a-z0-9][a-z0-9-]{0,31}$/.test(String(id || ''));

/**
 * 帖子的对外形状。
 * ⚠ 列表（full=false）**故意不带正文**：正文里内嵌着图片，一人几 MB 会把列表拖死。
 * @param {object} doc 数据库里那条
 * @param {boolean} [full] 要不要带正文
 * @returns {object|null} 给页面看的
 */
function publicPost(doc, full = false) {
  if (!doc) return null;
  const out = {
    id: doc.id,
    board: doc.board,
    title: doc.title,
    excerpt: doc.excerpt || excerptOf(doc.md),
    cover: doc.cover || '',
    authorNick: doc.authorNick,
    /* 帖子的显示名同理：优先当前昵称，其次建贴时烤进去的那个名字 */
    authorAlias: doc.authorAlias || doc.authorNick,
    authorAvatar: doc.authorAvatar || '',
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt || doc.createdAt,
    status: doc.status || 'ok',
    pinned: doc.pinned ? 1 : 0,
    views: doc.views || 0,
    images: doc.images || 0,
  };
  if (full) out.md = String(doc.md || '');
  return out;
}

/**
 * 按令牌找用户。
 * @param {string} token 令牌
 * @returns {Promise<object|null>} 用户文档
 */
async function userByToken(token) {
  const p = verify(token);
  if (!p) return null;
  const col = await users();
  return col.findOne({ id: p.id });
}

/* ============================================================ Twikoo 那条路 */

/**
 * 把一次业务事件交给 Twikoo 处理（和我们对外暴露的入口用的是同一套装配）。
 * @param {object} payload 业务事件
 * @param {object} [context] 云函数上下文
 * @returns {Promise<object>} Twikoo 的返回体
 */
async function runTwikoo(payload, context) {
  const request = toTkRequest(payload, context);
  const slots = {
    request: { toTkRequest: () => request },
    response: { fromTkResponse },
    database: twikooDb,
    capabilities,
    storage: storageStub,
    mailer: { send: noop },
    notifier: { notify: noop },
    postSubmit: { dispatch: async () => {} },
  };
  const handler = createHandler(
    typeof scaffoldAdapters === 'function'
      ? {
          ...scaffoldAdapters({
            request: slots.request,
            response: slots.response,
            database: twikooDb,
            capabilities,
          }),
          postSubmit: slots.postSubmit,
        }
      : slots
  );
  return fromTkResponse(await handler(request));
}

/**
 * 这个密码是不是站长（= Twikoo 的管理员密码）。
 *
 * ⚠ **要先把密码 md5 一下再问** —— Twikoo 的规矩是「客户端本地算 md5(密码) 作为 accessToken 上送」，
 * 服务端拿 `config.ADMIN_PASS !== md5(收到的值)` 比对（见 @twikoojs/common 的 services/user.ts）。
 * 也就是说：这里要传的是 **md5(用户敲的密码)**，不是原文。
 * （2026-10-07 踩过：传了原文，于是"密码明明是对的却报密码错误"——评论区小齿轮能进、
 *   我们这个接口进不去。本地测试当时两边都传原文，错误互相抵消，还全绿了。）
 * @param {string} password 用户敲的**原文**密码
 * @returns {Promise<{ok:boolean, message:string}>} 是不是 + Twikoo 的原话
 */
async function adminCheck(password) {
  if (!password) return { ok: false, message: '没填站长密码' };
  try {
    const hashed = crypto.createHash('md5').update(String(password)).digest('hex');
    const res = await runTwikoo({ event: 'LOGIN', password: hashed });
    return { ok: res?.code === 0, message: String(res?.message ?? '') };
  } catch (err) {
    return { ok: false, message: String(err?.message ?? err) };
  }
}

/* ============================================================ 聊天室：那几个事件 */

/**
 * 「这一天」是哪一天 —— **按北京时间切**（+8），不是按服务器时区。
 *
 * 为什么自己算：用户说的「每天保存一次聊天记录」是按他自己那个自然日算的，
 * 而云函数跑在哪个时区不由我们定（现在这台在上海，但别指望这个）。
 * 存进文档里的 `day` 就是"存档切哪一天"的依据，所以它必须是个写死的规矩。
 * @param {number} [ts] 毫秒时间戳
 * @returns {string} yyyy-mm-dd
 */
function dayKey(ts = Date.now()) {
  /*
    切天点是**北京时间凌晨 4 点**，不是 0 点（2026-10-09 用户要求）：
    "昨天凌晨四点到今天凌晨四点之间有没有人画过画/说过话" —— 所以"一天"= 04:00 到次日 04:00。
    实现就是把北京日期整体往前推 4 小时：ts + 8h - 4h。
    ⚠ 存档脚本的 yesterdayInBeijing 必须用同一个偏移，不然会漏掉/重复那四个小时。
  */
  return new Date(Number(ts) + 4 * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * 一条消息的对外形状。
 * `mine` 由调用方按"问的人是谁"补上（不把 userId 发出去 —— 那是账号的内部 id）。
 * @param {object} d 数据库里那条
 * @param {string} [meId] 提问者的账号 id
 * @returns {object} 给页面看的
 */
function publicMsg(d, meId = '') {
  return {
    id: d.id,
    day: d.day,
    /*
      显示名：优先"当前昵称"（列表查完按 userId 盖进来的），其次文档里那份快照。
      这样改了昵称，他以前说过的话也跟着显示新昵称。
    */
    alias: d.alias || d.nick,
    nick: d.nick,
    avatar: d.avatar || '',
    text: d.text || '',
    image: d.image || '',
    createdAt: d.createdAt,
    mine: !!meId && d.userId === meId,
  };
}

/**
 * 聊天室那张桌子：**过审才进得来**（读也一样）。
 *
 * 用户原话：「点进去以后所有注册后通过审核的用户只能和QQ聊天一样发一条一条的消息」——
 * 所以这里是"会员聊天室"，不是公开留言板：没登录 / 没过审的人看到的是"要过审才能看"。
 * （要不要让路人也能读，是一句话的事，跟站长确认过口径再改。）
 * @param {object} payload 请求体
 * @returns {Promise<{user: object}|{error: object}>} 过审的账号，或者一个错误返回体
 */
async function chatWho(payload) {
  const user = await userByToken(payload.ltToken);
  if (!user) return { error: bad('聊天室要登录才能进 —— 注册之后等站长过审。') };
  if (user.status === 'pending') return { error: bad('你的账号还在等站长审核，通过之后就能进来聊了。') };
  if (user.status !== 'approved') return { error: bad('这个账号被停用了。') };
  return { user };
}

/**
 * 聊天室相关事件（LT_CHAT_*）。限速和字数都在这里，服务端说了算。
 * @param {string} event 事件名
 * @param {object} payload 请求体
 * @returns {Promise<object>} 返回体
 */
async function handleChatEvent(event, payload) {
  const who = await chatWho(payload);
  if (who.error) return who.error;
  const me = who.user;
  const col = await chat();

  /* ---- 读某一天的消息 ---- */
  if (event === 'LT_CHAT_LIST') {
    /* 不给 day 就默认"今天"：页面平时只拉今天，翻旧账时才会带 day（存档页是静态的，不走这儿） */
    const day = String(payload.day || '') || dayKey();
    const filter = { day, deleted: { $ne: true } };
    /*
      ⚠ 2026-10-10 和画板那条一起改的：原来这里一次给最多 200 条，而一条带图的 data URL 能到 ~533KB ——
      一天里十几张图，响应体就撞上腾讯云 6MB 上限，**整个聊天室打不开**。
      现在同样按**字节预算**装（2MB 一批，给 6MB 留足余量），并把 `more` / `next` 一起回给页面，
      页面看到 more 立刻带游标再要一趟（分几批到，但一定会拉全）。
      游标用 `(createdAt, id)` 复合：只按 createdAt 的话同一毫秒的几条会被 `$gt` 漏掉；
      而且**绝不切断同一毫秒那一组**（老页面只认一个 createdAt 游标，截断了它就永远拉不到剩下那几条）。
    */
    const afterTs = Number(payload.after) || 0;
    const afterId = String(payload.afterId || '');
    if (afterTs) {
      /* 同画板那条：只有 afterId 也给了才启用"同一时间戳"那一条（老页面只发 after，不能把游标那一条自己捞回来） */
      filter.$or = [{ createdAt: { $gt: afterTs } }];
      if (afterId) filter.$or.push({ createdAt: afterTs, id: { $gt: afterId } });
    }
    const limit = Math.min(Math.max(Number(payload.limit) || 200, 1), 500);
    const budget = 2 * 1024 * 1024;
    const docs = await col.find(filter).sort({ createdAt: 1, id: 1 }).limit(limit).toArray();
    /*
      一屏消息的作者 → **当前**昵称（改了名，他以前说的话也跟着显示新昵称）。
      一次 $in 查询，最多几十个作者，很便宜。
    */
    const amChat = await aliasMapOf(docs);
    for (const d of docs) d.alias = amChat.get(d.userId) || d.alias;
    const messages = [];
    let bytes = 0;
    let more = false;
    let lastTs = 0;
    for (const d of docs) {
      const m = publicMsg(d, me.id);
      const n = JSON.stringify(m).length;
      const ts = Number(m.createdAt) || 0;
      if (messages.length && bytes + n > budget && ts !== lastTs) {
        more = true;
        break;
      }
      bytes += n;
      lastTs = ts;
      messages.push(m);
    }
    if (!more && docs.length === limit) more = true;
    const last = messages[messages.length - 1];
    return ok({
      day,
      messages,
      serverNow: Date.now(),
      /* 云函数那边"今天"是哪天（页面用它判断是不是跨零点了） */
      today: dayKey(),
      more,
      next: last ? { ts: Number(last.createdAt) || 0, id: last.id } : null,
    });
  }

  /* ---- 发一条 ---- */
  if (event === 'LT_CHAT_SEND') {
    const text = String(payload.text || '').trim();
    const image = String(payload.image || '');
    if (!text && !image) return bad('空消息就不发了。');
    if (text.length > CHAT_TEXT_MAX) return bad(`一条最多 ${CHAT_TEXT_MAX} 个字。`);
    if (image) {
      if (!imageDataUrl(image)) return bad('图片格式不对（要 PNG / JPEG / WebP / GIF）。');
      if (image.length > CHAT_IMAGE_MAX) return bad('图片太大了 —— 页面会自动压到 1000px，再选一次试试。');
    }
    const now = Date.now();
    /* 限速：先看这个人最后一条，再看这一小时发了多少 */
    const last = await col.find({ userId: me.id }).sort({ createdAt: -1 }).limit(1).toArray();
    if (last[0] && now - last[0].createdAt < CHAT_GAP_MS) {
      return bad(`慢一点，${Math.ceil(CHAT_GAP_MS / 1000)} 秒一条。`);
    }
    const hourCount = await col.countDocuments({ userId: me.id, createdAt: { $gt: now - 3600 * 1000 } });
    if (hourCount >= CHAT_PER_HOUR) return bad(`一小时最多 ${CHAT_PER_HOUR} 条，歇一会儿再聊。`);

    const doc = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      day: dayKey(now),
      userId: me.id,
      /* 昵称 / 头像按账号写死，防冒名（和评论、帖子一个规矩） */
      nick: me.nick,
      avatar: me.avatar || '',
      text,
      image,
      createdAt: now,
      deleted: false,
    };
    await col.insertOne(doc);
    return ok({ message: publicMsg(doc, me.id), serverNow: now });
  }

  /* ---- 删自己刚发的那条（说错话、发错图的退路） ---- */
  if (event === 'LT_CHAT_DELETE') {
    const id = String(payload.id || '');
    if (!id) return bad('没说是哪一条。');
    const doc = await col.findOne({ id });
    if (!doc) return bad('这条已经不在了。');
    if (doc.userId !== me.id) return bad('只能删自己发的。');
    await col.updateOne({ id }, { $set: { deleted: true, deletedAt: Date.now(), image: '' } });
    return ok({ id });
  }

  return bad('不认识的聊天事件：' + event);
}

/* ============================================================ 画板：那几个事件 */

/**
 * 画板上的颜色只收 `#rrggbb`。
 * 用户写的颜色最后会进 SVG 属性 —— 这条路必须堵死（和 src/utils/liyutang-strokes.mjs 同一套）。
 * @param {unknown} c 待检颜色
 * @returns {string} 规整后的颜色，或者空串
 */
function drawColor(c) {
  const s = String(c ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return '#' + s.slice(1).split('').map((x) => x + x).join('');
  return '';
}

/**
 * 一根笔划的点：夹进画布、去掉重复、截到上限。
 * @param {unknown} points 点集
 * @returns {number[][]} 规整后的点（空数组 = 这根笔划不算数）
 */
function cleanDrawPoints(points) {
  const out = [];
  for (const p of Array.isArray(points) ? points : []) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const x = Math.round(Math.min(BOARD_W, Math.max(0, Number(p[0]) || 0)) * 10) / 10;
    const y = Math.round(Math.min(BOARD_H, Math.max(0, Number(p[1]) || 0)) * 10) / 10;
    const last = out[out.length - 1];
    if (last && last[0] === x && last[1] === y) continue;
    out.push([x, y]);
    if (out.length >= DRAW_MAX_POINTS) break;
  }
  return out;
}

/**
 * 一个人在这块板上的"笔名"：账号 id 的短哈希。
 * 逐人显隐需要一个稳定的键，但**不该把账号 id 发给所有人** —— 所以发这个短哈希。
 * @param {string} id 账号 id
 * @returns {string} 8 位十六进制
 */
const drawUk = (id) => crypto.createHash('sha1').update(String(id)).digest('hex').slice(0, 8);

/**
 * 一根笔划的对外形状。
 * @param {object} d 数据库里那条
 * @param {string} [meUk] 提问者自己的 uk（用来标"这根是你的"）
 * @returns {object} 给页面看的
 */
function publicStroke(d, meUk = '') {
  return {
    id: d.id,
    uk: d.uk,
    nick: d.nick,
    alias: d.alias || d.nick,
    avatar: d.avatar || '',
    tool: d.tool,
    color: d.color,
    size: d.size,
    points: d.points,
    createdAt: d.createdAt,
    /*
      updatedAt 是**增量同步的游标**（2026-10-09 晚上加）：线条被拖动/被改过之后，
      别的客户端靠它才知道"这一笔变了"，不然拖完只有自己看得见。
    */
    updatedAt: d.updatedAt || d.createdAt,
    mine: !!meUk && d.uk === meUk,
  };
}

/**
 * 画板偏好（跟着账号走的那种记忆）：只收认识的字段，非法值一律丢掉 ——
 * 不让用户往自己的文档里塞任意东西。
 *   · palette：收藏在调色盘里的颜色，最多 24 个 `#rrggbb`（去重）
 *   · penSize / eraserSize：**画笔和橡皮各自的粗细**（1~64，不绑死）
 *   · color / tool：上次用的颜色和工具（下次进来接着用）
 * @param {unknown} input 前端传来的偏好
 * @returns {object|null} 规整后的偏好；整个不是对象就 null
 */
function checkPrefs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  if (Array.isArray(input.palette)) {
    const seen = new Set();
    out.palette = [];
    for (const c of input.palette) {
      const v = drawColor(c);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.palette.push(v);
      if (out.palette.length >= 24) break;
    }
  }
  for (const k of ['penSize', 'eraserSize']) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const n = Number(input[k]);
    if (!Number.isFinite(n)) continue;
    out[k] = Math.round(Math.min(64, Math.max(1, n)) * 10) / 10;
  }
  if (input.color !== undefined) {
    const c = drawColor(input.color);
    if (c) out.color = c;
  }
  if (input.tool === 'pen' || input.tool === 'eraser' || input.tool === 'pan' || input.tool === 'move' || input.tool === 'pick') out.tool = input.tool;
  /* 两个开关也存账号上（换设备也在）：网格线显示、橡皮是否擦所有人 */
  for (const k of ["grid", "eraserAll"]) {
    if (typeof input[k] === "boolean") out[k] = input[k];
  }
  return out;
}

/**
 * 画板的事件（LT_DRAW_*）。
 *
 * 规矩和聊天室一样：**过审才进得来、才能画**（同一个门槛 chatWho）。
 * 但画板有它自己的两个讲究：
 *   ① 一笔一个文档、**按天**存（和聊天室同一个"北京时间切天"），因为一天一块板；
 *   ② 限速按"笔"算：80 毫秒一笔（画得再快也有个谱）、一小时 4000 笔 —— 挡的是脚本刷，
 *      正常画画碰不到这个天花板。
 * @param {string} event 事件名
 * @param {object} payload 请求体
 * @returns {Promise<object>} 返回体
 */
async function handleDrawEvent(event, payload) {
  const who = await chatWho(payload);
  if (who.error) return who.error;
  const me = who.user;
  const meUk = drawUk(me.id);
  const col = await draw();

  /* ---- 拉今天的板（增量：只要比游标新的） ---- */
  if (event === 'LT_DRAW_LIST') {
    /*
      ⚠⚠ 2026-10-10 修的那个"画多了就超 6MB"的问题就在这里（用户原话：「非常严重」）。
      原来这一枪默认 `limit = 1500`，一天的笔划多起来之后**一次响应能到 10MB**，
      直接撞上腾讯云 6MB 上限 → 云函数抛 FUNCTIONS_INVOCATION_FAILED →
      **所有人打开画板都是一片空白 + "连不上服务器"**。画得越多越打不开，恶性循环。
      现在改成"**按字节预算装**"：一批最多装到 2MB（给 6MB 留足余量），装不下就把剩下的留给下一趟；
      客户端看到 `more: true` 会带着游标立刻再要一趟（这条循环早就在了），于是它**照样能拉完整个白天**，
      只是分几次到 —— 从"整块打不开"变成"几百毫秒内分批出现"。
      两个细节：
        · 游标是 `(updatedAt, id)` 复合游标。只按 updatedAt 的话，同一毫秒的几笔会被 `$gt` 漏掉
          （拖动过的线条要用 updatedAt 才拉得到新位置，所以不能改回 createdAt）。
        · 预算裁剪那一步**绝不切断同一毫秒那一组**（装不下就整组一起留给下一批）。
          诚实说明一处边界：如果一批恰好卡在**查询条数上限**（limit）上，同毫秒的另一组可能跨批 ——
          新页面有复合游标不受影响；只有 2026-10-10 之前部署的老页面（只认一个 updatedAt 游标）
          在"函数已更新、站点还没重新部署"那几分钟里，理论上会漏掉跨批的同毫秒笔划。
    */
    const day = String(payload.day || '') || dayKey();
    const baseFilter = { day, deleted: { $ne: true } };
    const afterTs = Number(payload.after) || 0;
    const afterId = String(payload.afterId || '');
    const limit = Math.min(Math.max(Number(payload.limit) || 500, 1), 2000);
    const budget = 2 * 1024 * 1024;
    /*
      游标字段 = `updatedAt`，**没有这个键的老文档就退回 createdAt**（那个键是 2026-10-09 晚上才加的）。
      为什么放在聚合里算、而不是写成 `$or` 条件：老文档的 updatedAt 是"缺失"，排序时当 null 排在最前，
      而过滤又想按 createdAt 比 —— 两边一错位，翻页就会**跳着给**、页数早期就 `more:false` 收工
      （2026-10-10 验收里就是这么红的：4000 笔只翻出 597 笔）。用 `$ifNull` 把两条路并成一个字段，
      排序和过滤就是同一把尺子，怎么翻都不会跳。
    */
    const pipeline = [
      { $match: baseFilter },
      { $addFields: { cur: { $ifNull: ['$updatedAt', '$createdAt'] } } },
    ];
    if (afterTs) {
      const cursorMatch = [{ cur: { $gt: afterTs } }];
      /* ⚠ 只有 afterId 也给了才启用"同一时间戳"那一条 —— 老页面只发一个 after，
         那时 `id > ''` 会把游标那一笔自己又捞回来（"没有新笔划时应该是空的"当场变红）。 */
      if (afterId) cursorMatch.push({ cur: afterTs, id: { $gt: afterId } });
      pipeline.push({ $match: { $or: cursorMatch } });
    }
    pipeline.push({ $sort: { cur: 1, id: 1 } }, { $limit: limit });
    const docs = await col.aggregate(pipeline).toArray();
    /* 作画者 → 当前昵称（改了名，之前画的笔划也显示新名） */
    const amDraw = await aliasMapOf(docs);
    for (const d of docs) d.alias = amDraw.get(d.userId) || d.alias;
    const strokes = [];
    let bytes = 0;
    let more = false;
    let lastTs = 0;
    for (const d of docs) {
      const s = publicStroke(d, meUk);
      const n = JSON.stringify(s).length;
      const ts = Number(s.updatedAt ?? s.createdAt) || 0;
      if (strokes.length && bytes + n > budget && ts !== lastTs) {
        more = true; /* 装不下 → 剩下的下一趟再来（绝不切断同一毫秒那一组） */
        break;
      }
      bytes += n;
      lastTs = ts;
      strokes.push(s);
    }
    if (!more && docs.length === limit) more = true;
    const last = strokes[strokes.length - 1];
    return ok({
      day,
      strokes,
      serverNow: Date.now(),
      today: dayKey(),
      /* 还有更多（说明这一趟没拉完，页面下次带游标继续） */
      more,
      /* 给新客户端用的复合游标；老客户端继续用自己算的 updatedAt，行为不变 */
      next: last ? { ts: Number(last.updatedAt ?? last.createdAt) || 0, id: last.id } : null,
    });
  }

  /* ---- 画一笔 ---- */
  if (event === 'LT_DRAW_ADD') {
    const tool = DRAW_TOOLS.includes(String(payload.tool)) ? String(payload.tool) : '';
    if (!tool) return bad('工具只能是 pen / eraser。');
    const color = drawColor(payload.color);
    if (!color) return bad('颜色要是 #rrggbb。');
    const size = Math.round(Math.min(64, Math.max(1, Number(payload.size) || 3)) * 10) / 10;
    const points = cleanDrawPoints(payload.points);
    if (!points.length) return bad('这根笔划一个点都没有。');

    const now = Date.now();
    const last = await col.find({ userId: me.id }).sort({ createdAt: -1 }).limit(1).toArray();
    if (last[0] && now - last[0].createdAt < DRAW_GAP_MS) return bad('画太快了，慢一点。');
    const hourCount = await col.countDocuments({ userId: me.id, createdAt: { $gt: now - 3600 * 1000 } });
    if (hourCount >= DRAW_PER_HOUR) return bad(`一小时最多 ${DRAW_PER_HOUR} 笔，歇一会儿。`);

    const doc = {
      id: crypto.randomUUID().replace(/-/g, '').slice(0, 12),
      day: dayKey(now),
      userId: me.id,
      uk: meUk,
      /* 昵称 / 头像按账号写死（逐人显隐那张表要显示是谁画的）—— 显示用的是昵称 alias */
      nick: me.nick,
      alias: me.alias || me.nick,
      avatar: me.avatar || '',
      tool,
      color,
      size,
      points,
      createdAt: now,
      updatedAt: now,
      deleted: false,
    };
    await col.insertOne(doc);
    return ok({ stroke: publicStroke(doc, meUk), serverNow: now });
  }

  /* ---- 拖动一根线条（只给"自己画的"）：整条平移，再整条夹回画板 ---- */
  if (event === 'LT_DRAW_MOVE') {
    const id = String(payload.id || '');
    if (!id) return bad('没说是哪一笔。');
    const dx = Number(payload.dx) || 0;
    const dy = Number(payload.dy) || 0;
    if (!dx && !dy) return bad('没说要挪多少。');
    if (Math.abs(dx) > BOARD_W || Math.abs(dy) > BOARD_H) return bad('挪得太远了。');
    const doc = await col.findOne({ id });
    if (!doc) return bad('这一笔已经不在了。');
    if (doc.userId !== me.id) return bad('只能挪自己画的。');
    const points = (doc.points || []).map(([x, y]) => [
      Math.round(Math.min(BOARD_W, Math.max(0, x + dx)) * 10) / 10,
      Math.round(Math.min(BOARD_H, Math.max(0, y + dy)) * 10) / 10,
    ]);
    const updatedAt = Date.now();
    await col.updateOne({ id }, { $set: { points, updatedAt } });
    return ok({ stroke: publicStroke({ ...doc, points, updatedAt }, meUk), serverNow: updatedAt });
  }

  /* ---- 撤销：删自己最后画的那一笔（只给 id 也行，但要确认是你的） ---- */
  if (event === 'LT_DRAW_DELETE') {
    const id = String(payload.id || '');
    if (!id) return bad('没说是哪一笔。');
    const doc = await col.findOne({ id });
    if (!doc) return bad('这一笔已经不在了。');
    if (doc.userId !== me.id) return bad('只能撤自己画的。');
    await col.updateOne({ id }, { $set: { deleted: true, deletedAt: Date.now() } });
    return ok({ id });
  }

  return bad('不认识的画板事件：' + event);
}

/* ============================================================ 帖子：那几个事件 */

/**
 * 帖子相关的用户事件（LT_POST_*）。站长那几个（LT_ADMIN_POST_*）在下面站长那一段里。
 *
 * 规矩和评论一样：**没过审的账号一个字都发不出去**，而且这里比评论更严 ——
 * 评论那条路是 Twikoo 的，我们只能在门口拦；帖子这条路整条都是我们的，作者身份不存在"冒名"的余地。
 * @param {string} event 事件名
 * @param {object} payload 请求体
 * @returns {Promise<object>} 返回体
 */
async function handlePostEvent(event, payload) {
  const col = await posts();

  /* ---- 列表 ---- */
  if (event === 'LT_POST_LIST') {
    const board = String(payload.board || '');
    const limit = Math.min(Math.max(Number(payload.limit) || 20, 1), 50);
    const filter = {};
    if (board) filter.board = board;
    if (payload.mine) {
      const me = await userByToken(payload.ltToken);
      if (!me) return bad('请先登录再看待审的帖子');
      filter.authorId = me.id;
    } else {
      /* 被站长隐藏的不出现在公开列表里 */
      filter.status = { $ne: 'hidden' };
    }
    /* 翻页游标：给"最后一条的 createdAt"。比 skip/offset 稳 —— 新帖插进来不会串页 */
    const before = Number(payload.before) || 0;
    if (before) filter.createdAt = { $lt: before };
    const docs = await col
      .find(filter)
      .sort({ pinned: -1, createdAt: -1 })
      .limit(limit)
      .toArray();
    /* 作者 → 当前昵称（改了名，他以前发的贴也跟着显示新昵称） */
    const amPost = await aliasMapOf(docs);
    for (const d of docs) d.authorAlias = amPost.get(d.authorId) || d.authorAlias;
    return ok({ posts: docs.map((d) => publicPost(d)), more: docs.length === limit });
  }

  /* ---- 读一条（顺便 +1 浏览） ---- */
  if (event === 'LT_POST_GET') {
    const id = String(payload.id || '');
    if (!id) return bad('没说是哪一条帖子');
    const doc = await col.findOne({ id });
    if (!doc) return bad('这条帖子不在了（可能被作者或站长删掉了）');
    const me = await userByToken(payload.ltToken);
    const mine = !!(me && me.id === doc.authorId);
    if (doc.status === 'hidden' && !mine) return bad('这条帖子被站长隐藏了');
    await col.updateOne({ id }, { $inc: { views: 1 } }).catch(() => {
      /* 浏览量加不上不是事 */
    });
    /* 作者名换成**当前**昵称（老帖子里烤进去的是用户名，这里盖掉） */
    const amOne = await aliasMapOf([doc]);
    const withAlias = { ...doc, views: (doc.views || 0) + 1, authorAlias: amOne.get(doc.authorId) || doc.authorAlias };
    return ok({ post: publicPost(withAlias, true), mine });
  }

  /* ---- 发帖 ---- */
  if (event === 'LT_POST_CREATE') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('要发帖请先注册并登录 —— 账号需要站长审核通过才能发东西。');
    if (user.status === 'pending') return bad('你的账号还在等站长审核，通过之后就能发帖了。');
    if (user.status !== 'approved') return bad('这个账号被停用了。');
    const board = String(payload.board || '');
    const title = String(payload.title || '').trim();
    const md = String(payload.md || '');
    if (!boardOk(board)) return bad('得先选一个版块');
    if (title.length < 2 || title.length > POST_TITLE_MAX) return bad(`标题要 2~${POST_TITLE_MAX} 个字`);
    if (!md.trim()) return bad('正文还是空的');
    if (md.length > POST_MAX_CHARS) return bad('正文太大了（正文里内嵌的图片合计不能超过 4MB，少放几张图再试）');
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
    const now = Date.now();
    const doc = {
      id,
      board,
      title,
      md,
      excerpt: excerptOf(md),
      cover: imageDataUrl(payload.cover) ? String(payload.cover) : '',
      images: countImages(md),
      authorId: user.id,
      authorNick: user.nick,
    authorAlias: user.alias || user.nick,
      /* 顺手把作者当下的头像抄一份进帖子：改头像之后旧帖不跟着变，但列表不用为每条帖再查一次账号 */
      authorAvatar: user.avatar || '',
      createdAt: now,
      updatedAt: now,
      status: 'ok',
      pinned: 0,
      views: 0,
    };
    await col.insertOne(doc);
    return ok({ id, post: publicPost(doc) });
  }

  /* ---- 改自己的帖子 ---- */
  if (event === 'LT_POST_UPDATE') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('请先登录');
    const doc = await col.findOne({ id: String(payload.id || '') });
    if (!doc) return bad('这条帖子不在了');
    if (doc.authorId !== user.id) return bad('只能改自己发的帖子');
    const set = { updatedAt: Date.now() };
    if (payload.title !== undefined) {
      const title = String(payload.title || '').trim();
      if (title.length < 2 || title.length > POST_TITLE_MAX) return bad(`标题要 2~${POST_TITLE_MAX} 个字`);
      set.title = title;
    }
    if (payload.md !== undefined) {
      const md = String(payload.md || '');
      if (!md.trim()) return bad('正文不能改成空的');
      if (md.length > POST_MAX_CHARS) return bad('正文太大了（内嵌的图片合计不能超过 4MB）');
      set.md = md;
      set.excerpt = excerptOf(md);
      set.images = countImages(md);
    }
    if (payload.cover !== undefined) set.cover = imageDataUrl(payload.cover) ? String(payload.cover) : '';
    await col.updateOne({ id: doc.id }, { $set: set });
    return ok({ id: doc.id, post: publicPost({ ...doc, ...set }, true) });
  }

  /* ---- 删自己的帖子 ---- */
  if (event === 'LT_POST_DELETE') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('请先登录');
    const doc = await col.findOne({ id: String(payload.id || '') });
    if (!doc) return bad('这条帖子不在了');
    if (doc.authorId !== user.id) return bad('只能删自己发的帖子');
    await col.deleteOne({ id: doc.id });
    return ok({ id: doc.id });
  }

  return bad('不认识的帖子事件：' + event);
}

/* ============================================================ 账号：那几个事件 */

const ok = (extra = {}) => ({ code: 0, ...extra });
/*
  ⚠ 错误码必须能区分「你没登录 / 令牌过期」和「服务器临时出问题」——
  2026-10-09 群友那次"刷新、换页面就掉登录"就是因为分不出来：
  那时所有错误都是默认的 1000，而云函数冷启动连不上数据库也回 1000，
  页面只好一律当成"登录过期"，顺手把令牌删了 —— 网络抖一下就永久登出。
  现在：**令牌无效/过期一律 401**（页面看到 401 才准删令牌），其他错误仍旧 1000
  （页面要保留登录状态，只是"这一次操作没成功"）。
*/
const AUTH = 401;
const bad = (message, code = 1000) => ({ code, message });

/** 昵称/邮箱/密码的基本校验（返回错误文案或空串） */
function checkFields({ nick, mail, pass }) {
  if (!/^[\w\u4e00-\u9fa5.-]{2,20}$/.test(String(nick || ''))) return '昵称要 2~20 个字（中英文数字 - _ . 都行）';
  if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(mail))) return '邮箱格式看着不对';
  if (String(pass || '').length < 6) return '密码至少 6 位';
  return '';
}

/**
 * 处理我们自己的事件。不是我们的就返回 null（交回给 Twikoo）。
 * @param {object} payload 业务事件
 * @returns {Promise<object|null>} 返回体或 null
 */
async function handleUserEvent(payload) {
  const event = String(payload?.event || '');
  if (!event.startsWith('LT_')) return null;
  const col = await users();

  /* ---- 注册 ---- */
  if (event === 'LT_REGISTER') {
    const nick = String(payload.nick || '').trim();
    const mail = String(payload.mail || '').trim();
    const pass = String(payload.pass || '');
    const err = checkFields({ nick, mail, pass });
    if (err) return bad(err);
    const nickLower = nick.toLowerCase();
    if (await col.findOne({ nickLower })) return bad('这个昵称已经有人用了，换一个');
    if (mail && (await col.findOne({ mailLower: mail.toLowerCase() }))) return bad('这个邮箱已经注册过了');
    const salt = crypto.randomBytes(16).toString('hex');
    await col.insertOne({
      id: crypto.randomUUID(),
      nick,
      nickLower,
      mail,
      mailLower: mail.toLowerCase(),
      salt,
      pass: hashPass(pass, salt),
      status: 'pending',
      label: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    return ok({ status: 'pending', message: '注册好了，等站长审核通过就能发言。' });
  }

  /* ---- 登录 ---- */
  if (event === 'LT_LOGIN') {
    const nick = String(payload.nick || '').trim().toLowerCase();
    const user = await col.findOne({ nickLower: nick });
    if (!user || !passOk(String(payload.pass || ''), user)) return bad('昵称或密码不对');
    if (user.status === 'banned') return bad('这个账号被停用了');
    return ok({ token: sign(user.id), user: publicUser(user) });
  }

  /* ---- 我是谁（拿令牌问状态，页面用来决定显示什么） ---- */
  if (event === 'LT_ME') {
    const user = await userByToken(payload.ltToken);
    /* 401 = 令牌真无效/过期（页面只有看到这个码才准删令牌）；没带令牌是另一回事 */
    if (!user) return bad(String(payload.ltToken || '') ? '登录状态过期了，重新登录一下' : '还没登录', payload.ltToken ? AUTH : 1000);
    const mine = await (await posts()).countDocuments({ authorId: user.id });
    return ok({ user: publicUser(user), posts: mine });
  }

  /* ---- 看某个人的公开资料（2026-10-09 晚上加）：用户页要能看别人 ---- */
  if (event === 'LT_USER_GET') {
    const id = String(payload.id || '').trim();
    if (!id) return bad('要看谁的资料？');
    const u = await (await users()).findOne({ id });
    if (!u) return bad('没有这个人');
    const mine = await userByToken(payload.ltToken);
    /*
      ⚠ 变量别叫 `posts`：那个名字在这一层是**集合函数**，用同名局部变量会把它遮住，
      于是 `await posts()` 直接抛 "Cannot access 'posts' before initialization"（TDZ）——
      2026-10-09 晚上验收里逮住过一次（LT_ME 那边用的是 mine，所以它没这个问题）。
    */
    const postCount = await (await posts()).countDocuments({ authorId: u.id });
    if (mine && mine.id === u.id) {
      /* 看自己：连"我发了几篇"一起给，页面好显示 */
      return ok({ user: publicUser(u), me: true, posts: postCount });
    }
    /*
      看别人：只给公开字段 —— **邮箱不发**（那是账号隐私），
      头像 / 用户名 / 昵称 / 标签 / 什么时候注册的，这些是公开的。
      以后要展示"他发过的贴 / 画过的画 / 上传的背景"也挂在这里。
    */
    const pub = publicUser(u);
    delete pub.mail;
    return ok({ user: pub, me: false, posts: postCount });
  }

  /* ---- 改昵称（2026-10-09 晚上加）：昵称随时能改，用户名不动 ---- */
  if (event === 'LT_PROFILE_SET') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('请先登录', AUTH);
    if (user.status === 'banned') return bad('这个账号被停用了');
    const alias = String(payload.alias ?? '').trim().replace(/\s+/g, ' ');
    /* 和注册同一个尺度：2~20 个字；用户名叫 nick，昵称叫 alias，两者可以不一样 */
    if (!/^[\w\u4e00-\u9fa5.-]{2,20}$/.test(alias)) return bad('昵称要 2~20 个字（中英文数字 - _ . 都行）');
    await (await users()).updateOne({ id: user.id }, { $set: { alias } });
    return ok({ user: publicUser({ ...user, alias }) });
  }

  /* ---- 画板的个人偏好（调色盘收藏 + 画笔/橡皮各自粗细）—— 跟着账号走，换设备也还在 ---- */
  if (event === 'LT_PREFS_SET') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('请先登录', AUTH);
    if (user.status === 'banned') return bad('这个账号被停用了');
    const prefs = checkPrefs(payload.prefs);
    if (!prefs) return bad('偏好数据看着不对');
    await (await users()).updateOne({ id: user.id }, { $set: { prefs } });
    return ok({ prefs });
  }

  /* ---- 换头像（登录了就能换，不用等过审 —— 头像不影响能不能发言） ---- */
  if (event === 'LT_AVATAR_SET') {
    const user = await userByToken(payload.ltToken);
    if (!user) return bad('请先登录再换头像');
    if (user.status === 'banned') return bad('这个账号被停用了');
    const avatar = String(payload.avatar || '');
    if (avatar && !imageDataUrl(avatar)) return bad('头像要是一张 PNG / JPEG / WebP / GIF 图片');
    if (avatar.length > AVATAR_MAX_CHARS) return bad('头像太大了（压到 200KB 以内，前端会自动压）');
    await col.updateOne({ id: user.id }, { $set: { avatar, updatedAt: Date.now() } });
    return ok({ avatar });
  }

  /* ---- 帖子：列 / 读 / 发 / 改 / 删（细节在下面那个函数里） ---- */
  if (event.startsWith('LT_POST_')) return handlePostEvent(event, payload);

  /* ---- 聊天室：读某天 / 发一条 / 删自己那条（细节在那个函数里，读也要过审） ---- */
  if (event.startsWith('LT_CHAT_')) return handleChatEvent(event, payload);

  /* ---- 画板：拉今天的笔划 / 画一笔 / 撤销自己那笔（同一个门槛） ---- */
  if (event.startsWith('LT_DRAW_')) return handleDrawEvent(event, payload);

  /* ---- 下面几个是站长专用的：先验密码（内部按 Twikoo 的规矩 md5 一下再问） ---- */
  const admin = await adminCheck(payload.password);
  if (!admin.ok) {
    return bad(
      '站长密码不对' + (admin.message ? '（Twikoo 原话：' + admin.message + '）' : '') +
        '。就是你在评论区小齿轮里设的那个密码 —— 注意要填**原文**，不要自己先做任何处理。',
      1403
    );
  }

  if (event === 'LT_ADMIN_LIST') {
    const list = await col
      .find({}, { projection: { pass: 0, salt: 0 } })
      .sort({ createdAt: -1 })
      .limit(500)
      .toArray();
    return ok({ users: list.map((u) => ({ ...publicUser(u), id: u.id })) });
  }

  if (event === 'LT_ADMIN_SET') {
    const id = String(payload.id || '');
    const status = String(payload.status || '');
    const label = payload.label === undefined ? undefined : String(payload.label);
    if (!id) return bad('没说要改谁');
    const set = { updatedAt: Date.now() };
    if (status) {
      if (!['pending', 'approved', 'banned'].includes(status)) return bad('状态只能是 pending / approved / banned');
      set.status = status;
    }
    if (label !== undefined) set.label = label.slice(0, 20);
    const r = await col.updateOne({ id }, { $set: set });
    if (!r.matchedCount) return bad('没找到这个账号');
    return ok({ id, status: set.status, label: set.label });
  }

  if (event === 'LT_ADMIN_DELETE') {
    const r = await col.deleteOne({ id: String(payload.id || '') });
    if (!r.deletedCount) return bad('没找到这个账号');
    return ok({ id: payload.id });
  }

  /*
    ---- 站长管帖子（2026-10-07 晚上加）----

    站长和作者都能删帖子，但走的是两条路：
      · 作者删自己的 → LT_POST_DELETE（上面，带令牌）；
      · 站长删谁的都行 → LT_ADMIN_POST_DELETE（这里，带站长密码）。
    "隐藏"只对站长开放（作者要么留着、要么自己删掉，免得作者把帖子藏起来跟站长捉迷藏）。
  */
  if (event === 'LT_ADMIN_POST_LIST') {
    const filter = {};
    const board = String(payload.board || '');
    if (board) filter.board = board;
    const limit = Math.min(Math.max(Number(payload.limit) || 200, 1), 500);
    const docs = await (await posts()).find(filter).sort({ createdAt: -1 }).limit(limit).toArray();
    return ok({ posts: docs.map((d) => publicPost(d)) });
  }

  if (event === 'LT_ADMIN_POST_SET') {
    const id = String(payload.id || '');
    if (!id) return bad('没说是哪一条帖子');
    const set = { updatedAt: Date.now() };
    if (payload.status !== undefined) {
      const status = String(payload.status);
      if (!['ok', 'hidden'].includes(status)) return bad('状态只能是 ok / hidden');
      set.status = status;
    }
    if (payload.pinned !== undefined) set.pinned = Number(payload.pinned) ? 1 : 0;
    if (payload.board !== undefined) {
      if (!boardOk(payload.board)) return bad('要移去的版块 id 不合法');
      set.board = String(payload.board);
    }
    const r = await (await posts()).updateOne({ id }, { $set: set });
    if (!r.matchedCount) return bad('没找到这条帖子');
    return ok({ id, status: set.status, pinned: set.pinned, board: set.board });
  }

  if (event === 'LT_ADMIN_POST_DELETE') {
    const r = await (await posts()).deleteOne({ id: String(payload.id || '') });
    if (!r.deletedCount) return bad('没找到这条帖子');
    return ok({ id: payload.id });
  }

  /*
    ---- 聊天室的每日存档（2026-10-09 加）----

    用户要的「每天保存一次聊天记录」是这么落地的：**每天定时**由 GitHub Action
    找这两个接口把前一天的话搬进仓库，搬完把云端的图片数据抹掉（换成静态路径）。
    这样"历史浏览和搜索"就完全不碰云端额度了 —— 图和数据都在仓库里。

    为什么要两个接口而不是一个：
      · DAY   —— 取出那一天的全部消息（**含图片 data URL**，所以只有站长拿得到）；
      · PRUNE —— 存好之后回来把云端那些 base64 抹掉，只留一条静态路径 `/img/chat/<日>/<id>.webp`。
    两个都走站长密码那道闸门（上面的 adminCheck），不出现在任何前端页面上。
  */
  /*
    ⚠ 和画板那条一样，这里也**分页**（2026-10-10 加）：
    一整天的话里只要带十几张图（一张 data URL 最大 ~533KB），响应体就会撞上腾讯云 6MB 上限 ——
    画板 10-09 已经真栽过一次（见 LT_ADMIN_DRAW_DAY 那段），聊天室是同一条路，别等它再栽。
    协议与游标完全一致：`after` / `afterId` / `limit`，按 `(createdAt, id)` 严格排序 + 2MB 字节预算，
    返回 `{count, total, messages, next}`；`next === null` 或这批 0 条 = 取完了。
  */
  if (event === 'LT_ADMIN_CHAT_DAY') {
    const day = String(payload.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('要指定哪一天（yyyy-mm-dd）');
    const limit = Math.min(Math.max(Number(payload.limit) || 200, 1), 1000);
    const budget = 2 * 1024 * 1024;
    const afterTs = Number(payload.after) || 0;
    const afterId = String(payload.afterId || '');
    const col = await chat();
    const q = afterTs
      ? { day, $or: [{ createdAt: { $gt: afterTs } }, { createdAt: afterTs, id: { $gt: afterId } }] }
      : { day };
    const docs = await col.find(q).sort({ createdAt: 1, id: 1 }).limit(limit).toArray();
    const total = await col.countDocuments({ day });
    const messages = [];
    let bytes = 0;
    for (const d of docs) {
      const m = {
        id: d.id,
        nick: d.nick,
        avatar: d.avatar || '',
        text: d.text || '',
        image: d.image || '',
        createdAt: d.createdAt,
        deleted: !!d.deleted,
      };
      const n = JSON.stringify(m).length;
      if (messages.length && bytes + n > budget) break;
      bytes += n;
      messages.push(m);
    }
    const last = messages[messages.length - 1];
    return ok({
      day,
      count: messages.length,
      total,
      messages,
      next: last ? { ts: last.createdAt, id: last.id } : null,
    });
  }

  if (event === 'LT_ADMIN_CHAT_PRUNE') {
    const day = String(payload.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('要指定哪一天（yyyy-mm-dd）');
    const col = await chat();
    const docs = await col.find({ day, image: { $regex: '^data:' } }).toArray();
    /*
      ⚠ 2026-10-10 加的闸门：抹 base64 是不可逆的（MongoDB 免费档没有备份），
      而云端那一份当时是**唯一**一份 —— 10-09 那次运行就是"图抹了、文件没提交"，5 张图从此没了。
      所以：存档脚本把"它搬下来几张"（expect）带过来，跟云端还剩几张对不上就不许抹。
      另外顺序也改了：现在是**先提交、后抹**（见 daily-archive.yml），抹这一步只在提交成功之后跑。
    */
    const expectRaw = payload.expect;
    if (expectRaw !== undefined && expectRaw !== null && expectRaw !== '') {
      const expect = Number(expectRaw);
      /* 危险方向只有一个：云端还有图、存档里却没有 —— 那说明有些图根本没搬下来。
         （反过来"存档里的图比云端多"是正常的：上一次已经抹过一遍了，重跑不该报错。） */
      if (!Number.isFinite(expect) || expect < docs.length) {
        return bad(`云端这天还有 ${docs.length} 张图没搬、存档里数出来是 ${expectRaw} —— 对不上，先别抹`);
      }
    }
    let pruned = 0;
    for (const d of docs) {
      /* 路径的规矩和存档脚本写文件时一模一样：/img/chat/<日>/<消息 id>.webp */
      await col.updateOne({ id: d.id }, { $set: { image: `/img/chat/${day}/${d.id}.webp` } });
      pruned += 1;
    }
    return ok({ day, pruned });
  }

  /*
    把"仓库里其实没有那个文件"的图片引用抹成空（2026-10-10 加）。
    来由：10-09 那次事故之后，云端这 5 条消息的 image 是一条静态路径，而 public/img/chat/2026-10-09/
    下的文件从来没进过仓库 —— 页面上就是 5 个碎图。像素已经救不回来了（base64 被抹掉了），
    能做的就是别再让它们显示成碎图：存档脚本发现路径指向的文件不存在时，调这个事件把云端那条置空。
  */
  if (event === 'LT_ADMIN_CHAT_CLEAR_IMAGE') {
    const day = String(payload.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('要指定哪一天（yyyy-mm-dd）');
    const ids = (Array.isArray(payload.ids) ? payload.ids : []).map((x) => String(x)).filter(Boolean);
    if (!ids.length) return bad('要给出要清哪几条（ids）');
    const r = await (await chat()).updateMany({ day, id: { $in: ids } }, { $set: { image: '' } });
    return ok({ day, cleared: r.modifiedCount, ids });
  }

  if (event === 'LT_ADMIN_CHAT_DELETE') {
    const r = await (await chat()).updateOne(
      { id: String(payload.id || '') },
      { $set: { deleted: true, deletedAt: Date.now(), image: '' } }
    );
    if (!r.matchedCount) return bad('没找到这条消息');
    return ok({ id: payload.id });
  }

  /*
    ---- 画板的每日存档（2026-10-09 加）----

    和聊天室是同一套路（DAY 取出 → 仓库里存成 JSON + SVG → CLEAR 清云端），
    但画板多一步"清"：笔划在仓库里已经是完整的记录了，云端再留着纯占地方
    （MongoDB 免费档 512MB，一笔一天几百上千条，很快就吃掉一大截）。
    所以这里是 DAY + CLEAR，而不是聊天室那种"抹掉图片、留下文字"。
    ⚠ CLEAR 之后云端就没有那天的笔划了 —— 想回看只能看仓库里那份存档（这正是设计意图）。
  */
  /*
    ⚠ 2026-10-10 的事故就出在这里，改之前先看这段：
      原来这一枪把一整天的笔划**一次全返回**。10-09 那天笔划多到响应体超过腾讯云 **6MB 上限**，
      云函数直接抛 `FUNCTIONS_INVOCATION_FAILED: The size of HTTP response body exceeds the upper limit (6MB)`，
      存档脚本那一枪整个失败 —— 而它排在聊天室之后，于是"聊天室已经搬好、云端图片 base64 也抹掉了"
      的那次运行**连提交都没走到**（文件只存在于 runner 上，随 runner 一起没了）。
      现在改成**分页**：调用方带 `after` / `afterId` / `limit`，服务端按 `(createdAt, id)` 严格排序，
      并且在**字节预算**（默认 2MB，给 6MB 留足余量）内尽量多装，返回 `{strokes, count, total, next}`：
        · `count` = 这一批几条；`total` = 这天总共几条（调用方拿它对账，少一条都不许当"取完了"）；
        · `next` = `{ts, id}`，下一批带上；`next === null` 或这批 0 条 = 取完了。
      id 必须一起当游标：同一毫秒可能有好几笔，只按 createdAt 会漏。
  */
  if (event === 'LT_ADMIN_DRAW_DAY') {
    const day = String(payload.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('要指定哪一天（yyyy-mm-dd）');
    const limit = Math.min(Math.max(Number(payload.limit) || 500, 1), 2000);
    const budget = 2 * 1024 * 1024;
    const afterTs = Number(payload.after) || 0;
    const afterId = String(payload.afterId || '');
    const col = await draw();
    const q = afterTs
      ? { day, $or: [{ createdAt: { $gt: afterTs } }, { createdAt: afterTs, id: { $gt: afterId } }] }
      : { day };
    const docs = await col.find(q).sort({ createdAt: 1, id: 1 }).limit(limit).toArray();
    const total = await col.countDocuments({ day });
    const strokes = [];
    let bytes = 0;
    for (const d of docs) {
      const s = {
        id: d.id,
        uk: d.uk,
        nick: d.nick,
        avatar: d.avatar || '',
        tool: d.tool,
        color: d.color,
        size: d.size,
        points: d.points,
        createdAt: d.createdAt,
        deleted: !!d.deleted,
      };
      const n = JSON.stringify(s).length;
      if (strokes.length && bytes + n > budget) break; /* 装不下就停，下一批接着取 */
      bytes += n;
      strokes.push(s);
    }
    const last = strokes[strokes.length - 1];
    return ok({
      day,
      count: strokes.length,
      total,
      strokes,
      next: last ? { ts: last.createdAt, id: last.id } : null,
    });
  }

  if (event === 'LT_ADMIN_DRAW_CLEAR') {
    const day = String(payload.day || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return bad('要指定哪一天（yyyy-mm-dd）');
    const col = await draw();
    const n = await col.countDocuments({ day });
    /*
      ⚠ 这道闸门是 2026-10-10 加的，理由很具体：云端这一份是**唯一**的一份，
      清掉就没了。存档脚本会把它数出来的笔数（`expect`）带过来 —— 对不上就不许清。
      没有它，一个"取到一半失败"的存档会把云端那天的画删干净，而仓库里什么都没有。
    */
    const expectRaw = payload.expect;
    if (expectRaw !== undefined && expectRaw !== null && expectRaw !== '') {
      const expect = Number(expectRaw);
      if (!Number.isFinite(expect) || expect !== n) {
        return bad(`云端这天有 ${n} 笔、存档里数出来是 ${expectRaw} —— 对不上，先别清`);
      }
    }
    const r = await col.deleteMany({ day });
    return ok({ day, cleared: r.deletedCount });
  }

  return bad('不认识的事件：' + event);
}

/* ============================================================ 入口 */

/**
 * HTTP 网关的信封 → 业务事件。
 * 不依赖具体字段名：已经有 event 字段就当业务事件；否则从 body 里取。
 * @param {unknown} event 云函数收到的事件
 * @returns {any} 业务事件
 */
function unwrapHttp(event) {
  if (!event || typeof event !== 'object') return event;
  if (typeof event.event === 'string') return event;
  if (typeof event.body === 'string') {
    try {
      const payload = JSON.parse(event.body || '{}');
      if (payload && typeof payload === 'object') {
        payload.headers = event.headers || {};
        return payload;
      }
    } catch {
      /* 不是 JSON：原样交回去，让 Twikoo 自己回它那句提示 */
    }
  } else if (event.body && typeof event.body === 'object') {
    return { ...event.body, headers: event.headers || {} };
  }
  return event;
}

/**
 * 云函数入口。
 *
 * 顺序：① 剥 HTTP 信封 → ② 自己的账号事件（LT_*）→ ③ 发评论的硬门槛 →
 *      ④ 其余交给 Twikoo。
 * @param {unknown} event 平台事件
 * @param {object} [context] 云函数上下文
 * @returns {Promise<object>} 返回体
 */
exports.main = async (event, context) => {
  const payload = unwrapHttp(event);
  const name = String(payload?.event || '');

  /* ② 我们自己的账号事件 */
  if (name.startsWith('LT_')) {
    try {
      const res = await handleUserEvent(payload);
      if (res) return res;
    } catch (err) {
      return bad('账号服务出错：' + String(err?.message || err));
    }
  }

  /* ③ 发评论的硬门槛：必须是一个已过审账号 */
  let submitted = null;
  if (name === 'COMMENT_SUBMIT') {
    let user = null;
    try {
      user = await userByToken(payload.ltToken);
    } catch (err) {
      return bad('账号服务出错：' + String(err?.message || err));
    }
    if (!user) return bad('要发言请先注册并登录 —— 账号需要站长审核通过才能发东西。');
    if (user.status === 'pending') return bad('你的账号还在等站长审核，通过之后就能随便发了。');
    if (user.status !== 'approved') return bad('这个账号被停用了。');
    /* 昵称 / 邮箱按账号写死，防冒名 */
    payload.nick = user.nick;
    if (user.mail) payload.mail = user.mail;
    /* 自己设的头像一起带上（空串不覆盖 Twikoo 那套 Gravatar 兜底） */
    if (user.avatar) payload.avatar = user.avatar;
    submitted = user;
  }

  /* ④ 其余交给 Twikoo */
  const res = await runTwikoo(payload, context);

  /*
    发评论成功、而这个账号有头像 → 把头像补写进刚存下的那条评论。

    为什么非补不可：Twikoo 存评论是**逐字段挑**的（@twikoojs/common 里构造 commentDo 那一段），
    `avatar` 它只按 QQ 邮箱自己算一份 —— 上送的 avatar 会不会被照抄，取决于它的实现细节，
    不能赌。补写是确定性的：客户端渲染评论时走 getAvatar()，第一句就是
    `if (comment.avatar) return comment.avatar`（2026-10-07 从 twikoo.all.min.js 里核过）。
    找不到刚存的那条就安静放过 —— 头像不是发评论的必要条件，不该因为它让评论失败。
  */
  if (name === 'COMMENT_SUBMIT' && res?.code === 0 && submitted?.avatar) {
    try {
      const col = (await ourDb()).collection('comment');
      /*
        提交成功的返回里带着刚存下那条评论的 id（实测：{"id":"…","code":0,…}），
        而 Twikoo 的评论 _id 就是它自己生成的 32 位串（idFilter(id) = {_id:id}），
        所以优先按 id 精确改；万一哪天它不给了（或者没命中），退回"按 url + 昵称找最新一条"。
      */
      let hit = 0;
      if (res.id) hit = (await col.updateOne({ _id: res.id }, { $set: { avatar: submitted.avatar } })).matchedCount;
      if (!hit) {
        const last = await col
          .find({ url: payload.url, nick: submitted.nick })
          .sort({ created: -1 })
          .limit(1)
          .toArray();
        if (last[0]) await col.updateOne({ _id: last[0]._id }, { $set: { avatar: submitted.avatar } });
      }
    } catch {
      /* 补不上就算了 */
    }
  }

  return res;
};
