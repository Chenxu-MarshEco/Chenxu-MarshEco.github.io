/*
 * ============================================================================
 * 黎语堂的"前端那一层"：账号（注册 / 登录 / 审核 / 头像）+ 帖子（列 / 读 / 发 / 改 / 删）
 * ----------------------------------------------------------------------------
 * 2026-10-07 晚上抽出来的。抽的原因：这一套一开始全写在 src/components/Twikoo.astro 里
 * （那时候只有评论区要用），现在**发帖页、版块页、帖子页、论坛首页**都要用同一套东西：
 *
 *   · 绿壳：登录 / 注册表单、待审核提示、封禁提示、"你以谁的身份登录"、
 *     换头像、退出登录 —— 界面和文案只能有一份，不然四个页面会各说各话；
 *   · 蓝壳：帖子列表（首页「最新帖子」和版块页共用一个）、帖子读写、时间格式、图片压缩。
 *
 * 所以规矩是：**这一层只认 HTTP 事件**（LT_*），不碰任何 Astro 的东西，
 * 页面拿到的是 DOM 元素和回调，怎么摆是页面自己的事。
 *
 * 后端地址（云函数那条 HTTP 网关网址）不是写死的：挂在页面元素的 data-api 上
 * （见 LiyutangAccount.astro / Twikoo.astro 怎么渲染它）—— 换环境只改 liyutang.json。
 * ============================================================================
 */
import { withBase } from './url';
import { excerptOf, renderMarkdown } from './liyutang-md.mjs';

/** 令牌在浏览器里存哪儿（按域名分开，刷新页面不掉线） */
export const TOKEN_KEY = 'lt_token';

/** 账号可能处于的四种状态 + 「还没问出来」 */
export type LtState = 'guest' | 'pending' | 'approved' | 'banned';

export interface LtUser {
  /** 用户名：注册时定的、用来登录、**不能改** */
  nick: string;
  /** 昵称：随时能改，页面上到处显示的都是它（没设过时后端已经兜底等于用户名） */
  alias?: string;
  mail: string;
  status: string;
  label?: string;
  avatar?: string;
  createdAt?: number;
  /** 画板的个人偏好（调色盘收藏、画笔/橡皮各自粗细）—— 跟着账号走，换设备也还在 */
  prefs?: {
    palette?: string[];
    penSize?: number;
    eraserSize?: number;
    color?: string;
    tool?: string;
  };
}

export interface LtPost {
  id: string;
  board: string;
  title: string;
  excerpt: string;
  cover: string;
  authorNick: string;
  /** 作者昵称（后端按当前昵称发的；改过名之后老帖子也是新昵称） */
  authorAlias?: string;
  authorAvatar: string;
  createdAt: number;
  updatedAt: number;
  status: string;
  pinned: number;
  views: number;
  images: number;
  /** 只有"读一条"的时候才有正文 */
  md?: string;
}

/* ============================================================ 小工具 */

/** 建一个元素（这一层的 DOM 全靠它拼，不写 innerHTML —— 用户内容一律走 textContent） */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}

/** 读元素上挂的后端地址（页面渲染时写进 data-api） */
export function apiOf(root: HTMLElement | null): string {
  return String(root?.dataset.api ?? '').trim();
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

export function setToken(t: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* 无痕模式之类：忽略，这次会话还能用 */
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* 无所谓 */
  }
}

/*
  ============================================================================
  「登录状态」为什么还要缓存一份（2026-10-09 晚上补）
  ----------------------------------------------------------------------------
  群友反馈过：刷新、重进站点、点进黎语堂的新页面时会"掉登录"。查出来的根因有两条，
  两条都不是"令牌真过期了"：

    ① 云函数**冷启动**时第一枪偶尔连不上数据库，回的是一句"临时连不上"，
       而那时所有错误码都是同一个 1000 —— 页面分不出来，就一律当成"登录过期"，
       **把令牌删掉了**（`clearToken()`）。网络抖一下 = 永久登出。
       现在后端给了可区分的码：**401 才是"令牌无效/过期"**，其他码要保留令牌。
    ② 就算令牌没删，那一瞬间页面也只能显示"未登录"：头像、名字、"以谁的身份"全空，
       用户看到的就是"掉登录"。

  所以这里做三件事：
    · **只认 401**：只有后端明说令牌无效才清令牌；
    · **缓存一份"上次确认过的身份"**（`lt_user`）：一进页面先拿它把头像/名字画出来，
      再去后台核对 —— 刷新时不会再闪一下"未登录"；
    · **失败自动重试**：临时失败不算数，几秒后自己再问一次，成功了悄悄换回真实状态
      （所以网络恢复之后**不用刷新页面**）。
  缓存里**不放令牌**（令牌单独存），也不放邮箱，够画面用就行。
  ============================================================================
*/
const USER_KEY = 'lt_user';

