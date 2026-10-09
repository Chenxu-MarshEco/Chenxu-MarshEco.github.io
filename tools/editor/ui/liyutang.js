/*
 * 黎语堂管理系统（/liyutang-admin）—— 2026-10-06 建。
 *
 * 干这几件事：
 *   ① 论坛版块：增 / 删 / 改名 / 改说明 / 改版块公告 / 上下挪顺序
 *   ①′ 大厅（2026-10-09 加）：首页最上面那两块大的（聊天室 / 久昭卿茶绘）——
 *      图标 / 标题 / 一句话说明 / 背景图 / 跳转地址 + 上下挪 + 删
 *   ② 评论系统：Giscus 还是 Waline（还是先不挂），以及那几项配置
 *   ③ 用户审核（2026-10-07）：谁注册了、要不要放他进来发言
 *   ④ 帖子管理（2026-10-07）：用户发的帖子在这儿隐藏 / 置顶 / 挪版块 / 删
 *   ⑤ 保存带指纹（2026-10-09 加）：盘上那份在你打开这一页之后被别处改过，
 *      这一次保存**不写盘**，页面明说原因 + 给一颗「重新载入这一页」
 *   ⑥ 页面文案（2026-10-09 加）：站点上那些"介绍 / 提示"文字（写 `copy` 区）——
 *      页面代码里一个字都不写死了，全在这儿填；留空 = 那个位置不显示
 *
 * ① ② ⑥ 写 src/data/liyutang.json；③ ④ 的数据**不在仓库里** —— 它们住在腾讯云函数 +
 * 外部 MongoDB（见 tools/liyutang-backend/index.js），这一页只通过编辑器服务那条转发口
 * （/api/liyutang/users、/api/liyutang/posts，见 server.mjs）问它、改它。
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

/** 多行输入（版块公告用）：rows 只是第一眼的高度，长了自己会长滚动条 */
function textarea(value, placeholder, onInput, rows = 3) {
  const node = el('textarea', 'input input--area');
  node.rows = rows;
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
/**
 * 读盘那一刻的文件指纹（GET /api/liyutang 带回来的 `rev`）。
 *
 * 保存时原样带回去 —— 服务端拿它和盘上现在的比，对不上就 409 拒写。
 * 为什么要有这个东西：草稿是"打开这一页那一刻"的快照，页面开着不刷新，
 * 这期间盘上被别处改过的东西（新键、新注释）会在保存时被旧快照整份盖掉
 * —— 2026-10-09 那场事故就是 `halls` 和 `_readme` 这么没的（见 server.mjs 那段注释）。
 */
let rev = '';
/** 站长密码存在浏览器本地（就是你在评论区小齿轮里设的那个），只为省得每次重填 */
const ADMIN_PW_KEY = 'lt_admin_pw';
/** 有没有没保存的改动 */
let dirty = false;

/*
  ---------------------------------------------------------------
   「页面文案」面板的字段表（2026-10-09）

  站点上那些"介绍 / 提示"文字在这里填（写 `src/data/liyutang.json` 的 `copy` 区）。
  为什么非要有这一页（用户原话，语气很重）：「当前的黎语堂网站里充斥着过多你自己胡编乱造的
  提示和简介 …… 请你全部删掉全部这一类你自己生造的句子 并且给对应的位置留下编辑器接口」。

  ⚠ 这张表和两处必须**一一对应**，加键 / 改键名时四处一起改：
    ① 这里（字段 + 中文标签）；
    ② src/utils/liyutang.ts 的 SiteCopy / copy()（站点读的时候认得它）；
    ③ tools/editor/server.mjs 的 COPY_SHAPE（保存时留得住它）；
    ④ src/data/liyutang.json 的 copy 区（拼错一个字母就是"填了不显示"）。
  验收脚本 tools/checks/editor-liyutang-copy-check.mjs 会断言这几处没脱节。

  label 一律写"出现在哪一页的哪个位置" —— 站长照着这句话就知道自己填的那行字会落在哪儿。
  留空 = 那个位置**什么都不显示**（站点那边见 utils/liyutang.ts 的 copy()：空串就不渲染那一块）。
  ---------------------------------------------------------------
*/
const COPY_FIELDS = [
  { group: 'board', key: 'lead', label: '茶绘画板页 · 顶部简介', where: '标题「久昭卿茶绘」下面那一句' },
  { group: 'board', key: 'hint', label: '茶绘画板页 · 操作提示', where: '工具条下面那段（画笔 / 缩放 / 移动怎么用）' },
  { group: 'board', key: 'note', label: '茶绘画板页 · 补充说明', where: '画板上的其它说明（留空就不显示）' },
  { group: 'board', key: 'empty', label: '茶绘画板页 · 没人动笔时那句', where: '「今天画过画的人」那一栏空着时显示（留空就不显示）' },
  { group: 'chat', key: 'lead', label: '聊天室页 · 顶部简介', where: '标题「聊天室」下面那一句（也用作搜索结果里那句描述）' },
  { group: 'chat', key: 'hint', label: '聊天室搜历史页 · 顶部说明', where: '搜索框上面那一句（也用作搜索结果里那句描述）' },
  { group: 'chat', key: 'note', label: '聊天室某一天的存档页 · 顶部说明', where: '「聊天室 · 2026-10-09」这类标题下面（也用作那一页的描述）' },
  { group: 'calendar', key: 'lead', label: '画过的日子页 · 顶部简介', where: '标题「画过的日子」下面那一句（也用作搜索结果里那句描述）' },
  { group: 'user', key: 'lead', label: '用户页 · 用户名 / 昵称说明', where: '资料卡下面那段（本人和别人都显示；也用作搜索结果里那句描述）' },
  { group: 'home', key: 'lead', label: '黎语堂首页 · 顶部引导', where: '标题「黎语堂」下面那一句（也用作搜索结果里那句描述）' },
  { group: 'home', key: 'note', label: '黎语堂首页 · 「发帖」旁边那行小字', where: '「发帖」按钮右边' },
  { group: 'post', key: 'hint', label: '帖子页 · 作者那一行说明', where: '「改这贴 / 删掉」旁边（只有作者自己看得见）' },
  { group: 'post', key: 'desc', label: '帖子页 · 搜索结果里那句描述', where: '搜索引擎 / 分享卡片上显示（页面正文里看不到；留空用站点总描述）' },
  { group: 'new', key: 'hint', label: '发帖页 · 一个版块都没有时那句', where: '「发在」那一行下面' },
  { group: 'new', key: 'desc', label: '发帖页 · 搜索结果里那句描述', where: '搜索引擎 / 分享卡片上显示（页面正文里看不到；留空用站点总描述）' },
];

/** 分组的中文名（面板里的小标题；分组本身 = 哪一页 / 哪一块功能） */
const COPY_GROUPS = {
  board: '茶绘画板页（久昭卿茶绘）',
  chat: '聊天室（今天 / 搜历史 / 存档日）',
  calendar: '画过的日子页',
  user: '用户页',
  home: '黎语堂首页',
  post: '帖子页',
  new: '发帖页',
};

async function load() {
  const res = await fetch('/api/liyutang');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  draft = data && typeof data === 'object' ? data : {};
  /*
    指纹单独收着，**不留在草稿里**：草稿是按"文件长什么样"整份回来的，
    rev 不是文件内容（存进 JSON 就是脏数据）。老服务端不带 rev 时这里是空串，
    保存照样发得出去（服务端那边把"没带指纹"当"要覆盖"处理）。
  */
  rev = typeof draft.rev === 'string' ? draft.rev : '';
  delete draft.rev;
  if (!draft.forum || typeof draft.forum !== 'object') draft.forum = {};
  if (!draft.forum.giscus || typeof draft.forum.giscus !== 'object') draft.forum.giscus = {};
  if (!draft.forum.waline || typeof draft.forum.waline !== 'object') draft.forum.waline = {};
  if (!draft.forum.twikoo || typeof draft.forum.twikoo !== 'object') draft.forum.twikoo = {};
  if (typeof draft.forum.enabled !== 'boolean') draft.forum.enabled = false;
  /* 认不出来就是 twikoo（2026-10-06 晚上定的那条路，和 server.mjs 的 cleanLiyutang 一致） */
  if (typeof draft.forum.provider !== 'string') draft.forum.provider = 'twikoo';
  if (!Array.isArray(draft.boards)) draft.boards = [];
  /* 大厅同理：盘上没有这个键（老数据 / 刚清空过）就先给一个空数组，页面照样画得出来 */
  if (!Array.isArray(draft.halls)) draft.halls = [];
  /*
    页面文案：盘上可能还没有这个键（老数据），先把分组补成空对象 ——
    真正缺的**键**由 renderCopy() 按 COPY_FIELDS 补齐（见那边的注释）。
  */
  if (!draft.copy || typeof draft.copy !== 'object') draft.copy = {};
  for (const f of COPY_FIELDS) {
    const g = draft.copy[f.group];
    if (!g || typeof g !== 'object' || Array.isArray(g)) draft.copy[f.group] = {};
    if (typeof draft.copy[f.group][f.key] !== 'string') draft.copy[f.group][f.key] = '';
  }
  return draft;
}

/* ---------------------------------------------------------------
   「盘上那份被别处改过」时的那条提示（2026-10-09 加）

   保存被 409 拒掉时，把服务端给的那句中文原话摆出来，再给一颗「重新载入这一页」——
   reload 之后 get 到的是盘上现在那份（新指纹也一起回来了），想改哪就接着改。
   ⚠ 这里**故意不自动重载**：页面上还有用户刚写的东西，一 reload 就没了。
     要丢哪些、什么时候丢，让人自己按。
   --------------------------------------------------------------- */

function showStale(message) {
  const box = $('lt-stale');
  if (!box) return;
  box.textContent = '';
  box.append(
    el('span', 'lt-stale__text', message),
    button('重新载入这一页', '丢掉这一页上的改动，重新读一遍盘上的内容（新指纹也一起回来）', () => {
      window.location.reload();
    }, true)
  );
  box.hidden = false;
}

function hideStale() {
  const box = $('lt-stale');
  if (!box) return;
  box.hidden = true;
  box.textContent = '';
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
      /* 草稿 + 指纹：服务端拿指纹判断盘上那份还是不是我读到的那一份 */
      body: JSON.stringify({ ...draft, rev }),
    });
    const data = await res.json().catch(() => null);
    /*
      409 = 盘上那份在别处被改过，这次**什么都没写**。
      这一条要单独处理：普通报错说"保存失败"就完了，而这一条得把
      「没有写进去 + 怎么办」讲清楚，并给一颗重新载入的按钮。
    */
    if (res.status === 409 && data?.stale) {
      const why = data.error || '盘上的 liyutang.json 在你打开这一页之后被改过。这一次保存没有写进去。';
      showStale(why);
      setStatus('这次保存没有写进去（盘上那份被别处改过）', true);
      toast('盘上的文件在你打开这一页之后被改过，这次保存没有写进去', true);
      return;
    }
    if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    hideStale();
    dirty = false;
    /* 拿服务端那份重新来过：它补过 id、洗过字段，界面上看到的必须和落盘的一致 */
    await load();
    render();
    const d = data.dropped ?? {};
    const lost = [];
    if (d.noTitle) lost.push(`${d.noTitle} 个没写名字的版块`);
    if (d.dupId) lost.push(`${d.dupId} 个重复的版块 id`);
    if (d.hallsNoTitle) lost.push(`${d.hallsNoTitle} 个没写名字的大厅`);
    if (d.hallsNoId) lost.push(`${d.hallsNoId} 个 id 不合法的大厅`);
    if (d.hallsDupId) lost.push(`${d.hallsDupId} 个重复的大厅 id`);
    if (d.hallsImage || d.hallsHref) lost.push('几条外站/不合法的地址（背景图和跳转地址只收站内路径）');
    /* 文案是给人看的：截断了 / 被清空了都要说出来，别让站长以为自己填上了 */
    if (d.copyTooLong) lost.push(`${d.copyTooLong} 条文案超过 200 字（截断了）`);
    if (d.copyNotString) lost.push(`${d.copyNotString} 条文案不是文字（清空了）`);
    const n = (k) => data.counts?.[k] ?? 0;
    if (data.built) {
      setStatus(
        `已保存并重新构建（${data.ms} ms）· ${n('halls')} 块大厅 · ${n('boards')} 个版块` +
          ` · 文案 ${n('copyFilled')}/${COPY_FIELDS.length} 条`
      );
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
   版面：大厅（2026-10-09 加）

   黎语堂首页最上面那两块大的：聊天室、久昭卿茶绘。它们**不是版块** ——
   不发帖、点进去是各自那个独立页面，所以比版块多两个字段：
     · 背景图（`image`）：填**站内路径**（例如 /img/uploads/xxx.webp），留空 = 用皮肤自带的落日渐变；
     · 跳转地址（`href`）：留空 = 按 /liyutang/<id>/ 兜底（和 src/utils/liyutang.ts 的 halls() 一致）。
   ⚠ 服务端对这两样都只收站内路径：外站地址（https://… 或者 //evil.com）会被规整成空串，
     所以这里两个框的提示都写明了"站内路径"。
   --------------------------------------------------------------- */

/** 新大厅的 id 先给一个 `hall-xxxx`（服务端对空 id 是**丢掉**这条，不留着让人踩空），站长想改就在行里改 */
function newHallId() {
  const used = new Set((draft?.halls ?? []).map((h) => String(h.id ?? '').trim()));
  for (let i = 0; i < 50; i++) {
    const id = `hall-${Math.random().toString(16).slice(2, 8)}`;
    if (!used.has(id)) return id;
  }
  return `hall-${Date.now().toString(36)}`;
}

function renderHalls() {
  const box = $('lt-halls-box');
  if (!box) return;
  box.textContent = '';

  box.append(
    el('h4', 'wbox__title', '大厅'),
    el(
      'p',
      'hint',
      '黎语堂首页最上面那两块大的（聊天室 / 久昭卿茶绘）—— 不是版块，不发帖，点进去是各自的页面。' +
        '顺序就是页面上从左到右的顺序，用 ↑ ↓ 挪。背景图填**站内路径**（例如 /img/uploads/xxx.webp），' +
        '留空就用皮肤自带的落日渐变；跳转地址留空 = 按 /liyutang/<id>/ 兜底。' +
        'id 就是网址里那一段（小写字母数字和连字符），空着或者和别人撞了，这条大厅会在保存时被丢掉。'
    )
  );

  const bar = el('div', 'lt-board__row');
  bar.append(
    button('＋ 新增大厅', '在最后加一块大厅，名字和跳转地址自己填', () => {
      draft.halls.push({ id: newHallId(), title: '', desc: '', icon: '', image: '', href: '' });
      markDirty();
      render();
      /* 光标落到新那一行的名字框上，省一次点击 */
      const inputs = box.querySelectorAll('.lt-hall__title');
      inputs[inputs.length - 1]?.focus();
    }, true)
  );
  box.append(bar);

  if (!draft.halls.length) {
    box.append(
      el(
        'div',
        'lt-empty',
        '还没有大厅。加一块之后，黎语堂首页最上面才会出现那张大卡片 —— 现在首页只有下面那些版块。'
      )
    );
    return;
  }

  draft.halls.forEach((h, i) => box.append(hallRow(h, i)));
}

function hallRow(hall, index) {
  const row = el('div', 'lt-board');
  row.dataset.hallId = hall.id || '';

  const icon = input(hall.icon ?? '', '💬', (v) => {
    hall.icon = v;
    markDirty();
  });
  icon.classList.add('lt-board__icon');
  row.append(icon);

  const fields = el('div', 'lt-board__fields');

  const title = input(hall.title ?? '', '大厅名字（必填）', (v) => {
    hall.title = v;
    markDirty();
  });
  title.classList.add('lt-hall__title');
  fields.append(title);

  const desc = input(hall.desc ?? '', '一句话说明这块大厅是干什么的（可空）', (v) => {
    hall.desc = v;
    markDirty();
  });
  /* 类名是给验收脚本认的（title / image / href 那几个也有，这里原来漏了） */
  desc.classList.add('lt-hall__desc');
  fields.append(desc);

  const image = input(
    hall.image ?? '',
    '背景图：站内路径，例如 /img/uploads/xxx.webp（留空 = 用皮肤自带的落日渐变）',
    (v) => {
      hall.image = v;
      markDirty();
    }
  );
  image.classList.add('lt-hall__image');
  fields.append(image);

  /* id 和跳转地址并排一行：它们是一件事的两半（id 是兜底地址里那一段） */
  const linkRow = el('div', 'lt-board__row');
  const idInput = input(hall.id ?? '', 'id：网址里那一段（小写字母数字和连字符）', (v) => {
    hall.id = v.trim();
    markDirty();
  });
  idInput.classList.add('lt-hall__id');
  const hrefInput = input(hall.href ?? '', '跳转地址：留空 = /liyutang/<id>/', (v) => {
    hall.href = v.trim();
    markDirty();
  });
  hrefInput.classList.add('lt-hall__href');
  linkRow.append(idInput, hrefInput);
  fields.append(linkRow);

  const ops = el('div', 'lt-board__ops');
  ops.append(
    button('↑', '往上挪一位', () => {
      if (index === 0) return;
      const list = draft.halls;
      [list[index - 1], list[index]] = [list[index], list[index - 1]];
      markDirty();
      render();
    }),
    button('↓', '往下挪一位', () => {
      const list = draft.halls;
      if (index >= list.length - 1) return;
      [list[index + 1], list[index]] = [list[index], list[index + 1]];
      markDirty();
      render();
    }),
    button('删除', '删掉这块大厅（按保存才真的写盘）', () => {
      if (!window.confirm(`删掉大厅「${hall.title || hall.id || index + 1}」？`)) return;
      draft.halls.splice(index, 1);
      markDirty();
      render();
    })
  );

  /* 这一行"点进去会到哪儿"：填了地址就用它，没填就是按 id 兜的那条 */
  const where = hall.href || (hall.id ? `/liyutang/${hall.id}/` : '（id 空着 → 保存时这条会被丢掉）');
  const meta = el('span', 'hint', `跳到 ${where}`);
  const foot = el('div', 'lt-board__row');
  foot.append(meta, ops);
  fields.append(foot);

  row.append(fields);
  return row;
}

/* ---------------------------------------------------------------
   版面：版块
   --------------------------------------------------------------- */

/*
  这四条 id 是**真路由**，不是版块：/liyutang/new/（发帖页）、/liyutang/post/（帖子页）、
  /liyutang/chatroom/（聊天室）、/liyutang/teahouse/（久昭卿茶绘）。
  版块 id 撞上它们，构建会直接报错（站点那边宁可报错也不悄悄吞掉一个版块）——
  所以在版块列表里**提前红字提醒**（不阻断保存：站长可能就是想先存下来再改名）。
*/
const FIXED_BOARD_IDS = ['new', 'post', 'chatroom', 'teahouse'];

/** 版块 id 撞固定路由时的红字；没撞就是空串 */
function boardIdWarn(id) {
  const key = String(id ?? '').trim().toLowerCase();
  if (!FIXED_BOARD_IDS.includes(key)) return '';
  const what = { new: '发帖页', post: '帖子页', chatroom: '聊天室', teahouse: '久昭卿茶绘' }[key];
  return `⚠ id「${key}」被${what}那条固定路由占着（/liyutang/${key}/），换成别的 —— 撞了构建会直接报错`;
}

function renderBoards() {
  const box = $('lt-boards-box');
  box.textContent = '';

  const title = el('h4', 'wbox__title', '论坛版块');
  box.append(
    title,
    el(
      'p',
      'hint',
      '黎语堂首页上的分区，排在上面那两块大厅的下面。顺序就是页面上从上往下的顺序 —— 用 ↑ ↓ 挪。' +
        '名字和说明都是纯文本，图标可以放一个 emoji。' +
        '「版块公告」是给这个版块写的一段 Markdown，站点把它渲染在版块页**顶部**（可以放图片）—— 留空就是没有公告。' +
        '⚠ id 不能叫 new / post / chatroom / teahouse —— 那四条是固定路由，撞了构建会直接报错。'
    )
  );

  const bar = el('div', 'lt-board__row');
  bar.append(
    button('＋ 新增版块', '在最后加一个版块，先写名字，再按保存', () => {
      draft.boards.push({ id: '', title: '', desc: '', icon: '', notice: '' });
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

  /*
    版块公告（2026-10-07 加）：Markdown 原文，站点那边渲染在版块页顶部。
    缺省写成空串而不是 undefined —— 站点和保存逻辑都不用再判一次"有没有这个字段"。
  */
  const notice = textarea(
    board.notice ?? '',
    '版块公告（Markdown，可空）：显示在这个版块页的顶部，可以放图片',
    (v) => {
      board.notice = v;
      markDirty();
    }
  );
  notice.classList.add('lt-board__notice');
  fields.append(notice);

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
  foot.append(meta);
  /* 撞上固定路由（new / post / chatroom / teahouse）就在这一行旁边红字提醒，见上面那段注释 */
  const warn = boardIdWarn(board.id);
  if (warn) {
    const bad = el('span', 'hint', warn);
    bad.style.color = 'var(--danger)';
    foot.append(bad);
  }
  foot.append(ops);
  fields.append(foot);

  row.append(fields);
  return row;
}

/* ---------------------------------------------------------------
   版面：页面文案（2026-10-09 加）

   站点上所有"介绍 / 提示"文字都在这儿填（`liyutang.json` 的 `copy` 区）。
   字段表在文件上面（COPY_FIELDS）—— 这里只负责画：一组一条小标题，组里每个字段一行
   （中文标签说明它出现在哪一页的哪个位置 + 一个 200 字的文本域）。
   留空 = 站点上那个位置什么都不显示（不会留空行），底下会数"共几条 / 已填几条"。
   --------------------------------------------------------------- */

function renderCopy() {
  const box = $('lt-copy-box');
  if (!box) return;
  box.textContent = '';

  if (!draft.copy || typeof draft.copy !== 'object') draft.copy = {};

  box.append(
    el('h4', 'wbox__title', '页面文案'),
    el(
      'p',
      'hint',
      '站点上那些「介绍 / 提示」文字都在这儿填 —— 页面上写什么由你说了算。' +
        '**留空 = 那个位置什么都不显示**（不会留空行、也不会用一句自动生成的废话顶上）。' +
        '状态和报错（"还没有存档。"、"账号还在等站长审核"、"正在压图…"）不在这儿，' +
        '那些是页面自己要说的事实。每条最多 200 字。'
    )
  );

  const wrap = el('div', 'lt-board__fields');
  let lastGroup = '';
  for (const f of COPY_FIELDS) {
    const g = draft.copy[f.group] && typeof draft.copy[f.group] === 'object' ? draft.copy[f.group] : (draft.copy[f.group] = {});
    if (typeof g[f.key] !== 'string') g[f.key] = '';

    if (f.group !== lastGroup) {
      lastGroup = f.group;
      wrap.append(el('h5', 'lt-copy__group', COPY_GROUPS[f.group] || f.group));
    }

    const area = textarea(g[f.key], f.where || '', (v) => {
      g[f.key] = v;
      markDirty();
      /* 底下的"已填几条"跟着动（只在同一条上改，不整页重画 —— 重画会把光标顶掉） */
      const line = $('lt-copy-count');
      if (line) line.textContent = copyCountText();
    }, 2);
    area.maxLength = 200;
    area.classList.add('lt-copy__field');
    /* 验收脚本按这两个 data 找字段；键名也就是站点那边 copy 区的键名 */
    area.dataset.copyGroup = f.group;
    area.dataset.copyKey = f.key;
    area.setAttribute('aria-label', f.label);

    const row = field(f.label, area);
    row.classList.add('lt-copy__row');
    wrap.append(row);
  }

  const line = el('p', 'lt-sub lt-copy__count', copyCountText());
  line.id = 'lt-copy-count';
  box.append(wrap, line);
}

/** 「共 12 条，已填 0 条」——留空是合法的，所以这里只是提醒，不拦着保存 */
function copyCountText() {
  const total = COPY_FIELDS.length;
  const filled = COPY_FIELDS.filter((f) => String(draft?.copy?.[f.group]?.[f.key] ?? '').trim()).length;
  return `共 ${total} 条，已填 ${filled} 条。留空的那几条在站点上不显示 —— 填完点右上角「保存并重新构建」就生效（不用另外发布）。`;
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
   云端那两块的共用件（用户审核 / 帖子管理，都是 2026-10-07）

   账号和帖子都住在腾讯云函数 + 外部 MongoDB 里（仓库里没有），这一页只是问它、改它，
   而两边的"拿站长密码问一次"长得一模一样 —— 所以密码框和那次请求只写一份。
   身份就是**你在评论区小齿轮里设的那个管理员密码**（云函数内部会拿它去 LOGIN 验一遍），
   不用再记第二个秘密。
   --------------------------------------------------------------- */

/** 站长密码在内存里就这一份 —— 两个面板哪边填了，另一边也认 */
let adminPw = '';
/** 本地那份读过了没有（只在第一次建密码框时读一次） */
let adminPwLoaded = false;
/** 页面上那两个密码框：面板名 -> { node, paint }，用来让两边同步 */
const adminPwViews = new Map();

/**
 * 建一个「站长密码」输入框（用户审核一个、帖子管理一个，长得一样）。
 * 读的是内存里那份 adminPw；在一边敲的时候另一边的框立刻跟着变。
 * ⚠ 敲的过程**不落本地** —— 敲错的那版会被一直带出来（用户真踩过这个坑）；
 *   只有一次调用**成功**之后才记（见 rememberAdminPw）。
 */
function adminPasswordField(panel) {
  if (!adminPwLoaded) {
    adminPwLoaded = true;
    try {
      adminPw = localStorage.getItem(ADMIN_PW_KEY) || '';
    } catch {
      adminPw = '';
    }
  }
  const node = input(adminPw, '站长密码（你在评论区小齿轮里设的那个）', () => {});
  node.type = 'password';
  /*
    密码框是掩码的，看不见自己敲了什么 —— 加上「显示」和字数，
    省得一个看不见的错字符（或本地存下来的旧值）把人绕进去。
  */
  const eye = button('👁 显示', '把刚才填的密码显示出来看一眼', () => {
    const show = node.type === 'password';
    node.type = show ? 'text' : 'password';
    eye.textContent = show ? '🙈 隐藏' : '👁 显示';
  });
  const count = el('span', 'hint', '');
  const view = {
    node,
    paint() {
      const n = String(node.value ?? '').length;
      count.textContent = n ? '当前输入了 ' + n + ' 个字符' : '还没填';
    },
  };
  node.addEventListener('input', () => {
    adminPw = node.value;
    /* 两个面板共用一份密码：这边敲了，另一边那个框也立刻跟着变 */
    for (const [key, other] of adminPwViews) {
      if (key === panel) continue;
      other.node.value = node.value;
      other.paint();
    }
    view.paint();
  });
  /* 面板重画时换掉自己那一份，别把上一次那些死节点一直留在表里 */
  adminPwViews.set(panel, view);
  view.paint();

  const wrap = el('div', 'lt-board__row');
  wrap.append(node, eye, count);
  return {
    field: field('站长密码', wrap),
    /** 现在该用哪个密码（内存里那一份，两个面板共用） */
    read: () => String(adminPw).trim(),
  };
}

/** 调用成功了才把这次密码记在本地（敲错的那版别被带出来） */
function rememberAdminPw(password) {
  try {
    localStorage.setItem(ADMIN_PW_KEY, password);
  } catch {
    /* 无所谓 */
  }
}

/**
 * 往编辑器服务那条转发口扔一次管理请求，把云函数返回的东西拿回来。
 * 失败时抛出的是**能给人看的原话**（页面要看得见到底哪儿不对，别吞）：
 *   · 服务端就没办成（地址没填 / 不准）→ 它给的那句 error；
 *   · 请求根本发不出去           → 「连不上云函数：…」；
 *   · 云函数答了但 code !== 0    → 云函数自己那句 message（err.fromCloud 标着这是它说的）。
 */
async function postAdmin(route, payload) {
  const res = await fetch(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => null);
  if (!data) throw new Error(`HTTP ${res.status}（编辑器服务没回 JSON）`);
  if (!data.ok) throw new Error(data.error || `HTTP ${res.status}`);
  if (data.reachable === false) throw new Error('连不上云函数：' + (data.error || '没有响应'));
  const r = data.result ?? {};
  if (r.code !== 0) {
    const err = new Error(String(r.message ?? data.raw ?? '云函数说不行'));
    /* 标一下：这句话是**云函数说的**，不是网络问题（页面上要用它去问"密码到底怎么不对"） */
    err.fromCloud = true;
    throw err;
  }
  return r;
}

/* ---------------------------------------------------------------
   用户审核（2026-10-07 加）

   用户在这一页点「通过」之前，注册了也**发不出任何东西**（硬门槛在云函数里）。
   站长的身份用 Twikoo 那个管理员密码。
   --------------------------------------------------------------- */

/** 当前这一屏的用户列表（渲染用） */
let userList = null;
/** 上一次操作的反馈 */
let userMsg = '';

function renderUsers() {
  const box = $('lt-users-box');
  if (!box) return;
  box.textContent = '';

  const api = String(draft?.forum?.twikoo?.envId ?? '');
  box.append(
    el('h4', 'wbox__title', '用户审核'),
    el(
      'p',
      'hint',
      '注册了的人默认是「待审核」—— 在你说通过之前，他一个字都发不出去（这道门槛在云函数里，绕开页面直接调接口也没用）。' +
        '通过之后就随便发，不用再逐条审。'
    )
  );

  if (!/^https?:\/\//i.test(api)) {
    box.append(el('p', 'lt-sub', '评论系统那边还没有后端地址（去上面「评论系统」里填好），先弄那个。'));
    return;
  }

  /* 站长密码：和「帖子管理」共用同一个框、同一份值（哪边填了另一边也认） */
  const pw = adminPasswordField('users');
  box.append(pw.field);

  const out = el('p', 'lt-sub', userMsg || '填好密码点「刷新用户列表」。');
  const bar = el('div', 'lt-board__row');

  const ask = async (payload) => {
    const password = pw.read();
    if (!password) {
      userMsg = '先把站长密码填上。';
      out.textContent = userMsg;
      return null;
    }
    try {
      const r = await postAdmin('/api/liyutang/users', { api, password, ...payload });
      /* 成功了才记这次密码（probe 那种只验密码的调用也算成功） */
      rememberAdminPw(password);
      return r;
    } catch (err) {
      userMsg = '操作失败：' + err.message;
      /*
        密码那类错误再问一次云函数「这个密码到底怎么不对」——
        Twikoo 会回「密码错误 / 未配置管理密码 / 数据库无配置」，比一句"不对"有用得多。
      */
      try {
        await postAdmin('/api/liyutang/users', { api, password, action: 'probe' });
      } catch (probeErr) {
        if (probeErr?.fromCloud) userMsg += '　（云函数的原话：' + probeErr.message + '）';
      }
      out.textContent = userMsg;
      out.style.color = 'var(--danger)';
      return null;
    }
  };

  const refresh = async () => {
    out.textContent = '正在问云函数要名单…';
    out.style.color = '';
    const r = await ask({ action: 'list' });
    if (!r) return;
    userList = r.users ?? [];
    userMsg =
      '共 ' +
      userList.length +
      ' 个账号：待审核 ' +
      userList.filter((u) => u.status === 'pending').length +
      ' · 已通过 ' +
      userList.filter((u) => u.status === 'approved').length +
      ' · 停用 ' +
      userList.filter((u) => u.status === 'banned').length;
    renderUsers();
  };

  const setStatus = async (id, status, who) => {
    out.textContent = '正在把「' + who + '」设为 ' + status + ' …';
    out.style.color = '';
    const r = await ask({ action: 'set', id, status });
    if (!r) return;
    userMsg = '已经把「' + who + '」设为 ' + status + '。';
    await refresh();
  };

  const remove = async (id, who) => {
    out.textContent = '正在删掉「' + who + '」…';
    out.style.color = '';
    const r = await ask({ action: 'delete', id });
    if (!r) return;
    userMsg = '已经删掉「' + who + '」。';
    await refresh();
  };

  bar.append(button('刷新用户列表', '问一次云函数里有谁注册了', refresh));
  box.append(bar, out);

  if (!userList) {
    box.append(el('p', 'lt-sub', '还没拉过名单。'));
    return;
  }
  if (userList.length === 0) {
    box.append(el('p', 'lt-sub', '还没有人注册。'));
    return;
  }

  const list = el('div', 'lt-board__fields');
  for (const u of userList) {
    const row = el('div', 'lt-board');
    const who = el('div', 'lt-board__fields');
    const line = el('div', 'lt-board__row');
    line.append(
      el('strong', '', u.nick),
      el('span', 'hint', (u.mail || '（没填邮箱）') + ' · ' + statusText(u.status) + (u.label ? ' · ' + u.label : ''))
    );
    const ops = el('div', 'lt-board__row');
    if (u.status !== 'approved') {
      ops.append(button('通过', '通过之后他就能随便发言了', () => setStatus(u.id, 'approved', u.nick)));
    }
    if (u.status !== 'pending') {
      ops.append(button('改回待审', '收回发言权（但他还是能看到帖子）', () => setStatus(u.id, 'pending', u.nick)));
    }
    if (u.status !== 'banned') {
      ops.append(button('封禁', '封禁后连登录都不行', () => setStatus(u.id, 'banned', u.nick)));
    }
    ops.append(button('删除', '把这个账号从库里删掉', () => remove(u.id, u.nick)));
    who.append(line, ops);
    row.append(el('div', 'lt-board__icon', ''), who);
    list.append(row);
  }
  box.append(list);
}

/** 状态 → 人话 */
function statusText(s) {
  return s === 'approved' ? '已通过' : s === 'banned' ? '已停用' : '待审核';
}

/* ---------------------------------------------------------------
   帖子管理（2026-10-07 加）

   站长在这一块管**用户发的帖子**（类似贴吧吧务）：隐藏 / 恢复 / 置顶 / 移版块 / 删除。
   帖子本体**不在仓库里** —— 它和账号一样住在腾讯云函数 + 外部 MongoDB
   （见 tools/liyutang-backend/index.js），所以全部走编辑器服务那条转发口
   /api/liyutang/posts（为什么非要转一手，见 server.mjs 那段注释）。
   身份还是那个站长密码：和「用户审核」共用同一份（见 adminPasswordField）。
   --------------------------------------------------------------- */

/** 当前这一屏的帖子列表（渲染用） */
let postList = null;
/** 上一次操作的反馈 */
let postMsg = '';

/** 版块 id → 版块标题（列表里给人看的是标题；id 是给网址用的那一段） */
function boardTitle(id) {
  const hit = (draft?.boards ?? []).find((b) => b.id === id);
  return hit?.title || id || '（没版块）';
}

/** 时间戳 → 人话；认不出来就原样贴回去（别在页面上显示 Invalid Date） */
function timeText(v) {
  if (v == null || v === '') return '';
  let ms = NaN;
  if (typeof v === 'number') ms = v;
  else if (/^\d+$/.test(String(v).trim())) ms = Number(String(v).trim());
  /* 秒和毫秒都收（不同地方给的不一样）：十位数那一档是秒 */
  if (Number.isFinite(ms) && ms < 1e12) ms *= 1000;
  if (!Number.isFinite(ms)) ms = Date.parse(String(v));
  if (!Number.isFinite(ms)) return String(v);
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function renderPosts() {
  const box = $('lt-posts-box');
  if (!box) return;
  box.textContent = '';

  const api = String(draft?.forum?.twikoo?.envId ?? '');
  box.append(
    el('h4', 'wbox__title', '帖子管理'),
    el(
      'p',
      'hint',
      '用户发在这个版块里的帖子都在这儿。隐藏之后站点上看不见（只是看不见，内容还在），' +
        '置顶的排在版块最前面，移版块会把帖子挪到另一个版块。删除是**真删**，删了就找不回来。'
    )
  );

  if (!/^https?:\/\//i.test(api)) {
    box.append(el('p', 'lt-sub', '先去评论系统那一块填好后端地址。'));
    return;
  }

  /* 站长密码：和「用户审核」共用同一个框、同一份值（哪边填了另一边也认） */
  const pw = adminPasswordField('posts');
  const out = el('p', 'lt-sub', postMsg || '填好密码点「刷新帖子列表」。');
  const bar = el('div', 'lt-board__row');

  const say = (text, color = '') => {
    postMsg = text;
    out.textContent = text;
    out.style.color = color;
  };

  const ask = async (payload) => {
    const password = pw.read();
    if (!password) {
      say('填上站长密码再刷新。', 'var(--danger)');
      return null;
    }
    try {
      const r = await postAdmin('/api/liyutang/posts', { api, password, ...payload });
      /* 成功了才记这次密码（和用户审核那边一个规矩：敲错的那版别被记下来） */
      rememberAdminPw(password);
      return r;
    } catch (err) {
      /* 云函数说的原话直接摆出来 —— 失败要看得见，别吞 */
      say('操作失败：' + err.message, 'var(--danger)');
      toast('帖子操作失败：' + err.message, true);
      return null;
    }
  };

  const refresh = async () => {
    say('正在问云函数要帖子…');
    const r = await ask({ action: 'list' });
    if (!r) return;
    postList = Array.isArray(r.posts) ? r.posts : [];
    postMsg =
      '共 ' +
      postList.length +
      ' 篇：正常 ' +
      postList.filter((p) => p.status !== 'hidden').length +
      ' · 已隐藏 ' +
      postList.filter((p) => p.status === 'hidden').length +
      ' · 置顶 ' +
      postList.filter((p) => p.pinned).length;
    renderPosts();
  };

  const setField = async (post, payload, okText) => {
    const who = post.title || post.id;
    say('正在处理「' + who + '」…');
    try {
      const r = await ask({ action: 'set', id: post.id, ...payload });
      if (!r) return;
      toast(okText);
      await refresh();
    } catch (err) {
      say('操作失败：' + err.message, 'var(--danger)');
    }
  };

  const remove = async (post) => {
    const who = post.title || post.id;
    if (!window.confirm(`删掉帖子「${who}」？删了就找不回来了。`)) return;
    say('正在删「' + who + '」…');
    const r = await ask({ action: 'delete', id: post.id });
    if (!r) return;
    toast('已经删掉「' + who + '」。');
    await refresh();
  };

  bar.append(button('刷新帖子列表', '问一次云函数里都有谁发了什么', refresh));
  box.append(pw.field, bar, out);

  if (!postList) {
    box.append(el('p', 'lt-sub', '还没拉过帖子列表。'));
    return;
  }
  if (postList.length === 0) {
    box.append(el('p', 'lt-sub', '还没有人发帖。'));
    return;
  }

  const list = el('div', 'lt-board__fields');
  for (const p of postList) list.append(postRow(p, { setField, remove }));
  box.append(list);
}

/** 帖子列表里的一行 */
function postRow(post, ops) {
  const who = post.title || post.id;
  const row = el('div', 'lt-board');
  row.dataset.postId = post.id || '';

  /* 头像那一格：有就显示小圆图，没有就空着（和用户审核那行的布局对齐） */
  const icon = el('div', 'lt-board__icon');
  if (post.authorAvatar) {
    const img = el('img', 'lt-post__avatar');
    img.src = String(post.authorAvatar);
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    icon.append(img);
  }
  row.append(icon);

  const fields = el('div', 'lt-board__fields');

  /*
    标题点了在新标签页打开**站点预览**上的那一页（编辑器服务和站点不是一个端口，
    所以用 PREVIEW_URL —— 和右上角「打开 /liyutang/」是同一个地方）。
  */
  const title = el('a', 'lt-post__title', post.title || '（没标题）');
  title.href = `${PREVIEW_URL}/liyutang/post/?id=${encodeURIComponent(post.id ?? '')}`;
  title.target = '_blank';
  title.rel = 'noopener';

  const meta = [
    boardTitle(post.board),
    post.authorNick || '（没昵称）',
    timeText(post.createdAt),
    post.views != null ? post.views + ' 次浏览' : '',
    post.status === 'hidden' ? '已隐藏' : '正常',
    post.pinned ? '置顶' : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const head = el('div', 'lt-board__row');
  head.append(title, el('span', 'hint', meta));
  fields.append(head, el('div', 'lt-post__excerpt', post.excerpt || '（没有摘要）'));

  const actions = el('div', 'lt-board__row');
  if (post.status === 'hidden') {
    actions.append(
      button('恢复', '恢复之后站点上又能看见这篇了', () => ops.setField(post, { status: 'ok' }, `已经把「${who}」恢复成正常。`))
    );
  } else {
    actions.append(
      button('隐藏', '站点上看不见（只是看不见，内容和回帖都还在）', () => ops.setField(post, { status: 'hidden' }, `已经把「${who}」隐藏了。`))
    );
  }
  if (post.pinned) {
    actions.append(
      button('取消置顶', '不再排在版块最前面', () => ops.setField(post, { pinned: 0 }, `已经取消「${who}」的置顶。`))
    );
  } else {
    actions.append(
      button('置顶', '排在版块最前面', () => ops.setField(post, { pinned: 1 }, `已经把「${who}」置顶了。`))
    );
  }

  /* 移版块：选项就是现有的版块表（值用版块 id —— 和网址里那一段是同一个东西） */
  const move = el('select', 'input lt-post__move');
  const blank = el('option', '', '移到…');
  blank.value = '';
  move.append(blank);
  for (const b of draft?.boards ?? []) {
    const opt = el('option', '', b.title || b.id);
    opt.value = b.id;
    move.append(opt);
  }
  move.addEventListener('change', () => {
    const to = move.value;
    /* 选回自己那个版块 = 什么都没做，别白跑一趟云函数 */
    if (!to || to === post.board) return;
    ops.setField(post, { moveTo: to }, `已经把「${who}」移到「${boardTitle(to)}」。`);
  });
  actions.append(move, button('删除', '真的从库里删掉（不是隐藏）', () => ops.remove(post)));

  fields.append(actions);
  row.append(fields);
  return row;
}

/* ---------------------------------------------------------------
   渲染 + 启动
   --------------------------------------------------------------- */

function render() {
  /* 用户审核在最上面（页面上也是排第一的那个区块，2026-10-07） */
  renderUsers();
  /* 大厅紧接着（页面上大厅就排在版块上面：论坛首页的顺序，2026-10-09） */
  renderHalls();
  renderBoards();
  /* 页面文案也是配置（排在版块后面、帖子管理前面：配完版块顺手就能填文案，2026-10-09） */
  renderCopy();
  /* 帖子管理夹在版块和评论系统中间（页面上也是这个位置，2026-10-07） */
  renderPosts();
  renderForum();
  if (!dirty) {
    const n = draft?.boards?.length ?? 0;
    const h = draft?.halls?.length ?? 0;
    const filled = COPY_FIELDS.filter((f) => String(draft?.copy?.[f.group]?.[f.key] ?? '').trim()).length;
    setStatus(
      `读取完成：${draft?.forum?.provider ?? 'giscus'} · ${h} 块大厅 · ${n} 个版块` +
        ` · 文案已填 ${filled}/${COPY_FIELDS.length} 条` +
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
