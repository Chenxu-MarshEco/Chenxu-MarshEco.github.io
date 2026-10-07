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
 * 账号那套用**自己的一条连接**（Twikoo 那条是它自己管的，插不进去）。
 * 单例 + 懒建：冷实例第一次用到才连，之后复用。
 * @returns {Promise<import('mongodb').Collection>} lt_users 集合
 */
let usersPromise = null;
function users() {
  if (!usersPromise) {
    usersPromise = (async () => {
      const client = new MongoClient(URI, {
        maxPoolSize: 3,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
      });
      await client.connect();
      const col = client.db(DB_NAME).collection(USERS);
      /* 昵称唯一（大小写不敏感：存一份小写副本做键） */
      await col.createIndex({ nickLower: 1 }, { unique: true }).catch(() => {});
      return col;
    })();
  }
  return usersPromise;
}

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
    ? { nick: u.nick, mail: u.mail, status: u.status, label: u.label || '', createdAt: u.createdAt }
    : null;

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
    return ok({ user: publicUser(user) });
  }

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
  }

  /* ④ 其余交给 Twikoo */
  return runTwikoo(payload, context);
};