/** 记下"上次确认过的身份"（渲染用，不含敏感字段） */
export function setCachedUser(u: LtUser | null): void {
  try {
    if (!u) localStorage.removeItem(USER_KEY);
    else localStorage.setItem(USER_KEY, JSON.stringify({ nick: u.nick, alias: u.alias, avatar: u.avatar, status: u.status, label: u.label }));
  } catch {
    /* 无痕模式之类：忽略 */
  }
}

/** @returns {Partial<LtUser>|null} 上次确认过的身份（没有就是 null） */
export function getCachedUser(): Partial<LtUser> | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<LtUser>;
    return v && typeof v === 'object' && v.nick ? v : null;
  } catch {
    return null;
  }
}

/**
 * 调一次云函数（账号事件、帖子事件、评论事件走的是**同一个**后端）。
 * 注意 response 要先 text() 再 JSON.parse —— 云函数出错时返回的可能是纯文本，
 * 直接 res.json() 会抛一个看不懂的错（2026-10-07 踩过）。
 */
export async function call(api: string, body: Record<string, unknown>): Promise<Record<string, any>> {
  const res = await fetch(api, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as Record<string, any>;
  } catch {
    throw new Error(`服务器返回了看不懂的东西（HTTP ${res.status}）：${text.slice(0, 120)}`);
  }
}

/** 时间戳 → 人话（列表和帖子页共用一套） */
export function formatTime(ts: number): string {
  const t = Number(ts) || 0;
  if (!t) return '';
  const diff = Date.now() - t;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 172_800_000) return '昨天';
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 一条帖子的网址（所有帖子共用 /liyutang/post/ 那一页，靠 ?id= 分） */
export const postUrl = (id: string): string => withBase(`/liyutang/post/?id=${encodeURIComponent(id)}`);

/** 一个版块的网址 */
export const boardUrl = (id: string): string => withBase(`/liyutang/${id}/`);

/** 发帖页的网址；带上 id 就是"改这一篇" */
export const composeUrl = (id = ''): string =>
  withBase('/liyutang/new/') + (id ? `?id=${encodeURIComponent(id)}` : '');

/* ============================================================ 图片压缩 */

