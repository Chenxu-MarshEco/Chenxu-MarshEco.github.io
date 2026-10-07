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

/** Twikoo 那条数据库（它自己管 comment / config / counter / cap_kv 四个集合） */
const twikooDb = new MongoDatabase({ uri: URI, dbName: DB_NAME });

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
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      const db = client.db(DB_NAME);
      await Promise.all([
        /* 昵称唯一（大小写不敏感：存一份小写副本做键） */
        db.collection(USERS).createIndex({ nickLower: 1 }, { unique: true }),
        db.collection(POSTS).createIndex({ id: 1 }, { unique: true }),
        db.collection(POSTS).createIndex({ board: 1, createdAt: -1 }),
        db.collection(POSTS).createIndex({ authorId: 1, createdAt: -1 }),
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

/** 用户文档 → 给页面看的字段（不带密码/盐） */
const publicUser = (u) =>
  u
    ? {
        nick: u.nick,
        mail: u.mail,
        status: u.status,
        label: u.label || '',
        /* 头像是一张 data URL（前端压过的小图），页面直接塞进 <img src> */
        avatar: u.avatar || '',
        createdAt: u.createdAt,
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
    return ok({ post: publicPost({ ...doc, views: (doc.views || 0) + 1 }, true), mine });
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
    if (!user) return bad('登录状态过期了，重新登录一下');
    const mine = await (await posts()).countDocuments({ authorId: user.id });
    return ok({ user: publicUser(user), posts: mine });
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
