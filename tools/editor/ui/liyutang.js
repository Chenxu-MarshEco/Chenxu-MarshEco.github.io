/*
 * 黎语堂管理系统（/liyutang-admin）—— 2026-10-06 建。
 *
 * 只干两件事，都写 src/data/liyutang.json：
 *   ① 论坛版块：增 / 删 / 改名 / 改说明 / 上下挪顺序
 *   ② 评论系统：Giscus 还是 Waline（还是先不挂），以及那几项配置
 *
 * 为什么单独一个页面、而不是编辑器里的一个面板（用户原话）：
 *   「黎语堂是一个本网站的静态论坛 有很多论坛独有的功能 所以不要将其接入原有的
 *    编辑器系统 应当在花娅陌质流里加一个新按钮跳转到黎语堂相关的编辑管理上」
 * 所以这份脚本**一行都不碰** app.js 里那套 type / frontmatter / 版块树。
 *
 * 首页那张「黎语堂」卡片（标题 / 副标题 / 背景图）**不在这里** —— 那是花涧堂首页的
 * 一块，归编辑器的「黎语堂」面板（写 home-widgets.json）。两边各管一件事。
 */

const THEME_KEY = 'local-editor:theme';
/** 站点预览服务（和编辑器不是同一个端口），「打开 /liyutang/」用 */
const PREVIEW_URL = 'http://127.0.0.1:4321';

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------
   主题：和编辑器共用同一个 localStorage 键，两边看着才是一套
   --------------------------------------------------------------- */
function initTheme() {
  let mode = 'auto';
  try {
    mode = localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    mode = 'auto';
  }
  const apply = () => {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = mode === 'auto' ? (prefersDark ? 'dark' : 'light') : mode;
  };
  apply();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (mode === 'auto') apply();
  });
}

/* ---------------------------------------------------------------
   小工具：建元素 / 吐司 / 状态行
   --------------------------------------------------------------- */

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  return node;
}

function field(labelText, control, hint) {
  const row = el('div', 'lt-field');
  row.append(el('label', '', labelText), control);
  if (hint) row.append(el('span'), el('span', 'hint', hint));
  return row;
}

function input(value, placeholder, onInput) {
  const node = el('input', 'input');
  node.type = 'text';
  node.placeholder = placeholder || '';
  node.value = value ?? '';
  node.addEventListener('input', () => onInput(node.value));
  return node;
}

function button(text, title, onClick, primary = false) {
  const b = el('button', primary ? 'btn btn--primary' : 'btn btn--ghost', text);
  b.type = 'button';
  if (title) b.title = title;
  b.addEventListener('click', onClick);
  return b;
}

function check(labelText, checked, onChange) {
  const wrap = el('label', 'lt-check');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = !!checked;
  box.addEventListener('change', () => onChange(box.checked));
  wrap.append(box, el('span', '', labelText));
  return wrap;
}

let toastTimer = 0;
function toast(message, isError = false) {
  const box = $('toast');
  if (!box) return;
  box.textContent = message;
  box.hidden = false;
  box.classList.add('is-on');
  box.classList.toggle('is-error', isError);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    box.classList.remove('is-on');
    box.hidden = true;
  }, isError ? 6000 : 3800);
}

function setStatus(text, isDirty = false) {
  const node = $('lt-status');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('is-dirty', isDirty);
}

function markDirty() {
  dirty = true;
  setStatus('有改动没保存（按右上角「保存并重新构建」才落盘）', true);
}

/* ---------------------------------------------------------------
   数据
   --------------------------------------------------------------- */

/** src/data/liyutang.json 的草稿（在本页里改，按保存才写盘） */
let draft = null;
/** 有没有没保存的改动 */
let dirty = false;