/** 把一张图读成 ImageBitmap（拿不到 createImageBitmap 就退回 <img>） */
async function toBitmap(file: File): Promise<{ w: number; h: number; draw: (c: HTMLCanvasElement, w: number, h: number) => void }> {
  if ('createImageBitmap' in window) {
    const bmp = await createImageBitmap(file);
    return {
      w: bmp.width,
      h: bmp.height,
      draw: (c, w, h) => {
        const ctx = c.getContext('2d');
        if (ctx) ctx.drawImage(bmp, 0, 0, w, h);
      },
    };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('这张图读不出来'));
      im.src = url;
    });
    return {
      w: img.naturalWidth,
      h: img.naturalHeight,
      draw: (c, w, h) => {
        const ctx = c.getContext('2d');
        if (ctx) ctx.drawImage(img, 0, 0, w, h);
      },
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface CompressOpts {
  /** 长边压到多少像素以内 */
  max?: number;
  /** 压成什么格式（WebP 同画质下比 JPEG 小一半左右） */
  mime?: string;
  /** 初始画质 */
  quality?: number;
  /** 头像要方图（居中裁切） */
  square?: boolean;
  /** 结果最大多少字节，超了就降画质再来一次 */
  maxBytes?: number;
}

/**
 * 在浏览器里把图片压小，返回 data URL。
 *
 * 为什么要压：帖子里的图是**内嵌进正文**存的（见云函数头部那段解释），
 * 手机拍的原图 3~8MB，不压的话正文立刻撞上 4MB 的上限、MongoDB 免费档也扛不住。
 * 压到 1600px 的 WebP 之后一张通常 150~400KB，够看也放得下。
 *
 * @param file 用户选的文件
 * @param opts 参数
 * @returns 压缩后的 data URL
 * @throws 不是图片 / 读不出来 / 压完还是太大
 */
export async function compressImage(file: File, opts: CompressOpts = {}): Promise<string> {
  const { max = 1600, mime = 'image/webp', quality = 0.82, square = false, maxBytes = 1_400_000 } = opts;
  if (!/^image\//.test(file.type)) throw new Error('只能传图片');
  const src = await toBitmap(file);

  /*
    方形头像要按短边居中裁一块，而"裁"用的是 drawImage 的九参数版本 ——
    它需要一个现成的"源画布"。所以先把原图整张画进一张临时画布，之后每轮从它上面取。
  */
  let full: HTMLCanvasElement | null = null;
  if (square) {
    full = document.createElement('canvas');
    full.width = src.w;
    full.height = src.h;
    src.draw(full, src.w, src.h);
  }

  let q = quality;
  for (let round = 0; round < 4; round += 1) {
    let sx = 0;
    let sy = 0;
    let sw = src.w;
    let sh = src.h;
    let w: number;
    let h: number;
    if (square) {
      const side = Math.min(src.w, src.h);
      sx = (src.w - side) / 2;
      sy = (src.h - side) / 2;
      sw = side;
      sh = side;
      w = Math.max(1, Math.round(Math.min(side, max)));
      h = w;
    } else {
      const scale = Math.min(1, max / Math.max(src.w, src.h));
      w = Math.max(1, Math.round(src.w * scale));
      h = Math.max(1, Math.round(src.h * scale));
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('这台浏览器画不了图（拿不到 canvas）');
    if (square && full) ctx.drawImage(full, sx, sy, sw, sh, 0, 0, w, h);
    else src.draw(canvas, w, h);

    const out = canvas.toDataURL(mime, q);
    if (!/^data:image\//.test(out)) throw new Error('这台浏览器导不出 WebP，换一张 JPEG 试试');
    if (out.length <= maxBytes || q <= 0.4) return out;
    q -= 0.18;
  }
  throw new Error('这张图压不小了，换一张小一点的再试');
}

/* ============================================================ 账号那一块 */

export interface AccountOpts {
  /** 云函数地址 */
  api: string;
  /** 挂在哪个元素上（内容会被清空重画） */
  box: HTMLElement;
  /**
   * 状态变了就叫一声。页面用它决定"露出评论区 / 允许发帖"。
   * user 在 guest 时是 null；extra.fake 表示这是 #admin 后门强行露出来的（不是真登录）。
   */
  onState?: (state: LtState, user: LtUser | null, extra?: { fake?: boolean }) => void;
  /** 过审之后在"你以谁的身份登录"后面补一句（例如「去发帖」的链接） */
  extraLinks?: (user: LtUser) => Node[];
}

export interface AccountHandle {
  state: LtState;
  user: LtUser | null;
  refresh(): Promise<void>;
}

/**
 * 画账号区，并且把状态机跑起来。
 *
 * 状态：guest（没登录）/ pending（等站长审核）/ approved（能发东西）/ banned（停用）。
 * **没过审的号一个字都发不出去** —— 服务端还有一道硬门槛（COMMENT_SUBMIT 和 LT_POST_CREATE
 * 都会自己再验一次令牌），所以这里画的是什么只是"界面"，不是"权限"。
 *
 * @param opts 配置
 * @returns 句柄（能手动 refresh，页面偶尔需要，比如发完帖回来）
 */
export function mountAccount(opts: AccountOpts): AccountHandle {
  const { api, box } = opts;
  const handle: AccountHandle = { state: 'guest', user: null, refresh: async () => {} };
  let user: LtUser | null = null;
  let state: LtState = 'guest';

  const logoutBtn = () => {
    const out = el('button', 'tkc__link', '退出登录');
    out.type = 'button';
    out.addEventListener('click', () => {
      clearToken();
      /* 主动退出要把缓存的身份也清掉，不然下次进页面会先"闪"出上一个身份 */
      setCachedUser(null);
      location.reload();
    });
    return out;
  };

  /** 换头像：选文件 → 压成 160×160 的方图 → 存到账号上 */
  const avatarBtn = () => {
    const btn = el('button', 'tkc__link', user?.avatar ? '换头像' : '上传头像');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        btn.disabled = true;
        const was = btn.textContent;
        btn.textContent = '处理中…';
        try {
          const avatar = await compressImage(file, { max: 160, square: true, quality: 0.85, maxBytes: 120_000 });
          const r = await call(api, { event: 'LT_AVATAR_SET', ltToken: getToken(), avatar });
          if (r.code !== 0) throw new Error(String(r.message ?? '换头像失败'));
          if (user) user.avatar = String(r.avatar ?? avatar);
          paint(state, '头像换好了。');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = was;
          hint.textContent = '换头像失败：' + String((err as Error)?.message ?? err);
          return;
        }
        btn.disabled = false;
        btn.textContent = '换头像';
      });
      input.click();
    });
    return btn;
  };

  /** 「你以谁的身份」那一行：头像 + 名字 + 标签 + 换头像 + 退出 */
  const who = (u: LtUser) => {
    const bar = el('div', 'tkc__who');
    const pic = el('span', 'lt-avatar');
    /* 头像是纯装饰（旁边就是昵称），对读屏软件藏起来 —— 否则会念出一个孤零零的字 */
    pic.setAttribute('aria-hidden', 'true');
    if (u.avatar) {
      const img = el('img', 'lt-avatar__img');
      img.src = u.avatar;
      img.alt = '';
      pic.append(img);
    } else {
      /* 显示名一律用昵称（alias）；没设过昵称时后端已经兜底等于用户名 */
      pic.textContent = (u.alias || u.nick || '?').slice(0, 1).toUpperCase();
    }
    bar.append(pic, el('span', 'tkc__me', `你以 ${u.alias || u.nick} 的身份登录` + (u.label ? `（${u.label}）` : '')));
    if (u.status === 'approved') bar.append(avatarBtn());
    for (const node of opts.extraLinks?.(u) ?? []) bar.append(node);
    bar.append(logoutBtn());
    return bar;
  };

  const hint = el('p', 'tkc__msg', '');

  /**
   * 按状态重画。msg 是"画完以后想提示一句"。
   */
  const paint = (next: LtState, msg = '', extra?: { fake?: boolean }) => {
    state = next;
    handle.state = next;
    handle.user = user;
    box.textContent = '';
    box.dataset.state = next;

    if (next === 'approved' && user) {
      box.append(who(user));
    } else if (next === 'approved' && extra?.fake) {
      box.append(el('p', 'tkc__note', '（#admin：强制显示，方便打开管理面板）'));
    } else if (next === 'pending') {
      box.append(
        el(
          'p',
          'tkc__note',
          `账号「${user?.nick ?? ''}」已经注册好了，还在等站长审核 —— 通过之后就能发帖、留言。`
        ),
        el('p', 'tkc__note', '（不注册也能看帖子；发东西要过审，是为了挡掉广告和闹事的人。）')
      );
      const row = el('div', 'tkc__who');
      row.append(avatarBtn(), logoutBtn());
      box.append(row);
    } else if (next === 'banned') {
      box.append(el('p', 'tkc__note', '这个账号被停用了。'), logoutBtn());
    } else {
      box.append(guestForm(msg));
    }

    if (msg && next !== 'guest') {
      hint.textContent = msg;
      box.append(hint);
    }
    opts.onState?.(next, user, extra);
  };

  /** 没登录时的注册 / 登录表单（和 2026-10-07 那版一模一样，只是搬了个家） */
  const guestForm = (msg: string): HTMLElement => {
    const wrap = el('div', 'tkc__form');
    const tabs = el('div', 'tkc__tabs');
    const paneLogin = el('div', 'tkc__pane');
    const paneReg = el('div', 'tkc__pane');
    let mode: 'login' | 'register' = 'login';

    const tabLogin = el('button', 'tkc__tab is-on', '登录');
    const tabReg = el('button', 'tkc__tab', '注册');
    tabLogin.type = 'button';
    tabReg.type = 'button';
    tabs.append(tabLogin, tabReg);

    const msgLine = el('p', 'tkc__msg', msg);
    const paintTabs = () => {
      tabLogin.classList.toggle('is-on', mode === 'login');
      tabReg.classList.toggle('is-on', mode === 'register');
      paneLogin.hidden = mode !== 'login';
      paneReg.hidden = mode !== 'register';
    };
    tabLogin.addEventListener('click', () => {
      mode = 'login';
      paintTabs();
    });
    tabReg.addEventListener('click', () => {
      mode = 'register';
      paintTabs();
    });

    const field = (label: string, type: string, ph: string, ac = 'off') => {
      const line = el('label', 'tkc__field');
      line.append(el('span', '', label));
      const node = el('input');
      node.type = type;
      node.placeholder = ph;
      node.autocomplete = ac;
      line.append(node);
      return { line, input: node };
    };

    /* ---- 登录 ---- */
    const lNick = field('昵称', 'text', '你注册时用的昵称');
    const lPass = field('密码', 'password', '', 'current-password');
    const lBtn = el('button', 'tkc__btn', '登录');
    lBtn.type = 'button';
    const lMsg = el('p', 'tkc__msg', '');
    lBtn.addEventListener('click', async () => {
      lBtn.disabled = true;
      lMsg.textContent = '登录中…';
      try {
        const r = await call(api, { event: 'LT_LOGIN', nick: lNick.input.value.trim(), pass: lPass.input.value });
        if (r.code !== 0) {
          lMsg.textContent = String(r.message ?? '登录失败');
          return;
        }
        setToken(String(r.token ?? ''));
        user = r.user as LtUser;
        /* 登进来就顺手把身份缓存上：下次刷新能立刻画出头像和名字（也免得闪一下"未登录"） */
        setCachedUser(user);
        paint(user.status === 'approved' ? 'approved' : user.status === 'banned' ? 'banned' : 'pending');
      } catch (err) {
        lMsg.textContent = '连不上服务器：' + String((err as Error)?.message ?? err);
      } finally {
        lBtn.disabled = false;
      }
    });
    paneLogin.append(lNick.line, lPass.line, lBtn, lMsg);

    /* ---- 注册 ---- */
    const rNick = field('昵称', 'text', '2~20 个字，中英文数字都行');
    const rMail = field('邮箱', 'text', '选填，用来显示头像');
    const rPass = field('密码', 'password', '至少 6 位', 'new-password');
    const rBtn = el('button', 'tkc__btn', '注册');
    rBtn.type = 'button';
    const rMsg = el('p', 'tkc__msg', '');
    rBtn.addEventListener('click', async () => {
      rBtn.disabled = true;
      rMsg.textContent = '提交中…';
      try {
        const r = await call(api, {
          event: 'LT_REGISTER',
          nick: rNick.input.value.trim(),
          mail: rMail.input.value.trim(),
          pass: rPass.input.value,
        });
        if (r.code !== 0) {
          rMsg.textContent = String(r.message ?? '注册失败');
          return;
        }
        mode = 'login';
        paintTabs();
        msgLine.textContent = '注册好了！等站长审核通过就能发东西 —— 到时候用同样的昵称密码登录。';
        msgLine.classList.add('is-ok');
      } catch (err) {
        rMsg.textContent = '连不上服务器：' + String((err as Error)?.message ?? err);
      } finally {
        rBtn.disabled = false;
      }
    });
    paneReg.append(rNick.line, rMail.line, rPass.line, rBtn, rMsg);

    paintTabs();
    wrap.append(tabs, msgLine, paneLogin, paneReg);
    return wrap;
  };

  /** 开场：有令牌就问一次"我是谁 / 过审没有" */
  handle.refresh = async () => {
    const t = getToken();
    if (!t) {
      user = null;
      setCachedUser(null);
      paint('guest');
      return;
    }
    /*
      先拿缓存把"我是谁"画出来（头像/名字/状态），再去核 ——
      这样刷新页面不会闪一下"未登录"，也不会因为一次网络抖动就被当成掉登录。
    */
    const cached = getCachedUser();
    if (cached && !user) {
      user = cached as LtUser;
      paint(user.status === 'approved' ? 'approved' : user.status === 'banned' ? 'banned' : 'pending', '正在确认登录状态…');
    }
    /* 临时失败要重试：最多 3 次，间隔 1.5s / 3s（冷启动那一枪大概要 6~10 秒才回得来） */
    let lastWhy = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt) await new Promise((r) => setTimeout(r, attempt === 1 ? 1500 : 3000));
      try {
        const r = await call(api, { event: 'LT_ME', ltToken: t });
        if (r.code === 0) {
          user = r.user as LtUser;
          setCachedUser(user);
          paint(user.status === 'approved' ? 'approved' : user.status === 'banned' ? 'banned' : 'pending');
          return;
        }
        /*
          ★ 只有后端**明说令牌无效/过期（401）**才把它删掉。
          其他非 0（服务器临时出问题、数据库连不上…）一个字都不动 ——
          这正是群友那次"刷新就掉登录"的根因。
        */
        if (Number(r.code) === 401) {
          clearToken();
          setCachedUser(null);
          user = null;
          paint('guest', '登录状态过期了，重新登录一下。');
          return;
        }
        lastWhy = String(r.message ?? '服务器那边这次没成');
      } catch (err) {
        lastWhy = String((err as Error)?.message ?? err);
      }
    }
    /* 三次都没成：令牌留着，身份按缓存显示，并且**过一会儿自己再试**（不用刷新） */
    user = cached ? (cached as LtUser) : null;
    paint(
      user ? (user.status === 'approved' ? 'approved' : user.status === 'banned' ? 'banned' : 'pending') : 'guest',
      `暂时连不上服务器（${lastWhy.slice(0, 40)}）—— 你的登录没有掉，稍后会自动再试。`
    );
    window.setTimeout(() => {
      if (getToken()) void handle.refresh();
    }, 6000);
  };

  /* 站长的后门：地址后面加 #admin 就不管登录状态，直接按"过审"处理。
     评论区默认藏着，而管理面板（那颗小齿轮）就长在评论区里 —— 藏起来站长自己也进不去。
     普通读者不会知道、也不会用到它；知道这个口令的人本来就该能进管理面板。
     ⚠ 后门只对**评论区的露出**有效：发帖、留言服务端照样验令牌，这里骗不过去。 */
  if (location.hash === '#admin') {
    user = null;
    paint('approved', '', { fake: true });
  } else {
    /*
      开场就问一次"我是谁 / 过审没有"。
      ⚠ 这一句 2026-10-07 晚上漏过一次：mountAccount 只把 refresh 挂出去、没人调它，
      于是界面永远停在「正在看登录状态…」—— 登录了也解锁不了发帖框（真浏览器那段验收逮住的）。
    */
    void handle.refresh();
  }

  return handle;
}

/* ============================================================ 帖子 */

export interface ListOpts {
  api: string;
  box: HTMLElement;
  /** 只看这个版块；空 = 全部 */
  board?: string;
  limit?: number;
  /** 版块 id → 标题（跨版块的列表要显示"发在哪儿"） */
  boardTitles?: Record<string, string>;
  /** 空列表时说什么 */
  empty?: string;
  /** 列表上面那行小标题（首页「最新帖子」用） */
  heading?: string;
}

/**
 * 画一份帖子列表（论坛首页的「最新帖子」和版块页共用）。
 * @param opts 配置
 * @returns 拿到的帖子（页面上还要用就留着）
 */
export async function mountPostList(opts: ListOpts): Promise<LtPost[]> {
  const { api, box, board = '', limit = 20, boardTitles = {}, empty = '这里还没有帖子。' } = opts;
  const holder = el('div', 'lyt-posts');
  if (opts.heading) holder.append(el('h2', 'lyt-posts__head', opts.heading));
  const loading = el('p', 'lyt-empty', '正在读帖子…');
  holder.append(loading);
  box.append(holder);

  let posts: LtPost[] = [];
  try {
    const r = await call(api, { event: 'LT_POST_LIST', board, limit });
    if (r.code !== 0) throw new Error(String(r.message ?? '读不到帖子'));
    posts = (r.posts ?? []) as LtPost[];
  } catch (err) {
    loading.textContent = '帖子读不出来：' + String((err as Error)?.message ?? err);
    loading.classList.add('is-bad');
    return [];
  }

  holder.textContent = '';
  if (opts.heading) holder.append(el('h2', 'lyt-posts__head', opts.heading));
  if (!posts.length) {
    holder.append(el('p', 'lyt-empty', empty));
    return [];
  }

  const list = el('ul', 'lyt-posts__list');
  for (const p of posts) {
    const li = el('li', 'lyt-post');
    /* 作者头像：没有就用昵称首字（不做 Gravatar —— 这条路上不该再引一个国外域名） */
    const face = el('span', 'lt-avatar');
    face.setAttribute('aria-hidden', 'true');
    if (p.authorAvatar) {
      const img = el('img', 'lt-avatar__img');
      img.src = p.authorAvatar;
      img.alt = '';
      img.loading = 'lazy';
      face.append(img);
    } else {
      face.textContent = (p.authorAlias || p.authorNick || '?').slice(0, 1).toUpperCase();
    }

    const link = el('a', 'lyt-post__link');
    link.href = postUrl(p.id);

    const titleRow = el('span', 'lyt-post__titleRow');
    if (p.cover) {
      const cover = el('img', 'lyt-post__cover');
      cover.src = p.cover;
      cover.alt = '';
      cover.loading = 'lazy';
      titleRow.append(cover);
    }
    if (p.pinned) titleRow.append(el('span', 'lyt-topicPin', '置顶'));
    titleRow.append(el('span', 'lyt-post__title', p.title));
    link.append(titleRow);

    link.append(
      el(
        'span',
        'lyt-post__meta',
        [
          boardTitles[p.board] || p.board,
          p.authorAlias || p.authorNick,
          formatTime(p.createdAt),
          p.images ? `${p.images} 图` : '',
          `${p.views} 浏览`,
        ]
          .filter(Boolean)
          .join(' · ')
      )
    );
    if (p.excerpt) link.append(el('span', 'lyt-post__excerpt', p.excerpt));

    li.append(face, link);
    list.append(li);
  }
  holder.append(list);
  return posts;
}