async function load() {
  const res = await fetch('/api/liyutang');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  draft = data && typeof data === 'object' ? data : {};
  if (!draft.forum || typeof draft.forum !== 'object') draft.forum = {};
  if (!draft.forum.giscus || typeof draft.forum.giscus !== 'object') draft.forum.giscus = {};
  if (!draft.forum.waline || typeof draft.forum.waline !== 'object') draft.forum.waline = {};
  if (!draft.forum.twikoo || typeof draft.forum.twikoo !== 'object') draft.forum.twikoo = {};
  if (typeof draft.forum.enabled !== 'boolean') draft.forum.enabled = false;
  /* 认不出来就是 twikoo（2026-10-06 晚上定的那条路，和 server.mjs 的 cleanLiyutang 一致） */
  if (typeof draft.forum.provider !== 'string') draft.forum.provider = 'twikoo';
  if (!Array.isArray(draft.boards)) draft.boards = [];
  return draft;
}

async function save() {
  const btn = $('lt-save');
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在保存…';
  setStatus('正在保存…');
  try {
    const res = await fetch('/api/liyutang', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    dirty = false;
    /* 拿服务端那份重新来过：它补过 id、洗过字段，界面上看到的必须和落盘的一致 */
    await load();
    render();
    const d = data.dropped ?? {};
    const lost = [];
    if (d.noTitle) lost.push(`${d.noTitle} 个没写名字的版块`);
    if (d.dupId) lost.push(`${d.dupId} 个重复的版块 id`);
    if (data.built) {
      setStatus(`已保存并重新构建（${data.ms} ms）· ${data.counts?.boards ?? 0} 个版块`);
      toast(`黎语堂已保存并重新构建（${data.ms} ms）${lost.length ? `；有 ${lost.join('、')} 被丢掉` : ''}`);
    } else {
      setStatus('已保存，但重新构建没成功');
      toast(`已保存，但重新构建没成功：${String(data.output || '').split('\n')[0]}`, true);
    }
  } catch (err) {
    setStatus(`出错了：${err.message}`, true);
    toast(`保存失败：${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* ---------------------------------------------------------------
   版面：版块
   --------------------------------------------------------------- */

function renderBoards() {
  const box = $('lt-boards-box');
  box.textContent = '';

  const title = el('h4', 'wbox__title', '论坛版块');
  box.append(
    title,
    el(
      'p',
      'hint',
      '黎语堂首页上的分区。顺序就是页面上从上往下的顺序 —— 用 ↑ ↓ 挪。' +
        '名字和说明都是纯文本，图标可以放一个 emoji。'
    )
  );

  const bar = el('div', 'lt-board__row');
  bar.append(
    button('＋ 新增版块', '在最后加一个版块，先写名字，再按保存', () => {
      draft.boards.push({ id: '', title: '', desc: '', icon: '' });
      markDirty();
      render();
      /* 光标落到新那一行的名字框上，省一次点击 */
      const inputs = box.querySelectorAll('.lt-board__title');
      inputs[inputs.length - 1]?.focus();
    }, true)
  );
  box.append(bar);

  if (!draft.boards.length) {
    box.append(
      el(
        'div',
        'lt-empty',
        '还没有版块。加一个之后，黎语堂首页才会长出分区列表 —— 现在 /liyutang 是一张空壳页。'
      )
    );
    return;
  }

  draft.boards.forEach((b, i) => box.append(boardRow(b, i)));
}

function boardRow(board, index) {
  const row = el('div', 'lt-board');
  row.dataset.boardId = board.id || '';

  const icon = input(board.icon ?? '', '📌', (v) => {
    board.icon = v;
    markDirty();
  });
  icon.classList.add('lt-board__icon');
  row.append(icon);

  const fields = el('div', 'lt-board__fields');

  const title = input(board.title ?? '', '版块名字（必填）', (v) => {
    board.title = v;
    markDirty();
  });
  title.classList.add('lt-board__title');
  fields.append(title);

  const desc = input(board.desc ?? '', '一句话说明这个版块是干什么的（可空）', (v) => {
    board.desc = v;
    markDirty();
  });
  fields.append(desc);

  const ops = el('div', 'lt-board__ops');
  ops.append(
    button('↑', '往上挪一位', () => {
      if (index === 0) return;
      const list = draft.boards;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      markDirty();
      render();
    }),
    button('↓', '往下挪一位', () => {
      const list = draft.boards;
      if (index >= list.length - 1) return;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      markDirty();
      render();
    }),
    button('删除', '删掉这个版块（按保存才真的写盘）', () => {
      if (!window.confirm(`删掉版块「${board.title || board.id || index + 1}」？`)) return;
      draft.boards.splice(index, 1);
      markDirty();
      render();
    })
  );

  const meta = el('span', 'hint', board.id ? `id：${board.id}` : 'id：保存时自动生成');
  const foot = el('div', 'lt-board__row');
  foot.append(meta, ops);
  fields.append(foot);

  row.append(fields);
  return row;
}

/* ---------------------------------------------------------------
   版面：评论系统
   --------------------------------------------------------------- */

function renderForum() {
  const box = $('lt-forum-box');
  box.textContent = '';

  const forum = draft.forum;
  const giscus = forum.giscus;
  const waline = forum.waline;
  const twikoo = forum.twikoo;

  box.append(
    el('h4', 'wbox__title', '评论系统'),
    el(
      'p',
      'hint',
      '花涧堂是静态站，没有自己的后端 —— 评论交给现成的无服务器方案，' +
        '数据存在你自己那个服务里（免费额度）。' +
        '「Twikoo（腾讯云开发）」是国内直连最稳的一条：自带 HTTPS、不用备案、自带审核后台，' +
        '群友填昵称和邮箱就能发言，但要你在管理面板点通过才显示（先审后发）—— 现在走的就是这条。' +
        '「Waline」功能最全（邮箱注册账号 + 用户标签）但国内不挂梯子打不开；' +
        '「Giscus」最省事但要求人人先有 GitHub 账号。'
    )
  );

  const provider = el('select', 'input');
  for (const [value, label] of [
    ['twikoo', 'Twikoo（腾讯云开发，国内直连，推荐）'],
    ['waline', 'Waline（自带邮箱注册账号，但国内打不开 Vercel）'],
    ['giscus', 'Giscus（GitHub Discussions，要人人有 GitHub 账号）'],
    ['none', '先不挂'],
  ]) {
    const opt = el('option', '', label);
    opt.value = value;
    if (forum.provider === value) opt.selected = true;
    provider.append(opt);
  }
  provider.addEventListener('change', () => {
    forum.provider = provider.value;
    markDirty();
    renderForum();
  });

  box.append(
    check('打开评论（enabled）', forum.enabled, (v) => {
      forum.enabled = v;
      markDirty();
    }),
    field('用哪一套', provider)
  );

  if (forum.provider === 'twikoo') {
    const sub = el('div', 'lt-board__fields');

    const envInput = input(twikoo.envId ?? '', 'https://…app.tcloudbase.com/twikoo', (v) => {
      twikoo.envId = v.trim();
      markDirty();
    });
    const regionInput = input(twikoo.region ?? 'ap-shanghai', 'ap-shanghai', (v) => {
      twikoo.region = v.trim() || 'ap-shanghai';
      markDirty();
    });
    sub.append(
      field('后端地址（网址或 envId）', envInput),
      field('环境地域（走 SDK 时才用）', regionInput)
    );

    /*
      自检：让**编辑器服务**照着评论框的姿势走一遍 —— 先匿名登录拿 token，
      再拿 token 调一次云函数（GET_FUNC_VERSION）。
      通了/卡在哪一步，它会把每一步都说清楚（见 server.mjs 的 checkTwikoo）。
    */
    const out = el('p', 'lt-sub', '还没自检。envId 填好之后点一下右边那颗按钮。');
    const judge = async () => {
      const envId = String(twikoo.envId ?? '').trim();
      if (!envId) {
        out.textContent = '先把环境 id 填上。';
        out.style.color = '';
        return;
      }
      out.textContent = '正在照评论框的姿势试一遍（第一次冷启动可能要几秒）…';
      out.style.color = '';
      try {
        const res = await fetch('/api/liyutang/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'twikoo', envId, region: twikoo.region }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        const lines = (data.steps ?? []).map(
          (s) => `${s.ok ? '✓' : '✗'} ${s.step}${s.status ? `（HTTP ${s.status}` : '（'}${s.ms != null ? ` · ${s.ms} ms）` : '）'}${s.ok ? '' : '：' + s.detail}`
        );
        out.textContent =
          (data.passed ? '✓ ' : '△ ') +
          (data.verdict ?? '') +
          (data.twikooVersion ? `（Twikoo ${data.twikooVersion}）` : '') +
          '\n' +
          lines.join('\n') +
          (data.hint ? '\n→ ' + data.hint : '');
        out.style.whiteSpace = 'pre-line';
        out.style.color = data.passed ? 'var(--accent)' : 'var(--warn)';
      } catch (err) {
        out.textContent = `✗ 自检本身出错了：${err.message}`;
        out.style.color = 'var(--danger)';
      }
    };

    const bar = el('div', 'lt-board__row');
    bar.append(button('自检连通', '让编辑器服务照评论框的姿势打一次：先看函数活没活，再看数据库通不通', judge));
    sub.append(bar, out);

    sub.append(
      el(
        'p',
        'lt-sub',
        '后端地址填**那条 HTTP 网关的网址**（云函数 / HTTP 网关 → 路由管理里那条路由，形如 ' +
          'https://liyutang-xxxx-数字.ap-shanghai.app.tcloudbase.com/twikoo）。' +
          '走网址这条形态时，前端**不走云开发 SDK**：既不需要匿名登录，也不受云函数调用权限的限制，' +
          '当管理员也**不用下载私钥**。'
      ),
      el(
        'p',
        'lt-sub',
        '数据库在那台网址背后的云函数里（外面接的 MongoDB）。自检要是报 bad auth，就是库的账号密码不对；' +
          '报 querySrv / Server selection / 超时，就是连接串主机名或 Atlas 的 IP 白名单（要放行 0.0.0.0/0）不对；' +
          '报 TIME_LIMIT_EXCEEDED，就是云函数的执行超时太短（调到 30 秒）。'
      ),
      el(
        'p',
        'lt-sub',
        '当管理员：打开帖子页，点评论区右下角的**小齿轮**，设一个管理员密码；' +
          '之后在管理面板里打开「评论审核」，就是「没我点头谁也上不了墙」。'
      )
    );
    box.append(sub);
  } else if (forum.provider === 'giscus') {
    const sub = el('div', 'lt-board__fields');
    sub.append(
      field('仓库', input(giscus.repo ?? '', '用户名/仓库名，例如 Chenxu-MarshEco/liyutang', (v) => {
        giscus.repo = v;
        markDirty();
      })),
      field('仓库 ID', input(giscus.repoId ?? '', 'R_xxxxxxxx（giscus.app 给的）', (v) => {
        giscus.repoId = v;
        markDirty();
      })),
      field('Discussion 分类', input(giscus.category ?? '', 'Announcements', (v) => {
        giscus.category = v;
        markDirty();
      })),
      field('分类 ID', input(giscus.categoryId ?? '', 'DIC_xxxxxxxx（giscus.app 给的）', (v) => {
        giscus.categoryId = v;
        markDirty();
      })),
      field('一个帖子对着哪条', input(giscus.mapping ?? '', 'pathname', (v) => {
        giscus.mapping = v;
        markDirty();
      })),
      field('语言', input(giscus.lang ?? '', 'zh-CN', (v) => {
        giscus.lang = v;
        markDirty();
      })),
      check('显示表情回应', giscus.reactionsEnabled !== false, (v) => {
        giscus.reactionsEnabled = v;
        markDirty();
      })
    );
    const tip = el(
      'p',
      'lt-sub',
      '这四个值（仓库 / 仓库 ID / 分类 / 分类 ID）去 https://giscus.app 按提示授权之后它会给出来，' +
        '原样粘进来就行。仓库必须是公开的、而且开了 Discussions —— ' +
        '但它要求每个留言的人都有 GitHub 账号，所以现在没走这条路。'
    );
    sub.append(tip);
    box.append(sub);
  } else if (forum.provider === 'waline') {
    const sub = el('div', 'lt-board__fields');

    const urlInput = input(waline.serverURL ?? '', 'https://liyutang.xxx.vercel.app', (v) => {
      waline.serverURL = v;
      markDirty();
    });
    sub.append(field('服务地址', urlInput));

    /*
      自检：让**编辑器服务**去请求 <serverURL>/ui/register。
      不能在浏览器里直接 fetch —— 跨源读不到状态码，"通不通"就说不清（见 server.mjs 那段注释）。
    */
    const out = el('p', 'lt-sub', '还没自检。服务地址填好之后点一下右边那颗按钮。');
    const judge = async () => {
      const url = String(waline.serverURL ?? '').trim();
      if (!url) {
        out.textContent = '先把服务地址填上。';
        out.style.color = '';
        return;
      }
      out.textContent = '正在请求 ' + url + '/ui/register …';
      out.style.color = '';
      try {
        const res = await fetch('/api/liyutang/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ serverURL: url }),
        });
        const data = await res.json();
        if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
        if (data.reachable) {
          /* Waline 部署完那个注册页就在；200 = 服务通了。其它状态码也照实说，不硬判死。 */
          const good = data.status === 200;
          out.textContent =
            (good ? '✓ 服务通了：' : '△ 请求到了，但状态码不是 200：') +
            `HTTP ${data.status} · ${data.ms} ms` +
            (data.looksLikeWaline ? ' · 看起来就是 Waline' : '') +
            `（${data.url}）` +
            (good ? '　下一步：打开注册页，抢先注册成管理员。' : '');
          out.style.color = good ? 'var(--accent)' : 'var(--warn)';
        } else {
          out.textContent = `✗ 连不上：${data.error}（请求的是 ${data.url}，${data.ms} ms）`;
          out.style.color = 'var(--danger)';
        }
      } catch (err) {
        out.textContent = `✗ 自检本身出错了：${err.message}`;
        out.style.color = 'var(--danger)';
      }
    };

    const bar = el('div', 'lt-board__row');
    bar.append(button('自检连通', '让编辑器服务去请求一次 <服务地址>/ui/register', judge));
    sub.append(bar, out);

    /* 三个现成的去路：注册（第一个是管理员）、登录、管理后台 */
    const links = el('div', 'lt-board__row');
    const addLink = (href, text, title) => {
      const a = el('a', 'hint', text);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.title = title;
      a.style.textDecoration = 'underline';
      links.append(a);
    };
    const base = String(waline.serverURL ?? '').trim().replace(/\/+$/, '');
    if (base) {
      addLink(`${base}/ui/register`, '注册第一个账号（会成为管理员）', '部署完马上去，晚了会被别人注册成管理员');
      addLink(`${base}/ui`, '打开评论管理后台', '改 / 标记 / 删除评论，给共创者打专属标签');
    }
    sub.append(links);
    sub.append(
      el(
        'p',
        'lt-sub',
        'Waline 的部署四步（Vercel 一键部署 → Storage 里建 Neon 数据库并跑一遍官方 waline.pgsql ' +
          '→ Redeploy → Visit 拿到地址）写在 README 的「黎语堂」一节里。' +
          '第一个在 /ui/register 注册的人自动是管理员，所以服务一通就去占位。'
      )
    );
    box.append(sub);
  }
}

/* ---------------------------------------------------------------
   渲染 + 启动
   --------------------------------------------------------------- */

function render() {
  renderBoards();
  renderForum();
  if (!dirty) {
    const n = draft?.boards?.length ?? 0;
    setStatus(
      `读取完成：${draft?.forum?.provider ?? 'giscus'} · ${n} 个版块` +
        (draft?.updated ? ` · 上次改动 ${draft.updated}` : '')
    );
  }
}

async function init() {
  initTheme();
  $('lt-save').addEventListener('click', save);
  $('lt-open-site').addEventListener('click', () => {
    window.open(`${PREVIEW_URL}/liyutang/`, '_blank', 'noopener');
  });
  $('lt-open-editor').addEventListener('click', () => {
    window.location.href = '/';
  });
  try {
    await load();
    render();
  } catch (err) {
    setStatus(`读取失败：${err.message}`, true);
  }
}

init();