/** 读一条帖子（正文一起拿到） */
export async function getPost(api: string, id: string): Promise<{ post: LtPost; mine: boolean } | { error: string }> {
  try {
    const r = await call(api, { event: 'LT_POST_GET', id, ltToken: getToken() });
    if (r.code !== 0) return { error: String(r.message ?? '读不到这条帖子') };
    return { post: r.post as LtPost, mine: !!r.mine };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

/** 发一条新帖 / 改一条已有的（改的时候要带 id） */
export async function savePost(
  api: string,
  data: { id?: string; board: string; title: string; md: string; cover?: string }
): Promise<{ id: string } | { error: string }> {
  const event = data.id ? 'LT_POST_UPDATE' : 'LT_POST_CREATE';
  try {
    const r = await call(api, { event, ltToken: getToken(), ...data });
    if (r.code !== 0) return { error: String(r.message ?? '没存上') };
    return { id: String(r.id ?? data.id ?? '') };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

/** 删自己发的帖子 */
export async function removePost(api: string, id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await call(api, { event: 'LT_POST_DELETE', ltToken: getToken(), id });
    if (r.code !== 0) return { error: String(r.message ?? '没删掉') };
    return { ok: true };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

/** 把 Markdown 渲染成 HTML 塞进一个元素（渲染器是 escape 优先的，见 liyutang-md.mjs） */
export function renderInto(box: HTMLElement, md: string): void {
  box.innerHTML = renderMarkdown(md);
}

/* ============================================================ 聊天室 */

export interface LtMsg {
  id: string;
  day: string;
  nick: string;
  avatar: string;
  text: string;
  image: string;
  createdAt: number;
  mine: boolean;
}

/** 拉某一天的消息（不给 day 就是服务器那边的"今天"；after/afterId 是增量游标） */
export async function listChat(
  api: string,
  opts: { day?: string; after?: number; afterId?: string; limit?: number } = {}
): Promise<{ messages: LtMsg[]; day: string; today: string; serverNow: number; more: boolean; next: { ts: number; id: string } | null } | { error: string }> {
  try {
    const r = await call(api, { event: 'LT_CHAT_LIST', ltToken: getToken(), ...opts });
    if (r.code !== 0) return { error: String(r.message ?? '读不到消息') };
    return {
      messages: (r.messages ?? []) as LtMsg[],
      day: String(r.day ?? ''),
      today: String(r.today ?? ''),
      serverNow: Number(r.serverNow) || Date.now(),
      /* 这一趟是不是被截断了（一条带图的 data URL 能有半兆，一天十几张就撞 6MB 上限）；见云函数里那段 */
      more: !!r.more,
      next: r.next && Number(r.next.ts) ? { ts: Number(r.next.ts), id: String(r.next.id ?? '') } : null,
    };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

/** 发一条消息（文字和图片至少给一样） */
export async function sendChat(
  api: string,
  data: { text?: string; image?: string }
): Promise<{ message: LtMsg } | { error: string }> {
  try {
    const r = await call(api, { event: 'LT_CHAT_SEND', ltToken: getToken(), ...data });
    if (r.code !== 0) return { error: String(r.message ?? '没发出去') };
    return { message: r.message as LtMsg };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

/** 删自己刚发的那条 */
export async function deleteChat(api: string, id: string): Promise<{ ok: true } | { error: string }> {
  try {
    const r = await call(api, { event: 'LT_CHAT_DELETE', ltToken: getToken(), id });
    if (r.code !== 0) return { error: String(r.message ?? '没删掉') };
    return { ok: true };
  } catch (err) {
    return { error: '连不上服务器：' + String((err as Error)?.message ?? err) };
  }
}

export interface ChatOpts {
  api: string;
  /** 消息流容器 */
  log: HTMLElement;
  /** 输入框 */
  input: HTMLTextAreaElement;
  /** 「发出去」按钮 */
  send: HTMLButtonElement;
  /** 「传图」按钮（可选） */
  image?: HTMLButtonElement;
  /** 状态行（可选）：发送中 / 失败原因 */
  status?: HTMLElement;
  /** 每几秒问一次有没有新消息 */
  pollMs?: number;
}

export interface ChatHandle {
  /** 立刻拉一次（新消息进来） */
  refresh(): Promise<void>;
  stop(): void;
}

/**
 * 聊天室那一套：画消息、发消息、发图、每几秒问一次新消息。
 *
 * 为什么要轮询而不是长连接：这套后端是"云函数 + HTTP 网关"，没有 WebSocket；
 * 论坛这个体量（几个人）四秒问一次足够，量也小。等以后真嫌慢，再换。
 *
 * 两个讲究：
 *   ① **只在自己这一条不发的时候轮询**，而且页面切到后台就停（`visibilitychange`）——
 *      一个开着的后台标签页不该一直烧额度；
 *   ② 图片走和帖子同一套压缩（1000px 的 WebP），**发出去之前先在本地显示**，
 *      不然发完等一个来回才有反应，用起来像卡住了。
 */
export function mountChat(opts: ChatOpts): ChatHandle {
  const { api, log, input, send, image: imageBtn, status } = opts;
  const pollMs = opts.pollMs ?? 4000;
  let cursor = 0;
  /** 复合游标第二半（同一毫秒的几条按 id 排；见 listChat 那段注释） */
  let cursorId = '';
  let stop = false;
  let sending = false;
  let timer = 0;

  const say = (text: string, ok = false) => {
    if (!status) return;
    status.textContent = text;
    status.classList.toggle('is-ok', ok);
  };

  const atBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  const scrollDown = (force = false) => {
    if (force || atBottom()) log.scrollTop = log.scrollHeight;
  };

  /** 画一条消息（用户内容一律 textContent / src=，绝不拼 HTML） */
  const paint = (m: LtMsg, append = true) => {
    const row = el('div', 'lyt-msg');
    row.dataset.id = m.id;
    const face = el('span', 'lt-avatar');
    face.setAttribute('aria-hidden', 'true');
    if (m.avatar) {
      const img = el('img', 'lt-avatar__img');
      img.src = m.avatar;
      img.alt = '';
      img.loading = 'lazy';
      face.append(img);
    } else {
      face.textContent = (m.alias || m.nick || '?').slice(0, 1).toUpperCase();
    }
    const body = el('div', 'lyt-msg__body');
    const head = el('div', 'lyt-msg__head');
    head.append(el('span', 'lyt-msg__nick', m.alias || m.nick), el('span', '', formatTime(m.createdAt)));
    if (m.mine) {
      const del = el('button', 'tkc__link', '撤回');
      del.type = 'button';
      del.addEventListener('click', async () => {
        del.disabled = true;
        const r = await deleteChat(api, m.id);
        if ('error' in r) {
          say(r.error);
          del.disabled = false;
          return;
        }
        row.remove();
        say('撤回了。', true);
      });
      head.append(del);
    }
    body.append(head);
    if (m.text) body.append(el('div', 'lyt-msg__text', m.text));
    if (m.image) {
      const img = el('img', 'lyt-msg__pic');
      img.src = m.image;
      img.alt = '';
      img.loading = 'lazy';
      body.append(img);
    }
    row.append(face, body);
    if (append) log.append(row);
    return row;
  };

  const refresh = async () => {
    const r = await listChat(api, cursor ? { after: cursor, afterId: cursorId } : {});
    if ('error' in r) {
      /*
        有一种错要翻译一下：云函数里那份代码比页面旧的时候，它不认识 LT_CHAT_*，
        于是走到站长密码那道闸门上、回你一句"站长密码不对"。照着那句话去查密码会白查半天，
        所以这里直接说清楚该怎么办。
      */
      say(
        /站长密码/.test(r.error)
          ? '聊天室还没开 —— 云函数那份代码要重新粘一次（见 tools/liyutang-backend/README.md）。'
          : r.error
      );
      return;
    }
    if (!cursor) {
      /* 第一趟：整页重画 */
      log.textContent = '';
      if (!r.messages.length) log.append(el('p', 'lyt-empty', '今天还没有人说话 —— 你可以先开个头。'));
      for (const m of r.messages) paint(m);
      scrollDown(true);
    } else if (r.messages.length) {
      const empty = log.querySelector('.lyt-empty');
      if (empty) empty.remove();
      const near = atBottom();
      for (const m of r.messages) paint(m);
      scrollDown(near);
    }
    if (r.next) {
      cursor = r.next.ts;
      cursorId = r.next.id;
    } else if (r.messages.length) {
      const lastMsg = r.messages[r.messages.length - 1];
      cursor = Number(lastMsg.createdAt) || cursor;
      cursorId = String(lastMsg.id || '');
    }
    /* 这一趟被字节预算截断了：立刻带游标再要一趟（分几批到，但一定拉得全） */
    if (r.more) void refresh();
    /* 跨零点了：这一天的记录已经翻篇，重来一次（会走"第一趟"那条路，把新的一天画出来） */
    if (r.today && r.day && r.today !== r.day) {
      cursor = 0;
      cursorId = '';
      await refresh();
    }
  };

  const doSend = async () => {
    if (sending) return;
    const text = input.value.trim();
    if (!text) return;
    sending = true;
    send.disabled = true;
    say('正在发…');
    const r = await sendChat(api, { text });
    sending = false;
    send.disabled = false;
    if ('error' in r) {
      say(r.error);
      return;
    }
    input.value = '';
    const empty = log.querySelector('.lyt-empty');
    if (empty) empty.remove();
    paint(r.message);
    scrollDown(true);
    cursor = Math.max(cursor, r.message.createdAt);
    say('', true);
    input.focus();
  };

  /** 传图：压到 1000px → 直接发一条带图的消息 */
  const pickImage = () => {
    const picker = document.createElement('input');
    picker.type = 'file';
    picker.accept = 'image/png,image/jpeg,image/webp,image/gif';
    picker.addEventListener('change', async () => {
      const file = picker.files?.[0];
      if (!file) return;
      if (imageBtn) imageBtn.disabled = true;
      say('正在压图…');
      try {
        const dataUrl = await compressImage(file, { max: 1000, maxBytes: 300_000 });
        say('正在发…');
        const r = await sendChat(api, { image: dataUrl });
        if ('error' in r) {
          say(r.error);
          return;
        }
        const empty = log.querySelector('.lyt-empty');
        if (empty) empty.remove();
        paint(r.message);
        scrollDown(true);
        cursor = Math.max(cursor, r.message.createdAt);
        say(`发出去了（${Math.round(dataUrl.length / 1024)} KB）。`, true);
      } catch (err) {
        say('这张图没发出去：' + String((err as Error)?.message ?? err));
      } finally {
        if (imageBtn) imageBtn.disabled = false;
      }
    });
    picker.click();
  };

  send.addEventListener('click', () => void doSend());
  input.addEventListener('keydown', (ev) => {
    /* 回车发、Shift+回车换行 —— 和聊天软件一个手感 */
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      void doSend();
    }
  });
  imageBtn?.addEventListener('click', pickImage);

  const tick = async () => {
    if (stop) return;
    if (document.visibilityState === 'visible') await refresh();
    timer = window.setTimeout(() => void tick(), pollMs);
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && !stop) void refresh();
  });

  void tick();

  return {
    refresh,
    stop: () => {
      stop = true;
      window.clearTimeout(timer);
    },
  };
}

export { excerptOf, renderMarkdown };
