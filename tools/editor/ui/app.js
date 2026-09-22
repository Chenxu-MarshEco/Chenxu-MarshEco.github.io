/* ============================================================
   本地内容编辑器 · 前端逻辑
   ------------------------------------------------------------
   · 零依赖：marked 从 /vendor/marked.js 动态加载，装没装都能用
   · 三栏：文档列表 / 表单 + Markdown 正文 / 实时预览
   · 草稿自动存 localStorage，关页面也不怕
   ============================================================ */

const $ = (id) => document.getElementById(id);

const els = {
  brandTitle: $('brand-title'),
  brandSub: $('brand-sub'),
  statusPill: $('status-pill'),
  btnPreview: $('btn-preview'),
  btnTheme: $('btn-theme'),
  themeLabel: $('theme-label'),
  btnSave: $('btn-save'),

  typeTabs: $('type-tabs'),
  search: $('search'),
  doclist: $('doclist'),
  btnNew: $('btn-new'),

  filename: $('filename'),
  editMeta: $('edit-meta'),
  form: $('form'),

  title: $('f-title'),
  date: $('f-date'),
  time: $('f-time'),
  updatedDate: $('f-updated-date'),
  updatedTime: $('f-updated-time'),
  week: $('f-week'),
  mood: $('f-mood'),
  tagsBox: $('tags-box'),
  tagsInput: $('f-tags-input'),
  subsBox: $('subs-box'),
  summary: $('f-summary'),
  cover: $('f-cover'),
  coverImg: $('cover-img'),
  coverEmpty: $('cover-empty'),
  btnCoverUpload: $('btn-cover-upload'),
  btnCoverClear: $('btn-cover-clear'),
  coverFile: $('cover-file'),
  pinned: $('f-pinned'),
  draft: $('f-draft'),

  toolbar: $('toolbar'),
  body: $('f-body'),
  bodyCount: $('body-count'),

  preview: $('preview'),
  previewNote: $('preview-note'),

  imgModal: $('img-modal'),
  modalPick: $('modal-pick'),
  modalFile: $('modal-file'),
  modalUploadHint: $('modal-upload-hint'),
  modalUrl: $('modal-url'),
  modalAlt: $('modal-alt'),
  modalInsert: $('modal-insert'),

  btnBoards: $('btn-boards'),
  boardsModal: $('boards-modal'),
  boardsEditor: $('boards-editor'),
  boardsSave: $('boards-save'),

  btnTimelines: $('btn-timelines'),
  tlModal: $('tl-modal'),
  tlEditor: $('tl-editor'),
  tlSave: $('tl-save'),

  btnNavs: $('btn-navs'),
  navsModal: $('navs-modal'),
  navsEditor: $('navs-editor'),
  navsSave: $('navs-save'),

  btnPages: $('btn-pages'),
  pagesModal: $('pages-modal'),
  pagesTitle: $('pages-title'),
  pwSearch: $('pw-search'),
  pwList: $('pw-list'),
  pwSolo: $('pw-standalone'),
  pwFields: $('pw-fields'),
  pwKids: $('pw-kids'),
  pwAddKid: $('pw-addkid'),
  pwContentNote: $('pw-content-note'),
  pwUrl: $('pw-url'),
  pwFrame: $('pw-frame'),
  pwRebuild: $('pw-rebuild'),
  pwOpen: $('pw-open'),
  pwStatus: $('pw-status'),
  pwAddLink: $('pw-addlink'),
  pageEditor: $('page-editor'),
  pageSave: $('page-save'),
  pwCopyUrl: $('pw-copy-url'),
  /*
    「页面」工作台里可以整块搬去独立页面工作台的节点。
    少一个这里就会是 null，initStudioAnchors 会跳过它 —— 于是搬不过去，
    独立页面面板中间就空着（踩过一次）。
  */
  pwEditCol: $('pw-edit-col'),
  pwPreviewCol: $('pw-preview-col'),
  pwContentBlock: $('pw-content-block'),
  pwKidsBlock: $('pw-kids-block'),
  pwPreviewHead: $('pw-preview-head'),
  pwFrameWrap: $('pw-frame-wrap'),
  pwActions: $('pw-actions'),

  /*
    独立页面工作台：中间栏和右栏是空的，控件靠 mountStudioHost()
    从「页面」工作台整块搬过来（见那边的注释）。
  */
  soloModal: $('solo-modal'),
  soloTitle: $('solo-title'),
  soloCount: $('solo-count'),
  soloSearch: $('solo-search'),
  soloNewName: $('solo-newname'),
  soloAdd: $('solo-add'),
  soloList: $('solo-list'),
  soloEditCol: $('solo-edit-col'),
  soloPreviewCol: $('solo-preview-col'),
  soloPanel: document.querySelector('#solo-modal .modal__panel'),

  btnHub: $('btn-hub'),
  hubMenu: $('hub-menu'),
  hubMenuList: $('hub-menu-list'),

  btnMusic: $('btn-music'),
  musicModal: $('music-modal'),
  musicSearch: $('music-search'),
  musicPages: $('music-pages'),
  musicCurrent: $('music-current'),
  musicUpload: $('music-upload'),
  musicFile: $('music-file'),
  musicTrackList: $('music-tracklist'),
  musicLibToggle: $('music-lib-toggle'),
  musicLib: $('music-lib'),
  musicPlayer: $('music-player'),
  musicStatus: $('music-status'),
  musicSave: $('music-save'),
  musicLog: $('music-log'),

  btnLayout: $('btn-layout'),
  layoutModal: $('layout-modal'),
  layoutFrame: $('layout-frame'),
  layoutPick: $('layout-pick'),
  layoutPage: $('layout-page'),
  layoutSample: $('layout-sample'),
  layoutSampleWrap: $('layout-sample-wrap'),
  layoutReset: $('layout-reset'),
  layoutResetAll: $('layout-resetall'),
  layoutSave: $('layout-save'),
  layoutNum: $('layout-num'),
  lnX: $('ln-x'),
  lnY: $('ln-y'),
  lnW: $('ln-w'),
  lnH: $('ln-h'),
  lnS: $('ln-s'),

  /*
    首页那几块（src/data/home-widgets.json）：日历 / 关于我 / 冰室冰山。
    三个面板各写文件里的一块，所以它们是三个独立的工作面，共用一份
    widgetsDraft（见 panels 那一节）。

    *Save 那几个按钮是 app.js 自己画出来的（panelShell 的动作条），
    这里取到的是 null，画完在各自的 renderXxxPanel 里指到真按钮上。
    顶栏没有这五个入口：它们只从「☰ 工作台」和面板顶上那条「切换」进。
  */
  calendarModal: $('calendar-modal'),
  calEditor: $('cal-editor'),
  calSave: $('cal-save'),

  aboutModal: $('about-modal'),
  aboutEditor: $('about-editor'),
  aboutSave: $('about-save'),

  icebergModal: $('iceberg-modal'),
  icebergEditor: $('iceberg-editor'),
  icebergSave: $('iceberg-save'),

  /* 冰山图（src/data/iceberg.json）：分类 / 标签 / 层级 / 条目 */
  icechartModal: $('icechart-modal'),
  iceEditor: $('ice-editor'),
  iceSave: $('ice-save'),

  /* 冰室精华（src/data/salon.json）：精华 / 成员两个面板共用一份 salonDraft */
  essencesModal: $('essences-modal'),
  essEditor: $('ess-editor'),
  essSave: $('ess-save'),

  membersModal: $('members-modal'),
  memEditor: $('mem-editor'),
  memSave: $('mem-save'),

  toast: $('toast'),
};

const TYPE_LABEL = { posts: '文章', notes: '手记' };
const DRAFT_PREFIX = 'local-editor:draft:';
const THEME_KEY = 'local-editor:theme';
const PREVIEW_KEY = 'local-editor:preview';
const THEME_ORDER = ['auto', 'light', 'dark'];

const state = {
  type: 'posts',
  site: { title: '本地内容编辑器', author: '', tagline: '' },
  items: { posts: [], notes: [] },
  search: '',
  current: null, // { file, frontmatter, body }
  tags: [],
  /** 这篇所属的子版块 id 列表，勾选框里选出来的 */
  subs: [],
  /** 可选子版块全集，从 /api/boards 拉一次缓存起来 */
  allSubs: [],
  dirty: false,
  saving: false,
  marked: null,
  markedFailed: false,
  themeMode: 'auto',
  previewOn: true,
};

/* ---------------------------------------------------------------
   通用小工具
   --------------------------------------------------------------- */

function formatToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** "2026-09-14 20:30" -> { date: '2026-09-14', time: '20:30' } */
function splitDateTime(value) {
  const s = String(value ?? '').trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/.exec(s);
  if (!m) return { date: '', time: '' };
  const time = m[2] === '00:00' ? '' : m[2] || '';
  return { date: m[1], time };
}

function joinDateTime(date, time) {
  const d = String(date ?? '').trim();
  const t = String(time ?? '').trim();
  if (!d) return '';
  return t ? `${d} ${t}` : d;
}

function todayDraftFrontmatter() {
  return {
    title: '',
    date: formatToday(),
    updated: '',
    summary: '',
    tags: [],
    cover: '',
    draft: false,
    pinned: 0,
    week: '',
    mood: '',
  };
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('is-error', Boolean(isError));
  els.toast.hidden = false;
  // 触发过渡
  requestAnimationFrame(() => els.toast.classList.add('is-on'));
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    els.toast.classList.remove('is-on');
    clearTimeout(toast._hide);
    toast._hide = setTimeout(() => {
      els.toast.hidden = true;
    }, 220);
  }, 2200);
}

function statusPill(text, kind) {
  if (!text) {
    els.statusPill.hidden = true;
    els.statusPill.textContent = '';
    return;
  }
  els.statusPill.hidden = false;
  els.statusPill.textContent = text;
  els.statusPill.classList.toggle('pill--warn', kind === 'warn');
}

/* ---------------------------------------------------------------
   HTTP
   --------------------------------------------------------------- */

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 300) };
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const apiGet = (path) => api(path, { headers: { Accept: 'application/json' } });
const apiPost = (path, payload) =>
  api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload ?? {}),
  });

/* ---------------------------------------------------------------
   主题
   --------------------------------------------------------------- */

function applyTheme() {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const resolved = state.themeMode === 'auto' ? (prefersDark ? 'dark' : 'light') : state.themeMode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.mode = state.themeMode;
  els.themeLabel.textContent =
    state.themeMode === 'auto' ? '自动' : state.themeMode === 'dark' ? '深色' : '浅色';
}

function initTheme() {
  let saved = 'auto';
  try {
    saved = localStorage.getItem(THEME_KEY) || 'auto';
  } catch {
    saved = 'auto';
  }
  state.themeMode = THEME_ORDER.includes(saved) ? saved : 'auto';
  applyTheme();
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const onChange = () => {
    if (state.themeMode === 'auto') applyTheme();
  };
  if (mq.addEventListener) mq.addEventListener('change', onChange);
  else if (mq.addListener) mq.addListener(onChange);
}

function cycleTheme() {
  const i = THEME_ORDER.indexOf(state.themeMode);
  state.themeMode = THEME_ORDER[(i + 1) % THEME_ORDER.length];
  try {
    localStorage.setItem(THEME_KEY, state.themeMode);
  } catch {
    /* 忽略隐私模式下的写入失败 */
  }
  applyTheme();
}

/* ---------------------------------------------------------------
   marked（可选依赖）
   --------------------------------------------------------------- */

async function loadMarked() {
  try {
    const mod = await import('/vendor/marked.js');
    const m = mod && (mod.marked || mod.default || mod);
    if (!m || typeof m.parse !== 'function') throw new Error('marked 导出格式无法识别');
    state.marked = m;
    state.markedFailed = false;
    els.previewNote.textContent = '';
    els.previewNote.classList.remove('is-warn');
  } catch {
    state.marked = null;
    state.markedFailed = true;
    els.previewNote.textContent = '未安装 marked，预览不可用';
    els.previewNote.classList.add('is-warn');
  }
  renderPreview();
}

/** 极简 HTML 清洗：本地工具也顺手挡一下脚本执行 */
function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div id="__root__">${html}</div>`, 'text/html');
  const root = doc.getElementById('__root__');
  if (!root) return '';
  root.querySelectorAll('script,style,iframe,object,embed,link,meta,form,base').forEach((n) => n.remove());
  root.querySelectorAll('*').forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim();
      if (name.startsWith('on')) {
        el.removeAttribute(attr.name);
      } else if (
        (name === 'href' || name === 'src' || name === 'xlink:href') &&
        /^\s*(javascript|vbscript|data:text\/html)/i.test(value)
      ) {
        el.removeAttribute(attr.name);
      }
    }
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return root.innerHTML;
}

let previewTimer = null;
// 上次渲染用的正文内容。用它挡掉重复渲染 —— 预览是整棵 DOM 替换，
// 白跑一次就会让预览的滚动位置归零、里面的图片重新加载，
// 表现出来就是"写到一半右边跳回顶部"。
let previewLastMd = null;

function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderPreview, 200);
}

/** 找出真正在滚动的祖先元素，用来在重绘前后保住滚动位置 */
function scrollParent(el) {
  let node = el;
  while (node && node !== document.body) {
    const s = getComputedStyle(node);
    if (/(auto|scroll)/.test(s.overflowY) && node.scrollHeight > node.clientHeight) return node;
    node = node.parentElement;
  }
  return null;
}

function renderPreview() {
  clearTimeout(previewTimer);
  const md = els.body.value;

  // 内容没变直接返回。切换文档、改标题、切栏目都会触发预览，
  // 那些情况下正文其实一个字都没动，没必要整棵重建。
  if (md === previewLastMd) return;

  if (!state.marked) {
    // 注意：这里不写 previewLastMd。marked 是异步加载的，
    // 早先写成"先记缓存再判断"，结果第一次渲染出的是占位符、
    // 缓存却记成已渲染，等 marked 就绪后重绘被跳过，占位符就留在那儿了。
    els.preview.innerHTML =
      '<div class="preview__placeholder">未安装 marked，预览不可用。<br />' +
      '正文照样能编辑和保存，等装好 marked（<code>pnpm add -D marked</code>）刷新一下就会出现预览。</div>';
    return;
  }
  if (!md.trim()) {
    els.preview.innerHTML = '<div class="preview__placeholder">还没有正文，右边会随着输入实时渲染。</div>';
    previewLastMd = md;
    return;
  }
  try {
    const html = state.marked.parse(md, { gfm: true, breaks: false });
    // 记住滚动位置，替换完再放回去
    const scroller = scrollParent(els.preview);
    const top = scroller ? scroller.scrollTop : 0;
    els.preview.innerHTML = `<article class="prose">${sanitizeHtml(html)}</article>`;
    if (scroller) scroller.scrollTop = top;
    previewLastMd = md;
  } catch (err) {
    els.preview.innerHTML = `<div class="preview__placeholder">Markdown 渲染失败：${String(
      err && err.message ? err.message : err
    )}</div>`;
  }
}

/* ---------------------------------------------------------------
   草稿（localStorage）
   --------------------------------------------------------------- */

function draftKey(type, file) {
  return `${DRAFT_PREFIX}${type}:${file || 'untitled'}`;
}

function readDraft(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeDraft() {
  if (!state.current || !state.dirty) return;
  const key = draftKey(state.type, state.current.file);
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ at: Date.now(), frontmatter: collectForm(), body: els.body.value })
    );
  } catch {
    /* 存储满了就算了，不影响编辑 */
  }
}

function clearDraft(type, file) {
  try {
    localStorage.removeItem(draftKey(type, file));
  } catch {
    /* 忽略 */
  }
}

let draftTimer = null;
function scheduleDraftSave() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(writeDraft, 500);
}

/* ---------------------------------------------------------------
   列表
   --------------------------------------------------------------- */

async function refreshList(type) {
  try {
    const items = await apiGet(`/api/list?type=${encodeURIComponent(type)}`);
    state.items[type] = Array.isArray(items) ? items : [];
    if (state.type === type) renderList();
  } catch (err) {
    state.items[type] = state.items[type] || [];
    toast(`读取列表失败：${err.message}`, true);
    if (state.type === type) renderList();
  }
}

function filteredItems() {
  const all = state.items[state.type] || [];
  const q = state.search.trim().toLowerCase();
  if (!q) return all;
  return all.filter((item) => {
    if (String(item.title || '').toLowerCase().includes(q)) return true;
    return (item.tags || []).some((t) => String(t).toLowerCase().includes(q));
  });
}

// 上次列表渲染的"指纹"（栏目 + 搜索词 + 文件清单 + 当前选中项）。
// 搜索框每敲一个字都会走到 renderList，而它是整表重建 —— 文档一多
// 就会明显卡顿。指纹没变就直接跳过。
let listLastKey = null;

function renderList() {
  const items = filteredItems();
  const currentFile = state.current ? state.current.file : '';
  const key =
    state.type + '|' + state.search + '|' + currentFile + '|' +
    items.map((i) => i.file + ':' + (i.title || '')).join(',');
  if (key === listLastKey) return;
  listLastKey = key;

  els.doclist.textContent = '';

  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'doclist__empty';
    li.textContent =
      (state.items[state.type] || []).length === 0
        ? `还没有${TYPE_LABEL[state.type]}。点下面的「＋ 新建」写第一篇。`
        : '没有匹配的结果。';
    els.doclist.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'doc';
    li.dataset.file = item.file;
    if (currentFile && item.file === currentFile) li.classList.add('is-active');

    const title = document.createElement('div');
    title.className = 'doc__title';
    title.textContent = item.title || item.slug || item.file;
    title.title = item.title || item.file;
    li.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'doc__meta';

    const date = document.createElement('span');
    date.textContent = item.date || '';
    meta.appendChild(date);

    if (item.draft) {
      const badge = document.createElement('span');
      badge.className = 'badge-draft';
      badge.textContent = '草稿';
      meta.appendChild(badge);
    }

    if (item.tags && item.tags.length) {
      const tags = document.createElement('div');
      tags.className = 'doc__tags';
      for (const t of item.tags.slice(0, 3)) {
        const tag = document.createElement('span');
        tag.className = 'doc__tag';
        tag.textContent = t;
        tags.appendChild(tag);
      }
      if (item.tags.length > 3) {
        const more = document.createElement('span');
        more.className = 'doc__tag';
        more.textContent = `+${item.tags.length - 3}`;
        tags.appendChild(more);
      }
      meta.appendChild(tags);
    }

    li.appendChild(meta);

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'doc__del';
    del.title = '删除这篇';
    del.setAttribute('aria-label', `删除 ${item.title || item.file}`);
    del.textContent = '✕';
    del.addEventListener('click', (ev) => {
      ev.stopPropagation();
      deleteItem(item);
    });
    li.appendChild(del);

    li.addEventListener('click', () => openItem(item.file, { askRestore: true }));
    els.doclist.appendChild(li);
  }
}

/* ---------------------------------------------------------------
   编辑器状态
   --------------------------------------------------------------- */

function startNew({ focus = true } = {}) {
  state.current = { file: '', frontmatter: todayDraftFrontmatter(), body: '' };
  state.tags = [];
  state.subs = [];
  fillForm(state.current.frontmatter, '');
  setDirty(false);
  renderList();
  renderMeta();
  renderPreview();
  schedulePreview();
  if (focus) els.title.focus();
}

async function openItem(file, { askRestore = true } = {}) {
  if (!file) return;
  if (state.dirty && !confirm('当前这篇还有未保存的修改（已暂存为草稿）。确定要切换吗？')) return;

  let data;
  try {
    data = await apiGet(`/api/item?type=${encodeURIComponent(state.type)}&file=${encodeURIComponent(file)}`);
  } catch (err) {
    toast(`打开失败：${err.message}`, true);
    return;
  }

  state.current = { file: data.file || file, frontmatter: data.frontmatter || {}, body: data.body || '' };
  fillForm(state.current.frontmatter, state.current.body);
  setDirty(false);
  renderList();
  renderPreview();

  const draft = readDraft(draftKey(state.type, state.current.file));
  let pending = null;
  if (draft && draft.frontmatter) {
    const diskBody = state.current.body || '';
    const draftBody = typeof draft.body === 'string' ? draft.body : '';
    const same =
      draftBody === diskBody &&
      JSON.stringify(draft.frontmatter) === JSON.stringify(state.current.frontmatter);
    if (!same) {
      const when = draft.at ? new Date(draft.at).toLocaleString() : '此前';
      const label = state.current.frontmatter.title || file;
      if (askRestore) {
        const yes = confirm(
          `发现「${label}」在 ${when} 有未保存的草稿，要恢复吗？\n` +
            `（选「取消」则保留磁盘上的内容，草稿仍然留在浏览器里）`
        );
        if (yes) {
          restoreDraft(draft);
          return;
        }
      }
      pending = draft;
    }
  }
  renderMeta(pending);
}

function restoreDraft(draft) {
  fillForm(draft.frontmatter || {}, typeof draft.body === 'string' ? draft.body : '');
  setDirty(true);
  renderMeta(draft);
  toast('已恢复未保存的草稿');
}

function renderMeta(draft) {
  els.editMeta.textContent = '';
  if (!draft) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--sm';
  btn.textContent = '恢复草稿';
  btn.title = '把 localStorage 里暂存的内容填回表单';
  btn.addEventListener('click', () => restoreDraft(draft));
  els.editMeta.append('有未保存的草稿 ', btn);
}

function fillForm(fm, body) {
  const f = fm || {};
  state.tags = Array.isArray(f.tags) ? f.tags.map((t) => String(t)).filter(Boolean) : [];

  els.title.value = f.title || '';

  const d = splitDateTime(f.date);
  els.date.value = d.date || '';
  els.time.value = d.time || '';

  const u = splitDateTime(f.updated);
  els.updatedDate.value = u.date || '';
  els.updatedTime.value = u.time || '';

  els.week.value = f.week || '';
  els.mood.value = f.mood || '';
  els.summary.value = f.summary || '';
  els.cover.value = f.cover || '';
  els.draft.checked = Boolean(f.draft);
  els.pinned.value = Number.isFinite(Number(f.pinned)) ? Number(f.pinned) : 0;

  els.body.value = typeof body === 'string' ? body : '';
  els.tagsInput.value = '';

  state.subs = Array.isArray(f.subs) ? f.subs.slice() : [];

  renderChips();
  renderSubPicker();
  updateCoverPreview();
  updateBodyCount();
  renderFilename();
  updateDocTitle();
}

function collectForm() {
  const fm = {
    title: els.title.value.trim(),
    date: joinDateTime(els.date.value, els.time.value),
    tags: state.tags.slice(),
    draft: els.draft.checked,
  };
  // 封面图文章和手记都支持（content.config.ts 里两边都有 cover 字段）
  fm.cover = els.cover.value.trim();
  if (state.type === 'posts') {
    fm.summary = els.summary.value.trim();
    fm.pinned = Number.isFinite(Number(els.pinned.value)) ? Number(els.pinned.value) : 0;
    const updated = joinDateTime(els.updatedDate.value, els.updatedTime.value);
    if (updated) fm.updated = updated;
  } else {
    fm.week = els.week.value.trim();
    fm.mood = els.mood.value.trim();
  }
  // 所属子版块，两种栏目都支持。空数组不写进 frontmatter，
  // 免得每篇都挂一个没用的 subs: []
  if (state.subs.length) fm.subs = state.subs.slice();
  return fm;
}

function renderFilename() {
  const file = state.current ? state.current.file : '';
  if (file) {
    els.filename.textContent = file;
    els.filename.classList.remove('is-new');
  } else {
    els.filename.textContent = '新文件（保存时按标题自动命名）';
    els.filename.classList.add('is-new');
  }
}

function updateBodyCount() {
  const text = els.body.value;
  const chars = text.replace(/\s/g, '').length;
  const lines = text ? text.split('\n').length : 0;
  els.bodyCount.textContent = `${chars} 字 · ${lines} 行`;
}

function updateDocTitle() {
  const name = els.title.value.trim() || (state.current && state.current.file) || '未命名';
  document.title = `${state.dirty ? '● ' : ''}${name} · ${state.site.title} 编辑器`;
}

function setDirty(value) {
  const changed = state.dirty !== Boolean(value);
  state.dirty = Boolean(value);
  if (state.dirty) statusPill('未保存的修改', 'warn');
  else statusPill('');
  if (changed) updateDocTitle();
}

function onFormChanged() {
  setDirty(true);
  scheduleDraftSave();
  updateDocTitle();
  // 切换类型时字段含义不同，这里只关心当前类型的字段
  renderFilename();
}

function onBodyChanged() {
  setDirty(true);
  updateBodyCount();
  schedulePreview();
  scheduleDraftSave();
}

/* ---------------------------------------------------------------
   标签 chips
   --------------------------------------------------------------- */

function renderChips() {
  for (const node of Array.from(els.tagsBox.querySelectorAll('.chip'))) node.remove();
  for (const tag of state.tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = tag;
    chip.appendChild(label);

    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip__x';
    x.textContent = '✕';
    x.title = `删除标签「${tag}」`;
    x.addEventListener('click', () => removeTag(tag));
    chip.appendChild(x);

    els.tagsBox.insertBefore(chip, els.tagsInput);
  }
}

function addTag(raw) {
  const tag = String(raw ?? '').replace(/[,，]/g, '').trim();
  if (!tag) return;
  if (!state.tags.includes(tag)) {
    state.tags.push(tag);
    renderChips();
    setDirty(true);
    scheduleDraftSave();
  }
}

function removeTag(tag) {
  state.tags = state.tags.filter((t) => t !== tag);
  renderChips();
  setDirty(true);
  scheduleDraftSave();
}

function commitTagInput() {
  const value = els.tagsInput.value;
  if (!value.trim()) return;
  value
    .split(/[,，]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .forEach(addTag);
  els.tagsInput.value = '';
}

/* ---------------------------------------------------------------
   封面
   --------------------------------------------------------------- */

function updateCoverPreview() {
  const value = els.cover.value.trim();
  if (value) {
    els.coverImg.src = value;
    els.coverImg.hidden = false;
    els.coverEmpty.hidden = true;
  } else {
    els.coverImg.removeAttribute('src');
    els.coverImg.hidden = true;
    els.coverEmpty.hidden = false;
  }
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/* ---------------------------------------------------------------
   上传图片

   **不在浏览器里预压缩了。**
   以前这里是先用 canvas 缩放 + 转 JPEG(q0.82) 再上传，服务端又原样存下；
   现在服务端有一条真正的图像管线（tools/images/optimize.mjs，用 sharp），
   所以浏览器这一道不但多余，还有害：canvas 的编码器比 mozjpeg 差一截，
   两遍 JPEG 等于「画质掉两回、体积还更大」。
   现在原图直接传（localhost 上多传几 MB 无所谓），压缩统一在服务端做：
   mozjpeg q82 + 限宽 1920 + 按 EXIF 摆正 + 去元数据，顺手生成
   WebP/AVIF 多尺寸和模糊占位。接口会把压前/压后的字节数回给前端，
   下面提示里报的就是真实数字，不是估算。
   --------------------------------------------------------------- */

async function uploadImage(file) {
  if (!file) throw new Error('没有选择文件');
  if (file.size > 20 * 1024 * 1024) throw new Error('图片超过 20MB，先裁一下再传');

  const dataUrl = await readFileAsDataURL(file);
  const res = await apiPost('/api/upload', { name: file.name, dataUrl });

  const before = Number(res.before ?? file.size);
  const after = Number(res.after ?? res.size ?? 0);
  if (after > 0 && before > after) {
    const fmt = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);
    toast(`图片已压缩后上传：${fmt(before)} → ${fmt(after)}${res.note ? `（${res.note}）` : ''}`);
  } else if (res.note) {
    toast(`图片已上传（${res.note}）`);
  }
  return res.path;
}

/* ---------------------------------------------------------------
   Markdown 工具栏
   --------------------------------------------------------------- */

function afterBodyEdit() {
  onBodyChanged();
}

/** 用 before/after 包裹选区；空选区插入占位文字并选中，方便直接打字覆盖 */
function surroundSelection(before, after, placeholder) {
  const ta = els.body;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = value.slice(start, end);
  const inner = selected || placeholder || '';
  const text = before + inner + after;
  ta.value = value.slice(0, start) + text + value.slice(end);
  ta.focus();
  ta.setSelectionRange(start + before.length, start + before.length + inner.length);
  afterBodyEdit();
}

/** 对选中的每一行（或当前行）加前缀 */
function prefixLines(makePrefix) {
  const ta = els.body;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  let lineEnd = value.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = value.length;

  const block = value.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const result = lines.map((line, i) => makePrefix(i, line) + line).join('\n');
  ta.value = value.slice(0, lineStart) + result + value.slice(lineEnd);
  ta.focus();
  ta.setSelectionRange(lineStart, lineStart + result.length);
  afterBodyEdit();
}

function insertText(text, { caretOffset = null, selectFrom = null, selectTo = null } = {}) {
  const ta = els.body;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = value.slice(0, start) + text + value.slice(end);
  ta.focus();
  if (selectFrom !== null && selectTo !== null) {
    ta.setSelectionRange(start + selectFrom, start + selectTo);
  } else {
    const caret = start + (caretOffset === null ? text.length : caretOffset);
    ta.setSelectionRange(caret, caret);
  }
  afterBodyEdit();
}

function blockInsert(text) {
  const ta = els.body;
  const value = ta.value;
  const start = ta.selectionStart;
  const needsBefore = start > 0 && value[start - 1] !== '\n';
  const tail = value.slice(ta.selectionEnd);
  const needsAfter = tail.length > 0 && !tail.startsWith('\n');
  const payload = `${needsBefore ? '\n' : ''}${text}${needsAfter ? '\n' : ''}`;
  insertText(payload);
}

function runToolbar(cmd) {
  switch (cmd) {
    case 'bold':
      surroundSelection('**', '**', '粗体文字');
      break;
    case 'italic':
      surroundSelection('*', '*', '斜体文字');
      break;
    case 'code':
      surroundSelection('`', '`', 'code');
      break;
    case 'heading':
      // 已经是标题就降级成正文（去掉 # 前缀）
      prefixLines((i, line) => (/^#{1,6}\s/.test(line) ? '' : '## '));
      break;
    case 'quote':
      prefixLines(() => '> ');
      break;
    case 'ul':
      prefixLines(() => '- ');
      break;
    case 'ol':
      prefixLines((i) => `${i + 1}. `);
      break;
    case 'codeblock':
      surroundSelection('```\n', '\n```', '代码');
      break;
    case 'link': {
      const ta = els.body;
      const selected = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      const label = selected || '链接文字';
      const text = `[${label}](url)`;
      const urlStart = 1 + label.length + 2;
      insertText(text, { selectFrom: urlStart, selectTo: urlStart + 3 });
      break;
    }
    case 'image':
      pickLocalImage();
      break;
    case 'image-url':
      openImageModal();
      break;
    case 'hr':
      blockInsert('---');
      break;
    default:
      break;
  }
}

/* ---------------------------------------------------------------
   插入图片弹窗
   --------------------------------------------------------------- */

/* ---------------------------------------------------------------
   插入图片

   工具栏上那个 🖼 走的是一步到位的路径：开系统文件选择器 → 上传 →
   直接把 Markdown 插到光标处。以前要先弹出弹窗、再点「选择图片…」、
   传完还得点一下「插入」，三步才完事。网址方式留在「网址」按钮里。
   --------------------------------------------------------------- */

function pickLocalImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    await insertImageFile(file);
  });
  input.click();
}

/** 上传一张图并把它插到光标处。拖拽和粘贴也走这里。 */
async function insertImageFile(file, fallbackName) {
  toast('正在上传图片……');
  try {
    const p = await uploadImage(file);
    const name = file.name || fallbackName || '图片';
    const alt = name.replace(/\.[^.]+$/, '');
    blockInsert(`![${alt}](${p})`);
    toast('已插入图片');
    return true;
  } catch (err) {
    toast(`上传失败：${err.message}`, true);
    return false;
  }
}

/**
 * 从系统剪贴板粘贴的图片没有像样的文件名（都叫 image.png），
 * 按时间戳重新起一个，免得上传目录里一堆同名文件。
 * 有真名的（比如从资源管理器复制过来的文件）就别动它的名字。
 */
function renamePasted(file) {
  if (file && file.name && !/^(image|blob|clipboard)(\.\w+)?$/i.test(file.name)) return file;
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`
    + `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
  try {
    return new File([file], `粘贴-${stamp}.${ext}`, { type: file.type });
  } catch {
    return file;   // 极老的浏览器没有 File 构造函数
  }
}

/* ---------------------------------------------------------------
   图片接入口：拖进来 / 粘进来（公共层）

   编辑器里好几个地方要收图片：文章 / 手记的封面图、插入图片弹窗、
   地图换图、页面内容里的图片块、版块 / 导航的标题图（图标）。
   以前每处各造一个隐藏的 <input type=file>，只有「点按钮 → 系统文件
   选择器」这一条路；从 QQ 拖一张进来、或者截图后 Ctrl+V，没人接。

   现在这些地方都注册成「接入口」：
   · <input type=file> 仍然是兜底 —— 它的 change 也由这一层接管，
     点按钮那条路一个字节都没变，只是这份代码只写一遍；
   · 拖进来 / 粘进来 / 选文件，最后都汇到同一个 onFiles，
     里面调的还是同一个 uploadImage()，上传路径只有一条；
   · 粘贴「给谁」由 resolveImageIntake() 按优先级挑（见那边的注释）。

   以后再加一个上传点，就是 attachImageIntake({...}) 一行的事。
   正文编辑器（bindImageDropAndPaste）有自己的老一套，没走这里，也没动它。
   --------------------------------------------------------------- */

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';

/** 注册过的上传点；被重画掉的（isConnected 为假）会在下一次查表前剔除 */
const IMAGE_INTAKES = [];

/** 最近一次点过 / 聚焦过的接入口 —— 粘贴优先级 ② 靠它 */
let lastIntake = null;

/** 看得见才算数：弹窗 [hidden] 挡住、面板重画带走的那种都得排除 */
function intakeVisible(el) {
  return Boolean(el && el.isConnected && el.getClientRects().length);
}

/**
 * 这个接入口挂在哪个面板里（哪层弹窗；不在弹窗里就是主表单）。
 * 现算不缓存 —— 页面工作台和独立页面工作台会整块搬运同一批 DOM，
 * 缓存下来的话搬完就认错门了。
 */
function intakePanelOf(el) {
  return el.closest('.modal') || els.form || document.body;
}

function pruneIntakes() {
  for (let i = IMAGE_INTAKES.length - 1; i >= 0; i -= 1) {
    if (!IMAGE_INTAKES[i].el.isConnected) IMAGE_INTAKES.splice(i, 1);
  }
}

function imageFilesOf(list) {
  return Array.from(list || []).filter((f) => f && /^image\//i.test(f.type || ''));
}

/** 从 DataTransfer / ClipboardData 里取图片：QQ 截图的图只在 items 里，files 常常是空的 */
function imageFilesFromTransfer(dt) {
  if (!dt) return [];
  const direct = imageFilesOf(dt.files);
  if (direct.length) return direct;
  return Array.from(dt.items || [])
    .filter((it) => it.kind === 'file' && /^image\//i.test(it.type || ''))
    .map((it) => it.getAsFile())
    .filter(Boolean);
}

/**
 * 兜底：从网页 / QQ 窗口里拖过来的常常是**链接**而不是文件。
 * 没有文件时从 text/uri-list、text/html 里抠一个像图片的地址出来；
 * 抠不到就是空字符串，调用方当没这回事，不硬来。
 */
function imageLinkFromTransfer(dt) {
  if (!dt) return '';
  let uri = '';
  try {
    uri = String(dt.getData('text/uri-list') || '').split(/\r?\n/).find((l) => l && !l.startsWith('#')) || '';
  } catch {
    uri = '';   // dragover 阶段读 getData 会抛，按没有处理
  }
  if (/^data:image\//i.test(uri)) return uri;
  if (/^https?:\/\//i.test(uri) && /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(uri)) return uri;
  let html = '';
  try {
    html = String(dt.getData('text/html') || '');
  } catch {
    html = '';
  }
  // html 里的 <img src> 明摆着是图，就不看扩展名了
  const m = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
  return m ? m[1].trim() : '';
}

/** 这次拖拽值不值得接：有图才接，拖个 pdf 进来就交回浏览器默认行为 */
function dragAcceptsImage(dt) {
  if (!dt) return false;
  const items = Array.from(dt.items || []);
  const files = items.filter((it) => it.kind === 'file');
  if (files.length) {
    const known = files.filter((it) => it.type);
    if (!known.length) return true;                       // 类型没给，先当能放
    return known.some((it) => /^image\//i.test(it.type));
  }
  if (Array.from(dt.types || []).includes('Files')) return true;
  // 从网页 / QQ 窗口拖链接：dragover 阶段读不到内容，只能看类型
  return Array.from(dt.types || []).some((t) => t === 'text/uri-list' || t === 'text/html');
}

function clearIntakeHighlight() {
  for (const el of document.querySelectorAll('.intake--dragover')) el.classList.remove('intake--dragover');
}

/** 往 textarea 的光标处插一段文字（页面里的文字块插图片用），插完让外层状态跟上 */
function insertIntoTextarea(ta, text) {
  const start = typeof ta.selectionStart === 'number' ? ta.selectionStart : ta.value.length;
  const end = typeof ta.selectionEnd === 'number' ? ta.selectionEnd : start;
  ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
  const caret = start + text.length;
  ta.focus();
  ta.setSelectionRange(caret, caret);
  ta.dispatchEvent(new Event('input', { bubbles: true }));   // 让外面那份 block.text 自己更新
}

/**
 * 收下若干文件：单值的地方只用第一张（其余明说被忽略），多值的地方全收。
 * 「忽略了几张」这条压在最后 —— 上传结果那条 toast 已经报过路径了，
 * 这里再补一句，用户不会漏掉任何一头。
 */
async function runIntake(entry, files) {
  const use = entry.multiple ? files : files.slice(0, 1);
  try {
    await entry.onFiles(use);
  } catch (err) {
    toast(`上传失败：${err.message}`, true);
  } finally {
    if (!entry.multiple && files.length > 1) {
      toast(`${entry.label}只收一张图，用了第一张，另外 ${files.length - 1} 张忽略了`);
    }
  }
}

/**
 * 把一个上传点接上「拖进来 / 粘进来 / 选文件」三条路。
 *
 * @param {HTMLElement} o.el       接入口范围 —— 拖拽高亮和落点判断都按它算
 * @param {HTMLInputElement} [o.input]  兜底的 <input type=file>，change 交给这里管
 * @param {string} [o.accept]      收哪些类型，默认图片
 * @param {boolean} [o.multiple]   true = 一次能收多张；默认只收第一张
 * @param {(files: File[]) => any} o.onFiles  拿到文件干什么（里面调 uploadImage）
 * @param {(url: string) => void} [o.onUrl]   拖进来的是图片链接时当地址填进去
 * @param {string} [o.hint]        按钮旁边那行小字（不想加字的地方别传）
 * @param {string} [o.title]       鼠标停在这块上时的提示（el 自己没 title 才写）
 * @param {string} [o.label]       「只收一张」提示里怎么称呼这块，比如「封面图」
 * @param {boolean} [o.countsForPaste]  false = 不参与「面板里只有一个上传点」那条兜底
 */
function attachImageIntake(o) {
  const el = o && o.el;
  if (!el) return null;
  pruneIntakes();

  const entry = {
    el,
    input: o.input || el.querySelector('input[type="file"]'),
    multiple: Boolean(o.multiple),
    countsForPaste: o.countsForPaste !== false,
    label: o.label || '这里',
    onFiles: o.onFiles,
    onUrl: o.onUrl,
  };

  el.dataset.imgIntake = '';
  el.classList.add('intake');
  if (o.title && !el.title) el.title = o.title;

  if (o.hint) {
    const hint = document.createElement('span');
    hint.className = 'intake__hint';
    hint.textContent = o.hint;
    if (entry.input && entry.input.parentNode === el) el.insertBefore(hint, entry.input);
    else el.appendChild(hint);
  }

  // ---- 选文件（原来每家自己写的那份 change，收进来只留一份）----
  if (entry.input) {
    entry.input.accept = o.accept || IMAGE_ACCEPT;
    entry.input.addEventListener('change', () => {
      const files = imageFilesOf(entry.input.files);
      entry.input.value = '';        // 清掉，同一个文件再选一次也认
      if (!files.length) return;
      lastIntake = entry;
      void runIntake(entry, files);
    });
  }

  // ---- 拖进来 ----
  el.addEventListener('dragenter', (ev) => {
    if (!dragAcceptsImage(ev.dataTransfer)) return;
    el.classList.add('intake--dragover');
  });
  el.addEventListener('dragover', (ev) => {
    if (!dragAcceptsImage(ev.dataTransfer)) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'copy';
    el.classList.add('intake--dragover');
  });
  el.addEventListener('dragleave', (ev) => {
    // 在自家子元素之间挪也会触发 dragleave，用 relatedTarget 挡一下，省得闪
    if (ev.relatedTarget && el.contains(ev.relatedTarget)) return;
    el.classList.remove('intake--dragover');
  });
  el.addEventListener('drop', async (ev) => {
    const dt = ev.dataTransfer;
    if (!dt) return;
    const files = imageFilesFromTransfer(dt);
    const link = files.length ? '' : imageLinkFromTransfer(dt);
    if (!files.length && !link) return;
    ev.preventDefault();
    ev.stopPropagation();          // 外层可能也有监听（比如正文那套），别收两遍
    el.classList.remove('intake--dragover');
    lastIntake = entry;
    if (!files.length) {
      if (entry.onUrl) entry.onUrl(link);
      else toast('拖进来的是个链接，这里只认图片文件', true);
      return;
    }
    await runIntake(entry, files);
  });

  IMAGE_INTAKES.push(entry);
  return entry;
}

/** 焦点 / 事件正好落在某个接入口里？ */
function intakeFromNode(node) {
  if (!(node instanceof Element)) return null;
  const hit = node.closest('[data-img-intake]');
  if (!hit || !intakeVisible(hit)) return null;
  return IMAGE_INTAKES.find((e) => e.el === hit) || null;
}

/** 正文编辑器（连外壳）自己有拖 / 粘那一套，别抢它的活 */
function isBodyEditorNode(node) {
  if (!(node instanceof Element)) return false;
  return node === els.body || Boolean(node.closest('.editor'));
}

/** 当前开着的面板：焦点所在的那层弹窗；都没有就退回主表单 */
function currentIntakePanel() {
  const focusModal = document.activeElement instanceof Element
    ? document.activeElement.closest('.modal')
    : null;
  if (focusModal && intakeVisible(focusModal)) return focusModal;
  const open = Array.from(document.querySelectorAll('.modal')).filter(intakeVisible);
  if (open.length) return open[open.length - 1];
  return els.form || document.body;
}

/**
 * 粘贴的图给谁 —— 按优先级挑：
 * ① 事件 / 焦点正好落在某个接入口里
 *    （光标停在「封面图地址」那个输入框里、或者刚点过某一格的按钮）；
 * ② 最近点过 / 聚焦过的那个接入口，面板还开着、还看得见；
 * ③ 当前面板里只有一个可见接入口（打开「独立页面」面板直接粘封面走这条）。
 * 挑不出来返回 null，调用方负责给一句人话提示，不静默吞掉。
 */
function resolveImageIntake(node) {
  pruneIntakes();
  const direct = intakeFromNode(node) || intakeFromNode(document.activeElement);
  if (direct) return direct;

  if (lastIntake && intakeVisible(lastIntake.el)) return lastIntake;

  // ③ 只在「有面板开着」时兜底：主界面里正文编辑器才是粘图的正主，别抢
  const form = els.form || document.body;
  const panel = currentIntakePanel();
  if (panel !== form) {
    const only = IMAGE_INTAKES.filter(
      (e) => intakePanelOf(e.el) === panel && intakeVisible(e.el) && e.countsForPaste,
    );
    if (only.length === 1) return only[0];
  }
  return null;
}

/** 记下最近一次点过 / 聚焦过的接入口（优先级 ②） */
function bindImageIntakeTracking() {
  const track = (ev) => {
    const entry = intakeFromNode(ev.target);
    if (entry) lastIntake = entry;
  };
  document.addEventListener('pointerdown', track, true);
  document.addEventListener('focusin', track, true);
  // 拖到窗口外松手时不会有人给自己擦高亮，这里统一收个尾
  document.addEventListener('dragleave', (ev) => {
    if (!ev.relatedTarget) clearIntakeHighlight();
  });
  document.addEventListener('drop', clearIntakeHighlight, true);
}

/**
 * 全局粘贴：只在剪贴板里**真有图片**时才动手。
 * 纯文字 / HTML 的粘贴一个字节都不碰（输入框里粘文字必须照旧）。
 */
function bindImagePasteToIntakes() {
  document.addEventListener('paste', async (ev) => {
    const files = imageFilesFromTransfer(ev.clipboardData);
    if (!files.length) return;

    const direct = intakeFromNode(ev.target) || intakeFromNode(document.activeElement);
    // 焦点在正文编辑器里又没有明确的上传点 → 交回给老的那套（插到光标处）
    if (!direct && (isBodyEditorNode(ev.target) || isBodyEditorNode(document.activeElement))) return;

    const entry = direct || resolveImageIntake(null);
    if (!entry) {
      ev.preventDefault();
      toast('不知道该把这张图放哪儿：先点一下「上传 / 选图片」那个按钮，再按 Ctrl+V');
      return;
    }
    ev.preventDefault();
    lastIntake = entry;
    await runIntake(entry, files.map((f) => renamePasted(f)));
  });
}

function bindImageDropAndPaste() {
  const ta = els.body;

  ta.addEventListener('dragover', (ev) => {
    if (ev.dataTransfer && Array.from(ev.dataTransfer.types).includes('Files')) {
      ev.preventDefault();
      ta.classList.add('editor__area--dragover');
    }
  });
  ta.addEventListener('dragleave', () => ta.classList.remove('editor__area--dragover'));
  ta.addEventListener('drop', async (ev) => {
    const files = Array.from((ev.dataTransfer && ev.dataTransfer.files) || []);
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;          // 普通文件拖进来交给浏览器默认行为
    ev.preventDefault();
    ta.classList.remove('editor__area--dragover');
    for (const f of images) {
      if (!(await insertImageFile(f))) break;
    }
  });

  ta.addEventListener('paste', async (ev) => {
    const items = Array.from((ev.clipboardData && ev.clipboardData.items) || []);
    const hit = items.find((i) => i.kind === 'file' && i.type.startsWith('image/'));
    if (!hit) return;                    // 粘的是文字，走正常粘贴
    ev.preventDefault();
    const blob = hit.getAsFile();
    if (blob) await insertImageFile(renamePasted(blob), '粘贴的图片');
  });
}

function openImageModal() {
  els.modalUrl.value = '';
  els.modalAlt.value = '';
  els.modalUploadHint.textContent = '支持 png / jpeg / gif / webp / svg，单张不超过 10MB。';
  els.imgModal.hidden = false;
  els.modalUrl.focus();
}

function closeImageModal() {
  els.imgModal.hidden = true;
}

function doInsertImage() {
  const url = els.modalUrl.value.trim();
  if (!url) {
    toast('请先填写图片地址，或上传一张图片', true);
    els.modalUrl.focus();
    return;
  }
  const alt = els.modalAlt.value.trim();
  closeImageModal();
  blockInsert(`![${alt}](${url})`);
  toast('已插入图片');
}

/* ---------------------------------------------------------------
   首页大板块的子版块编辑

   数据在 src/data/home-boards.json，服务端接口是 /api/boards。
   改的是 JSON 而不是 site.config.ts —— 后者是 TypeScript 源码，
   让编辑器去改它很容易把文件写坏。
   --------------------------------------------------------------- */

let boardsDraft = null;

async function openBoardsModal() {
  markWorkspaceActive('boards');
  els.boardsModal.hidden = false;
  /*
    已经有草稿就直接画，**不再从盘上读一遍**。
    重读会把「页面 / 独立页面工作台里改了还没保存」的东西一并冲掉 ——
    两处共用 boardsDraft，从盘上重读等于把草稿扔了。
  */
  if (boardsDraft) {
    renderBoardsEditor();
    return;
  }
  els.boardsEditor.textContent = '正在读取…';
  try {
    const res = await fetch('/api/boards');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    boardsDraft = await res.json();
    renderBoardsEditor();
  } catch (err) {
    els.boardsEditor.textContent = `读取失败：${err.message}`;
  }
}

/**
 * 给草稿里每个节点临时发一个 key，用来在下拉里互相指认。
 *
 * 为什么不用 id：刚「＋下级」出来的节点还没有 id（id 要保存时才由服务端生成），
 * 拿 id 当下拉的值会有一半指不到。__k 这种字段保存时会被服务端丢掉
 * （writeBoards 只挑 id/title/href/image/children），不会写进 JSON。
 */
function indexBoardNodes() {
  const byKey = new Map();
  const home = new Map();
  let seq = 0;

  const walk = (list, parentKey, depth) => {
    list.forEach((node, index) => {
      if (!Array.isArray(node.children)) node.children = [];
      node.__k = `k${(seq += 1)}`;
      byKey.set(node.__k, node);
      home.set(node.__k, { list, index, parentKey, depth });
      walk(node.children, node.__k, depth + 1);
    });
  };

  for (const board of boardsDraft.boards) {
    if (!Array.isArray(board.children)) board.children = [];
    board.__k = `b${(seq += 1)}`;
    byKey.set(board.__k, board);
    home.set(board.__k, { list: boardsDraft.boards, index: 0, parentKey: null, depth: -1 });
    walk(board.children, board.__k, 0);
  }

  return { byKey, home };
}

/** target 是不是 node 自己或自己的后代 —— 版块不能塞进自己肚子里 */
function isSelfOrDescendant(node, target) {
  if (node === target) return true;
  return (node.children ?? []).some((kid) => isSelfOrDescendant(kid, target));
}

/** 一个受控输入框 */
function boardInput(value, placeholder, onInput) {
  const el = document.createElement('input');
  el.type = 'text';
  el.className = 'input';
  el.placeholder = placeholder;
  el.value = value ?? '';
  el.addEventListener('input', () => onInput(el.value));
  return el;
}

/* ---------------------------------------------------------------
   工作面总入口（左上角那个「工作台」按钮）

   编辑器里能整块干活的地方就这么多：文章/手记、页面、独立页面、子版块、
   导航、时间轴、音乐、排版。以前想换一个得先把手上这个关掉，页面一多就来回折腾。
   现在统一从这儿跳：openWorkspace() 先关掉别的面板，再打开目标那个。

   关掉 ≠ 丢改动：每个面板的数据都在各自的内存草稿里（boardsDraft /
   timelinesDraft / navsDraft / musicDraft / pageDraft），关面板只是 hidden，
   再打开时读到的是草稿而不是盘上的旧值 —— 这就是「切走再切回来改动还在」。
   --------------------------------------------------------------- */

const WORKSPACES = [
  { id: 'docs', label: '文章 / 手记', hint: '回到主界面，继续写文章和手记' },
  { id: 'pages', label: '页面', hint: '整页编辑：板块树里的每一页' },
  { id: 'solo', label: '独立页面', hint: '不挂在任何板块下的页面，可搜索的清单' },
  { id: 'boards', label: '子版块', hint: '首页大板块下面的整棵版块树' },
  { id: 'navs', label: '导航', hint: '可复用的导航分类库' },
  { id: 'timelines', label: '时间轴', hint: '新建 / 编辑时间轴' },
  { id: 'music', label: '音乐', hint: '给每个页面配一份歌单' },
  { id: 'layout', label: '排版', hint: '拖动 / 缩放页面上的元素' },
  /*
    首页那几块（src/data/home-widgets.json）+ 冰室精华（src/data/salon.json）。
    放在最后：这几个是后来加的，前八个的顺序和用户已经点熟的位置一个字没动。
  */
  { id: 'calendar', label: '日历', hint: '首页日历：特殊日子、以及今天那句话' },
  { id: 'about', label: '关于我', hint: '页头小圆片的头像 + /about-me/ 的正文' },
  { id: 'iceberg', label: '冰室冰山', hint: '首页「冰室冰山」那块：图、一句话、链接' },
  { id: 'ice-chart', label: '冰山图', hint: '冰山图（/iceberg/）：分类 / 标签 / 层级 / 条目' },
  { id: 'essences', label: '精华', hint: '冰室精华（/salon/）：可搜索 / 新增 / 改删' },
  { id: 'members', label: '成员', hint: '精华的成员表：改名 / 换头像，他所有精华跟着变' },
];

/** 现在开着的是哪个工作面；没有面板开着就是主界面 'docs' */
let activeWorkspace = 'docs';

/** 顶上那条「切换」小按钮亮到当前这个工作面 */
function markWorkspaceActive(id) {
  activeWorkspace = id;
  paintWorkspaceSwitch();
}

/** 关掉一个工作面。没开着也照常叫 —— 每个 close 都是幂等的。 */
function closeWorkspace(id) {
  if (id === 'pages') closePagesView();
  else if (id === 'solo') closeSoloView();
  else if (id === 'boards') closeBoardsModal();
  else if (id === 'navs') closeNavsModal();
  else if (id === 'timelines') closeTimelinesModal();
  else if (id === 'music') closeMusicModal();
  else if (id === 'layout') closeLayoutModal();
  else if (id === 'calendar') closeCalendarModal();
  else if (id === 'about') closeAboutModal();
  else if (id === 'iceberg') closeIcebergModal();
  else if (id === 'ice-chart') closeIceChartModal();
  else if (id === 'essences') closeEssencesModal();
  else if (id === 'members') closeMembersModal();
}

/** 关掉除 except 以外的所有面板 */
function closeOtherWorkspaces(except = '') {
  for (const ws of WORKSPACES) if (ws.id !== except) closeWorkspace(ws.id);
}

/**
 * 打开一个工作面。
 * 顶栏按钮、总入口菜单、面板里那条「切换」都走这儿，所以不管从哪儿点，
 * 行为和「先关掉别的」都一致。
 */
async function openWorkspace(id) {
  closeHubMenu();
  if (id === 'docs') {
    closeOtherWorkspaces('');
    markWorkspaceActive('docs');
    return;
  }
  closeOtherWorkspaces(id);
  if (id === 'pages') await openPagesView();
  else if (id === 'solo') await openSoloView();
  else if (id === 'boards') await openBoardsModal();
  else if (id === 'navs') await openNavsModal();
  else if (id === 'timelines') await openTimelinesModal();
  else if (id === 'music') await openMusicModal();
  else if (id === 'layout') await openLayoutModal();
  else if (id === 'calendar') await openCalendarModal();
  else if (id === 'about') await openAboutModal();
  else if (id === 'iceberg') await openIcebergModal();
  else if (id === 'ice-chart') await openIceChartModal();
  else if (id === 'essences') await openEssencesModal();
  else if (id === 'members') await openMembersModal();
}

/** 面板里那条切换条：每个面板顶上都有一个空的 [data-ws-slot]，往里面填按钮 */
function paintWorkspaceSwitch() {
  for (const slot of document.querySelectorAll('[data-ws-slot]')) {
    slot.textContent = '';
    for (const ws of WORKSPACES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'wsswitch__btn';
      b.dataset.ws = ws.id;
      b.textContent = ws.label;
      b.title = ws.hint;
      if (ws.id === activeWorkspace) b.classList.add('is-active');
      b.addEventListener('click', () => openWorkspace(ws.id));
      slot.appendChild(b);
    }
    const shut = document.createElement('button');
    shut.type = 'button';
    shut.className = 'wsswitch__btn wsswitch__btn--close';
    shut.textContent = '关闭面板';
    shut.title = '关掉这个面板（没保存的改动留着，再打开还在）';
    shut.addEventListener('click', () => openWorkspace('docs'));
    slot.appendChild(shut);
  }
}

function buildHubMenu() {
  const box = els.hubMenuList;
  if (!box) return;
  box.textContent = '';
  for (const ws of WORKSPACES) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'hubmenu__btn';
    b.dataset.ws = ws.id;
    if (ws.id === activeWorkspace) b.classList.add('is-active');

    const label = document.createElement('span');
    label.className = 'hubmenu__label';
    label.textContent = ws.label;
    const hint = document.createElement('em');
    hint.className = 'hubmenu__hint';
    hint.textContent = ws.hint;
    b.append(label, hint);
    b.addEventListener('click', () => openWorkspace(ws.id));
    li.appendChild(b);
    box.appendChild(li);
  }
}

function openHubMenu() {
  if (!els.hubMenu) return;
  buildHubMenu();
  els.hubMenu.hidden = false;
  els.btnHub.setAttribute('aria-expanded', 'true');
  els.btnHub.classList.add('is-on');
  // 菜单挂在 body 上（要盖过弹窗），位置得自己按按钮算
  const r = els.btnHub.getBoundingClientRect();
  els.hubMenu.style.left = `${Math.max(8, Math.round(r.left))}px`;
  els.hubMenu.style.top = `${Math.round(r.bottom + 6)}px`;
}

function closeHubMenu() {
  if (!els.hubMenu || els.hubMenu.hidden) return;
  els.hubMenu.hidden = true;
  els.btnHub.setAttribute('aria-expanded', 'false');
  els.btnHub.classList.remove('is-on');
}

function toggleHubMenu() {
  if (!els.hubMenu) return;
  if (els.hubMenu.hidden) openHubMenu();
  else closeHubMenu();
}

/* ---------------------------------------------------------------
   页面工作台（整页编辑）

   这是编辑器里「改页面」的唯一入口，长得跟写文章那边一样：
   左栏挑页面、中栏改这一页的全部东西、右栏是这一页现在的样子。

   中栏管三件事：
     1. 这一页自己的字段：名称、副标题、地址、版式、封面图
     2. 这一页的内容块（就是上面那套「页面内容」编辑器）
     3. 这一页的子版块：改名、传封面、单张卡的比例/大小、上下换顺序

   保存 = 写进 home-boards.json + 自动重新构建，右栏立刻能看到结果。
   数据仍然是同一棵 boardsDraft，和「子版块」弹窗共用，不会各存一份。
   --------------------------------------------------------------- */

const BLOCK_LABEL = {
  text: '文字',
  image: '图片',
  link: '链接',
  divider: '分隔线',
  columns: '两栏',
  video: '视频',
  posts: '文章',
  toc: '目录',
  map: '地图',
  children: '子页面',
  nav: '导航',
};
const TEXT_HINT =
  '支持 Markdown：**粗体**、[链接](地址)、- 列表、![图](/img/uploads/x.png)、## 小标题、[[文字|图片地址]]（悬停出图）、[[文字|图片地址|链接地址]]（悬停出图 + 点击跳转）';
/* 「窄」的说明：连着几张窄图会横着排开、排满一行再换行（见 PageContent.astro 的 .pblock--flow） */
const IMG_WIDTHS = [['full', '全宽'], ['wide', '宽'], ['half', '半宽'], ['third', '窄（连着放会并排）']];
const CARD_SHAPES = [['wide', '横（16:3）'], ['square', '方（1:1）'], ['tall', '竖（3:4）']];
const CARD_SIZES = [['l', '大'], ['m', '中'], ['s', '小']];
/** 「子页面」块里单张卡的下拉多一项「默认」，表示不覆盖整块的设置 */
const CARD_SHAPES_OR = [['', '默认比例'], ...CARD_SHAPES];
const CARD_SIZES_OR = [['', '默认大小'], ...CARD_SIZES];
/** 版式：不写 = 竖排（子页面一条条占满整行） */
const LAYOUTS = [['', '竖排（子页面一条条整行）'], ['region', '三列分区（左大块 + 中右两栏）']];
const LAYOUT_HINT = '三列分区要有 4 个以上子版块才生效；这一页写了「页面内容」时以内容为准，版式不参与';

/** 当前正在编辑哪个节点、它下面那份块的草稿 */
let pageNode = null;
let pageDraft = [];

/*
  「新块插到哪儿」和「拖着换位置」两份临时状态（换页 / 换面板都得清掉）。

  pageInsertAfterId：点了哪张卡片头上的「＋」—— 新块插在它后面。
    **null 就是老规矩：插到最后**。故意不拿"刚才在哪儿点过一下"当落点：
    落点要么是明着指定的，要么就在最后面，老用户点底部那排「＋ 文字」的习惯
    一点都不变，也不会因为光标停在哪一段就偷偷插进正文中间。
  pageActiveBlockId：鼠标 / 光标最近落在哪张卡片上（"当前这一段"）。
    只用来高亮和插完滚动，不参与落点计算 —— 见 pageInsertAt()。
*/
let pageInsertAfterId = null;
let pageActiveBlockId = null;
/** 正在被按住拖的那一块；没在拖就是 null */
let pageDragId = null;
/** 拖拽打算落在第几位（「摘掉自己之后」那个数组里的下标） */
let pageDropAt = -1;
/** 拖拽期间的临时节点 / 句柄，松手和重画都要清干净 */
let pageDragBox = null;
let pageDropLine = null;
let pageDragRaf = 0;
let pageDragPointer = null;

/** 工作台里当前选中的节点（和 pageNode 是同一个东西，读起来更像页面） */
let studioNode = null;
/** 左栏搜索词 */
let studioSearch = '';
/** 独立页面工作台的搜索词 */
let soloSearch = '';
/** 上次在独立页面工作台看的是哪一页：来回切面板时别跳回第一条 */
let lastSoloNode = null;

let blockSeq = 0;
const newBlockId = (nodeId) => `${nodeId}-p${Date.now().toString(36)}${(blockSeq += 1)}`;

/** 打开工作台。传节点就定位到那一页，不传就用上次看的 / 第一个大板块。 */
async function openPagesView(node = null) {
  // 中间/右栏那几块控件可能正被「独立页面」工作台借走，先搬回来
  mountStudioHost('pages');
  markWorkspaceActive('pages');
  els.pagesModal.hidden = false;

  if (!boardsDraft) {
    els.pwList.textContent = '正在读取版块树…';
    try {
      const res = await fetch('/api/boards');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      boardsDraft = await res.json();
    } catch (err) {
      els.pwList.textContent = `读取失败：${err.message}`;
      return;
    }
  }

  /*
    时间轴也一起拉一把：「这一页用哪条轴」「每个块对应哪个时间点」
    都要它的列表才画得出来。拉不到不算致命 —— 那几个下拉退化成空的，
    别因为时间轴挂了就整个页面工作台打不开。
  */
  try {
    await loadTimelines();
  } catch {
    /* 忽略：没有时间轴照样能改页面 */
  }

  /*
    分类库也拉一把：「＋ 导航」那个块要列出所有大分类才勾得出来。
    同样拉不到不算致命 —— 块里会提示「先去导航面板建分类」。
  */
  try {
    await loadNavs();
  } catch {
    /* 忽略：没有分类库照样能改页面，只是导航块勾不了 */
  }

  /*
    默认留在普通页面上：独立页面已经有自己的面板了，在这儿选中它，
    左栏那棵树里又找不到它，看着像"什么都没选中"。
  */
  const want = node
    || (studioNode && studioNode.standalone !== true ? studioNode : null)
    || pickDefaultPage();
  // selectStudioPage 还是同一页时只重画、不重读，中间栏那份草稿不会被冲掉
  selectStudioPage(want);
}

/** 关掉工作台（块草稿不丢：没保存的改动本来就只在内存里） */
function closePagesView() {
  els.pagesModal.hidden = true;
  els.pwFrame.srcdoc = '';
}

/** 把整棵草稿树摊平，带上「在第几个、父级是谁」，方便换顺序 */
function flattenBoardNodes() {
  const out = [];
  const walk = (list, parentId, parentUrl, depth) => {
    list.forEach((node, index) => {
      const link = typeof node.link === 'string' ? node.link.trim() : '';
      const external = !!link;
      const seg = parentId && node.id && node.id.startsWith(`${parentId}-`)
        ? node.id.slice(parentId.length + 1)
        : node.id;
      const url = external ? link : node.href || (depth === 0 ? `/${seg}` : `${parentUrl}/${seg}`);
      out.push({ node, url, depth, list, index, external });
      // 链接版块是叶子：它没有页面，下面的东西也不该再算成页面
      if (external) return;
      walk(node.children ?? [], node.id, url, depth + 1);
    });
  };
  for (const board of boardsDraft?.boards ?? []) walk([board], null, '', 0);
  return out;
}

/** 页面清单：链接版块不是页面，不列在里面 */
function studioPages() {
  return flattenBoardNodes().filter((f) => !f.external);
}

/**
 * 打开工作台时默认选哪一页。
 * 优先普通页面：独立页面不挂在任何板块下，不该抢这个「默认打开」的位置
 * （真要编辑它，去「独立页面」工作台 —— 它有自己的面板）。
 */
function pickDefaultPage() {
  const all = studioPages();
  return (all.find((f) => f.node.standalone !== true) ?? all[0])?.node ?? null;
}

/**
 * 站内链接能不能落到一个真页面上。
 *
 * 只查 `/开头` 的：站外地址这边没联网查不了；带扩展名的（.pdf/.png…）
 * 当静态文件，也交给服务器。返回 'external' | 'ok' | 'missing'。
 */
function siteLinkStatus(link) {
  const s = String(link ?? '').trim();
  if (!s.startsWith('/')) return 'external';
  const clean = s.replace(/[?#].*$/, '');
  if (/\.\w{2,4}$/.test(clean)) return 'external';
  const pages = new Set();
  for (const f of studioPages()) pages.add(f.url.endsWith('/') ? f.url : `${f.url}/`);
  return pages.has(clean) || pages.has(`${clean}/`) ? 'ok' : 'missing';
}

/**
 * 换到某一页：把它的内容读进草稿，然后整屏重画。
 *
 * 两个「不丢草稿」的关键：
 *   · 换页之前先把当前这页没保存的块收进它自己的节点（commitPageBlocks）——
 *     不收的话，切走就再也找不回来了；
 *   · 还是同一页时**不重读** node.page —— 面板切来切去会重复选中同一页，
 *     每次重读都等于把中间栏里没保存的改动按原数据抹掉。
 */
function selectStudioPage(node) {
  if (!node) return;
  if (node === pageNode) {
    renderPageStudio();
    loadStudioFrame();
    return;
  }
  if (pageNode) commitPageBlocks();
  studioNode = node;
  pageNode = node;
  // 深拷一份块：没点保存之前不该动到原数据
  pageDraft = JSON.parse(JSON.stringify(node.page ?? []));
  // 换页了：上一页的插入落点和拖拽状态不该漂到这一页来
  resetPageBlockPlacement();
  renderPageStudio();
  loadStudioFrame();
}

function renderPageStudio() {
  if (!studioNode) return;
  const name = studioNode.title || studioNode.id || '未命名';
  els.pagesTitle.textContent = `页面 · ${name}`;
  if (studioNode.standalone === true) {
    lastSoloNode = studioNode;
    if (els.soloTitle) els.soloTitle.textContent = `独立页面 · ${name}`;
  }
  renderStudioTree();
  renderStudioStandalone();
  renderSoloList();
  renderStudioFields();
  renderPageEditor();
  renderStudioKids();
}

/* ---------- 左栏：页面清单 ---------- */

function renderStudioTree() {
  const box = els.pwList;
  box.textContent = '';

  /*
    独立页面**不在**这棵树里：它们不挂在任何板块下，
    在这棵树里出现只会让人以为「它属于哪个板块」。下面那张卡片是它们的入口。
  */
  const all = studioPages().filter((f) => f.node.standalone !== true);
  const kw = studioSearch.trim().toLowerCase();
  const shown = kw
    ? all.filter((f) => (f.node.title || '').toLowerCase().includes(kw) || f.url.toLowerCase().includes(kw))
    : all;

  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'pw-tree__empty';
    li.textContent = '没有匹配的页面';
    box.appendChild(li);
    return;
  }

  for (const f of shown) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pw-tree__item';
    if (f.node === studioNode) btn.classList.add('is-active');
    btn.style.paddingLeft = `${8 + f.depth * 14}px`;

    const name = document.createElement('span');
    name.className = 'pw-tree__name';
    name.textContent = f.node.title || '(未命名)';

    const meta = document.createElement('em');
    meta.className = 'pw-tree__url';
    meta.textContent = (f.node.page ?? []).length ? `${f.url} · ${f.node.page.length} 块` : f.url;

    btn.append(name, meta);
    btn.addEventListener('click', () => selectStudioPage(f.node));
    li.appendChild(btn);
    box.appendChild(li);
  }
}

/* ---------- 独立页面（专属工作台） ----------

   用户要的是「写文章限制太多，不如直接写页面」，但页面一直以来
   必须挂在某个板块下才建得出来。独立页面就是解这个的：

   · 数据上是 `home-boards.json` 里一个**顶层节点** + `standalone: true`；
   · 页面照常生成，地址还是 `/<id>/`（href 可以覆盖）；
   · 但它**不被任何列表收录** —— 首页那两张卡片、右上角目录树、
     任何页面的子版块列表、sitemap 都没有它；
   · 所以它只能靠别处挂的链接点进来（正文链接 / 地图图钉 / 时间轴跳转地址），
     于是「地址好拿、好复制」就是这一节最要紧的事。

   以前它们挤在「页面」工作台左栏底下那一小块里，页面一多就翻不动。
   现在有自己的面板（#solo-modal）：左边是可搜索的清单，中间改标题 / 地址 /
   正文块，右边是这一页的样子。数据还是 boardsDraft 里那些顶层节点，
   和「页面」工作台**共用同一份**；中间和右栏的控件是整块搬过来的
   （见 mountStudioHost），所以两边的行为永远一样，不会各写一套。
   --------------------------------------------------------------- */

/** 独立页面：顶层、`standalone === true` 的那些节点 */
const standaloneBoards = () => (boardsDraft?.boards ?? []).filter((b) => b && b.standalone === true);

/** 整份数据里用过的所有 id（板块、子版块、独立页面共用同一层命名空间） */
function allBoardIds() {
  const ids = new Set();
  const walk = (list) => {
    for (const n of list ?? []) {
      if (n?.id) ids.add(String(n.id));
      walk(n?.children);
    }
  };
  walk(boardsDraft?.boards);
  return ids;
}

/** 名字 → 能当地址用的 id 片段（只留小写字母、数字、横杠；中文之类留不下就给空串） */
const slugifyId = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

/**
 * 给新建的独立页面起个 id。
 * 名字是英文/数字就拿它当 id（地址 /about/ 又短又好记），中文之类留不下
 * 就退回一个短的随机 id；两条路都保证**全文件唯一**。
 *
 * 注意：id 只在建的这一刻定，之后**改名不改 id** —— 地址一变，
 * 别处已经粘好的链接就全断了（和板块那套「不用标题当 id」一个道理）。
 */
function newStandaloneId(title) {
  const used = allBoardIds();
  const base = slugifyId(title) || `page-${Date.now().toString(36)}`;
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** 某个节点（草稿里）现在的站内地址，带尾斜杠 */
function nodeUrl(node) {
  const f = flattenBoardNodes().find((x) => x.node === node);
  const url = f?.url || `/${node?.id ?? ''}`;
  return url.endsWith('/') ? url : `${url}/`;
}

/**
 * 把一段字复制进剪贴板。
 *
 * `navigator.clipboard` 在 `http://127.0.0.1` 上算安全上下文，一般能用；
 * 用不了（浏览器不给权限、页面没焦点、老浏览器）就**把那段字选中**，
 * 让人自己按 Ctrl+C —— 地址复制不了就等于白显示，总得留条路。
 */
function copyText(text, el) {
  const fallback = () => {
    try {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      toast(`剪贴板用不了（浏览器不让），地址已经选中了，按 Ctrl+C：${text}`, true);
    } catch {
      toast(`复制失败，地址在这儿：${text}`, true);
    }
  };
  let p = null;
  try {
    if (navigator.clipboard?.writeText) p = navigator.clipboard.writeText(text);
  } catch {
    p = null;
  }
  if (p && typeof p.then === 'function') {
    p.then(() => toast(`地址已复制：${text}`), fallback);
    return;
  }
  fallback();
}

/**
 * 独立页面清单里的一行：点一下选中它，右边的「删除」删掉它。
 *
 * 改名 / 改地址**不**放在行里做 —— 每一行都带输入框，几十页就挤成一团，
 * 反而更翻不动（那正是要被改掉的老毛病）。那些字段在中间栏，选中了改。
 */
function soloRow(node) {
  const li = document.createElement('li');
  li.className = 'solo__row';
  li.dataset.soloId = node.id;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'solo__item';
  if (node === studioNode) pick.classList.add('is-active');
  pick.title = '选中这一页：中间改标题 / 地址 / 正文块，右边看效果';

  const name = document.createElement('span');
  name.className = 'solo__name';
  name.textContent = node.title || '(未命名)';

  const url = document.createElement('em');
  url.className = 'solo__urltag';
  const blocks = Array.isArray(node.page) ? node.page.length : 0;
  url.textContent = blocks ? `${nodeUrl(node)} · ${blocks} 块` : nodeUrl(node);

  pick.append(name, url);
  pick.addEventListener('click', () => selectSoloPage(node));

  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'btn btn--ghost boardedit__mini boardedit__del solo__del';
  del.textContent = '删除';
  del.title = (node.children ?? []).length
    ? '会连同它下面的子版块一起删掉'
    : '删掉这一页（别处链到它的链接会变成 404）';
  del.addEventListener('click', () => deleteStandalone(node));

  li.append(pick, del);
  return li;
}

/** 独立页面清单：按标题 / 地址 / id 筛，一共几条一眼看得出来 */
function renderSoloList() {
  const box = els.soloList;
  if (!box) return;
  box.textContent = '';
  const solos = standaloneBoards();
  if (els.soloCount) els.soloCount.textContent = `${solos.length} 个`;

  const kw = soloSearch.trim().toLowerCase();
  const shown = kw
    ? solos.filter((n) => String(n.title ?? '').toLowerCase().includes(kw)
      || String(n.id ?? '').toLowerCase().includes(kw)
      || String(n.href ?? '').toLowerCase().includes(kw)
      || nodeUrl(n).toLowerCase().includes(kw))
    : solos;

  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'solo__empty';
    li.textContent = solos.length
      ? `没有匹配「${soloSearch.trim()}」的页面`
      : '还没有独立页面。上面填个名字、点「＋ 新建」就有了。';
    box.appendChild(li);
    return;
  }
  for (const node of shown) box.appendChild(soloRow(node));
}

/** 在独立页面面板里选中一页 */
function selectSoloPage(node) {
  if (!node) return;
  lastSoloNode = node;
  // 里面会连清单、字段、正文块、右栏预览一起重画
  selectStudioPage(node);
  if (els.soloTitle) els.soloTitle.textContent = `独立页面 · ${node.title || node.id || '未命名'}`;
}

/** 删掉一条独立页面（下面还挂着子版块时要用户点一下头） */
function deleteStandalone(node) {
  if ((node.children ?? []).length
    && !confirm(`「${node.title || node.id}」下面还有 ${node.children.length} 个子版块，一起删掉吗？`)) {
    return;
  }
  const i = (boardsDraft?.boards ?? []).indexOf(node);
  if (i < 0) return;
  boardsDraft.boards.splice(i, 1);
  markStudioDirty();
  if (node === pageNode) {
    /*
      删的正好是手上这一页：换到剩下第一条独立页面。
      一条都不剩就把中间栏清空 —— 不清的话，「保存」会把别的页面给存了。
    */
    if (lastSoloNode === node) lastSoloNode = null;
    const next = standaloneBoards()[0] ?? null;
    if (next) selectSoloPage(next);
    else clearStudioSelection();
  } else {
    renderStudioFields();
  }
  renderSoloList();
  renderStudioStandalone();
  renderStudioTree();
}

/** 一条独立页面都不剩时：把中间栏清干净，别留着上一页的字段 */
function clearStudioSelection() {
  // 清之前先把手上这页没保存的块收进它自己的节点 —— 否则从这里回到「页面」工作台，那页的改动就白改了
  if (pageNode) commitPageBlocks();
  studioNode = null;
  pageNode = null;
  pageDraft = [];
  resetPageBlockPlacement();
  if (els.soloTitle) els.soloTitle.textContent = '独立页面';
  els.pwFields.textContent = '';
  els.pageEditor.textContent = '';
  els.pwKids.textContent = '';
  els.pwUrl.textContent = '—';
  els.pwStatus.textContent = '';
  els.pwStatus.classList.remove('is-dirty');
  els.pwFrame.srcdoc = '';
}

/** 左栏上面那个「＋ 新建」：填个名字就建一条，建完立刻选中、名字就能接着敲 */
function createStandalone(input) {
  if (!boardsDraft) return null;
  const wanted = input.value.trim();
  const pageTitle = wanted || '新独立页面';
  const node = { id: newStandaloneId(pageTitle), title: pageTitle, standalone: true, page: [] };
  // 放到最前面：刚建的在最上面，一眼看到
  boardsDraft.boards.unshift(node);
  input.value = '';
  markStudioDirty();
  // 新建的别被搜索词挡在清单外面
  soloSearch = '';
  if (els.soloSearch) els.soloSearch.value = '';
  selectSoloPage(node);
  // 名字选中，接着敲字就是改名
  const nameIn = els.pwFields.querySelector('input');
  nameIn?.focus();
  nameIn?.select?.();
  return node;
}

/** 打开独立页面工作台。传节点就定位到那一页，不传就接着上次看的那一页。 */
async function openSoloView(node = null) {
  mountStudioHost('solo');
  markWorkspaceActive('solo');
  els.soloModal.hidden = false;

  if (!boardsDraft) {
    els.soloList.textContent = '正在读取版块树…';
    try {
      const res = await fetch('/api/boards');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      boardsDraft = await res.json();
    } catch (err) {
      els.soloList.textContent = `读取失败：${err.message}`;
      return;
    }
  }

  // 时间轴、分类库：中间栏那几个下拉要它们才画得出来；拉不到不影响改页面
  try {
    await loadTimelines();
  } catch {
    /* 忽略 */
  }
  try {
    await loadNavs();
  } catch {
    /* 忽略 */
  }

  const solos = standaloneBoards();
  if (els.soloSearch) els.soloSearch.value = soloSearch;

  /*
    选中哪一页：显式指定的 > 上次在这个面板看的那一页 > 手上正编辑的
    （它本来就是独立页面时）> 第一页。一条都没有就清空中间栏。
  */
  const want = node
    || (solos.includes(lastSoloNode) ? lastSoloNode : null)
    || (studioNode && studioNode.standalone === true ? studioNode : null)
    || solos[0]
    || null;
  if (want) selectSoloPage(want);
  else clearStudioSelection();
  renderSoloList();
}

/** 关掉独立页面工作台（草稿不丢：改动就在 boardsDraft 里） */
function closeSoloView() {
  if (els.soloModal) els.soloModal.hidden = true;
  els.pwFrame.srcdoc = '';
  // 控件搬回「页面」工作台，免得下次打开那边中间栏是空的
  if (studioHost === 'solo') mountStudioHost('pages');
}

/* ---------- 两个工作台共用同一套编辑控件 ----------

   「页面」和「独立页面」的中间栏、右栏、状态栏是**同一批 DOM 节点**：
   打开哪个面板就把它们 appendChild 到哪个面板里去 —— 搬的是节点本身，不是复制。
   这样 boardsDraft / pageDraft / #page-editor 只有一份，
   两个面板不可能显示得不一样，也不用维护第二套渲染函数。

   搬回去靠事先插好的锚点。不能用记下来的 nextSibling 还原：
   下一个兄弟自己也被搬走了，insertBefore 会因为参照节点不在父节点下直接抛错。
   --------------------------------------------------------------- */

/** 'pages' | 'solo'：这批共用控件现在挂在哪个面板里 */
let studioHost = 'pages';
const STUDIO_MOVERS = [];

function initStudioAnchors() {
  const pairs = [
    [els.pwFields, els.soloEditCol],
    [els.pwContentBlock, els.soloEditCol],
    [els.pwKidsBlock, els.soloEditCol],
    [els.pwPreviewHead, els.soloPreviewCol],
    [els.pwFrameWrap, els.soloPreviewCol],
    [els.pwActions, els.soloPanel],
  ];
  for (const [el, dest] of pairs) {
    if (!el || !el.parentNode || !dest) continue;
    const anchor = document.createElement('span');
    anchor.className = 'studio-anchor';
    el.parentNode.insertBefore(anchor, el);
    STUDIO_MOVERS.push({ el, anchor, dest });
  }
}

function mountStudioHost(which) {
  if (which === studioHost || !STUDIO_MOVERS.length) return;
  for (const m of STUDIO_MOVERS) {
    if (which === 'solo') m.dest.appendChild(m.el);
    else if (m.anchor.parentNode) m.anchor.parentNode.insertBefore(m.el, m.anchor);
  }
  studioHost = which;
  paintWorkspaceSwitch();
}

/**
 * 「页面」工作台左栏底下那一小块：现在只是个入口卡片。
 * 清单本身搬去了独立页面工作台 —— 在这儿塞一整列（还要挨个改名改地址）
 * 正是「页面一多就翻不动」的老毛病，不如让出一个按钮直接跳过去。
 */
function renderStudioStandalone() {
  const box = els.pwSolo;
  if (!box) return;
  box.textContent = '';
  const solos = standaloneBoards();

  const head = document.createElement('div');
  head.className = 'pw-solo__head';
  const title = document.createElement('span');
  title.className = 'pw-solo__title';
  title.textContent = '独立页面';
  const count = document.createElement('em');
  count.className = 'pw-solo__count';
  count.textContent = solos.length ? `${solos.length} 个` : '还没有';
  head.append(title, count);
  box.appendChild(head);

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'btn btn--ghost boardedit__mini pw-solo__jump';
  jump.id = 'pw-solo-jump';
  jump.textContent = '打开独立页面工作台 ›';
  jump.title = '独立页面有自己的编辑窗：可搜索的清单 + 标题 / 地址 / 正文块，页面多了也好翻';
  jump.addEventListener('click', () => openWorkspace('solo'));
  box.appendChild(jump);

  const hint = document.createElement('p');
  hint.className = 'hint pw-solo__hint';
  hint.textContent =
    '不显示在任何板块下：首页卡片、右上角目录树、别人的子版块列表、sitemap 里都没有它，页面本身照常生成。只能靠你在别处挂的链接点进来。';
  box.appendChild(hint);
}

/* ---------- 中栏（上）：这一页自己的字段 ---------- */

function pwField(labelText, control, hint) {
  const wrap = document.createElement('label');
  wrap.className = 'pw-field';
  // 给测试和以后的脚本一个稳定的抓手，别靠"第几个 input"去猜
  wrap.dataset.field = labelText;
  const cap = document.createElement('span');
  cap.className = 'pw-field__label';
  cap.textContent = labelText;
  wrap.append(cap, control);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'pw-field__hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

function renderStudioFields() {
  const node = studioNode;
  const box = els.pwFields;
  box.textContent = '';

  const grid = document.createElement('div');
  grid.className = 'pw-grid';

  grid.appendChild(pwField('名称', boardInput(node.title ?? '', '这一页叫什么', (v) => {
    node.title = v;
    els.pagesTitle.textContent = `页面 · ${v || node.id || '未命名'}`;
    if (node.standalone === true && els.soloTitle) {
      els.soloTitle.textContent = `独立页面 · ${v || node.id || '未命名'}`;
    }
    renderStudioTree();
    // 独立页面清单里那一行的名字也跟着变（重建清单不会动到正在打字的这个框）
    renderSoloList();
    markStudioDirty();
  })));

  grid.appendChild(pwField('副标题', boardInput(node.subtitle ?? '', '可留空（面板标题旁边那行小字）', (v) => {
    node.subtitle = v;
    markStudioDirty();
  })));

  grid.appendChild(pwField('地址', boardInput(node.href ?? '', '留空 = 按 id 自动生成', (v) => {
    node.href = v.trim();
    markStudioDirty();
    renderStudioTree();
    renderSoloList();
  }), node.href ? '用的是你写的这个地址' : `现在自动生成的是 ${flattenBoardNodes().find((f) => f.node === node)?.url ?? '—'}`));
  /*
    上方那行位置链接（面包屑）点它去哪。
    默认 = 这一项自己那一页；填了就改去这个地址 —— hero 里那个「← 返回 X」也一起跟着变
    （两处标的是同一件事）。用户原话：「上方会有可以点击的纷湖二字 如果预留了点击位
    那么请加入可以编辑点击跳转到的链接的接口」。
  */
  const crumbOwn = flattenBoardNodes().find((f) => f.node === node)?.url ?? '—';
  grid.appendChild(pwField('上方位置链接', boardInput(node.crumbHref ?? '', '留空 = 回它自己那一页', (v) => {
    const s = v.trim();
    if (s) node.crumbHref = s;
    else delete node.crumbHref;
    markStudioDirty();
  }), `子页面正文上方那行「… › 这一项 › 当前页」里点它去哪（站内路径 / 外链都行）；留空 = ${crumbOwn}`));

  const layoutSel = pageSelect(LAYOUTS, node.layout ?? '', (v) => {
    if (v) node.layout = v;
    else delete node.layout;
    markStudioDirty();
  });
  layoutSel.title = LAYOUT_HINT;
  grid.appendChild(pwField('版式', layoutSel, LAYOUT_HINT));

  /*
    时间轴：这一页用哪条轴，以及这一页自己认领哪个时间点/时间段。
    换了轴，之前认领的点/段都是旧轴上的 id，留着就是悬空的，
    所以一并清掉 —— 界面上那个下拉也会跟着变成「不指定」。
  */
  const tlOptions = [['', '（没有时间轴）']].concat(
    (timelinesDraft?.timelines ?? []).map((t) => [t.id, t.title])
  );
  const tlSel = pageSelect(tlOptions, node.timeline ?? '', (v) => {
    if (v) node.timeline = v;
    else delete node.timeline;
    delete node.timePoint;
    delete node.timeSpan;
    markStudioDirty();
    renderStudioFields();
    renderPageEditor();
  });
  grid.appendChild(
    pwField('时间轴', tlSel, timelinesDraft?.timelines?.length
      ? '这一页右侧显示哪条时间轴；好几页可以共用同一条'
      : '还没有时间轴 —— 先到顶栏「时间轴」里建一条')
  );

  if (node.timeline) {
    const claim = timeSelect(() => readTime(node), (v) => {
      writeTime(node, v);
      markStudioDirty();
    });
    grid.appendChild(
      pwField('本页认领', claim, '打开这一页时时间轴默认停在这儿；也用在它作为卡片出现在上一页的时候')
    );
  }

  const cover = pwField('封面图', boardCoverControl(node, () => {
    markStudioDirty();
    renderStudioFields();
  }), '卡片上的那张图；没传就用渐变兜底');

  const idLine = document.createElement('div');
  idLine.className = 'pw-field';
  const idCap = document.createElement('span');
  idCap.className = 'pw-field__label';
  idCap.textContent = '标识 id';
  const idVal = document.createElement('code');
  idVal.className = 'pw-field__id';
  idVal.textContent = node.id || '（保存后自动生成）';
  idVal.title = '文章归类靠它；换父级也不会变，别手改';
  idLine.append(idCap, idVal);

  grid.append(cover, idLine);
  box.appendChild(grid);

  // 上一级：一键跳到父页面，省得在左栏里翻
  const all = flattenBoardNodes();
  const me = all.find((f) => f.node === node);
  const parentRow = document.createElement('div');
  parentRow.className = 'pw-parent';
  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn btn--ghost boardedit__mini';
  up.textContent = '← 上一级';
  if (me && me.depth > 0) {
    const parent = all.find((f) => f.node !== node && (node.id ?? '').startsWith(`${f.node.id}-`)
      && f.depth === me.depth - 1);
    up.disabled = !parent;
    if (parent) up.addEventListener('click', () => selectStudioPage(parent.node));
  } else {
    up.disabled = true;
  }
  parentRow.appendChild(up);
  box.appendChild(parentRow);
}

/* ---------- 中栏（下）：这一页的子版块 ---------- */

function renderStudioKids() {
  const box = els.pwKids;
  box.textContent = '';
  const kids = studioNode.children ?? (studioNode.children = []);

  if (!kids.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '这一页下面还没有子版块。点下面的「＋ 加一个子版块」就能加一个属于自己的子页面。';
    box.appendChild(p);
    return;
  }

  kids.forEach((kid, i) => {
    const row = document.createElement('div');
    row.className = 'pw-kid';
    row.dataset.kidIndex = String(i);
    const isLink = !!(kid.link && String(kid.link).trim());
    if (isLink) row.classList.add('pw-kid--link');

    // 第一行：名字 + 一排操作
    const top = document.createElement('div');
    top.className = 'pw-kid__top';

    const name = boardInput(kid.title ?? '', '子版块名字', (v) => {
      kid.title = v;
      markStudioDirty();
      renderStudioTree();
    });
    name.classList.add('pw-kid__name');

    /*
      链接版块：填了地址就不再有自己的页面，点它是直接跳走。
      地址只在这里出现，页面上不显示 —— 卡片上只有名字和封面图。
    */
    const linkInput = boardInput(kid.link ?? '', '链接（填了就点它跳走，不再是页面）', (v) => {
      const was = !!(kid.link && String(kid.link).trim());
      const now = !!v.trim();
      if (now) kid.link = v;
      else delete kid.link;
      markStudioDirty();
      // 从「普通」变「链接」或反过来，整行都要重画（按钮不一样）
      if (was !== now) renderStudioKids();
      renderStudioTree();
    });
    linkInput.classList.add('pw-kid__link');
    linkInput.type = 'url';

    const shape = pageSelect(CARD_SHAPES_OR, kid.cardShape ?? '', (v) => {
      if (v) kid.cardShape = v;
      else delete kid.cardShape;
      markStudioDirty();
    });
    const size = pageSelect(CARD_SIZES_OR, kid.cardSize ?? '', (v) => {
      if (v) kid.cardSize = v;
      else delete kid.cardSize;
      markStudioDirty();
    });
    shape.title = '这一项作为卡片出现时的横竖比例（空着就跟「子页面」块的默认值）';
    size.title = '这一项作为卡片出现时的大小档位（大/中/小）';

    /*
      具体像素宽高。档位（大中小）只是粗调，用户要的是「这张卡太大了，
      改成 300×80」——那就得能填数字。填了就盖过档位。
    */
    const numInput = (key, ph) => {
      const el = document.createElement('input');
      el.type = 'number';
      el.className = 'input pw-kid__px';
      el.min = '20';
      el.max = '2400';
      el.step = '1';
      el.placeholder = ph;
      el.value = kid[key] ? String(kid[key]) : '';
      el.title = key === 'cardW' ? '卡片宽度（像素），空着就自动' : '卡片高度（像素），空着就自动';
      el.addEventListener('input', () => {
        const n = Number(el.value);
        if (el.value === '' || !Number.isFinite(n)) delete kid[key];
        else kid[key] = Math.round(n);
        markStudioDirty();
      });
      return el;
    };
    const pxW = numInput('cardW', '宽自动');
    const pxH = numInput('cardH', '高自动');

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn--ghost boardedit__mini';
    up.textContent = '↑';
    up.title = '往前挪';
    up.disabled = i === 0;
    up.addEventListener('click', () => {
      [kids[i - 1], kids[i]] = [kids[i], kids[i - 1]];
      markStudioDirty();
      renderStudioKids();
      renderStudioTree();
    });

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn btn--ghost boardedit__mini';
    down.textContent = '↓';
    down.title = '往后挪';
    down.disabled = i === kids.length - 1;
    down.addEventListener('click', () => {
      [kids[i + 1], kids[i]] = [kids[i], kids[i + 1]];
      markStudioDirty();
      renderStudioKids();
      renderStudioTree();
    });

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn btn--ghost boardedit__mini';
    open.textContent = '编辑这一页 ›';
    open.title = '切到它自己的页面继续改';
    open.hidden = isLink; // 链接版块没有自己的页面可编辑
    open.addEventListener('click', () => selectStudioPage(kid));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.title = (kid.children ?? []).length ? '会连同它下面的子版块一起删掉' : '删掉这一项';
    del.addEventListener('click', () => {
      if ((kid.children ?? []).length
        && !confirm(`「${kid.title || '这一项'}」下面还有 ${kid.children.length} 个子版块，一起删掉吗？`)) {
        return;
      }
      kids.splice(i, 1);
      markStudioDirty();
      renderStudioKids();
      renderStudioTree();
    });

    const cover = boardCoverControl(kid, () => {
      markStudioDirty();
      renderStudioKids();
    });

    // 第二行：封面 + 单张卡的比例、档位、像素宽高
    const bar = document.createElement('div');
    bar.className = 'pw-kid__bar';
    const shapeLabel = document.createElement('label');
    shapeLabel.className = 'pw-mini';
    shapeLabel.append('比例', shape);
    const sizeLabel = document.createElement('label');
    sizeLabel.className = 'pw-mini';
    sizeLabel.append('大小', size);
    const pxWrap = document.createElement('span');
    pxWrap.className = 'pw-mini';
    pxWrap.append('尺寸', pxW, '×', pxH, 'px');
    bar.append(cover, shapeLabel, sizeLabel, pxWrap);

    /*
      这一项认领的时间点/时间段。
      两个用处：它作为卡片出现在这一页时，滚到它就停在那一点；
      点进它自己的页面，时间轴默认也停在那儿。
      链接版块没有自己的页面，只影响卡片那一下。
    */
    if (!isLink) {
      const tlLabel = document.createElement('label');
      tlLabel.className = 'pw-mini pw-mini--tl';
      tlLabel.append('时间', timeSelect(() => readTime(kid), (v) => {
        writeTime(kid, v);
        markStudioDirty();
      }));
      bar.appendChild(tlLabel);
    }

    if (isLink) {
      const badge = document.createElement('span');
      badge.className = 'pw-kid__badge';
      badge.textContent = '↗ 链接版块：点它直接跳走，页面上不显示这个地址';
      bar.appendChild(badge);

      /*
        站内链接顺手查一下：填了 `/xxx` 但站里没有这一页的话，
        点下去就是 404 —— 与其等发布完才发现，不如现在就标出来。
      */
      if (siteLinkStatus(kid.link) === 'missing') {
        const warn = document.createElement('span');
        warn.className = 'pw-kid__warn';
        warn.textContent = `⚠ 站内没有「${String(kid.link).trim()}」这一页，点它会 404`;
        bar.appendChild(warn);
      }
    }

    top.append(name, up, down, open, del);
    row.append(top, linkInput, bar);
    box.appendChild(row);
  });
}

/** 工作台里的改动只是内存里的草稿，提示一句，免得以为已经存了 */
function markStudioDirty() {
  els.pwStatus.textContent = '有改动没保存';
  els.pwStatus.classList.add('is-dirty');
}

/* ---------- 右栏：预览 ---------- */

/** 这一页现在（草稿里）的地址 */
function studioUrl() {
  const f = flattenBoardNodes().find((x) => x.node === studioNode);
  const url = f?.url || '/';
  return url.endsWith('/') ? url : `${url}/`;
}

/** 把这一页的 HTML 抓过来塞进 srcdoc（同源，方便以后做点选） */
async function loadStudioFrame({ keepStatus = false } = {}) {
  const url = studioUrl();
  els.pwUrl.textContent = url;
  if (!keepStatus) {
    els.pwStatus.textContent = '';
    els.pwStatus.classList.remove('is-dirty');
  }
  try {
    const res = await fetch(`/api/preview?path=${encodeURIComponent(url)}`, { cache: 'no-store' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      let msg = `HTTP ${res.status}`;
      try {
        msg = JSON.parse(detail).error || msg;
      } catch { /* 不是 JSON 就用状态码 */ }
      throw new Error(msg);
    }
    let html = await res.text();
    // srcdoc 没有自己的地址，相对路径要靠 <base> 指回预览服务
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${PREVIEW_URL}${url}">`);
    els.pwFrame.srcdoc = html;
  } catch (err) {
    els.pwFrame.srcdoc = `<body style="font:14px/1.8 system-ui;padding:24px;color:#b4443a">
      载入这一页失败：${String(err.message).replace(/[<>&]/g, '')}<br>
      先在启动器里点「看效果」把预览服务（4321）起起来。</body>`;
  }
}

/** 保存：写盘 → 重新构建 → 刷新预览 */
async function saveStudio() {
  if (!studioNode) return;
  commitPageBlocks();
  els.pageSave.disabled = true;
  els.pwStatus.textContent = '正在保存…';
  els.pwStatus.classList.remove('is-dirty');
  try {
    const ok = await saveBoards({ silent: true });
    if (!ok) throw new Error('写入 home-boards.json 失败');

    els.pwStatus.textContent = '正在重新构建…';
    const res = await fetch('/api/build', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) throw new Error(data.error || `构建失败 HTTP ${res.status}`);

    // 顺序要紧：先把预览刷新了，再写状态栏 ——
    // loadStudioFrame 会把状态清掉，反过来的话「已保存」一闪就没了。
    await loadStudioFrame({ keepStatus: true });
    els.pwStatus.textContent = `已保存并重新构建（${data.ms} ms）`;
    toast('页面已保存，右边就是最新效果');
    renderStudioTree();
    renderStudioFields();
  } catch (err) {
    els.pwStatus.textContent = `出错了：${err.message}`;
    els.pwStatus.classList.add('is-dirty');
    toast(`保存失败：${err.message}`, true);
  } finally {
    els.pageSave.disabled = false;
  }
}

function pageSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'input';
  for (const [v, label] of options) {
    const o = document.createElement('option');
    o.value = v;
    o.textContent = label;
    sel.appendChild(o);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

/**
 * 划分线的默认颜色。
 * 最早那版划分线是写死橙黄一根，现在改成一条线一个色，
 * 但老数据（还有刚画上去还没改色的新线）仍然用它，所见即所得。
 */
const MAP_LINE_DEFAULT_COLOR = '#ffb43c';

/**
 * 编辑器里「下一次画线用什么颜色」。
 * 放在模块级：地图编辑区每次重画都会重建 DOM，颜色得活过这一轮重建，
 * 不然挑好的色一刷新就弹回默认，画三条线要挑三次。
 */
let mapDrawColor = MAP_LINE_DEFAULT_COLOR;

/** `#rrggbb` → [r, g, b]；认不出来就给默认线色，不抛错 */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex || '').trim());
  if (!m) return [255, 180, 60];
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** [r, g, b] → `#rrggbb`，越界的夹回 0~255，省得存出个非法颜色 */
function rgbToHex(r, g, b) {
  const c = (v) =>
    Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * 「填 RGB 挑颜色」那一套：一个取色块 + 三个 0~255 的数字框，两边双向同步。
 *
 * 取色块是浏览器自带的调色板（本来就是按 RGB 调的），数字框则是给
 * 「我知道要 #1e90ff，不想在色轮上摸」的场合准备的。挑完立刻回调，
 * 预览图和线路清单会跟着变。
 */
function rgbColorField(getHex, setHex, opts = {}) {
  const wrap = document.createElement('span');
  wrap.className = 'pmap-edit__color' + (opts.compact ? ' pmap-edit__color--compact' : '');

  const swatch = document.createElement('input');
  swatch.type = 'color';
  swatch.className = 'pmap-edit__swatch';
  swatch.value = getHex();
  swatch.title = '点开挑颜色（也可以直接填右边的 R / G / B）';

  const boxes = ['R', 'G', 'B'].map((name) => {
    const box = document.createElement('input');
    box.type = 'number';
    box.min = '0';
    box.max = '255';
    box.step = '1';
    box.className = 'input pmap-edit__rgb';
    box.title = name;
    box.setAttribute('aria-label', `线色 ${name}`);
    return box;
  });

  /** 把三个数字框刷成当前颜色。值没变就不写，免得手动输入时光标被顶到末尾 */
  const paint = () => {
    const rgb = hexToRgb(swatch.value);
    boxes.forEach((box, i) => {
      const v = String(rgb[i]);
      if (box.value !== v) box.value = v;
    });
  };

  /** 统一入口：不管从哪边改的，先归一化成合法颜色，再同步两边、回调出去 */
  const push = (hex) => {
    const clean = rgbToHex(...hexToRgb(hex));
    swatch.value = clean;
    paint();
    setHex(clean);
  };

  paint();
  swatch.addEventListener('input', () => push(swatch.value));
  for (const box of boxes) {
    box.addEventListener('input', () => push(rgbToHex(...boxes.map((b) => b.value))));
    // 手敲的时候不打断，等离开这个框再把越界的值夹回来
    box.addEventListener('blur', () => push(rgbToHex(...boxes.map((b) => b.value))));
  }

  wrap.append(swatch, ...boxes);
  return wrap;
}

/**
 * 地图块的编辑区。
 *
 * 地图是**分页**的：上面一排页签切页，每页各有自己的图、图钉、划分线和简介。
 *
 * 一页的编辑区分四块：
 *   1. 选这一页的图（复用图片块那套上传 / 压缩）
 *   2. 简介输入（显示在地图下面）
 *   3. 一张可以点的预览图 —— 在图上**点一下**钉图钉，**拖一下**画区域划分线
 *   4. 图钉清单（类型 / 名字 / 跳转地址）和划分线清单（颜色 / 删除）
 *
 * 位置一律存百分比（0~100）。预览图和页面上显示的大小不一样也没关系，
 * 只要按图的宽高算比例，钉出来的点就是同一个地方。
 */
function mapFields(block) {
  const wrap = document.createElement('div');
  wrap.className = 'pmap-edit';

  /**
   * 把块读成「页的数组」。
   * 兼容最早那版只有一页的写法（块上直接挂 src + markers）：
   * 读进来当第一页，保存时服务端会写成新的分页结构。
   */
  const pagesOf = () => {
    if (!Array.isArray(block.pages)) block.pages = [];
    if (!block.pages.length && String(block.src ?? '').trim()) {
      block.pages.push({
        id: `${block.id}-p1`,
        src: block.src,
        alt: block.alt ?? '',
        text: '',
        markers: (Array.isArray(block.markers) ? block.markers : []).map((m) => ({
          ...m,
          kind: m.kind === 'region' ? 'region' : 'building',
        })),
        lines: [],
      });
    }
    for (const pg of block.pages) {
      if (!Array.isArray(pg.markers)) pg.markers = [];
      if (!Array.isArray(pg.lines)) pg.lines = [];
    }
    return block.pages;
  };
  pagesOf();

  /** 当前在看第几页、点图时放什么 */
  let pageIdx = 0;
  // 'building' / 'region' 是点一下钉一个；'line' 是按住拖一条
  let mode = 'building';

  const newId = (suffix) => `${block.id}-${suffix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

  const redraw = () => {
    wrap.textContent = '';
    const pages = pagesOf();
    if (pageIdx >= pages.length) pageIdx = pages.length - 1;
    if (pageIdx < 0) pageIdx = 0;

    /* ---------- 页签 ---------- */
    const tabs = document.createElement('div');
    tabs.className = 'pmap-edit__tabs';
    pages.forEach((pg, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'pmap-edit__tab' + (i === pageIdx ? ' is-active' : '');
      tab.textContent = `第 ${i + 1} 页`;
      tab.addEventListener('click', () => {
        pageIdx = i;
        redraw();
      });
      tabs.appendChild(tab);
    });
    const addPage = document.createElement('button');
    addPage.type = 'button';
    addPage.className = 'btn btn--ghost boardedit__mini';
    addPage.textContent = '＋ 加一页';
    addPage.addEventListener('click', () => {
      block.pages.push({ id: newId('p'), src: '', alt: '', text: '', markers: [], lines: [] });
      pageIdx = block.pages.length - 1;
      markStudioDirty();
      redraw();
    });
    tabs.appendChild(addPage);

    if (pages.length > 1) {
      const delPage = document.createElement('button');
      delPage.type = 'button';
      delPage.className = 'btn btn--ghost boardedit__mini boardedit__del';
      delPage.textContent = '删掉这一页';
      delPage.addEventListener('click', () => {
        block.pages.splice(pageIdx, 1);
        pageIdx = Math.max(0, pageIdx - 1);
        markStudioDirty();
        redraw();
      });
      tabs.appendChild(delPage);
    }
    wrap.appendChild(tabs);

    if (!pages.length) {
      const hint = document.createElement('p');
      hint.className = 'pblock-edit__hint';
      hint.textContent = '还没有页。点上面的「＋ 加一页」，再给这一页选一张地图图。';
      wrap.appendChild(hint);
      return;
    }

    const page = pages[pageIdx];

    /* ---------- 1. 选图 ---------- */
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';

    const thumb = document.createElement('span');
    thumb.className = 'boardedit__thumb';
    if (page.src) {
      thumb.style.backgroundImage = `url(${page.src})`;
      thumb.title = page.src;
    } else {
      thumb.classList.add('boardedit__thumb--empty');
      thumb.title = '还没选图';
    }

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    file.hidden = true;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'btn btn--ghost boardedit__mini';
    pick.textContent = page.src ? '换一张地图' : '选地图图';
    pick.title = '也可以直接把图拖进来，或 QQ 截图后 Ctrl+V';
    pick.addEventListener('click', () => file.click());
    // 点按钮 / 拖进来 / 粘进来，最后都走这个 onFiles（里面是同一个 uploadImage）
    attachImageIntake({
      el: row,
      input: file,
      label: '地图图',
      onFiles: async ([f]) => {
        try {
          page.src = await uploadImage(f);
          toast('地图传好了');
          markStudioDirty();
          redraw();
        } catch (err) {
          toast(`传图失败：${err.message}`, true);
        }
      },
      onUrl: (url) => {
        page.src = url;
        toast('地图地址已填上（拖进来的是链接）');
        markStudioDirty();
        redraw();
      },
    });

    /*
      这一格是 <img alt>，只在图加载失败或者读屏时用，**页面上不显示**。
      以前它叫「地图说明」，很容易和下面那个「简介」搞混 —— 明明填了东西
      页面上却什么都没有。所以名字里就把这件事说清楚。
    */
    const alt = boardInput(page.alt ?? '', '图片说明（给读屏 / 图挂了时用，页面上不显示）', (v) => {
      page.alt = v;
      markStudioDirty();
    });

    row.append(thumb, pick, alt, file);
    wrap.appendChild(row);

    /* ---------- 2. 简介（真会显示在地图下方的那句话） ---------- */
    const textRow = document.createElement('div');
    textRow.className = 'pblock-edit__introRow';

    const introLabel = document.createElement('span');
    introLabel.className = 'pblock-edit__hint';
    introLabel.textContent = '简介 —— 会以小一号的字显示在地图下方，留空就不显示';

    const intro = document.createElement('textarea');
    intro.className = 'input pblock-edit__intro';
    intro.rows = 2;
    intro.placeholder = '这一页的简介，比如这张图是什么时候、什么地方的地图';
    intro.value = page.text ?? '';
    intro.addEventListener('input', () => {
      page.text = intro.value;
      markStudioDirty();
    });

    textRow.append(introLabel, intro);
    wrap.appendChild(textRow);

    if (!page.src) {
      const hint = document.createElement('p');
      hint.className = 'pblock-edit__hint';
      hint.textContent = '这一页还没选图。选好之后在图上点一下就能钉图钉。';
      wrap.appendChild(hint);
      return;
    }

    /* ---------- 3. 点 / 拖的预览图 ---------- */
    const modeRow = document.createElement('div');
    modeRow.className = 'pmap-edit__modes';
    const modeLabel = document.createElement('span');
    modeLabel.className = 'pblock-edit__hint pblock-edit__hint--inline';
    modeLabel.textContent = '在这里放：';
    modeRow.appendChild(modeLabel);
    for (const [key, label, tip] of [
      ['building', '建筑图钉', '在图上点一下 = 钉一个粉色塔吊图钉'],
      ['region', '区域图钉', '在图上点一下 = 钉一个落日配色的区域图钉'],
      ['line', '区域划分线', '在图上按住拖一下 = 画一条划分线，颜色用右边挑的那个'],
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn--ghost boardedit__mini' + (mode === key ? ' is-active' : '');
      b.textContent = label;
      b.title = tip;
      b.addEventListener('click', () => {
        mode = key;
        redraw();
      });
      modeRow.appendChild(b);
    }

    /*
      画线用的颜色。放在这一排是因为「先挑色、再画线」这个顺序最顺手：
      挑完颜色直接去图上拖，新线就是那个色；画完想改，下面清单里
      每条线还有自己的一个取色块。
    */
    const colorLabel = document.createElement('span');
    colorLabel.className = 'pblock-edit__hint pblock-edit__hint--inline';
    colorLabel.textContent = '线色：';
    modeRow.appendChild(colorLabel);
    modeRow.appendChild(
      rgbColorField(
        () => mapDrawColor,
        (hex) => {
          mapDrawColor = hex;
        }
      )
    );
    wrap.appendChild(modeRow);

    const tip = document.createElement('p');
    tip.className = 'pblock-edit__hint';
    tip.textContent =
      mode === 'line'
        ? '按住鼠标在图上拖一条线出来。线不显示名字、也点不动，只是把地图划成几块；颜色用上面挑的那个，画完还能在下面清单里单独改。'
        : `在图上点一下就钉一个${mode === 'region' ? '区域' : '建筑'}图钉；已经钉好的图钉可以直接按住拖动挪位置。`;
    wrap.appendChild(tip);

    const canvas = document.createElement('div');
    canvas.className = 'pmap-edit__canvas';

    const img = document.createElement('img');
    img.src = page.src;
    img.alt = '';
    img.draggable = false;
    canvas.appendChild(img);

    // 划分线画在图上（editor 里就按百分比铺，和页面上一套坐标）
    for (const ln of page.lines) {
      const el = document.createElement('span');
      el.className = 'pmap-edit__line';
      el.dataset.lineId = ln.id;
      // 颜色挂在元素上，样式表里用 var(--lc) 取，和页面那边一个套路
      el.style.setProperty('--lc', ln.color || MAP_LINE_DEFAULT_COLOR);
      canvas.appendChild(el);
    }
    // 图钉
    page.markers.forEach((m, i) => {
      const pin = document.createElement('span');
      pin.className = `pmap-edit__pin pmap-edit__pin--${m.kind}`;
      pin.dataset.markerId = m.id;
      pin.title = m.title || '（还没起名）';
      const n = document.createElement('i');
      n.textContent = String(i + 1);
      pin.appendChild(n);
      canvas.appendChild(pin);
    });

    /** 图片在画布里的实际显示框（图未必铺满画布），百分比一律相对它算 */
    const imgBox = () => img.getBoundingClientRect();

    /** 把划分线摆到画布上。线用 canvas 的百分比定位，所以要换算一次 */
    const paintLines = () => {
      const box = imgBox();
      if (!box.width) return;
      for (const ln of page.lines) {
        const el = canvas.querySelector(`[data-line-id="${ln.id}"]`);
        if (!(el instanceof HTMLElement)) continue;
        // 图片未必从画布左上角开始（有留白），先算图在画布里的偏移百分比
        const ox = ((box.left - canvas.getBoundingClientRect().left) / box.width) * 100;
        const oy = ((box.top - canvas.getBoundingClientRect().top) / box.height) * 100;
        const x1 = ox + ln.x1;
        const y1 = oy + ln.y1;
        const x2 = ox + ln.x2;
        const y2 = oy + ln.y2;
        const dx = ((x2 - x1) / 100) * box.width;
        const dy = ((y2 - y1) / 100) * box.height;
        el.style.left = `${x1}%`;
        el.style.top = `${y1}%`;
        el.style.width = `${Math.hypot(dx, dy)}px`;
        el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      }
    };

    /** 把图钉摆到画布上 */
    const paintPins = () => {
      const box = imgBox();
      if (!box.width) return;
      const cbox = canvas.getBoundingClientRect();
      for (const m of page.markers) {
        const el = canvas.querySelector(`[data-marker-id="${m.id}"]`);
        if (!(el instanceof HTMLElement)) continue;
        el.style.left = `${box.left - cbox.left + (m.x / 100) * box.width}px`;
        el.style.top = `${box.top - cbox.top + (m.y / 100) * box.height}px`;
      }
    };

    const paintAll = () => {
      paintLines();
      paintPins();
    };
    // 图加载完才知道真实尺寸，那时候再摆一次
    if (img.complete) paintAll();
    else img.addEventListener('load', paintAll, { once: true });
    requestAnimationFrame(paintAll);

    let dragging = null;

    canvas.addEventListener('pointerdown', (e) => {
      const box = imgBox();
      if (!box.width) return;
      const pct = (ev) => ({
        x: ((ev.clientX - box.left) / box.width) * 100,
        y: ((ev.clientY - box.top) / box.height) * 100,
      });
      const { x, y } = pct(e);

      const pinEl = e.target.closest?.('.pmap-edit__pin');
      if (pinEl) {
        // 按住已有图钉 = 挪它，不用删掉重新点
        const m = page.markers.find((k) => k.id === pinEl.dataset.markerId);
        if (!m) return;
        dragging = { kind: 'pin', marker: m, el: pinEl };
        canvas.setPointerCapture(e.pointerId);
        pinEl.classList.add('is-dragging');
        return;
      }

      if (mode === 'line') {
        // 拖一条线：先立一个临时的预览元素，松手才写进数据
        if (x < 0 || x > 100 || y < 0 || y > 100) return;
        const el = document.createElement('span');
        el.className = 'pmap-edit__line';
        // 预览就按当前挑好的颜色显示，拖的时候就知道画出来什么样
        el.style.setProperty('--lc', mapDrawColor);
        canvas.appendChild(el);
        dragging = { kind: 'line', from: { x, y }, el, moved: false };
        canvas.setPointerCapture(e.pointerId);
        return;
      }

      // 点一下钉一个图钉
      if (x < 0 || x > 100 || y < 0 || y > 100) return;
      page.markers.push({
        id: newId('m'),
        kind: mode === 'region' ? 'region' : 'building',
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        title: '',
        href: '',
      });
      markStudioDirty();
      redraw();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const box = imgBox();
      if (!box.width) return;
      const cbox = canvas.getBoundingClientRect();
      const x = ((e.clientX - box.left) / box.width) * 100;
      const y = ((e.clientY - box.top) / box.height) * 100;

      if (dragging.kind === 'pin') {
        const m = dragging.marker;
        m.x = Math.round(Math.min(100, Math.max(0, x)) * 100) / 100;
        m.y = Math.round(Math.min(100, Math.max(0, y)) * 100) / 100;
        dragging.el.style.left = `${box.left - cbox.left + (m.x / 100) * box.width}px`;
        dragging.el.style.top = `${box.top - cbox.top + (m.y / 100) * box.height}px`;
        return;
      }

      // 画线预览
      dragging.moved = true;
      const dx = ((x - dragging.from.x) / 100) * box.width;
      const dy = ((y - dragging.from.y) / 100) * box.height;
      dragging.el.style.left = `${box.left - cbox.left + (dragging.from.x / 100) * box.width}px`;
      dragging.el.style.top = `${box.top - cbox.top + (dragging.from.y / 100) * box.height}px`;
      dragging.el.style.width = `${Math.hypot(dx, dy)}px`;
      dragging.el.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
      dragging.to = { x, y };
    });

    const endDraw = (e) => {
      if (!dragging) return;
      const d = dragging;
      dragging = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* 指针没了，忽略 */
      }

      if (d.kind === 'pin') {
        d.el.classList.remove('is-dragging');
        markStudioDirty();
        return;
      }

      // 太短的当误触，不留
      const to = d.to ?? d.from;
      if (!d.moved || (Math.abs(to.x - d.from.x) < 1 && Math.abs(to.y - d.from.y) < 1)) {
        d.el.remove();
        return;
      }
      page.lines.push({
        id: newId('l'),
        x1: Math.round(Math.min(100, Math.max(0, d.from.x)) * 100) / 100,
        y1: Math.round(Math.min(100, Math.max(0, d.from.y)) * 100) / 100,
        x2: Math.round(Math.min(100, Math.max(0, to.x)) * 100) / 100,
        y2: Math.round(Math.min(100, Math.max(0, to.y)) * 100) / 100,
        color: mapDrawColor,
      });
      markStudioDirty();
      redraw();
    };
    canvas.addEventListener('pointerup', endDraw);
    canvas.addEventListener('pointercancel', endDraw);

    wrap.appendChild(canvas);

    // 画布尺寸会随窗口变，线得跟着重算一次
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => paintAll());
      ro.observe(canvas);
    }

    /* ---------- 4. 清单 ---------- */
    const list = document.createElement('div');
    list.className = 'pmap-edit__list';

    // 地址输入给一份候选：整棵版块树上的每一页，敲两个字就能补全
    const dlId = `pmap-pages-${block.id}-${page.id}`;
    const dl = document.createElement('datalist');
    dl.id = dlId;
    for (const sp of studioPages()) {
      const o = document.createElement('option');
      o.value = sp.url;
      o.label = sp.node.title || sp.url;
      dl.appendChild(o);
    }
    wrap.appendChild(dl);

    if (!page.markers.length && !page.lines.length) {
      const none = document.createElement('p');
      none.className = 'pblock-edit__hint';
      none.textContent = '这一页还没有图钉和划分线。在上面那张图上点几下、或者拖一条线试试。';
      list.appendChild(none);
    }

    page.markers.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'pmap-edit__item';

      const no = document.createElement('span');
      no.className = 'pmap-edit__no';
      no.textContent = String(i + 1);
      no.title = m.kind === 'region' ? '区域图钉（落日配色）' : '建筑图钉（粉色塔吊）';

      const kind = pageSelect(
        [
          ['building', '建筑'],
          ['region', '区域'],
        ],
        m.kind,
        (v) => {
          m.kind = v;
          markStudioDirty();
          redraw();
        }
      );
      kind.className = 'input pmap-edit__kind';

      const name = boardInput(m.title ?? '', '名字（鼠标移上去显示）', (v) => {
        m.title = v;
        markStudioDirty();
        const pin = canvas.querySelectorAll('.pmap-edit__pin')[i];
        if (pin) pin.title = v || '（还没起名）';
      });

      const linkInput = boardInput(m.href ?? '', '点它跳去 /huaya/xxx（可留空）', (v) => {
        m.href = v.trim();
        markStudioDirty();
      });
      linkInput.setAttribute('list', dlId);
      // 图钉也能直接钉到页面里的某个位置（标题/图片/段落）
      const link = withAnchorPick(linkInput);

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--ghost boardedit__mini boardedit__del';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        page.markers.splice(i, 1);
        markStudioDirty();
        redraw();
      });

      item.append(no, kind, name, link, del);
      list.appendChild(item);
    });

    page.lines.forEach((ln, i) => {
      const item = document.createElement('div');
      item.className = 'pmap-edit__item pmap-edit__item--line';

      const no = document.createElement('span');
      no.className = 'pmap-edit__no pmap-edit__no--line';
      no.textContent = '线';
      // 小方块直接用这条线的颜色，一眼看清哪根是哪根
      no.style.background = `${ln.color || MAP_LINE_DEFAULT_COLOR}38`;
      no.style.borderColor = ln.color || MAP_LINE_DEFAULT_COLOR;

      const label = document.createElement('span');
      label.className = 'pblock-edit__hint pblock-edit__hint--inline';
      label.textContent = `第 ${i + 1} 条划分线（不显示名字，也不能点）`;

      /*
        改这一条的颜色。改完不整块重画（重画会把焦点也弄丢），
        只把图上那根线的 --lc 和旁边的小方块就地刷一下。
      */
      const color = rgbColorField(
        () => ln.color || MAP_LINE_DEFAULT_COLOR,
        (hex) => {
          ln.color = hex;
          const el = canvas.querySelector(`[data-line-id="${ln.id}"]`);
          if (el instanceof HTMLElement) el.style.setProperty('--lc', hex);
          no.style.background = `${hex}38`;
          no.style.borderColor = hex;
          markStudioDirty();
        }
      );

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--ghost boardedit__mini boardedit__del';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        page.lines.splice(i, 1);
        markStudioDirty();
        redraw();
      });

      item.append(no, label, color, del);
      list.appendChild(item);
    });

    wrap.appendChild(list);
  };

  redraw();
  return wrap;
}

/**
 * 「导航」块的字段区。
 *
 * 这里**只存引用**：勾了哪几个大分类、按什么顺序（`block.cats`）。
 * 条目的内容全在分类库里 —— 所以这里永远不内联一份条目拷贝，
 * 页面数据里只有几个 id；改分类内容不用动页面（这正是「可复用导航」的意义）。
 * 被勾选的分类按 `cats` 的顺序列在下面，可以上下调。
 */
function navBlockFields(block) {
  const wrap = document.createElement('div');
  wrap.className = 'pblock-edit__body';
  block.cats = Array.isArray(block.cats) ? block.cats.filter((c) => typeof c === 'string') : [];

  const cats = navsDraft?.categories ?? [];

  const textRow = document.createElement('div');
  textRow.className = 'pblock-edit__row';
  const textCap = document.createElement('span');
  textCap.className = 'pblock-edit__sub';
  textCap.textContent = '顶栏文字';
  const text = boardInput(block.text ?? '', '不写就叫「分类」', (v) => {
    if (v.trim()) block.text = v;
    else delete block.text;
  });
  text.classList.add('pblock-nav__text');
  textRow.append(textCap, text);
  wrap.appendChild(textRow);

  if (!cats.length) {
    const p = document.createElement('p');
    p.className = 'pblock-edit__hint pblock-nav__empty';
    p.textContent = '分类库里还是空的。先到顶栏点「导航」建几个大分类，再回来勾选 —— 这里只放引用，条目的内容都在库里。';
    wrap.appendChild(p);
    return wrap;
  }

  const pickCap = document.createElement('p');
  pickCap.className = 'pblock-edit__hint';
  pickCap.textContent = '勾选这一页要挂哪几个大分类（内容在顶栏「导航」面板里改，这里只记 id）：';
  wrap.appendChild(pickCap);

  const pickBox = document.createElement('div');
  pickBox.className = 'pblock-nav__pick';
  for (const cat of cats) {
    const label = document.createElement('label');
    label.className = 'pblock-nav__check';
    label.dataset.catId = cat.id;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = block.cats.includes(cat.id);
    box.addEventListener('change', () => {
      const i = block.cats.indexOf(cat.id);
      if (box.checked && i < 0) block.cats.push(cat.id);
      if (!box.checked && i >= 0) block.cats.splice(i, 1);
      // 下面「顺序」那一栏要跟着变，整块重画一次
      renderPageEditor();
    });
    const name = document.createElement('span');
    name.className = 'pblock-nav__cname';
    name.textContent = cat.title || '(未命名)';
    const n = document.createElement('em');
    n.className = 'pblock-nav__count';
    n.textContent = `${navItemCount(cat)} 条`;
    label.append(box, name, n);
    pickBox.appendChild(label);
  }
  wrap.appendChild(pickBox);

  const orderCap = document.createElement('p');
  orderCap.className = 'pblock-edit__hint';
  orderCap.textContent = '这一页的顺序（页面上就按这个排；同一个分类在别的页面可以排在别处）：';
  wrap.appendChild(orderCap);

  const orderBox = document.createElement('div');
  orderBox.className = 'pblock-nav__order';
  if (!block.cats.length) {
    const none = document.createElement('span');
    none.className = 'pblock-nav__none';
    none.textContent = '（还没勾分类）';
    orderBox.appendChild(none);
  }
  block.cats.forEach((id, i) => {
    const cat = cats.find((c) => c.id === id);
    const row = document.createElement('span');
    row.className = 'pblock-nav__orow' + (cat ? '' : ' is-missing');
    row.dataset.catId = id;
    const name = document.createElement('span');
    name.className = 'pblock-nav__oname';
    name.textContent = cat ? cat.title || '(未命名)' : `（库里没有「${id}」）`;
    if (!cat) {
      row.title = '这个 id 在分类库里找不到：站点会跳过它（不会因此报错）。要么去库里把它建出来，要么在这儿删掉这个引用。';
    }
    const mini = (label, t, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn--ghost boardedit__mini ${cls}`.trim();
      b.textContent = label;
      b.title = t;
      b.addEventListener('click', fn);
      return b;
    };
    row.append(
      name,
      mini('↑', '往前挪', () => {
        if (i === 0) return;
        [block.cats[i - 1], block.cats[i]] = [block.cats[i], block.cats[i - 1]];
        renderPageEditor();
      }),
      mini('↓', '往后挪', () => {
        if (i === block.cats.length - 1) return;
        [block.cats[i + 1], block.cats[i]] = [block.cats[i], block.cats[i + 1]];
        renderPageEditor();
      }),
      mini('✕', '不在这页用它了（分类本身还在库里，别的页面照用）', () => {
        block.cats.splice(i, 1);
        renderPageEditor();
      })
    );
    orderBox.appendChild(row);
  });
  wrap.appendChild(orderBox);
  return wrap;
}

/** 一个块的字段区 */
function blockFields(block) {
  const wrap = document.createElement('div');
  wrap.className = 'pblock-edit__body';

  if (block.type === 'text') {
    const ta = document.createElement('textarea');
    ta.className = 'input pblock-edit__text';
    ta.rows = 5;
    ta.placeholder = TEXT_HINT;
    ta.value = block.text ?? '';
    ta.addEventListener('input', () => {
      block.text = ta.value;
    });
    wrap.appendChild(ta);

    /*
      文字块是 Markdown，图能直接插进去 —— 一次拖 / 粘多张就一次插多行。
      但它不参与粘贴优先级 ③（countsForPaste: false）：页面里这种文字块常有
      好几个，算进去的话「面板里只有一个上传点」那条就永远不成立，
      打开面板直接粘封面反而找不到地方了。
    */
    attachImageIntake({
      el: ta,
      multiple: true,
      countsForPaste: false,
      label: '文字块',
      title: '也可以直接把图拖进来，或 QQ 截图后 Ctrl+V（一次多张也行）',
      onFiles: async (files) => {
        const lines = [];
        for (const f of files) {
          try {
            const p = await uploadImage(f);
            lines.push(`![${(f.name || '图片').replace(/\.[^.]+$/, '')}](${p})`);
          } catch (err) {
            toast(`上传失败：${err.message}`, true);
          }
        }
        if (!lines.length) return;
        insertIntoTextarea(ta, `\n${lines.join('\n')}\n`);
        toast(`已插入 ${lines.length} 张图片`);
      },
      onUrl: (url) => {
        insertIntoTextarea(ta, `\n![](${url})\n`);
        toast('图片地址已插进去（拖进来的是链接）');
      },
    });

    const hint = document.createElement('p');
    hint.className = 'pblock-edit__hint';
    hint.textContent = TEXT_HINT;
    wrap.appendChild(hint);
    return wrap;
  }

  if (block.type === 'image') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';

    const thumb = document.createElement('span');
    thumb.className = 'boardedit__thumb';
    const paint = () => {
      if (block.src) {
        thumb.style.backgroundImage = `url(${block.src})`;
        thumb.classList.remove('boardedit__thumb--empty');
        thumb.title = block.src;
      } else {
        thumb.style.backgroundImage = '';
        thumb.classList.add('boardedit__thumb--empty');
        thumb.title = '还没选图';
      }
    };
    paint();

    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
    file.hidden = true;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'btn btn--ghost boardedit__mini';
    pick.textContent = '选图片';
    pick.title = '也可以直接把图拖进来，或 QQ 截图后 Ctrl+V';
    pick.addEventListener('click', () => file.click());
    attachImageIntake({
      el: row,
      input: file,
      label: '图片块',
      onFiles: async ([f]) => {
        try {
          block.src = await uploadImage(f);
          paint();
          toast('图片传好了');
        } catch (err) {
          toast(`传图失败：${err.message}`, true);
        }
      },
      onUrl: (url) => {
        block.src = url;
        paint();
        toast('图片地址已填上（拖进来的是链接）');
      },
    });

    const alt = boardInput(block.alt ?? '', '说明文字（可留空）', (v) => {
      block.alt = v;
    });

    const width = pageSelect(IMG_WIDTHS, block.width ?? 'wide', (v) => {
      block.width = v;
    });

    row.append(thumb, pick, alt, width, file);
    wrap.appendChild(row);
    return wrap;
  }

  if (block.type === 'link') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';
    row.append(
      boardInput(block.text ?? '', '链接文字', (v) => {
        block.text = v;
      }),
      // 链接块也能直接指到页面里的某个标题/图片/段落
      withAnchorPick(
        boardInput(block.href ?? '', '地址（站内写 /huaya，站外写 https://…）', (v) => {
          block.href = v.trim();
        })
      )
    );
    wrap.appendChild(row);
    return wrap;
  }

  if (block.type === 'divider') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';
    row.append(
      boardInput(block.text ?? '', '中间那句话（可留空，就是一条线）', (v) => {
        block.text = v;
      })
    );
    wrap.appendChild(row);
    return wrap;
  }

  if (block.type === 'columns') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row pblock-edit__row--cols';
    const cell = (key, label) => {
      const box = document.createElement('label');
      box.className = 'pblock-edit__cell';
      const cap = document.createElement('span');
      cap.className = 'pblock-edit__hint';
      cap.textContent = label;
      const ta = document.createElement('textarea');
      ta.className = 'input pblock-edit__text';
      ta.rows = 4;
      ta.placeholder = TEXT_HINT;
      ta.value = block[key] ?? '';
      ta.addEventListener('input', () => {
        block[key] = ta.value;
      });
      box.append(cap, ta);
      return box;
    };
    row.append(cell('left', '左栏'), cell('right', '右栏'));
    wrap.appendChild(row);
    return wrap;
  }

  if (block.type === 'video') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';
    row.append(
      boardInput(block.src ?? '', '视频地址：/video/x.mp4 或 B 站 / YouTube 链接', (v) => {
        block.src = v.trim();
      }),
      boardInput(block.caption ?? '', '说明文字（可留空）', (v) => {
        block.caption = v;
      })
    );
    const hint = document.createElement('p');
    hint.className = 'pblock-edit__hint';
    hint.textContent = '视频文件（mp4 / webm）直接播；B 站和 YouTube 链接会自动换成播放器。';
    wrap.append(row, hint);
    return wrap;
  }

  if (block.type === 'posts') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';
    row.append(
      boardInput(block.text ?? '', '小标题（可留空，就只有列表）', (v) => {
        block.text = v;
      })
    );
    const hint = document.createElement('p');
    hint.className = 'pblock-edit__hint';
    hint.textContent = '列的是一直归在这一页名下的文章 / 手记。插了这一块，页面底部就不再自动列一遍。';
    wrap.append(row, hint);
    return wrap;
  }

  if (block.type === 'toc') {
    const row = document.createElement('div');
    row.className = 'pblock-edit__row';
    row.append(
      boardInput(block.text ?? '', '目录的标题（可留空，默认就叫「目录」）', (v) => {
        block.text = v;
      })
    );
    const hint = document.createElement('p');
    hint.className = 'pblock-edit__hint';
    hint.textContent =
      '自动把这一页里所有「## 小标题」和「### 子标题」收集成一份带序号的目录，点一条就跳到那里。它自己不产生正文，放在开头最像目录。页面里还没有小标题时，先在上面加个文字块写 ## 标题。';
    wrap.append(row, hint);
    return wrap;
  }

  /*
    导航块：**引用**分类库里的几个大分类，不是把条目拷一份进来。
    页面里存的就是 `cats`（分类 id 的列表，顺序 = 页面上的顺序），
    所以分类内容改了不用动任何页面（保存分类时服务端会重新构建）。
  */
  if (block.type === 'nav') {
    return navBlockFields(block);
  }

  if (block.type === 'map') {
    wrap.appendChild(mapFields(block));
    return wrap;
  }

  // children：把这一层的子页面铺在这里
  const row = document.createElement('div');
  row.className = 'pblock-edit__row';
  const shape = pageSelect(CARD_SHAPES, block.shape ?? 'wide', (v) => {
    block.shape = v;
  });
  const size = pageSelect(CARD_SIZES, block.size ?? 'l', (v) => {
    block.size = v;
  });
  const hint = document.createElement('span');
  hint.className = 'pblock-edit__hint pblock-edit__hint--inline';
  hint.textContent = '整块的默认比例和大小；单张想不一样，在下面「这一页的子版块」里单独设';
  row.append(shape, size, hint);
  wrap.appendChild(row);

  const kids = Array.isArray(pageNode?.children) ? pageNode.children : [];
  if (!kids.length) {
    const none = document.createElement('p');
    none.className = 'pblock-edit__hint';
    none.textContent = '这一页还没有子版块 —— 在下面「这一页的子版块」里加几个，它们就会铺在这里。';
    wrap.appendChild(none);
  }
  return wrap;
}

/* ---------------------------------------------------------------
   内容块的两个「少点几下」：插到指定位置 / 按住拖着换位置

   以前想在中间插一张图，只能点底部「＋ 图片」（永远插到最后），再一路点 ↑
   把它挪上去 —— 内容一多就是几十下。这里补两条路：

   · 每张卡片头上一个「＋」＝「新块插在这一块后面」，点了会在那张卡下面
     画一条落点提示；底部那排「＋ 文字 / ＋ 图片 / …」就插在那个位置。
     没点过「＋」还是老规矩：插到最后。
   · 每张卡片头上一个把手（⠿），按住上下拖就能换位置，拖到列表上下边缘
     会自动滚动，松手落位。

   拖拽用 pointer 事件自己写，**不用 HTML5 拖放**：内容区里"拖图片进来"
   是要上传的（见上面「图片接入口」那一层），两套拖拽共用 dataTransfer
   会打架 —— 从 QQ 拖张图进来可能变成把卡片挪走。所以把手上的事件一律
   stopPropagation，把手之外（输入框、按钮）一个监听都不加：
   在输入框里选字还是选字。
   --------------------------------------------------------------- */

/** 拖到离列表上下边缘这么近就开始自动滚 */
const PAGE_DRAG_EDGE = 48;
/** 自动滚动每帧最多滚这么多像素（贴得越近越快） */
const PAGE_DRAG_SPEED = 18;

/** 新块该插到第几位（splice 的下标）；-1 = 照老规矩插到最后 */
function pageInsertAt() {
  if (!pageInsertAfterId) return -1;
  const i = pageDraft.findIndex((b) => b.id === pageInsertAfterId);
  // 那一块被删了 / 换页了 → 落点作废，退回「插到最后」，绝不插到别人后面去
  return i < 0 ? -1 : i + 1;
}

/** 底部「添加：」那一排旁边那行小字：现在会插到哪儿 */
function pageInsertNote() {
  const at = pageInsertAt();
  if (at < 0) return '点某一段头上的「＋」＝ 新块插在它后面；不点就还是加在最后。';
  const b = pageDraft[at - 1];
  return `将插到第 ${at} 段（${BLOCK_LABEL[b.type] || b.type}）后面；再点一次那个「＋」就改回插到最后。`;
}

/** 换页 / 清空时把落点和拖拽状态一起收掉：上一页的插入点不该漂到下一页 */
function resetPageBlockPlacement() {
  pageInsertAfterId = null;
  pageActiveBlockId = null;
  stopPageBlockDrag();
}

/** 这一块的卡片元素（id 里可能有中文和特殊字符，不拿它拼选择器） */
function pageBlockEl(blockId) {
  return (
    Array.from(els.pageEditor.querySelectorAll('.pblock-edit')).find(
      (b) => b.dataset.blockId === blockId,
    ) || null
  );
}

/** 现在列表里所有卡片（可以排除正在拖的那一张） */
function pageCardEls(exceptId = '') {
  return Array.from(els.pageEditor.querySelectorAll('.pblock-edit')).filter(
    (b) => b.dataset.blockId !== exceptId,
  );
}

/**
 * 把草稿里第 from 块挪到「摘掉自己之后」的第 to 位。返回真的动了没有。
 * 顺序就是页面上的顺序，改完重画一次就完事。
 */
function movePageDraft(from, to) {
  if (from < 0 || from >= pageDraft.length) return false;
  if (!Number.isFinite(to)) return false;
  to = Math.max(0, Math.min(pageDraft.length - 1, to));
  if (to === from) return false;
  const [block] = pageDraft.splice(from, 1);
  pageDraft.splice(to, 0, block);
  return true;
}

/** 新加 / 挪过的那一块滚进视野并闪一下：内容一多，不指一下根本找不着它落在哪儿 */
function revealPageBlock(blockId) {
  const box = pageBlockEl(blockId);
  if (!box) return;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  box.classList.remove('is-new');
  void box.offsetWidth;                 // 强制重排：连插两次也能各闪一遍
  box.classList.add('is-new');
  window.setTimeout(() => box.classList.remove('is-new'), 1200);
}

/** 键盘换位之后把焦点还给同一块的把手：连着按 ↑↑↑ 才顺 */
function focusPageGrip(blockId) {
  const grip = pageBlockEl(blockId)?.querySelector('.pblock-edit__grip');
  if (grip) grip.focus({ preventScroll: true });
  revealPageBlock(blockId);
}

/**
 * 把某一块上移 / 下移一格。卡片头上的 ↑ ↓ 和把手上的方向键都走这里，
 * 所以「换位置」只有一条路径：改草稿 → 标脏 → 重画。
 */
function moveBlockBy(blockId, delta, refocusGrip = false) {
  const from = pageDraft.findIndex((b) => b.id === blockId);
  if (from < 0) return;
  if (!movePageDraft(from, from + delta)) return;
  pageActiveBlockId = blockId;
  markStudioDirty();
  renderPageEditor();
  if (refocusGrip) focusPageGrip(blockId);
  else revealPageBlock(blockId);
}

/**
 * 内容块列表里那个能滚动的祖先：拖到上下边缘时要滚的是它。
 * 页面工作台和独立页面工作台是同一批 DOM 搬来搬去，写死某一层会在另一边滚不动。
 */
function pageEditorScroller() {
  for (let el = els.pageEditor.parentElement; el; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return document.scrollingElement || document.documentElement;
}

/**
 * 指针在 clientY：这块松手会落到第几位。
 * 数的是「指针在多少张卡片的**中线**以下」—— 排除自己，得到的就是摘掉自己
 * 之后那个数组里的下标（0..n），splice 直接用，不用再补正。
 */
function pageDropIndexAt(clientY) {
  const cards = pageCardEls(pageDragId);
  let idx = 0;
  for (const card of cards) {
    const r = card.getBoundingClientRect();
    if (clientY > r.top + r.height / 2) idx += 1;
  }
  return idx;
}

/** 落点线：绝对定位在 #page-editor 里，**不占布局** */
function ensurePageDropLine() {
  if (pageDropLine && pageDropLine.isConnected) return pageDropLine;
  pageDropLine = document.createElement('div');
  pageDropLine.className = 'pblock-dropline';
  pageDropLine.setAttribute('aria-hidden', 'true');
  const tag = document.createElement('span');
  tag.className = 'pblock-dropline__tag';
  pageDropLine.appendChild(tag);
  els.pageEditor.appendChild(pageDropLine);
  return pageDropLine;
}

/**
 * 把落点线画到该在的位置。
 *
 * 线是绝对定位的（不占布局）：要是让它占布局，线一插进去后面的卡片就往下挪，
 * 下一次 pointermove 算出来的落点又跳回去，指示线会在两格之间来回抖。
 */
function paintPageDropLine(clientY) {
  if (!pageDragId) return;
  const cards = pageCardEls(pageDragId);
  const idx = pageDropIndexAt(clientY);
  const box = els.pageEditor.getBoundingClientRect();
  // 有下一张就贴它的上沿，没有就贴最后一张的下沿
  const y = idx < cards.length
    ? cards[idx].getBoundingClientRect().top
    : cards.length
      ? cards[cards.length - 1].getBoundingClientRect().bottom
      : box.bottom;
  const line = ensurePageDropLine();
  line.style.top = `${y - box.top + els.pageEditor.scrollTop}px`;
  const tag = line.querySelector('.pblock-dropline__tag');
  if (tag) tag.textContent = `放到这里（第 ${idx + 1} 位）`;
  pageDropAt = idx;
}

/**
 * 拖到列表上下边缘时自己滚 —— 内容多的时候不滚就永远拖不到头。
 * 用 rAF 循环而不是只在 pointermove 里滚：鼠标顶着边缘不动时也得继续滚。
 */
function pageDragAutoScroll() {
  pageDragRaf = 0;
  if (!pageDragId || !pageDragPointer) return;
  const scroller = pageEditorScroller();
  const isDoc = scroller === document.scrollingElement || scroller === document.documentElement;
  const rect = isDoc
    ? { top: 0, bottom: window.innerHeight }
    : scroller.getBoundingClientRect();
  const y = pageDragPointer.y;
  let dy = 0;
  if (y < rect.top + PAGE_DRAG_EDGE) {
    dy = -Math.ceil(((rect.top + PAGE_DRAG_EDGE - y) / PAGE_DRAG_EDGE) * PAGE_DRAG_SPEED);
  } else if (y > rect.bottom - PAGE_DRAG_EDGE) {
    dy = Math.ceil(((y - (rect.bottom - PAGE_DRAG_EDGE)) / PAGE_DRAG_EDGE) * PAGE_DRAG_SPEED);
  }
  if (dy) {
    const before = scroller.scrollTop;
    scroller.scrollTop = before + dy;
    if (scroller.scrollTop !== before) paintPageDropLine(y);
  }
  pageDragRaf = requestAnimationFrame(pageDragAutoScroll);
}

function onPageDragMove(ev) {
  if (!pageDragId) return;
  ev.preventDefault();
  pageDragPointer = { x: ev.clientX, y: ev.clientY };
  paintPageDropLine(ev.clientY);
}

/** 松手：真把顺序换过来（原地放下不算改动，不标脏） */
function onPageDragEnd(ev) {
  if (!pageDragId) return;
  if (ev.type === 'pointercancel') {
    stopPageBlockDrag();
    return;
  }
  const from = pageDraft.findIndex((b) => b.id === pageDragId);
  const to = pageDropAt;
  stopPageBlockDrag();
  if (from < 0) return;
  if (!movePageDraft(from, to)) return;
  pageActiveBlockId = pageDraft[to].id;
  markStudioDirty();
  renderPageEditor();
  revealPageBlock(pageDraft[to].id);
}

/** 拖到一半按 Esc：当没拖过 */
function onPageDragKey(ev) {
  if (!pageDragId || ev.key !== 'Escape') return;
  ev.stopPropagation();
  stopPageBlockDrag();
}

/** 收尾：线、类名、监听器、rAF 全部还原，松手后不留一点拖拽痕迹 */
function stopPageBlockDrag() {
  if (pageDragRaf) {
    cancelAnimationFrame(pageDragRaf);
    pageDragRaf = 0;
  }
  window.removeEventListener('pointermove', onPageDragMove);
  window.removeEventListener('pointerup', onPageDragEnd);
  window.removeEventListener('pointercancel', onPageDragEnd);
  window.removeEventListener('keydown', onPageDragKey, true);
  for (const el of document.querySelectorAll('.pblock-edit.is-dragging')) {
    el.classList.remove('is-dragging');
  }
  document.body.classList.remove('pblock-dragging');
  if (pageDropLine) {
    pageDropLine.remove();
    pageDropLine = null;
  }
  pageDragId = null;
  pageDragBox = null;
  pageDragPointer = null;
  pageDropAt = -1;
}

/**
 * 按住把手：开始拖。
 * 事件挂在 window 上收尾（不靠 pointer capture）—— 捕获失败、指针划过
 * 右边预览 iframe 之类的情况下，一样收得到 move / up。
 */
function startPageBlockDrag(ev, blockId, box, grip) {
  if (ev.button !== undefined && ev.button !== 0) return;   // 只接左键 / 触摸
  ev.preventDefault();       // 别顺手选中文字、别让浏览器起原生拖放
  ev.stopPropagation();      // 别惊动「图片接入口」那层
  stopPageBlockDrag();       // 上一次没收干净的先收掉
  pageDragId = blockId;
  pageDragBox = box;
  box.classList.add('is-dragging');
  document.body.classList.add('pblock-dragging');
  try {
    grip.setPointerCapture?.(ev.pointerId);
  } catch {
    /* 环境不支持就算了，下面这些监听器挂在 window 上，照样收得到 */
  }
  pageDragPointer = { x: ev.clientX, y: ev.clientY };
  // 顺手把焦点放到把手上（preventDefault 挡掉了浏览器的默认聚焦）：
  // 拖完想接着按 ↑ / ↓ 换位置，不用再 Tab 一圈
  try {
    grip.focus({ preventScroll: true });
  } catch {
    grip.focus();   // 老浏览器不认参数就退回默认
  }
  paintPageDropLine(ev.clientY);
  window.addEventListener('pointermove', onPageDragMove);
  window.addEventListener('pointerup', onPageDragEnd);
  window.addEventListener('pointercancel', onPageDragEnd);
  window.addEventListener('keydown', onPageDragKey, true);
  pageDragRaf = requestAnimationFrame(pageDragAutoScroll);
}

function renderPageEditor() {
  els.pageEditor.textContent = '';

  if (!pageDraft.length) {
    const empty = document.createElement('p');
    empty.className = 'pblock-edit__hint';
    empty.textContent = '还没有内容。写点介绍、传张图，或者把子页面插进来 —— 不写就按老样子自动铺开子版块。';
    els.pageEditor.appendChild(empty);
  }

  pageDraft.forEach((block, i) => {
    const box = document.createElement('div');
    box.className = 'pblock-edit';
    // 拖拽、滚动定位、测试都用它认块（序号会变，块 id 不会）
    box.dataset.blockId = block.id;
    if (block.id === pageActiveBlockId) box.classList.add('is-active');
    if (block.id === pageDragId) box.classList.add('is-dragging');

    const head = document.createElement('div');
    head.className = 'pblock-edit__head';

    // 把手：按住上下拖就能换位置（键盘聚焦后按 ↑ / ↓ 也一样）。
    // 只在这个按钮上收事件 —— 别的控件一个都不劫持。
    const grip = document.createElement('button');
    grip.type = 'button';
    grip.className = 'pblock-edit__grip';
    grip.textContent = '⠿';
    grip.title = '按住上下拖：换这一块的位置（也可以点它，然后按 ↑ / ↓）；拖到列表上下边缘会自动滚';
    grip.setAttribute('aria-label', `拖动第 ${i + 1} 段换位置`);
    grip.addEventListener('pointerdown', (ev) => startPageBlockDrag(ev, block.id, box, grip));
    grip.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      moveBlockBy(block.id, ev.key === 'ArrowUp' ? -1 : 1, true);
    });
    // 点 / 聚焦哪一张卡片＝「当前这一段」：只做高亮，不改落点（见 pageInsertAt）
    box.addEventListener('pointerdown', () => {
      if (pageActiveBlockId === block.id) return;
      pageActiveBlockId = block.id;
      for (const card of pageCardEls()) {
        card.classList.toggle('is-active', card.dataset.blockId === block.id);
      }
    });

    const n = document.createElement('span');
    n.className = 'pblock-edit__n';
    n.textContent = String(i + 1);

    const type = document.createElement('span');
    type.className = 'pblock-edit__type';
    type.textContent = BLOCK_LABEL[block.type] || block.type;

    const idTag = document.createElement('code');
    idTag.className = 'pblock-edit__id';
    idTag.textContent = block.id;
    idTag.title = '排版模式用它当锚点（pg-<id>）';

    const spacer = document.createElement('span');
    spacer.className = 'pblock-edit__spacer';

    // ↑ ↓ 和把手上的方向键走同一条路（moveBlockBy）：改草稿 → 标脏 → 重画
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn--ghost boardedit__mini';
    up.textContent = '↑';
    up.title = '上移';
    up.disabled = i === 0;
    up.addEventListener('click', () => moveBlockBy(block.id, -1));

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn btn--ghost boardedit__mini';
    down.textContent = '↓';
    down.title = '下移';
    down.disabled = i === pageDraft.length - 1;
    down.addEventListener('click', () => moveBlockBy(block.id, 1));

    /*
      「＋」＝新块插在这一块后面。底部那排「＋ 文字 / ＋ 图片 / …」照着这个落点插，
      不用先加到最下面再一路点 ↑。再点一次就取消（改回插到最后）。
    */
    const ins = document.createElement('button');
    ins.type = 'button';
    ins.className = 'btn btn--ghost boardedit__mini pblock-edit__ins';
    ins.textContent = '＋';
    const insOn = block.id === pageInsertAfterId;
    ins.classList.toggle('is-on', insOn);
    ins.setAttribute('aria-pressed', insOn ? 'true' : 'false');
    ins.title = insOn
      ? '新内容就插在这一段后面（再点一次取消，改回插到最后）'
      : '在这一段下面插入新内容：点它，再点底部那排「＋ 文字 / ＋ 图片 / …」';
    ins.addEventListener('click', () => {
      pageActiveBlockId = block.id;
      pageInsertAfterId = insOn ? null : block.id;
      renderPageEditor();
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      pageDraft.splice(i, 1);
      // 落点正好是删掉的那一块：顺位交给顶上来的下一块（没有下一块就退回插到最后）
      if (pageInsertAfterId === block.id) {
        const next = pageDraft[i] || pageDraft[i - 1];
        pageInsertAfterId = next ? next.id : null;
      }
      if (pageActiveBlockId === block.id) pageActiveBlockId = null;
      markStudioDirty();
      renderPageEditor();
    });

    head.append(grip, n, type, idTag, spacer, ins, up, down, del);
    box.appendChild(head);
    box.appendChild(blockFields(block));

    /*
      每个块都可能有「认领的时间点/时间段」—— 滚到这一段内容时，
      右侧时间轴停到对应刻度。挂在 blockFields 外面而不是里面：
      那里面有十种块、各自早期 return，塞进去每一处都得补一遍。
    */
    if (currentTimeline()) {
      const timeRow = document.createElement('div');
      timeRow.className = 'pblock-edit__row pblock-edit__row--time';
      const cap = document.createElement('span');
      cap.className = 'pblock-edit__hint pblock-edit__hint--inline';
      cap.textContent = '对应时间：';
      timeRow.append(
        cap,
        timeSelect(() => readTime(block), (v) => {
          writeTime(block, v);
          markStudioDirty();
        })
      );
      box.appendChild(timeRow);
    }

    els.pageEditor.appendChild(box);

    // 落点提示：明着画在会插进去的那条缝上，一眼看得出新内容会落在哪儿
    if (block.id === pageInsertAfterId) {
      const mark = document.createElement('div');
      mark.className = 'pblock-insmark';
      const tag = document.createElement('span');
      tag.className = 'pblock-insmark__tag';
      tag.textContent = `新内容将插到第 ${i + 1} 段后面`;
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'btn btn--ghost boardedit__mini';
      back.textContent = '改回插到最后';
      back.addEventListener('click', () => {
        pageInsertAfterId = null;
        renderPageEditor();
      });
      mark.append(tag, back);
      els.pageEditor.appendChild(mark);
    }
  });

  // 添加新块
  const addRow = document.createElement('div');
  addRow.className = 'pblock-add';
  const addLabel = document.createElement('span');
  addLabel.className = 'pblock-add__label';
  addLabel.textContent = '添加：';
  addRow.appendChild(addLabel);

  const adders = [
    ['text', '文字', () => ({ id: newBlockId(pageNode.id), type: 'text', text: '' })],
    ['image', '图片', () => ({ id: newBlockId(pageNode.id), type: 'image', src: '', width: 'wide' })],
    ['link', '链接', () => ({ id: newBlockId(pageNode.id), type: 'link', text: '', href: '' })],
    ['children', '子页面', () => ({ id: newBlockId(pageNode.id), type: 'children', shape: 'wide', size: 'l' })],
    ['divider', '分隔线', () => ({ id: newBlockId(pageNode.id), type: 'divider', text: '' })],
    ['columns', '两栏', () => ({ id: newBlockId(pageNode.id), type: 'columns', left: '', right: '' })],
    ['video', '视频', () => ({ id: newBlockId(pageNode.id), type: 'video', src: '', caption: '' })],
    ['posts', '文章', () => ({ id: newBlockId(pageNode.id), type: 'posts', text: '' })],
    ['toc', '目录', () => ({ id: newBlockId(pageNode.id), type: 'toc', text: '' })],
    // 导航：引用分类库里的大分类（页面里只存 id，条目内容在库里）
    ['nav', '导航', () => ({ id: newBlockId(pageNode.id), type: 'nav', cats: [], text: '' })],
    // 地图是分页的，新建时就直接建成分页形状（别再造老那种 src+markers 挂在块上的了）
    ['map', '地图', () => ({ id: newBlockId(pageNode.id), type: 'map', pages: [] })],
  ];
  for (const [, label, make] of adders) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.textContent = `＋ ${label}`;
    btn.addEventListener('click', () => {
      const made = make();
      const at = pageInsertAt();
      // 指定了「插在某段后面」就插在那儿，否则照老规矩插到最后
      if (at < 0) pageDraft.push(made);
      else pageDraft.splice(at, 0, made);
      // 落点跟着往下走一格：连着插两三段都落在同一处后面，顺序才顺
      pageInsertAfterId = made.id;
      pageActiveBlockId = made.id;
      markStudioDirty();
      renderPageEditor();
      revealPageBlock(made.id);
    });
    addRow.appendChild(btn);
  }

  // 这一排现在往哪儿插：没点过某一段头上的「＋」就还是老规矩 —— 加在最后
  const note = document.createElement('span');
  note.className = 'pblock-add__note';
  note.id = 'page-insert-note';
  note.textContent = pageInsertNote();
  addRow.appendChild(note);

  els.pageEditor.appendChild(addRow);
}

/** 把草稿里的块写回节点，顺手丢掉空块（没写字的文字、没选图的图片…） */
function commitPageBlocks() {
  if (!pageNode) return;
  pageDraft = pageDraft.filter((b) => {
    if (b.type === 'text') return String(b.text ?? '').trim();
    if (b.type === 'image') return String(b.src ?? '').trim();
    if (b.type === 'link') return String(b.text ?? '').trim() && String(b.href ?? '').trim();
    // 分隔线、目录、「文章」块和**导航块**本身就有意义
    // （一条线、一份自动生成的目录、一列这一页的文章、一组分类引用），
    // 不因为它们「空」就删掉 —— 导航块尤其不能删：cats 还没勾完就被丢掉，
    // 用户会以为「加了块它自己没了」。
    if (b.type === 'divider' || b.type === 'posts' || b.type === 'toc' || b.type === 'nav') return true;
    if (b.type === 'columns') return String(b.left ?? '').trim() || String(b.right ?? '').trim();
    if (b.type === 'video') return String(b.src ?? '').trim();
    /*
      地图是**分页**的：图片挂在每一页自己的 src 上（b.pages[i].src），
      块自己身上那个 b.src 只属于最早那版「只有一页」的老写法。
      这里以前只看 b.src，于是分页结构的地图一存就整块没了 ——
      纷湖那张地图就是这么丢的。两种形状都得认。
      一页图都没选才算空；选了图，哪怕一个地标都没钉也可以留着。
    */
    if (b.type === 'map') {
      const pages =
        Array.isArray(b.pages) && b.pages.length ? b.pages : String(b.src ?? '').trim() ? [{ src: b.src }] : [];
      return pages.some((pg) => String(pg?.src ?? '').trim());
    }
    return true;
  });
  pageNode.page = pageDraft;
}

/**
 * 版块封面图：缩略图 + 上传 + 去掉。
 *
 * 图传到 public/img/uploads/ 下，路径写进节点的 image 字段
 * （服务端 cleanNode 会原样保留）。页面上这张图就是卡片左边那格；
 * 没设的话用渐变兜底，不会是块空白。
 */
/**
 * 图片控件：缩略图 + 选图 + 去掉。
 *
 * 图传到 public/img/uploads/ 下，路径写进节点的 `image` 字段
 * （服务端 cleanNode / cleanNavs 都会原样保留）。页面上这张图就是卡片左边那格；
 * 没设的话用渐变兜底，不会是块空白。
 *
 * `opts` 只改文案：导航条目那边叫「图标」，版块 / 页面那边叫「封面图」，
 * 逻辑是同一套，就不用写第二份了。
 */
function boardCoverControl(node, onChange = renderBoardsEditor, opts = {}) {
  const label = {
    pick: '封面图',
    pickTitle: '给这个版块选一张封面（页面上卡片左边那张图）',
    empty: '还没有封面图',
    clear: '去掉图',
    ...opts,
  };
  const wrap = document.createElement('span');
  wrap.className = 'boardedit__cover';

  const thumb = document.createElement('span');
  thumb.className = 'boardedit__thumb';
  if (node.image) {
    thumb.style.backgroundImage = `url(${node.image})`;
    thumb.title = node.image;
  } else {
    thumb.classList.add('boardedit__thumb--empty');
    thumb.title = label.empty;
  }

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  file.hidden = true;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn btn--ghost boardedit__mini';
  pick.textContent = node.image ? (label.pick === '图标' ? '换图标' : '换图') : label.pick;
  pick.title = `${label.pickTitle}；也可以直接把图拖进来，或 QQ 截图后 Ctrl+V`;
  pick.addEventListener('click', () => file.click());

  attachImageIntake({
    el: wrap,
    input: file,
    label: label.pick,
    onFiles: async ([f]) => {
      try {
        node.image = await uploadImage(f);
        onChange();
        toast(`${label.pick}传好了，记得保存`);
      } catch (err) {
        toast(`传图失败：${err.message}`, true);
      }
    },
    onUrl: (url) => {
      node.image = url;
      onChange();
      toast(`${label.pick}地址已填上，记得保存（拖进来的是链接）`);
    },
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn--ghost boardedit__mini';
  clear.textContent = label.clear;
  clear.hidden = !node.image;
  clear.addEventListener('click', () => {
    delete node.image;
    onChange();
  });

  wrap.append(thumb, pick, clear, file);
  return wrap;
}

function renderBoardsEditor() {
  els.boardsEditor.textContent = '';
  const idx = indexBoardNodes();

  /**
   * 「移动到…」下拉：选一个大板块，或选一个别的版块，把这一项挂过去。
   * 移动只改父子关系，**不改 id** —— 文章 frontmatter 里的 subs 存的是 id，
   * 换 id 等于把归类关系全切断。
   */
  const moveSelect = (node) => {
    const sel = document.createElement('select');
    sel.className = 'input boardedit__move';
    sel.title = '把这一项挂到别的地方去';

    const head = document.createElement('option');
    head.value = '';
    head.textContent = '移动到…';
    sel.appendChild(head);

    const topGroup = document.createElement('optgroup');
    topGroup.label = '大板块下';
    for (const b of boardsDraft.boards) {
      if (b === node || isSelfOrDescendant(node, b)) continue;
      const o = document.createElement('option');
      o.value = b.__k;
      o.textContent = b.title || '(未命名大板块)';
      topGroup.appendChild(o);
    }
    sel.appendChild(topGroup);

    const subGroup = document.createElement('optgroup');
    subGroup.label = '某个版块下';
    for (const [key, other] of idx.byKey) {
      if (!key.startsWith('k')) continue; // 顶层大板块上面已经列过
      if (isSelfOrDescendant(node, other)) continue;
      // 挂到链接版块下面是挂到空气里：它是叶子，下面的东西不会渲染
      if (other.link) continue;
      const info = idx.home.get(key);
      const o = document.createElement('option');
      o.value = key;
      o.textContent = `${'　'.repeat(info.depth)}${other.title || '(未命名)'}`;
      subGroup.appendChild(o);
    }
    if (subGroup.children.length) sel.appendChild(subGroup);

    sel.addEventListener('change', () => {
      const target = idx.byKey.get(sel.value);
      if (!target || target === node) return;
      const mine = idx.home.get(node.__k);
      if (!mine) return;
      mine.list.splice(mine.index, 1);
      target.children.push(node);
      renderBoardsEditor();
      toast(`已把「${node.title || '未命名'}」移过去，记得保存`);
    });

    return sel;
  };

  /**
   * 版式下拉：竖排（默认）/ 三列分区。
   *
   * 以前这个字段编辑器里没有开关，只能在 JSON 里手改 ——
   * 用户想给哪个页面试三列分区都做不到，而 cleanNode 又必须原样保留它，
   * 不然一保存就静默退回竖排。
   */
  const layoutSelect = (node) => {
    const sel = pageSelect(LAYOUTS, node.layout ?? '', (v) => {
      if (v) node.layout = v;
      else delete node.layout;
      toast('版式改好了，记得保存');
    });
    sel.title = LAYOUT_HINT;
    sel.classList.add('boardedit__layout');
    return sel;
  };

  // 递归渲染一层
  const renderLevel = (list, container, depth) => {
    for (let i = 0; i < list.length; i += 1) {
      const node = list[i];
      if (!node.children) node.children = [];

      const box = document.createElement('div');
      box.className = 'boardnode';
      box.style.marginLeft = depth === 0 ? '0' : '16px';

      const row = document.createElement('div');
      row.className = 'boardedit__row';

      const title = boardInput(node.title || node.label || '', '名称', (v) => {
        node.title = v;
      });

      const href = boardInput(node.href || '', '地址（留空 = 自动生成页面）', (v) => {
        node.href = v.trim();
      });

      /*
        链接版块：填了地址这一项就不再是页面，点它是跳走。
        放在这一行最后，空着就是普通子版块。
      */
      const link = boardInput(node.link || '', '链接（填了就跳走，不是页面）', (v) => {
        const s = v.trim();
        if (s) node.link = s;
        else delete node.link;
      });
      link.type = 'url';
      link.classList.add('boardedit__link');
      link.title = '填了它就变成链接版块：卡片照旧有名字和封面图，但点下去打开这个网址，站里不再为它生成页面';

      /*
        上方那行位置链接（面包屑）点它去哪 —— 留空 = 回它自己那一页。
        放在第二行（和版式、封面一排），因为这属于「这一项怎么被点到」，不是名字 / 地址。
      */
      const crumb = boardInput(node.crumbHref || '', '上方位置链接（留空 = 回它自己那页）', (v) => {
        const s = v.trim();
        if (s) node.crumbHref = s;
        else delete node.crumbHref;
      });
      crumb.classList.add('boardedit__crumb');
      crumb.title = '子页面正文上方那行「… › 纷湖 › 当前页」里点到这一项时去哪；hero 里那个「← 返回」也跟着变';

      // 加下级：这是「一层里能再加更多层」的入口
      const addKid = document.createElement('button');
      addKid.type = 'button';
      addKid.className = 'btn btn--ghost boardedit__mini';
      addKid.textContent = '＋下级';
      // 链接版块是叶子：它没有页面，挂在它下面的东西不会出现在站里
      addKid.disabled = !!node.link;
      addKid.title = node.link
        ? '链接版块点了就跳走，它下面不能再挂东西'
        : '在这个版块下面再加一层';
      addKid.addEventListener('click', () => {
        if (!node.children) node.children = [];
        node.children.push({ title: '' });
        renderBoardsEditor();
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--ghost boardedit__mini boardedit__del';
      del.textContent = '删除';
      del.title = node.children.length ? '会连同下面的子版块一起删掉' : '删除这一项';
      del.addEventListener('click', () => {
        if (node.children.length
          && !confirm(`「${node.title || '这一项'}」下面还有 ${node.children.length} 个子版块，一起删掉吗？`)) {
          return;
        }
        list.splice(i, 1);
        renderBoardsEditor();
      });

      row.append(title, href, link, addKid, del);
      box.appendChild(row);

      // 第二行：id（只读，改了会切断文章归类）+ 移动到哪个版块下
      const meta = document.createElement('div');
      meta.className = 'boardedit__row2';
      if (node.id) {
        const idLine = document.createElement('span');
        idLine.className = 'boardnode__id';
        idLine.textContent = node.id;
        idLine.title = '文章归类用的标识，换父级也不会变，别手改';
        meta.appendChild(idLine);
      }
      meta.appendChild(moveSelect(node));
      meta.appendChild(layoutSelect(node));
      meta.appendChild(boardCoverControl(node));
      meta.appendChild(crumb);

      // 页面内容：直接开工作台（那里能整页地改，还带预览）
      const content = document.createElement('button');
      content.type = 'button';
      content.className = 'btn btn--ghost boardedit__mini';
      content.textContent = (node.page ?? []).length ? `改这一页（${node.page.length} 块）` : '改这一页';
      content.title = '写这一页的介绍文字、插图片、插子页面；右边直接看效果';
      content.addEventListener('click', () => openPagesView(node));
      meta.appendChild(content);

      box.appendChild(meta);

      container.appendChild(box);

      if (node.children.length) {
        const kids = document.createElement('div');
        kids.className = 'boardnode__kids';
        container.appendChild(kids);
        renderLevel(node.children, kids, depth + 1);
      }
    }
  };

  for (const board of boardsDraft.boards) {
    if (!board.children) board.children = [];

    const box = document.createElement('div');
    box.className = 'boardedit';

    const head = document.createElement('div');
    head.className = 'boardedit__head';
    // 独立页面也在这份数据里（顶层节点），但别让人以为它是「大板块」
    head.textContent = board.standalone === true ? `独立页面　${board.id}` : `大板块　${board.id}`;
    box.appendChild(head);

    // 大板块自己的三个字段。以前这里只显示一行只读文字，名字和地址都改不了。
    const top = document.createElement('div');
    top.className = 'boardedit__top';
    top.append(
      boardInput(board.title || '', '大板块名称', (v) => {
        board.title = v;
      }),
      boardInput(board.subtitle || '', '副标题（首页卡片上那行小字）', (v) => {
        board.subtitle = v;
      }),
      boardInput(board.href || '', '地址（留空 = 按 id 自动生成）', (v) => {
        board.href = v.trim();
      })
    );
    box.appendChild(top);

    // 大板块也有封面图（首页那两张卡片用的就是它），单独一行放缩略图和按钮
    const topCover = document.createElement('div');
    topCover.className = 'boardedit__row2';
    topCover.appendChild(boardCoverControl(board));
    topCover.appendChild(layoutSelect(board));

    const topContent = document.createElement('button');
    topContent.type = 'button';
    topContent.className = 'btn btn--ghost boardedit__mini';
    topContent.textContent = (board.page ?? []).length ? `改这一页（${board.page.length} 块）` : '改这一页';
    topContent.title = '写这一页的介绍文字、插图片、插子页面；右边直接看效果';
    topContent.addEventListener('click', () => openPagesView(board));
    topCover.appendChild(topContent);
    box.appendChild(topCover);

    const list = document.createElement('div');
    box.appendChild(list);
    renderLevel(board.children, list, 0);

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--ghost boardedit__add';
    add.textContent = '＋ 添加一级版块';
    add.addEventListener('click', () => {
      board.children.push({ title: '' });
      renderBoardsEditor();
    });
    box.appendChild(add);

    els.boardsEditor.appendChild(box);
  }
}

/**
 * 把整棵版块树写进 home-boards.json。
 *
 * 工作台（页面）和「子版块」弹窗都走这里 —— 数据只有一份草稿，
 * 谁先保存都会把对方的改动一起带上，不会各存一份互相覆盖。
 * silent = true 时不弹 toast、不关「子版块」弹窗（工作台自己管提示）。
 */
/* ---------------------------------------------------------------
   时间轴

   独立的一份数据（src/data/timelines.json），和版块树并列：
   一条轴可以被好几个页面共用，所以不能塞进树里 —— 塞进去就得靠 id
   到处引用，树一改就断。

   页面工作台里给「这一页用哪条轴」选一条，再给各个成分认领
   时间点或时间段；这里负责把轴本身做出来。
   --------------------------------------------------------------- */

/** 草稿：{ timelines: [...] }。编辑器里读改存都走它，保存时整份写回 */
let timelinesDraft = null;
/** 当前在看第几条轴 */
let tlIndex = 0;
/**
 * 「难考据」的时间点 → 表单里那个位置读数（含数字微调框）的刷新函数。
 * 预览里拖着塔吊改位置时，左边那一行得跟着变 —— 但表单和预览是分开画的，
 * 所以用一个表把刷新函数挂上来（每次重建表单时清空）。
 */
const tlFuzzyReadouts = new Map();
/**
 * 时间点 id → 它切到「难考据」之前填的那个日期（可能是哨兵 `today`）。
 *
 * 难考据的点**没有日期**，切过去时数据里的 `date` 要删掉；
 * 但用户之前填的那个日期不能就这么没了 —— 切回「时刻 / 事件」时
 * 原样还给他，不然就是白填一遍。
 */
const tlDateMemo = new Map();
/**
 * 表单里「默认比例尺」那一格的**读数**刷新函数。
 * 它显示的是「一刻度 ≈ N 天 · 整条轴约几格 · 建议值」，
 * 而这几样都跟跨度有关 —— 用户改了日期、加了点，读数也得跟着变，
 * 但那时候表单不会重建，所以把刷新函数挂在这儿，由 `scheduleTlPreview` 顺手调一下。
 * 只刷读数字，**不碰输入框里的字**（免得跟正在打字的人打架）。
 */
let tlScaleHintSync = null;

async function loadTimelines() {
  if (timelinesDraft) return timelinesDraft;
  const res = await fetch('/api/timelines');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  timelinesDraft = await res.json();
  if (!Array.isArray(timelinesDraft.timelines)) timelinesDraft.timelines = [];
  return timelinesDraft;
}

async function openTimelinesModal() {
  markWorkspaceActive('timelines');
  els.tlEditor.textContent = '正在读取…';
  els.tlModal.hidden = false;
  try {
    // loadTimelines 有缓存：已经有草稿就直接用内存里那份，不重读、不冲掉没保存的改动
    await loadTimelines();
    if (tlIndex >= timelinesDraft.timelines.length) tlIndex = 0;
    renderTimelineEditor();
  } catch (err) {
    els.tlEditor.textContent = `读取失败：${err.message}`;
  }
}

function closeTimelinesModal() {
  els.tlModal.hidden = true;
}

/** 新时间轴的 id：不用标题当 id（改名就断），直接给一个短的 */
const newTimelineId = () => `tl-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

/**
 * 「对应时间」那个下拉。
 *
 * 值用 `p:<id>` / `s:<id>` 前缀区分时间点和时间段 ——
 * 两边 id 各自独立，不加前缀就可能撞上。
 */
function timeSelect(get, set) {
  const tl = currentTimeline();
  const sel = document.createElement('select');
  sel.className = 'input';

  const none = document.createElement('option');
  none.value = '';
  none.textContent = tl ? '（不指定）' : '（这一页还没选时间轴）';
  sel.appendChild(none);

  if (tl) {
    if (tl.points.length) {
      const g = document.createElement('optgroup');
      g.label = '时间点';
      // 难考据的点没有日期，排到最后（它们的时间先后是看不出来的）
      const byDate = (a, b) => {
        const fa = tlPointKind(a) === 'fuzzy' ? 1 : 0;
        const fb = tlPointKind(b) === 'fuzzy' ? 1 : 0;
        if (fa !== fb) return fa - fb;
        return String(a.date ?? '').localeCompare(String(b.date ?? ''));
      };
      for (const p of [...tl.points].sort(byDate)) {
        const o = document.createElement('option');
        o.value = `p:${p.id}`;
        o.textContent = `${tlDateText(p)}　${p.label}`;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
    if (tl.spans.length) {
      const g = document.createElement('optgroup');
      g.label = '时间段';
      for (const s of tl.spans) {
        const o = document.createElement('option');
        o.value = `s:${s.id}`;
        o.textContent = s.name;
        g.appendChild(o);
      }
      sel.appendChild(g);
    }
  }

  sel.value = get();
  sel.addEventListener('change', () => set(sel.value));
  return sel;
}

/** 把一个成分（块/节点）上认领的时间读成下拉的值 */
const readTime = (target) =>
  target?.timeSpan ? `s:${target.timeSpan}` : target?.timePoint ? `p:${target.timePoint}` : '';

/** 下拉的值写回成分 */
function writeTime(target, value) {
  if (!target) return;
  delete target.timePoint;
  delete target.timeSpan;
  if (value.startsWith('p:')) target.timePoint = value.slice(2);
  else if (value.startsWith('s:')) target.timeSpan = value.slice(2);
}

/** 页面工作台当前那一页用的时间轴（没选就没有） */
function currentTimeline() {
  const id = studioNode?.timeline || pageNode?.timeline;
  if (!id || !timelinesDraft) return null;
  return timelinesDraft.timelines.find((t) => t.id === id) ?? null;
}

/* ---------------------------------------------------------------
   日期输入

   原来只有一个 <input type="date">：想填日期就得点开日历一层层翻，
   一条轴十个时间点就要翻十次，很烦。改成「打字为主、日历为辅」：
   一个能直接敲数字的文本框 + 右边一个开日历的小按钮。
--------------------------------------------------------------- */

/** 全角数字 → 半角（中文输入法下很容易敲出全角） */
const toHalfWidthDigits = (s) => String(s ?? '').replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/**
 * 把用户敲进来的各种写法读成 `yyyy-mm-dd`。
 *
 * 认这些：`20230110` / `2023-01-10` / `2023-1-10` / `2023/1/10` /
 * `2023.1.10` / `2023年1月10日`，全角数字也认。
 * 读不出来（或者日子根本不存在，比如 2023-02-30）返回空串 ——
 * 调用方据此把框标红，而不是悄悄存一个坏日期进去。
 */
function parseDateText(raw) {
  const s = toHalfWidthDigits(raw)
    .replace(/[年月]/g, '-')
    .replace(/日/g, '')
    .replace(/[./\\\s]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .trim();

  let y;
  let m;
  let d;
  const parts = s.split('-').filter((x) => x !== '');
  if (parts.length === 3) {
    [y, m, d] = parts;
  } else if (parts.length === 1) {
    // 没有分隔符就按 yyyymmdd 读
    const digits = parts[0].replace(/\D/g, '');
    if (digits.length !== 8) return '';
    y = digits.slice(0, 4);
    m = digits.slice(4, 6);
    d = digits.slice(6, 8);
  } else {
    // 两段或四段以上（2023-1、2023-1-1-1）都不认，免得瞎猜
    return '';
  }
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return '';

  const yi = Number(y);
  const mi = Number(m);
  const di = Number(d);
  // 2023-02-30 这种「格式对但日子不存在」的会被 Date 顺延到下个月，
  // 存回去再读出来比一比就知道有没有这回事
  const dt = new Date(Date.UTC(yi, mi - 1, di));
  if (dt.getUTCFullYear() !== yi || dt.getUTCMonth() !== mi - 1 || dt.getUTCDate() !== di) return '';

  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(mi)}-${p(di)}`;
}

/** 边打边补横杠：2023 → 2023-0 → 2023-01-1 → 2023-01-10 */
function formatDateAsYouType(raw) {
  const digits = toHalfWidthDigits(raw).replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 4) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

/** 今天的 `yyyy-mm-dd`（本地日期）—— 把「实时」关掉时用它兜底 */
function isoToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 日期控件：左边能直接打数字，右边那个 📅 把系统日历叫出来，
 * 再右边一个「实时」开关（`opts.live` / `opts.onLive`）。
 * 几边改的是同一个值，`onInput` 只在拿到合法日期（或清空）时才回调。
 *
 * 「实时」打开时，这个点存的是哨兵 `today`（不是某个具体日期）：页面上永远显示今天、
 * 每天跟着变。所以活着的这段时间里日期框是禁用的，只留一个「每天自动（今天）」的占位。
 * 关掉时把**之前填过的那个日期**还给他；要是本来就没填过，就用今天兜底 ——
 * 否则这个点会变成「没有日期」，存盘时会被服务端丢掉。
 *
 * `opts.onReady({ set })` 会把一个「从外面写值」的口子交出来：
 * 时间点切成「难以考据」时整个日期控件被收起来，切回来时得把之前那个日期
 * 原样塞回去（连「实时」开关的状态一起），光改 input.value 是对不上的。
 */
function dateField(value, onInput, opts = {}) {
  const live = opts.live === true;
  const wrap = document.createElement('span');
  wrap.className = 'datefield';

  const el = document.createElement('input');
  el.type = 'text';
  el.inputMode = 'numeric';
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.className = 'input datefield__text';
  el.placeholder = live ? '每天自动（今天）' : '20230110';
  el.value = live ? '' : (value ?? '');
  el.disabled = live;
  el.title = live
    ? '这个点是「实时」的：永远显示今天，每天自动变。点右边的「实时」关掉它。'
    : '直接敲数字就行：20230110，或者 2023-1-10 / 2023/1/10。右边按钮开日历。';
  let lastLen = el.value.length;
  /** 切到「实时」之前填的那个日期，切回来时还给他 */
  let lastDate = live ? '' : String(value ?? '');

  el.addEventListener('input', () => {
    const raw = el.value;
    /*
      粘贴进来的整条日期（2023/1/10、2023年1月10日…）先直接认下来，
      别丢给下面的「按数字重排」—— 那会把 1 和 10 粘成 110。
      一个一个敲的情况下这里认不出来，自然落到下面的分支。
    */
    if (/[./\\年月日]/.test(raw)) {
      const iso = parseDateText(raw);
      if (iso) {
        el.value = iso;
        lastLen = iso.length;
        el.classList.remove('is-bad');
        onInput(iso);
        return;
      }
    }
    /*
      只有「越打越长」的时候才自动补横杠。退格时别自作聪明，
      否则删掉「2023-0」里那个 0 会连横杠一起吃，手感很别扭。
    */
    const next = raw.length >= lastLen ? formatDateAsYouType(raw) : raw.replace(/[^\d-]/g, '');
    lastLen = next.length;
    if (next !== raw) el.value = next;
    el.classList.remove('is-bad');
  });

  /** 把框里的字落成数据；读不出来就标红、不写 */
  const commit = () => {
    const raw = el.value.trim();
    if (!raw) {
      el.classList.remove('is-bad');
      onInput('');
      return;
    }
    const iso = parseDateText(raw);
    if (!iso) {
      el.classList.add('is-bad');
      el.title = `「${raw}」读不出日期。写成 20230110 或 2023-01-10 都行。`;
      return;
    }
    el.classList.remove('is-bad');
    el.value = iso;
    lastLen = iso.length;
    onInput(iso);
  };

  el.addEventListener('change', commit);
  el.addEventListener('blur', commit);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    }
  });

  /*
    隐藏的原生日期输入：日历挑完把值抄回文本框。
    不能用 display:none —— showPicker() 要求元素「正在被渲染」，
    藏起来会直接抛错。所以让它 1×1、opacity 0 地待在这儿。
  */
  const cal = document.createElement('input');
  cal.type = 'date';
  cal.className = 'datefield__cal';
  cal.tabIndex = -1;
  cal.setAttribute('aria-hidden', 'true');
  cal.value = value ?? '';
  cal.addEventListener('change', () => {
    el.value = cal.value;
    lastLen = el.value.length;
    el.classList.remove('is-bad');
    onInput(cal.value);
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'datefield__btn';
  btn.textContent = '📅';
  btn.title = '打开日历挑日期';
  btn.disabled = live;
  btn.addEventListener('click', () => {
    cal.value = el.value;
    if (typeof cal.showPicker === 'function') {
      try {
        cal.showPicker();
        return;
      } catch {
        /* 有些情况下浏览器不让直接开（比如不是用户手势），退回下面那条 */
      }
    }
    cal.focus();
    cal.click();
  });

  /*
    「实时」开关。打开之后这个点存的是哨兵 `today`：
    页面上永远显示今天、每天自动变（打开页面时脚本按访问者当天重排整条轴）。
    ⚠ `opts.hideLive`：日历/精华那种"就是一个固定日期"的地方不该出现这个开关，
    所以那两处只借这个控件"直接打数字"的那半边（见下面的 dayPicker）。
  */
  const liveBtn = opts.hideLive ? null : document.createElement('button');
  if (liveBtn) {
    liveBtn.type = 'button';
    liveBtn.className = 'datefield__live';
    liveBtn.textContent = '实时';
    liveBtn.setAttribute('aria-pressed', live ? 'true' : 'false');
    liveBtn.title = live
      ? '现在是实时的（永远显示今天、每天自动变）。点一下改回固定日期。'
      : '设为实时更新：这一个永远显示今天，每天自动变。';
    liveBtn.addEventListener('click', () => {
      const next = liveBtn.getAttribute('aria-pressed') !== 'true';
      liveBtn.setAttribute('aria-pressed', next ? 'true' : 'false');
      el.disabled = next;
      btn.disabled = next;
      if (next) {
        lastDate = el.value.trim();
        el.value = '';
        el.placeholder = '每天自动（今天）';
        el.classList.remove('is-bad');
        opts.onLive?.(true, '');
        liveBtn.title = '现在是实时的（永远显示今天、每天自动变）。点一下改回固定日期。';
      } else {
        // 还给他之前填的那个日期；没填过就用今天兜底，免得这个点变成「没有日期」被丢掉
        const back = /^\d{4}-\d{2}-\d{2}$/.test(lastDate) ? lastDate : isoToday();
        el.value = back;
        lastLen = back.length;
        el.placeholder = '20230110';
        opts.onLive?.(false, back);
        liveBtn.title = '设为实时更新：这一个永远显示今天，每天自动变。';
      }
    });
  }

  /*
    给外面一个「从别处写值」的口子（时间点那边切类型时要用）：
    切成「难以考据」时日期框被收起来，切回来得把之前那个日期塞回去 ——
    直接改 el.value 是不行的，「实时」开关的状态、内部的 lastDate 都会对不上。
  */
  opts.onReady?.({
    /** 塞一个日期（或 `today` 哨兵）进去，框里的字和「实时」开关一起同步 */
    set(next) {
      const on = String(next ?? '').trim() === 'today';
      if (liveBtn) liveBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      el.disabled = on;
      btn.disabled = on;
      el.classList.remove('is-bad');
      if (on) {
        lastDate = '';
        el.value = '';
        el.placeholder = '每天自动（今天）';
      } else {
        lastDate = String(next ?? '');
        el.value = lastDate;
        lastLen = lastDate.length;
        el.placeholder = '20230110';
        cal.value = /^\d{4}-\d{2}-\d{2}$/.test(lastDate) ? lastDate : '';
      }
    },
  });

  wrap.append(el, btn, ...(liveBtn ? [liveBtn] : []), cal);
  return wrap;
}

/* ---------------------------------------------------------------
   锚点（跳到页面里的具体位置）

   站点构建时会导出 `dist/anchors.json`：每个页面里能跳到的位置 —— 标题
   （id 就是标题文字，中文原样）、每个内容块（id = blk-<块id>）。
   编辑器里所有填链接的地方都挂一个「选位置…」按钮，选中之后把 href 拼成
   `/页面路径/#锚点id`，省得手打中文 id。

   清单是**构建产物**，所以刚改过页面内容、还没重新构建时它是旧的 ——
   面板里明说了这一点，读不到也只是一句提示（不是报错）。
   --------------------------------------------------------------- */

/** 锚点清单缓存（面板上有「刷新清单」） */
let anchorsCache = null;

async function loadAnchors({ force = false } = {}) {
  if (anchorsCache && !force) return anchorsCache;
  const res = await fetch('/api/anchors', { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  anchorsCache = await res.json();
  return anchorsCache;
}

/**
 * 「选位置…」那个小按钮。
 * `getValue()` 拿当前值（用来预选），`apply(href)` 把选中的地址写回去
 * （清空时给空串）。
 */
function anchorPickButton(getValue, apply) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn--ghost boardedit__mini anchorpick__open';
  btn.textContent = '选位置…';
  btn.title = '选一个页面里的标题 / 图片 / 段落，自动拼成「/页面/#锚点」；清单来自上次构建';
  btn.addEventListener('click', (ev) => {
    ev.preventDefault();
    openAnchorPicker({ current: typeof getValue === 'function' ? getValue() : '', onPick: apply });
  });
  return btn;
}

/** 把「输入框 + 选位置按钮」包成一行 */
function withAnchorPick(input) {
  const wrap = document.createElement('span');
  wrap.className = 'linkpick';
  const btn = anchorPickButton(
    () => input.value,
    (href) => {
      input.value = href;
      // 走一遍输入框自己的事件：各处的 onInput / 校验都会跟着跑
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
    }
  );
  wrap.append(input, btn);
  return wrap;
}

let anchorPickerBusy = false;

/** 那个「先选页面、再选位置」的面板 */
async function openAnchorPicker({ current = '', onPick } = {}) {
  if (anchorPickerBusy) return;
  anchorPickerBusy = true;
  document.querySelector('.anchorpick')?.remove();

  const mask = document.createElement('div');
  mask.className = 'anchorpick';
  const panel = document.createElement('div');
  panel.className = 'anchorpick__panel';
  mask.appendChild(panel);
  document.body.appendChild(mask);

  const close = () => {
    mask.remove();
    anchorPickerBusy = false;
  };
  mask.addEventListener('click', (ev) => {
    if (ev.target === mask) close();
  });

  const head = document.createElement('div');
  head.className = 'anchorpick__head';
  const title = document.createElement('h4');
  title.className = 'anchorpick__title';
  title.textContent = '选页面里的位置';
  const mkBtn = (text, t, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn--ghost boardedit__mini';
    b.textContent = text;
    b.title = t;
    b.addEventListener('click', fn);
    return b;
  };
  const refresh = mkBtn('刷新清单', '重新读一次 dist/anchors.json（刚重新构建过就点它）', () => load(true));
  const clear = mkBtn('清空链接', '把这个链接清空', () => {
    onPick?.('');
    close();
  });
  const shut = mkBtn('关闭', '关掉这个面板', close);
  head.append(title, refresh, clear, shut);
  panel.appendChild(head);

  const note = document.createElement('p');
  note.className = 'hint anchorpick__note';
  panel.appendChild(note);

  const body = document.createElement('div');
  body.className = 'anchorpick__body';
  const left = document.createElement('div');
  left.className = 'anchorpick__col';
  const right = document.createElement('div');
  right.className = 'anchorpick__col';
  body.append(left, right);
  panel.appendChild(body);

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input input--sm';
  search.placeholder = '找页面…';
  search.autocomplete = 'off';
  left.appendChild(search);
  const pageList = document.createElement('div');
  pageList.className = 'anchorpick__list';
  left.appendChild(pageList);

  const rightCap = document.createElement('p');
  rightCap.className = 'anchorpick__sub';
  rightCap.textContent = '左边先选一个页面';
  right.appendChild(rightCap);
  const anchorList = document.createElement('div');
  anchorList.className = 'anchorpick__list';
  right.appendChild(anchorList);

  /** 这一页的锚点列出来，点一个就拼好地址 */
  const showAnchors = (page, preselectId = '') => {
    anchorList.textContent = '';
    rightCap.textContent = page ? `${page.title || '(没标题)'}　${page.href}` : '左边先选一个页面';
    if (!page) return;
    const anchors = Array.isArray(page.anchors) ? page.anchors : [];
    if (!anchors.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '这一页里没有能跳的位置（标题和内容块都会出现在这儿）。';
      anchorList.appendChild(p);
      return;
    }
    for (const a of anchors) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'anchorpick__item' + (a.id === preselectId ? ' is-active' : '');
      item.dataset.anchorId = a.id;
      const text = document.createElement('span');
      text.className = 'anchorpick__text';
      const label = String(a.text ?? '').trim();
      text.textContent = label || (a.kind === 'image' ? '（图片）' : `（${a.kind || '块'}）`);
      const kind = document.createElement('em');
      kind.className = 'anchorpick__kind';
      kind.textContent = a.kind || '';
      item.append(text, kind);
      item.title = `${page.href}#${a.id}`;
      item.addEventListener('click', () => {
        onPick?.(`${page.href}#${a.id}`);
        close();
      });
      anchorList.appendChild(item);
    }
  };

  const showPages = (pages, preselect = current) => {
    pageList.textContent = '';
    if (!pages.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '清单里没有页面。';
      pageList.appendChild(p);
      showAnchors(null);
      return;
    }
    let hitBtn = null;
    let hitPage = null;
    let hitAnchor = '';
    for (const page of pages) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'anchorpick__page';
      btn.dataset.href = page.href;
      const t = document.createElement('span');
      t.className = 'anchorpick__ptitle';
      t.textContent = page.title || page.href;
      const u = document.createElement('em');
      u.className = 'anchorpick__phref';
      u.textContent = `${page.href} · ${Array.isArray(page.anchors) ? page.anchors.length : 0} 处`;
      btn.append(t, u);
      // 当前地址已经指到这一页（可能还带 #锚点）就预选上
      const cur = String(preselect ?? '');
      const [curPath, curHash] = cur.split('#');
      if (
        !hitBtn &&
        curPath &&
        (curPath === page.href || `${curPath}/` === page.href || curPath === String(page.href).replace(/\/$/, ''))
      ) {
        hitBtn = btn;
        hitPage = page;
        hitAnchor = curHash || '';
      }
      btn.addEventListener('click', () => {
        for (const other of pageList.querySelectorAll('.anchorpick__page')) other.classList.toggle('is-active', other === btn);
        showAnchors(page);
      });
      pageList.appendChild(btn);
    }
    const first = pageList.querySelector('.anchorpick__page');
    (hitBtn || first)?.classList.add('is-active');
    showAnchors(hitPage || pages[0], hitAnchor);
  };

  const load = async (force) => {
    note.textContent = '正在读取锚点清单…';
    try {
      const data = await loadAnchors({ force });
      note.textContent =
        data.note ||
        '清单来自上次构建（dist/anchors.json）：刚改过页面内容的话，先「保存并重新构建」再来选。';
      showPages(Array.isArray(data.pages) ? data.pages : []);
    } catch (err) {
      note.textContent = `读不到锚点清单：${err.message}`;
      showPages([]);
    }
  };

  search.addEventListener('input', () => {
    const kw = search.value.trim().toLowerCase();
    const pages = anchorsCache?.pages ?? [];
    showPages(kw ? pages.filter((p) => `${p.title ?? ''} ${p.href ?? ''}`.toLowerCase().includes(kw)) : pages, '');
  });

  await load(false);
}

/**
 * 这个地址存下去会不会被服务端丢掉。
 *
 * 规则照抄 tools/editor/server.mjs 的 cleanLink：只留 http(s) / mailto / tel /
 * 站内 /路径 / #锚点；只写 example.com 这种会自动补 https://。
 * 认不出来的（比如 javascript:）当场把框标红，省得存完发现点了没反应。
 */
function linkLooksOk(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return true;
  if (s.startsWith('/') || s.startsWith('#')) return true;
  if (/^(https?:|mailto:|tel:)/i.test(s)) return true;
  return /^[\w-]+(\.[\w-]+)+([/?#][^\s]*)?$/.test(s);
}

/**
 * 链接输入框（时间点 / 时间段 / 导航条目里那个「跳去哪」）。
 * 就是普通文本框，只是顺手把不合规的地址标红。
 * `opts.anchor` 打开时多一个「选位置…」按钮（跳到页面里的具体标题/图片/段落）。
 */
function linkField(value, placeholder, onInput, opts = {}) {
  const el = boardInput(value, placeholder, (v) => {
    el.classList.toggle('is-bad', !linkLooksOk(v));
    onInput(v);
  });
  el.classList.toggle('is-bad', !linkLooksOk(value));
  return opts.anchor ? withAnchorPick(el) : el;
}

/* ===============================================================
   时间轴预览

   把正在编辑的这条轴按**页面上的规则**画一遍，改一个字段就跟着变，
   不用先存盘、重新构建、再打开页面看。

   和 src/components/Timeline.astro 里的那段脚本是同一套规则：
   弧线几何、26px 一格刻度、同一侧挤在一起的点合并成一个塔吊、
   塔吊垂直于弧线朝外长、文字离弧线 40px、合并后组内文字错开 18px。
   唯一的区别是**这里一次把整条轴画完** —— 编辑的时候要的是「全貌」，
   页面上那种滚一屏看一段的节奏不适合校对日期和名字。
   因为位置全是相对的，所以「谁和谁合并」「文字间距」跟页面默认比例尺下
   一模一样，只是不分屏而已。

   改这里的常量时，记得对着 Timeline.astro 一起改。
   =============================================================== */

const TL_PV = {
  BULGE: 30, // 弧顶比两端往左凸出多少
  APEX: 0.5, // 弧顶在画布横向的位置（预览列比较窄，取中间两边都放得下文字）
  TICK_STEP: 26, // 刻度间隔
  TICK: 7, // 刻度线多长
  MERGE_GAP: 22, // 同一侧离这么近的点合并成一个塔吊
  LABEL_GAP: 18, // 合并后组内文字上下错开多少
  GAP: 40, // 文字离弧线多远
  MIN_DAYS: 1, // 比例尺最左：一刻度一天
  MAX_DAYS: 365, // 比例尺最右：一刻度一年
  SCALE: 0.5, // 预览按页面打开时的默认比例尺画（正中间）
  WIDTH: 360, // 量不到宽度时的兜底画布宽（正常按预览列的实际宽度算）
  PAD: 14, // 画布上下各留一点，首尾两端的文字才不会被裁掉半行
  BAND_OFFSET: 8, // 时间段带子往自己那一侧让开多少（和页面上的 translateX 对齐）
  LANE_STEP: 11, // 同一侧重合的时间段，每往外一层再多让开多少（和页面一致）
};

/** 塔吊图形的路径，和页面右上角那颗是同一份 */
const TL_PV_CRANE = 'M10.5 20.5V6.5M13.5 20.5V6.5M8.5 20.5h7M12 4v2.5M3.5 9h17M12 4 3.5 9M12 4l8.5 5M17.5 9v4';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 造一个 SVG 元素（预览专用） */
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * `yyyy-mm-dd` → 天数（和 src/utils/timelines.ts 的 dayOf 一致）。
 * `today` 那个哨兵也算今天 —— 实时更新的时间点就靠它落在轴上。
 */
function tlDay(date) {
  const s = String(date ?? '').trim();
  if (s === 'today') {
    const d = new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  }
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000;
}

/**
 * 这个时间点是哪一类：`moment`（时刻）/ `event`（事件）/ `fuzzy`（难以考据）。
 * 没写 kind 的老数据一律当「时刻」—— 和 src/utils/timelines.ts 的 pointKind 一致。
 */
const tlPointKind = (p) =>
  p?.kind === 'event' ? 'event' : p?.kind === 'fuzzy' ? 'fuzzy' : 'moment';

/**
 * 「难以考据」那个点的位置，0（最早）~ 1（最晚）。
 * 没写或者写坏了都给 0.5 —— 和服务端清洗、站点 pointParam 一个规矩。
 */
function tlFuzzyAt(p) {
  const n = Number(p?.at);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.5;
}

/** `at` 存进数据前收一下：最多 4 位小数（和服务端一致） */
const tlRound4 = (n) => Math.round(n * 10000) / 10000;

/** 位置读数，比如 `62.3%` */
const tlAtText = (p) => `${(tlFuzzyAt(p) * 100).toFixed(1)}%`;

/**
 * 没填 `tickDays` 时用的默认比例尺（一刻度多少天）。
 *
 * 就是页面上那根滑块的默认位置（最左 1 天/格、最右 365 天/格，
 * 打开时停在正中间）：`1 * (365/1)^0.5 ≈ 19.1` 天/格。
 * 这里**不写成 19** —— 公式算出来是多少就是多少，老数据看到的
 * 疏密才和加这个字段之前一模一样。
 */
const TL_TICK_FALLBACK = TL_PV.MIN_DAYS * Math.pow(TL_PV.MAX_DAYS / TL_PV.MIN_DAYS, TL_PV.SCALE);

/**
 * 这条时间轴用的一刻度天数。
 *
 * 数据里写了合法的 `tickDays` 就用它，没写（或写了坏值 —— 服务端会丢掉）
 * 就回到默认那个。`custom` 是用来区分「作者真的填了」和「用的是默认」的：
 * 只影响读数怎么写，不影响画。
 */
function tlTick(tl) {
  const n = Number(tl?.tickDays);
  const ok = Number.isFinite(n) && n >= TL_PV.MIN_DAYS && n <= TL_PV.MAX_DAYS;
  return ok ? { days: n, custom: true } : { days: TL_TICK_FALLBACK, custom: false };
}

/**
 * 「一刻度 ≈ N 天」里的那个 N。
 * 默认那个按老样子取整（19 天），自己填的写到两位小数（2.5 / 1.08）——
 * 取整会把 2.5 说成 3 天，那就等于骗人了。
 */
const tlDaysText = (tick) =>
  String(tick.custom ? Math.round(tick.days * 100) / 100 : Math.round(tick.days));

/**
 * 这条轴上有日期的点跨了多少天（难考据的点没日期，不参与）。
 * 用来给「整条轴大约几格」和「建议比例尺」做参考；算不出来给 0。
 */
function tlSpanDays(tl) {
  const days = (tl?.points ?? []).map((p) => tlDay(p.date)).filter((d) => Number.isFinite(d));
  if (days.length < 2) return 0;
  return Math.max(...days) - Math.min(...days);
}

/**
 * 按跨度给个建议的一刻度天数：让整条轴大约 24 格格完。
 * 只是**建议** —— 编辑器不会自己改用户填的值，要点按钮才填进去。
 */
function tlSuggestTickDays(spanDays) {
  if (!(spanDays > 0)) return null;
  const n = Math.round((spanDays / 24) * 100) / 100;
  return Math.min(TL_PV.MAX_DAYS, Math.max(TL_PV.MIN_DAYS, n));
}

/**
 * 显示用的日期文案：实时点说人话，别把哨兵字符串露出去。
 * 难考据的点没有日期，就明说「难考据」—— 时间段那两个下拉里也靠它认出来。
 */
const tlDateText = (p) =>
  tlPointKind(p) === 'fuzzy'
    ? '（难考据）'
    : p?.date === 'today'
      ? '今天（实时）'
      : p?.date || '（没填日期）';

/**
 * 给同一侧的时间段分层：时间上有重叠的排到不同的层。
 * 和 src/utils/timelines.ts 的 assignSpanLanes 是同一套算法（经典区间着色）。
 * 层号决定预览里那条带子离轴多远、用什么颜色 —— 重合的那一段才分得开。
 */
function assignSpanLanes(list) {
  const out = new Map();
  for (const side of ['left', 'right']) {
    const ends = [];
    for (const s of list.filter((x) => x.side === side).sort((a, b) => a.lo - b.lo)) {
      let lane = ends.findIndex((end) => end <= s.lo);
      if (lane < 0) {
        lane = ends.length;
        ends.push(s.hi);
      } else {
        ends[lane] = s.hi;
      }
      out.set(s.id, lane);
    }
  }
  return out;
}

/** 每一层的颜色；第 0 层是没重合时的样子（和页面上那份一致） */
const LANE_TINT = ['#ff78be', '#c86bff', '#5fd8ff', '#7dff9e', '#ffd447'];
const laneColor = (lane) => LANE_TINT[Math.min(lane, LANE_TINT.length - 1)];

/**
 * 这条轴的时间范围和「某一天落在 0~1 的哪儿」。
 * 规则照抄 src/utils/timelines.ts 的 rangeOf/paramOf：上下各留 6% 余量；
 * 所有点挤在同一天时人为撑开一天，免得除数为 0。
 */
function tlRange(tl) {
  const days = (tl?.points ?? []).map((p) => tlDay(p.date)).filter((d) => Number.isFinite(d));
  if (!days.length) return { min: 0, max: 1, total: 1, of: () => 0.5 };
  let min = Math.min(...days);
  let max = Math.max(...days);
  if (max - min < 1) {
    min -= 0.5;
    max += 0.5;
  }
  const pad = (max - min) * 0.06;
  min -= pad;
  max += pad;
  const total = max - min || 1;
  return { min, max, total, of: (d) => (Number.isFinite(d) ? (d - min) / total : 0.5) };
}

/** 预览是「改一下就重画」，同一帧里连着改几个字段只画一次 */
let tlPreviewQueued = false;
function scheduleTlPreview() {
  if (tlPreviewQueued) return;
  tlPreviewQueued = true;
  requestAnimationFrame(() => {
    tlPreviewQueued = false;
    // 改日期/增删点都会让跨度变，比例尺那一格的「约几格 / 建议值」得跟着刷
    tlScaleHintSync?.();
    const host = els.tlEditor?.querySelector('.tl-pv');
    if (host instanceof HTMLElement) paintTimelinePreview(host);
  });
}

/**
 * 让预览里那个「难考据」塔吊能被鼠标 / 手指拖着走。
 *
 * 拖动改的是**草稿数据**里这个点的 `at`（0 = 最早，1 = 最晚，和站点一致），
 * 吸附到 1%；松开就结束。只动这一个点，别的点一个不碰，
 * 存盘还是走原来那个「保存并重新构建」。
 *
 * 拖的过程中**不重画整块预览**：整块重画会把这个正在被拖的元素从 DOM 里摘掉，
 * `setPointerCapture` 当场失效，后面的事件就再也收不到了。
 * 所以只就地挪这一个点，松手之后再整体重画一次（合并、文字错开跟着更新）。
 */
function attachFuzzyDrag(crane, item, p, side, inner, V, arcX, craneRot) {
  const clampY = (y) => (y < 0 ? 0 : y > V ? V : y);

  /** 位置写进草稿，并同步左边表单里那个读数 / 数字框 */
  const apply = (at) => {
    p.at = tlRound4(at);
    tlFuzzyReadouts.get(p.id)?.();
  };

  crane.addEventListener('pointerdown', (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return; // 只接左键 / 触摸
    ev.preventDefault(); // 别顺手选中文字、别触发别的交互
    ev.stopPropagation();
    // 指针捕获：手指划出预览区、鼠标拖到窗口外面也还收得到事件
    try {
      crane.setPointerCapture(ev.pointerId);
    } catch {
      /* 环境不支持就算了，事件本来也挂在塔吊自己身上 */
    }
    crane.classList.add('is-dragging');

    // 轴那一块的坐标原点：拿它把 clientY 换成轴上的 y
    const top = inner.getBoundingClientRect().top;

    const move = (e) => {
      e.preventDefault();
      const y = clampY(e.clientY - top);
      // 吸附到 1%，免得存下一堆 0.6234712 这种数
      apply(Math.round((y / V) * 100) / 100);
      // 只挪这一个点：位置、塔吊朝向、（读数由 apply 里刷）
      const py = tlFuzzyAt(p) * V;
      item.style.top = `${py}px`;
      item.style.left = `${arcX(py)}px`;
      crane.style.transform = `rotate(${craneRot(arcX(py), py, side)}rad)`;
    };

    const end = (e) => {
      crane.removeEventListener('pointermove', move);
      crane.removeEventListener('pointerup', end);
      crane.removeEventListener('pointercancel', end);
      crane.classList.remove('is-dragging');
      try {
        crane.releasePointerCapture(e.pointerId);
      } catch {
        /* 上面没捕获成功时这里也会抛，无视 */
      }
      crane.title = `按住往上 / 往下拖，改这个「难考据」时间点在轴上的位置（现在 ${tlAtText(p)}）`;
      // 松手之后整块重画：合并、文字错开、时间段让位都跟着新位置更新
      scheduleTlPreview();
    };

    crane.addEventListener('pointermove', move);
    crane.addEventListener('pointerup', end);
    crane.addEventListener('pointercancel', end);
  });
}

/**
 * 把这条轴画进 `host`。
 *
 * 整块重建，但把滚动位置记在 host 上带着走 —— 轴长的时候
 * 每敲一个字就跳回顶部会没法用。
 */
function paintTimelinePreview(host) {
  const keepScroll = Number(host.dataset.scrollTop) || 0;
  host.textContent = '';

  const head = document.createElement('div');
  head.className = 'tl-pv__head';
  const title = document.createElement('span');
  title.className = 'tl-pv__title';
  title.textContent = '预览';
  const meta = document.createElement('span');
  meta.className = 'tl-pv__meta';
  head.append(title, meta);
  host.appendChild(head);

  const note = document.createElement('p');
  note.className = 'tl-pv__note';

  const stage = document.createElement('div');
  stage.className = 'tl-pv__stage';

  // 先挂上去再量宽度：画布宽度按预览列的实际宽度算，箭头和文字才不会被切
  host.append(stage, note);

  const tl = timelinesDraft?.timelines?.[tlIndex];
  /*
    能画上轴的点：有日期的，加上「难以考据」那种 —— 它们本来就没有日期，
    位置在 `at` 里（编辑器里拖出来的）。日期读不出来的点照旧不画。
  */
  const points = (tl?.points ?? []).filter(
    (p) => tlPointKind(p) === 'fuzzy' || Number.isFinite(tlDay(p.date))
  );
  const fuzzyPts = points.filter((p) => tlPointKind(p) === 'fuzzy');

  if (!tl || !points.length) {
    meta.textContent = '还没有时间点';
    const empty = document.createElement('p');
    empty.className = 'tl-pv__empty';
    empty.append('加一个时间点（「难考据」的不用填日期），', document.createElement('br'), '这里就会画出它在轴上的样子。');
    stage.appendChild(empty);
    note.textContent = '页面上那根轴是「落日色的弧 + 粉色外框」，这里按同一套规则画。';
    return;
  }

  const range = tlRange(tl);
  /*
    比例尺：这条轴**自己**的「一刻度多少天」（表单里那个「默认比例尺」）。
    没填就是页面打开时的默认那个（≈19.1 天/格）——
    短跨度的轴（比如两个月）把这里调小，预览和访客打开时看到的疏密才一致。
  */
  const tick = tlTick(tl);
  const daysPerTick = tick.days;
  // 整条轴有多高：一刻度 26px，一共 V/26 格，每格 daysPerTick 天
  const V = Math.max(160, (TL_PV.TICK_STEP * range.total) / daysPerTick);
  const W = Math.max(240, stage.clientWidth || TL_PV.WIDTH);
  const apexX = W * TL_PV.APEX;
  const cy = V / 2;
  const R = ((V / 2) * (V / 2) + TL_PV.BULGE * TL_PV.BULGE) / (2 * TL_PV.BULGE);
  const cx = apexX + R;
  /** 弧上高度 y 处的横坐标 */
  const arcX = (y) => {
    const d = Math.abs(y - cy);
    const inside = R * R - d * d;
    return cx - Math.sqrt(inside > 0 ? inside : 0);
  };

  /**
   * 这个点落在轴上的哪儿（0 = 最早，1 = 最晚）。
   * 有日期的照旧走上面那条换算（`range.of`，和页面的 paramOf 一个规则）；
   * 「难以考据」的直接读 `at` —— 它没有日期可换算。
   */
  const paramOf = (p) => (tlPointKind(p) === 'fuzzy' ? tlFuzzyAt(p) : range.of(tlDay(p.date)));

  /** 高度 y 处塔吊的朝向（沿弧线的径向朝外），和页面上同一个算法 */
  const craneRot = (x, y, side) => {
    const nx = (x - cx) / R;
    const ny = (y - cy) / R;
    return side === 'right' ? Math.atan2(-nx, ny) : Math.atan2(nx, -ny);
  };

  const canvas = document.createElement('div');
  canvas.className = 'tl-pv__canvas';
  canvas.style.width = `${W}px`;
  // 上下各留一点：首尾两端的文字是按弧上位置居中的，贴边会被画布裁掉半行
  canvas.style.height = `${V + TL_PV.PAD * 2}px`;

  // 真正画轴的那块，坐标原点在这里；所有 y 都相对它算
  const inner = document.createElement('div');
  inner.className = 'tl-pv__inner';
  inner.style.height = `${V}px`;
  inner.style.marginTop = `${TL_PV.PAD}px`;

  const gid = 'tl-pv-grad';
  const svg = svgEl('svg', { class: 'tl-pv__svg', width: W, height: V, viewBox: `0 0 ${W} ${V}` });
  const defs = svgEl('defs');
  const grad = svgEl('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
  for (const [off, col] of [
    [0, '#fff2b8'],
    [30, '#ffd447'],
    [66, '#ff9d2e'],
    [100, '#e04a08'],
  ]) {
    grad.appendChild(svgEl('stop', { offset: `${off}%`, 'stop-color': col }));
  }
  defs.appendChild(grad);
  svg.appendChild(defs);

  /** 沿弧线从 t0 到 t1 的一段（时间段带子用） */
  const arcSeg = (t0, t1, steps = 24) => {
    let d = '';
    for (let i = 0; i <= steps; i++) {
      const y = (t0 + (t1 - t0) * (i / steps)) * V;
      d += `${i ? 'L' : 'M'}${arcX(y).toFixed(1)} ${y.toFixed(1)}`;
    }
    return d;
  };

  /* ---- 时间段的带子：一个时间段 × 一侧一条（和页面上一样） ---- */
  // 先把每条「时间段 × 侧」摊平，算出各自落在第几层（同侧重合的分开），再画
  const flatSpans = [];
  for (const s of tl.spans ?? []) {
    const a = tl.points.find((p) => p.id === s.from);
    const b = tl.points.find((p) => p.id === s.to);
    /*
      端点可以是「难以考据」的点 —— 那种点没有日期，但也有位置（at）。
      两端都算得出位置就用它们围出区间；只有一端算得出（另一端日期坏了，
      或者压根不在了）就退化成那一点上的一个点，和站点 spanEdges/spanParam 一个规矩。
    */
    const hasPos = (p) => !!p && (tlPointKind(p) === 'fuzzy' || Number.isFinite(tlDay(p.date)));
    const pa = hasPos(a) ? paramOf(a) : NaN;
    const pb = hasPos(b) ? paramOf(b) : NaN;
    let lo;
    let hi;
    if (Number.isFinite(pa) && Number.isFinite(pb)) {
      lo = Math.min(pa, pb);
      hi = Math.max(pa, pb);
    } else {
      const one = !Number.isFinite(pa) && !Number.isFinite(pb) ? 0.5 : Number.isFinite(pa) ? pa : pb;
      lo = one;
      hi = one;
    }
    // 挂哪几侧：数据说了算；老数据没写就按起点那侧（和 spanSides 一个规矩）
    const sides =
      s.side === 'both'
        ? ['left', 'right']
        : s.side === 'left' || s.side === 'right'
          ? [s.side]
          : [a?.side === 'left' ? 'left' : 'right'];
    for (const side of sides) flatSpans.push({ el: s, side, lo, hi });
  }
  const laneMap = assignSpanLanes(flatSpans.map((f, i) => ({ id: String(i), side: f.side, lo: f.lo, hi: f.hi })));

  const spanMarks = [];
  flatSpans.forEach((f, i) => {
    const lane = laneMap.get(String(i)) ?? 0;
    // lo / hi 已经是 0~1 的位置（上面换算过了），直接用
    const t0 = f.lo;
    const t1 = f.hi;
    const dir = f.side === 'left' ? -1 : 1;
    const off = dir * (TL_PV.BAND_OFFSET + lane * TL_PV.LANE_STEP);
    svg.appendChild(
      svgEl('path', {
        class: 'tl-pv__band',
        d: arcSeg(t0, t1),
        // 第 0 层还是落日渐变，往外的层各用自己那个颜色（和页面上一致）
        stroke: lane === 0 ? `url(#${gid})` : laneColor(lane),
        transform: `translate(${off},0)`,
      })
    );
    spanMarks.push({ el: f.el, y: ((t0 + t1) / 2) * V, side: f.side, color: laneColor(lane) });
  });

  /* ---- 主弧线（每 8px 一个点，够顺） ---- */
  const ys = [];
  for (let y = 0; y < V; y += 8) ys.push(y);
  ys.push(V);
  svg.appendChild(
    svgEl('path', {
      class: 'tl-pv__arc',
      d: ys.map((y, i) => `${i ? 'L' : 'M'}${arcX(y).toFixed(1)} ${y.toFixed(1)}`).join(''),
      stroke: `url(#${gid})`,
    })
  );

  /* ---- 刻度尺 ---- */
  let ticks = '';
  for (let y = 0; y <= V; y += TL_PV.TICK_STEP) {
    const x = arcX(y);
    const nx = (x - cx) / R;
    const ny = (y - cy) / R;
    ticks += `M${x.toFixed(1)} ${y.toFixed(1)}L${(x + nx * TL_PV.TICK).toFixed(1)} ${(y + ny * TL_PV.TICK).toFixed(1)}`;
  }
  svg.appendChild(svgEl('path', { class: 'tl-pv__ruler', d: ticks, stroke: `url(#${gid})` }));
  inner.appendChild(svg);

  /* ---- 时间点：同一侧 + 同一类、挤在一起的合并成一个塔吊（和页面同一套判据） ---- */
  const asTicks = (list) => list.map((p) => ({ p, y: paramOf(p) * V }));
  const sideOf = (o) => (o.p.side === 'right' ? 'right' : 'left');
  const groups = { left: [], right: [] };
  for (const side of ['left', 'right']) {
    for (const kind of ['moment', 'event']) {
      const list = asTicks(points)
        .filter((o) => sideOf(o) === side)
        // 时刻和事件分开成组：混在一起并成一摞就看不出大小和颜色了
        .filter((o) => tlPointKind(o.p) === kind)
        .sort((a, b) => a.y - b.y);
      let run = [];
      let lastY = Number.NEGATIVE_INFINITY;
      const flush = () => {
        if (run.length) groups[side].push(run);
        run = [];
      };
      for (const o of list) {
        if (run.length && o.y - lastY > TL_PV.MERGE_GAP) flush();
        run.push(o);
        lastY = o.y;
      }
      flush();
    }
    /*
      「难以考据」的点**各自一组**，不跟谁合并。
      页面上的合并是为了省地方；但这里每个难考据点都得留出自己的塔吊 ——
      合并成一摞就只剩组里第一个有塔吊，剩下的根本没得拖，
      而「拖」正是这类点唯一能调位置的办法。
    */
    for (const o of asTicks(fuzzyPts)
      .filter((o) => sideOf(o) === side)
      .sort((a, b) => a.y - b.y)) {
      groups[side].push([o]);
    }
  }

  /** 一侧的文字占掉的纵向区间，「时间段名」要靠这个让位 */
  const taken = { left: [], right: [] };
  const HALF_TEXT = 8;

  for (const side of ['left', 'right']) {
    for (const group of groups[side]) {
      // 整组共用一个锚点（组里第一个点），和页面一致
      const y = group[0].y;
      const x = arcX(y);
      const half = ((group.length - 1) / 2) * TL_PV.LABEL_GAP + HALF_TEXT;
      taken[side].push([y - half, y + half]);

      group.forEach((o, i) => {
        const off = (i - (group.length - 1) / 2) * TL_PV.LABEL_GAP;
        const kind = tlPointKind(o.p);
        const item = document.createElement('div');
        item.className = 'tl-pv__item';
        item.dataset.side = side;
        item.dataset.kind = kind;
        item.dataset.pointId = o.p.id;
        item.style.left = `${x}px`;
        item.style.top = `${y}px`;

        if (i === 0) {
          // 一组只画一个塔吊（难考据的点一组就一个），方向是那一点的径向（朝外）
          const crane = document.createElement('span');
          crane.className = 'tl-pv__crane';
          crane.style.transform = `rotate(${craneRot(x, y, side)}rad)`;
          const cs = svgEl('svg', { viewBox: '0 0 24 24' });
          cs.appendChild(svgEl('path', { d: TL_PV_CRANE }));
          /*
            透明的一整块命中区：塔吊是个描边图形，只按笔画判定的话
            得正好戳在那几根细线上才拖得动。
          */
          cs.appendChild(svgEl('rect', { x: 0, y: 0, width: 24, height: 24, fill: 'transparent' }));
          crane.appendChild(cs);

          if (kind === 'fuzzy') {
            crane.title = `按住往上 / 往下拖，改这个「难考据」时间点在轴上的位置（现在 ${tlAtText(o.p)}）`;
            attachFuzzyDrag(crane, item, o.p, side, inner, V, arcX, craneRot);
          }
          item.appendChild(crane);
        }

        const name = document.createElement('span');
        name.className = 'tl-pv__name';
        name.textContent = o.p.label || '（还没起名）';
        name.title = `${tlDateText(o.p)}　${o.p.label || '（还没起名）'}${o.p.href ? `　→ ${o.p.href}` : ''}`;
        // 有链接的在预览里加条虚下划线，一眼看出哪几个点能点
        if (o.p.href) name.classList.add('is-link');
        name.style.transform = `translateY(calc(-50% + ${off}px))`;
        item.appendChild(name);
        inner.appendChild(item);
      });
    }
  }

  /*
    时间段的名字：一侧一个。
    挂哪一侧是数据定的，所以撞上事件文字时只在本侧上下让，不翻到对面
    （翻过去就等于挂错历法了）—— 和页面上的规矩一样。
  */
  for (const mark of spanMarks) {
    const free = (side, y) => !taken[side].some((b) => y + HALF_TEXT > b[0] && y - HALF_TEXT < b[1]);
    const side = mark.side;
    let y = mark.y;
    if (!free(side, y)) {
      const hit = [16, -16, 32, -32, 48, -48].map((off) => y + off).find((yy) => free(side, yy));
      if (hit !== undefined) y = hit;
    }
    taken[side].push([y - HALF_TEXT, y + HALF_TEXT]);

    const el = document.createElement('div');
    el.className = 'tl-pv__span' + (mark.el.href ? ' is-link' : '');
    el.textContent = mark.el.name || '（这段还没起名）';
    el.title = mark.el.href ? `${mark.el.name}　→ ${mark.el.href}` : mark.el.name || '';
    // 名字的颜色跟着它那条带子的层走，一眼能对上哪条带子叫什么
    el.style.setProperty('--sc', mark.color ?? laneColor(0));
    const x = arcX(y);
    /*
      和页面上一样：右侧直接写 left；左侧写 left 再 translateX(-100%)
      把文字右对齐过去 —— 用 right 的话会被行内 left 顶掉。
    */
    el.style.left = `${side === 'right' ? x + TL_PV.GAP : x - TL_PV.GAP}px`;
    el.style.top = `${y}px`;
    el.style.transform = side === 'left' ? 'translate(-100%, -50%)' : 'translateY(-50%)';
    inner.appendChild(el);
  }

  canvas.appendChild(inner);
  stage.appendChild(canvas);

  const dated = points.filter((p) => tlPointKind(p) !== 'fuzzy');
  const merged = [...groups.left, ...groups.right].filter((g) => g.length > 1).length;
  if (dated.length) {
    const first = dated.reduce((a, b) => (tlDay(a.date) <= tlDay(b.date) ? a : b));
    const lastP = dated.reduce((a, b) => (tlDay(a.date) >= tlDay(b.date) ? a : b));
    const days = Math.round(tlDay(lastP.date) - tlDay(first.date));
    meta.textContent = fuzzyPts.length
      ? `${first.date} → ${lastP.date} · ${dated.length} 个有日期的点 · 跨 ${days} 天 · 另有 ${fuzzyPts.length} 个难考据点${merged ? ` · ${merged} 处合并` : ''}`
      : `${first.date} → ${lastP.date} · ${points.length} 个点 · 跨 ${days} 天${merged ? ` · ${merged} 处合并` : ''}`;
  } else {
    // 整条轴一个日期都没有：那就只说难考据点，别去 reduce 一个空数组
    meta.textContent = `${fuzzyPts.length} 个难考据点 · 都没有日期`;
  }
  note.textContent =
    `按这条轴打开时的默认比例尺画（1 格 ≈ ${tlDaysText(tick)} 天），合并和文字间距跟页面上一致；页面上那一屏能滚，这里一次画完整条轴。` +
    (fuzzyPts.length ? '虚化的塔吊是「难考据」的点：按住它上下拖就能改位置。' : '');

  stage.scrollTop = keepScroll;
  stage.addEventListener('scroll', () => {
    host.dataset.scrollTop = String(stage.scrollTop);
  });
}

/**
 * 「默认比例尺」那一格：一刻度代表多少天。
 *
 * 为什么要有它：页面上打开时停在滑块正中间（≈19 天/格）。一条只有两个月
 * 跨度的轴用这个比例尺，整条轴才 1 格多高 —— 打开就短得看不清，每次都得手动
 * 拖滑块。所以每条轴可以自己定一个默认值，访客打开时就是作者看到的疏密。
 *
 * 留空 = 不写 `tickDays` = 用默认那个（≈19 天/格），老数据也是这样。
 * 1~365 之外、或者敲不成数字的，**当场标红**并说明「存下去会当作没填」——
 * 和服务端一个规矩（那里是直接丢掉这个字段，而不是夹到端点）。
 *
 * 只做建议、不自动改用户的值：跨度 ÷ 24 算出来一个「整条轴约 24 格」的值，
 * 想看就点「整轴铺满」填进去。
 */
function tickField(tl) {
  const wrap = document.createElement('span');
  wrap.className = 'tickfield';

  const row = document.createElement('span');
  row.className = 'tickfield__row';

  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(TL_PV.MIN_DAYS);
  num.max = String(TL_PV.MAX_DAYS);
  num.step = '0.5';
  num.className = 'input tickfield__num';
  num.placeholder = String(Math.round(TL_TICK_FALLBACK));
  num.autocomplete = 'off';
  /*
    框里显示数据里那个值（没写就空着 = 用默认）。
    数据里本来就是个不合法值（手改过 JSON 之类）时也照样显示出来，
    但**当场标红**并说清「存下去会当作没填」—— 不然框里写着 0、
    预览却按 19 天画，人会以为哪里坏了。
  */
  const rawTick = tl.tickDays;
  const hasRawTick = rawTick !== undefined && rawTick !== null && rawTick !== '';
  const rawTickNum = Number(rawTick);
  const rawTickOk =
    hasRawTick &&
    Number.isFinite(rawTickNum) &&
    rawTickNum >= TL_PV.MIN_DAYS &&
    rawTickNum <= TL_PV.MAX_DAYS;
  num.value = hasRawTick ? String(rawTick) : '';
  num.title =
    `打开这条时间轴时一刻度代表多少天（${TL_PV.MIN_DAYS}~${TL_PV.MAX_DAYS} 天，可以填小数）。` +
    `留空 = 用页面默认的（≈${Math.round(TL_TICK_FALLBACK)} 天/格）。` +
    `只有两个月这种短跨度的轴记得调小 —— 不调的话打开时整条轴只有一两格高，看着很短。`;
  if (hasRawTick && !rawTickOk) {
    num.classList.add('is-bad');
    num.title = `「${rawTick}」不在 ${TL_PV.MIN_DAYS}~${TL_PV.MAX_DAYS} 天里，存下去会当作没填（回到默认 ≈${Math.round(TL_TICK_FALLBACK)} 天/格）。`;
  }

  const unit = document.createElement('span');
  unit.className = 'tickfield__unit';
  unit.textContent = '天 / 格';

  row.append(num, unit);
  const hint = document.createElement('span');
  hint.className = 'tickfield__hint';
  wrap.append(row, hint);

  const suggestBtn = document.createElement('button');
  suggestBtn.type = 'button';
  suggestBtn.className = 'btn btn--ghost boardedit__mini';
  suggestBtn.textContent = '整轴铺满';
  row.appendChild(suggestBtn);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'btn btn--ghost boardedit__mini';
  resetBtn.textContent = '默认';
  resetBtn.title = `清空 = 不写这个字段，用页面默认的比例尺（≈${Math.round(TL_TICK_FALLBACK)} 天/格）`;
  row.appendChild(resetBtn);

  /** 跨度、建议值、当前读数 —— 一律现算，别缓存 */
  const state = () => {
    const spanDays = tlSpanDays(tl);
    const tick = tlTick(tl);
    const suggest = tlSuggestTickDays(spanDays);
    return { spanDays, tick, suggest };
  };

  /** 只刷读数（不碰输入框，改日期时也不会把用户正在打的字冲掉） */
  const syncHint = () => {
    const { spanDays, tick, suggest } = state();
    const parts = [`一刻度 ≈ ${tlDaysText(tick)} 天${tick.custom ? '' : '（默认）'}`];
    if (spanDays > 0) {
      parts.push(`整条轴约 ${Math.round((spanDays / tick.days) * 10) / 10} 格（跨度 ${spanDays} 天）`);
      if (suggest !== null) parts.push(`建议 ${suggest} 天/格`);
    } else {
      parts.push('这条轴还看不出跨度（要两个以上带日期的点）');
    }
    hint.textContent = parts.join(' · ');
    suggestBtn.disabled = suggest === null;
    suggestBtn.title =
      suggest === null
        ? '这条轴还没有两个带日期的点，算不出建议值'
        : `填 ${suggest} 天/格：整条轴大约 24 格格完（跨度 ${spanDays} 天 ÷ 24）`;
  };

  /**
   * 把输入框里的字落成数据。
   * 空 → 删掉字段（= 默认）；合法 → 收两位小数写进去；
   * 不合法 → 也删掉（服务端会丢，这里先说清楚），并把框标红。
   */
  const commit = () => {
    const raw = num.value.trim();
    if (!raw) {
      delete tl.tickDays;
      num.classList.remove('is-bad');
      num.title = `留空 = 用页面默认的（≈${Math.round(TL_TICK_FALLBACK)} 天/格）`;
      syncHint();
      scheduleTlPreview();
      return;
    }
    const n = Number(raw);
    if (!Number.isFinite(n) || n < TL_PV.MIN_DAYS || n > TL_PV.MAX_DAYS) {
      delete tl.tickDays;
      num.classList.add('is-bad');
      num.title = `「${raw}」不在 ${TL_PV.MIN_DAYS}~${TL_PV.MAX_DAYS} 天里，存下去会当作没填（回到默认 ≈${Math.round(TL_TICK_FALLBACK)} 天/格）。`;
      syncHint();
      scheduleTlPreview();
      return;
    }
    tl.tickDays = Math.round(n * 100) / 100;
    num.classList.remove('is-bad');
    num.title = '一刻度多少天（1~365，可以填小数）；留空 = 用页面默认的';
    syncHint();
    scheduleTlPreview();
  };

  num.addEventListener('input', commit);
  resetBtn.addEventListener('click', () => {
    num.value = '';
    commit();
  });
  suggestBtn.addEventListener('click', () => {
    const { suggest } = state();
    if (suggest === null) return;
    num.value = String(suggest);
    commit();
  });

  syncHint();
  return { el: wrap, syncHint };
}

/**
 * 时间轴编辑区：左边一列表单，右边一列实时预览。
 * 表单里改任何东西都只重画预览（`scheduleTlPreview`），
 * 只有增删行、换轴这种结构变化才整块重建 —— 否则输入框会一直丢焦点。
 */
function renderTimelineEditor() {
  const box = els.tlEditor;
  box.textContent = '';
  // 读数刷新函数是跟着行一起重建的，旧的先扔掉（点删掉了就不会再挂着）
  tlFuzzyReadouts.clear();
  const list = timelinesDraft?.timelines ?? [];

  // 表单这一列；预览那一列在函数末尾按当前数据现画
  const form = document.createElement('div');
  form.className = 'tl-edit__form';
  const pv = document.createElement('div');
  pv.className = 'tl-pv';
  const grid = document.createElement('div');
  grid.className = 'tl-edit';
  grid.append(form, pv);
  box.appendChild(grid);

  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有时间轴。点下面的「＋ 新建时间轴」开始。';
    form.appendChild(p);
  }

  /* ---- 选哪一条 + 新建 / 删除 ---- */
  const bar = document.createElement('div');
  bar.className = 'tl-edit__bar';

  if (list.length) {
    const pick = document.createElement('select');
    pick.className = 'input';
    list.forEach((t, i) => {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = t.title;
      pick.appendChild(o);
    });
    pick.value = String(tlIndex);
    pick.addEventListener('change', () => {
      tlIndex = Number(pick.value) || 0;
      renderTimelineEditor();
    });
    bar.appendChild(pick);
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'btn btn--ghost boardedit__mini';
  add.textContent = '＋ 新建时间轴';
  add.addEventListener('click', () => {
    timelinesDraft.timelines.push({
      id: newTimelineId(),
      title: `时间轴 ${timelinesDraft.timelines.length + 1}`,
      leftName: '花娅历',
      rightName: '冰室历',
      points: [],
      spans: [],
    });
    tlIndex = timelinesDraft.timelines.length - 1;
    renderTimelineEditor();
  });
  bar.appendChild(add);

  if (list.length) {
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删掉这条';
    del.addEventListener('click', () => {
      timelinesDraft.timelines.splice(tlIndex, 1);
      tlIndex = Math.max(0, tlIndex - 1);
      renderTimelineEditor();
    });
    bar.appendChild(del);
  }
  form.appendChild(bar);

  const tl = list[tlIndex];
  if (!tl) {
    // 一条轴都没有：只留提示和「新建」，预览那边自己会说「还没有时间点」
    tlScaleHintSync = null;
    paintTimelinePreview(pv);
    return;
  }
  if (!Array.isArray(tl.points)) tl.points = [];
  if (!Array.isArray(tl.spans)) tl.spans = [];

  /* ---- 基本字段 ---- */
  const scale = tickField(tl);
  // 改了日期/增删点 -> 跨度变了，这一格的读数和建议值也要跟着变（见 scheduleTlPreview）
  tlScaleHintSync = scale.syncHint;
  const row = document.createElement('div');
  row.className = 'tl-edit__row';
  row.append(
    pwField(
      '名称',
      boardInput(tl.title ?? '', '这条轴叫什么', (v) => {
        tl.title = v;
      })
    ),
    pwField(
      '左侧叫什么历',
      boardInput(tl.leftName ?? '', '比如 花娅历', (v) => {
        tl.leftName = v;
      })
    ),
    pwField(
      '右侧叫什么历',
      boardInput(tl.rightName ?? '', '比如 冰室历', (v) => {
        tl.rightName = v;
      })
    ),
    pwField('默认比例尺', scale.el)
  );
  form.appendChild(row);

  /*
    时间段那两个下拉里写的是「日期　事件名」。日期或者名字改过之后
    得把选项文字刷新一遍，否则下拉里还挂着改之前的旧值。
    真函数在下面 slist 建好之后才赋上（时间点在前面先建）。
  */
  let refreshSpanOptions = () => {};

  /* ---- 时间点 ---- */
  const pHead = document.createElement('h4');
  pHead.className = 'tl-edit__h';
  pHead.textContent = '时间点';
  form.appendChild(pHead);

  const plist = document.createElement('div');
  plist.className = 'tl-edit__list';
  tl.points.forEach((p, i) => {
    const item = document.createElement('div');
    item.className = 'tl-edit__item';

    const side = pageSelect(
      [['left', tl.leftName || '左侧'], ['right', tl.rightName || '右侧']],
      p.side === 'right' ? 'right' : 'left',
      (v) => {
        p.side = v;
        scheduleTlPreview();
      }
    );
    side.className = 'input tl-edit__side';

    /*
      时刻 / 事件 / 难以考据（fuzzy）。三种类型功能完全一样
      （左右、名字、链接都能填），差别只在页面上长什么样：
        · 时刻 = 大塔吊 + 大字（默认；选它就把 kind 删掉，
          老数据不会因为过一遍编辑器就多出一堆 kind:"moment"）
        · 事件 = 小一号的粉色塔吊 + 小字
        · 难考据 = 查不到具体日期的往事：**没有日期**，
          位置存在 `at` 里（0 = 最早、1 = 最晚），在右边预览里拖着塔吊定
    */
    const kind = pageSelect(
      [
        ['moment', '时刻'],
        ['event', '事件'],
        ['fuzzy', '难考据'],
      ],
      tlPointKind(p),
      (v) => setKind(v)
    );
    kind.className = 'input tl-edit__kind';
    kind.title =
      '时刻 = 大塔吊 + 大字；事件 = 小一号的粉色塔吊 + 小字；难考据 = 查不到具体日期的往事，没有日期，位置在右边预览里拖着塔吊定。';

    /*
      日期那一格。难考据的点整块收起来（不是禁用 —— 用户要的是「没有日期选项了」），
      换成「位置：xx%」的读数 + 一个能微调的数字框。
      建日期控件时用记下来的那个日期：这样切回「时刻 / 事件」时框里本来就是对的。
    */
    let dateApi = null;
    const date = dateField(tlPointKind(p) === 'fuzzy' ? (tlDateMemo.get(p.id) ?? '') : p.date, (v) => {
      p.date = v;
      refreshSpanOptions();
      scheduleTlPreview();
    }, {
      live: p.date === 'today',
      onLive: (on, back) => {
        // 打开时写哨兵 today；关掉时写回具体日期（dateField 保证 back 是个合法日期）
        p.date = on ? 'today' : back;
        refreshSpanOptions();
        scheduleTlPreview();
      },
      onReady: (api) => {
        dateApi = api;
      },
    });

    const pos = document.createElement('span');
    pos.className = 'tl-fuzzypos';
    const posText = document.createElement('span');
    posText.className = 'tl-fuzzypos__text';
    posText.title = '这个「难考据」时间点在这条轴上的位置（0 = 最早，1 = 最晚）。在右边预览里按住那个塔吊上下拖就能改。';
    const posNum = document.createElement('input');
    posNum.type = 'number';
    posNum.min = '0';
    posNum.max = '100';
    posNum.step = '0.1';
    posNum.className = 'input tl-fuzzypos__num';
    posNum.title = '位置（0~100%）。也可以直接在右边预览里拖着塔吊改。';
    posNum.addEventListener('input', () => {
      const n = Number(posNum.value);
      if (!Number.isFinite(n)) return;
      p.at = tlRound4(Math.min(1, Math.max(0, n / 100)));
      posText.textContent = `位置：${tlAtText(p)}`;
      scheduleTlPreview();
    });
    pos.append(posText, posNum);

    /** 把读数 / 数字框刷成数据里的样子（预览里拖塔吊时也调它） */
    const syncPos = () => {
      posText.textContent = `位置：${tlAtText(p)}`;
      // 正在数字框里打字就别去动它，否则光标会乱跳
      if (document.activeElement !== posNum) posNum.value = String(Math.round(tlFuzzyAt(p) * 1000) / 10);
    };
    tlFuzzyReadouts.set(p.id, syncPos);

    const label = boardInput(p.label ?? '', '事件名（常驻显示在轴旁边）', (v) => {
      p.label = v;
      refreshSpanOptions();
      scheduleTlPreview();
    });
    const href = linkField(p.href ?? '', '点它跳去哪（/huaya/xxx，留空就点不动）', (v) => {
      p.href = v;
      scheduleTlPreview();
    }, { anchor: true });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      const gone = p.id;
      tl.points.splice(i, 1);
      // 时间段是靠 id 指过来的，端点没了那一段就悬空了，一并删掉
      tl.spans = tl.spans.filter((s) => s.from !== gone && s.to !== gone);
      renderTimelineEditor();
    });

    // 难考据那行的说明，铺满整行挂在下面（那一格放不下一整句）
    const hint = document.createElement('p');
    hint.className = 'hint tl-edit__fuzzyhint';
    hint.textContent =
      '时间难考据：没有日期，位置直接在右边预览里按住那个塔吊上下拖（也可以在上面填百分数）。';

    /** 切类型：换掉日期那一格，顺带把日期在数据里存/取 */
    const setKind = (v) => {
      const wasFuzzy = tlPointKind(p) === 'fuzzy';
      if (v === 'fuzzy') {
        // 把现在这个日期记下来（切回去时还给他），数据里不留 date
        if (!wasFuzzy) tlDateMemo.set(p.id, p.date === 'today' ? 'today' : p.date || '');
        p.kind = 'fuzzy';
        delete p.date;
        if (!Number.isFinite(Number(p.at))) p.at = 0.5;
      } else {
        if (v === 'event') p.kind = 'event';
        else delete p.kind;
        delete p.at;
        // 之前填过的日期还给他；本来没填过就用今天兜底（不然存盘会被丢掉）
        const back = tlDateMemo.get(p.id);
        p.date = back ? back : p.date || isoToday();
        dateApi?.set(p.date);
      }
      syncWhen();
      refreshSpanOptions();
      scheduleTlPreview();
    };

    /** 日期那一格显示成日期控件还是「位置」读数 */
    const syncWhen = () => {
      const fuzzy = tlPointKind(p) === 'fuzzy';
      date.classList.toggle('tl-hide', fuzzy);
      pos.classList.toggle('tl-hide', !fuzzy);
      hint.classList.toggle('tl-hide', !fuzzy);
      syncPos();
    };

    item.append(side, kind, date, pos, label, href, del, hint);
    syncWhen();
    plist.appendChild(item);
  });
  form.appendChild(plist);

  // 三种时间点各一个按钮 —— 新加的那一条就带着 kind，省得再加一步去改类型
  for (const [label, k] of [
    ['＋ 加时刻', 'moment'],
    ['＋ 加事件', 'event'],
    ['＋ 加难考据', 'fuzzy'],
  ]) {
    const addP = document.createElement('button');
    addP.type = 'button';
    addP.className = 'btn btn--ghost boardedit__mini';
    addP.textContent = label;
    addP.title =
      k === 'event'
        ? '加一条「事件」：小一号的粉色塔吊 + 更小的文字'
        : k === 'fuzzy'
          ? '加一条「难考据」：查不到具体日期的往事，没有日期，位置在右边预览里拖着塔吊定'
          : '加一条「时刻」：大塔吊 + 大字';
    addP.addEventListener('click', () => {
      const p = {
        id: `${tl.id}-p${Date.now().toString(36)}${tl.points.length}`,
        side: 'left',
        label: '',
      };
      if (k === 'fuzzy') {
        p.kind = 'fuzzy';
        p.at = 0.5;
      } else {
        p.date = '';
        if (k === 'event') p.kind = 'event';
      }
      tl.points.push(p);
      renderTimelineEditor();
    });
    form.appendChild(addP);
  }

  /* ---- 时间段 ---- */
  const sHead = document.createElement('h4');
  sHead.className = 'tl-edit__h';
  sHead.textContent = '时间段（两个时间点之间命名）';
  form.appendChild(sHead);

  const slist = document.createElement('div');
  slist.className = 'tl-edit__list';
  /**
   * 下拉里那条「2023-01-10　冰室成立」的文案。
   * 「难考据」的点没有日期，就缀一个「（难考据）」——
   * 时间段可以拿它们当端点（站点按它的 at 处理），但得让用户看得出这是哪一种点。
   */
  const optText = (p) =>
    tlPointKind(p) === 'fuzzy'
      ? `${p.label || '（没填名字）'}（难考据）`
      : `${tlDateText(p)}　${p.label || '（没填名字）'}`;

  tl.spans.forEach((s, i) => {
    const item = document.createElement('div');
    item.className = 'tl-edit__item tl-edit__item--span';

    /*
      挂哪一侧。数据里没写这一项（老数据）就按起点那个时间点的侧算 ——
      和页面上的规则一致，所以下拉里直接预选算出来的那一侧，
      用户不动它，存下去也不会多出字段。
    */
    const sideOf = (v) => (v === 'left' || v === 'right' || v === 'both' ? v : '');
    const fromPoint = tl.points.find((p) => p.id === s.from);
    const effSide = sideOf(s.side) || (fromPoint?.side === 'right' ? 'right' : 'left');
    const spanSide = pageSelect(
      [
        ['left', tl.leftName || '左侧'],
        ['right', tl.rightName || '右侧'],
        ['both', '两侧都有'],
      ],
      effSide,
      (v) => {
        s.side = v;
        scheduleTlPreview();
      }
    );
    spanSide.className = 'input tl-edit__side';
    spanSide.title = '这段年月挂在哪本历上；两边各有各的叫法就加两条，起点终点填一样、各选一侧';

    const name = boardInput(s.name ?? '', '这段叫什么（比如 XX年代）', (v) => {
      s.name = v;
      scheduleTlPreview();
    });

    const opts = tl.points.map((p) => ({ id: p.id, text: optText(p) }));
    const from = pageSelect([['', '起点…'], ...opts.map((o) => [o.id, o.text])], s.from, (v) => {
      s.from = v;
      // 换端点可能连「默认挂哪一侧」都变了，整块重画一次让下拉跟着对上
      renderTimelineEditor();
    });
    from.className = 'input';
    const to = pageSelect([['', '终点…'], ...opts.map((o) => [o.id, o.text])], s.to, (v) => {
      s.to = v;
      scheduleTlPreview();
    });
    to.className = 'input';
    // 每个选项挂上点 id，日期/名字改了就地改文案，不用整块重画
    for (const sel of [from, to]) {
      Array.from(sel.options).forEach((o) => {
        if (o.value) o.dataset.pointId = o.value;
      });
    }

    const href = linkField(s.href ?? '', '点它跳去哪（/huaya/xxx，留空就点不动）', (v) => {
      s.href = v;
      scheduleTlPreview();
    }, { anchor: true });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      tl.spans.splice(i, 1);
      renderTimelineEditor();
    });

    item.append(spanSide, name, from, to, href, del);
    slist.appendChild(item);
  });
  form.appendChild(slist);

  refreshSpanOptions = () => {
    for (const o of slist.querySelectorAll('option[data-point-id]')) {
      const p = tl.points.find((x) => x.id === o.dataset.pointId);
      if (p) o.textContent = optText(p);
    }
  };

  const addS = document.createElement('button');
  addS.type = 'button';
  addS.className = 'btn btn--ghost boardedit__mini';
  addS.textContent = '＋ 加时间段';
  addS.addEventListener('click', () => {
    tl.spans.push({ id: `${tl.id}-s${Date.now().toString(36)}${tl.spans.length}`, name: '', from: '', to: '' });
    renderTimelineEditor();
  });
  // 时间点少于两个就没得连
  addS.disabled = tl.points.length < 2;
  form.appendChild(addS);

  // 表单建完了，按当前数据把预览画出来
  paintTimelinePreview(pv);
}

async function saveTimelines() {
  const btn = els.tlSave;
  const wasText = btn?.textContent ?? '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在保存…';
    }
    const res = await fetch('/api/timelines', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(timelinesDraft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    /*
      服务端会顺手清洗（没日期的点、端点没了的段都会被丢掉）。
      丢东西一定要**说出来** —— 早先「实时」那个日期值服务端不认识，
      于是一保存整个时间点就被悄悄删掉，界面上看起来就是「点了一下保存它就没了」。
      那种事以后必须当场看到原因，而不是对着空列表发愣。
    */


    const d = data.dropped ?? {};
    const lost = [];
    if (d.timelines) lost.push(`${d.timelines} 条时间轴`);
    if (d.points) lost.push(`${d.points} 个时间点`);
    if (d.spans) lost.push(`${d.spans} 个时间段`);

    // 存完拿服务端那份重新渲染，让界面上看到的和落盘的一致
    timelinesDraft = null;
    await loadTimelines();
    if (tlIndex >= timelinesDraft.timelines.length) tlIndex = Math.max(0, timelinesDraft.timelines.length - 1);
    renderTimelineEditor();
    /*
      这里**故意不关弹窗**。
      以前存完会 closeTimelinesModal()，看着像"保存 = 完事收工"，
      但这一下后面还跟着一次重新构建（好几秒），而且改一条轴常常要连着调好几处
      （加个点、再改个日期、再拖一下位置），每存一次就被关掉、还得重新点开一次
      ——用户报的就是这个。存完留着，想关自己点右上角那个 ×。
    */

    // 再构建一次，页面上才是刚存的样子（不然得另找地方点「保存并重新构建」）
    let built = false;
    if (btn) btn.textContent = '正在重新构建…';
    try {
      const bres = await fetch('/api/build', { method: 'POST' });
      const bdata = await bres.json();
      built = bres.ok && bdata.ok;
    } catch {
      /* 构建失败不算保存失败，下面会提示 */
    }

    if (lost.length) {
      toast(
        `保存了，但有 ${lost.join('、')} 没存下 —— 多半是缺名字、日期读不出来、或者时间段的端点不在了（难考据的点没有日期是正常的）`,
        true
      );
    } else if (built) {
      toast('时间轴已保存并重新构建，刷新页面就能看到');
    } else {
      toast('时间轴已保存，但重新构建没成功 —— 去启动器里点一下「保存并重新构建」', true);
    }
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = wasText;
    }
  }
}

/* ---------------------------------------------------------------
   导航分类库

   和「时间轴」一个套路：**先在这里建可复用的东西，页面里只引用**。

   这里可复用的单位是「大分类」（category）。用户的原话是：有些条目对应的
   页面既属于 A 大分类又属于 B 大分类 —— A 页的导航可能是「甲 + 乙」、
   B 页是「甲 + 丙」，甲里那几十条条目只该录一次。所以页面内容块里存的
   只是一个 id 列表（`{ type:'nav', cats:[…] }`），改分类内容不用动页面：改一次，
   所有引用它的页面一起变（保存时服务端会顺手重新构建一遍）。

   结构和时间轴面板一样：左栏清单、中栏编辑、右栏实时预览。
   --------------------------------------------------------------- */

/** 库里那份草稿：{ _readme?: string[], categories: [...] } */
let navsDraft = null;
/** 服务端算出来的「哪些页面引用了哪些分类」（按盘上那份 home-boards.json） */
let navsPages = [];
/** 当前在看第几个大分类 */
let navIndex = 0;

async function loadNavs() {
  if (navsDraft) return navsDraft;
  const res = await fetch('/api/navs');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  navsDraft = data.navs && typeof data.navs === 'object' ? data.navs : { categories: [] };
  if (!Array.isArray(navsDraft.categories)) navsDraft.categories = [];
  navsPages = Array.isArray(data.pages) ? data.pages : [];
  return navsDraft;
}

async function openNavsModal() {
  markWorkspaceActive('navs');
  els.navsEditor.textContent = '正在读取…';
  els.navsModal.hidden = false;
  try {
    // 同上：loadNavs 有缓存，重开面板不会把没保存的分类改动冲掉
    await loadNavs();
    if (navIndex >= navsDraft.categories.length) navIndex = 0;
    /*
      顺手把版块树拉一把：条目里的站内地址要能查「站里到底有没有这一页」，
      查不了就别乱标红（那比不标更糟）。
    */
    if (!boardsDraft) {
      try {
        const res = await fetch('/api/boards');
        if (res.ok) boardsDraft = await res.json();
      } catch {
        /* 忽略：没有版块树照样能编辑分类，只是不做「站内没这一页」的提示 */
      }
    }
    renderNavEditor();
  } catch (err) {
    els.navsEditor.textContent = `读取失败：${err.message}`;
  }
}

function closeNavsModal() {
  els.navsModal.hidden = true;
}

const navCatSeq = () => Date.now().toString(36) + Math.floor(Math.random() * 1e3);
const newNavCatId = () => `navcat-${navCatSeq()}`;
const newNavGroupId = (cat) => {
  const used = new Set((cat.groups ?? []).map((g) => g.id));
  let id = `g-${navCatSeq()}`;
  while (used.has(id)) id = `g-${navCatSeq()}`;
  return id;
};
/** 细分类 id：**只要求在同一条子分类内唯一** */
const newNavSubgroupId = (group) => {
  const used = new Set((group.subgroups ?? []).map((s) => s.id));
  let id = `s-${navCatSeq()}`;
  while (used.has(id)) id = `s-${navCatSeq()}`;
  return id;
};
/** 条目 id：整个大分类里不撞（子分类的和细分类里的一起算） */
const newNavItemId = (cat) => {
  const used = new Set();
  for (const g of cat.groups ?? []) {
    for (const it of g.items ?? []) used.add(it.id);
    for (const sg of g.subgroups ?? []) for (const it of sg.items ?? []) used.add(it.id);
  }
  let id = `i-${navCatSeq()}`;
  while (used.has(id)) id = `i-${navCatSeq()}`;
  return id;
};

/** 这个分类里一共多少条目（子分类直接挂的 + 细分类里的，左栏「N 条」用） */
const navItemCount = (cat) =>
  (cat.groups ?? []).reduce(
    (n, g) => n + (g.items ?? []).length + (g.subgroups ?? []).reduce((m, s) => m + (s.items ?? []).length, 0),
    0
  );

/** 引用这个分类的页面（服务端按盘上那份数据算的） */
const navUsedBy = (catId) => navsPages.filter((p) => (p.cats ?? []).includes(catId));

/**
 * 让「导航」面板里改一个条目的站内地址时能给点提示。
 *
 * 只在版块树已经拉回来的时候才判断 —— 没拉到就一律不标（
 * 否则每个 `/xxx` 都会被说成「站里没有这一页」，比不提示更误导）。
 */
function navHrefStatus(href) {
  if (!boardsDraft) return 'unknown';
  return siteLinkStatus(href);
}

function renderNavEditor() {
  const box = els.navsEditor;
  box.textContent = '';
  const cats = navsDraft?.categories ?? [];

  const grid = document.createElement('div');
  grid.className = 'nv-edit';
  const left = document.createElement('div');
  left.className = 'nv-edit__col nv-edit__cats';
  const mid = document.createElement('div');
  mid.className = 'nv-edit__col nv-edit__main';
  const pv = document.createElement('div');
  pv.className = 'nv-edit__col nv-pv';
  grid.append(left, mid, pv);
  box.appendChild(grid);

  /* ---- 左栏：大分类清单 ---- */
  const head = document.createElement('div');
  head.className = 'nv-head';
  const hTitle = document.createElement('span');
  hTitle.className = 'nv-head__title';
  hTitle.textContent = '大分类';
  const hCount = document.createElement('em');
  hCount.className = 'nv-head__count';
  hCount.textContent = cats.length ? `${cats.length} 个` : '';
  head.append(hTitle, hCount);
  left.appendChild(head);

  const addCat = document.createElement('button');
  addCat.type = 'button';
  addCat.className = 'btn btn--ghost boardedit__mini nv-addcat';
  addCat.textContent = '＋ 新建大分类';
  addCat.title = '大分类就是可以整个搬进页面的单位（比如「实体」）';
  addCat.addEventListener('click', () => {
    const cat = { id: newNavCatId(), title: '新分类', groups: [] };
    navsDraft.categories.push(cat);
    navIndex = navsDraft.categories.length - 1;
    renderNavEditor();
  });
  left.appendChild(addCat);

  if (!cats.length) {
    const none = document.createElement('p');
    none.className = 'hint nv-empty';
    none.textContent = '还没有分类。点上面「＋ 新建大分类」开始 —— 建好之后到「页面」工作台的内容块里加「＋ 导航」，勾选要用哪几个。';
    left.appendChild(none);
  }

  const list = document.createElement('div');
  list.className = 'nv-cats';
  cats.forEach((cat, i) => {
    const row = document.createElement('div');
    row.className = 'nv-cat' + (i === navIndex ? ' is-active' : '');
    row.dataset.catId = cat.id;

    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'nv-cat__pick';
    const name = document.createElement('span');
    name.className = 'nv-cat__name';
    name.textContent = cat.title || '(未命名)';
    const meta = document.createElement('em');
    meta.className = 'nv-cat__meta';
    const used = navUsedBy(cat.id).length;
    meta.textContent = `${navItemCount(cat)} 条${used ? ` · 被 ${used} 个页面引用` : ' · 还没页面用'}`;
    pick.append(name, meta);
    pick.addEventListener('click', () => {
      navIndex = i;
      renderNavEditor();
    });
    row.appendChild(pick);

    const ops = document.createElement('div');
    ops.className = 'nv-cat__ops';
    const mini = (text, title, fn, cls = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn--ghost boardedit__mini ${cls}`.trim();
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', fn);
      return b;
    };
    ops.append(
      mini('↑', '往前挪（页面上的顺序按页面自己排，这里只管清单）', () => {
        if (i === 0) return;
        [cats[i - 1], cats[i]] = [cats[i], cats[i - 1]];
        navIndex = i - 1;
        renderNavEditor();
      }),
      mini('↓', '往后挪', () => {
        if (i === cats.length - 1) return;
        [cats[i + 1], cats[i]] = [cats[i], cats[i + 1]];
        navIndex = i + 1;
        renderNavEditor();
      }),
      mini('复制', '整份复制一份（条目也一样），改个名字就是另一个分类', () => {
        const copy = JSON.parse(JSON.stringify(cat));
        copy.id = newNavCatId();
        copy.title = `${cat.title} 副本`;
        // 子分类和条目的 id 也重新发一遍，免得两份撞 id
        for (const g of copy.groups ?? []) {
          g.id = newNavGroupId(copy);
          for (const it of g.items ?? []) it.id = newNavItemId(copy);
        }
        navsDraft.categories.splice(i + 1, 0, copy);
        navIndex = i + 1;
        renderNavEditor();
      }),
      mini('删除', '删掉这个分类', () => {
        const usedPages = navUsedBy(cat.id);
        if (usedPages.length) {
          const names = usedPages.map((p) => p.title || p.id).join('、');
          if (!confirm(`「${cat.title}」还被 ${usedPages.length} 个页面引用着：\n${names}\n\n删掉之后那几页的导航里就会少这一节（页面本身不会坏）。确定删吗？`)) {
            return;
          }
        } else if (!confirm(`删掉大分类「${cat.title}」？`)) {
          return;
        }
        cats.splice(i, 1);
        navIndex = Math.max(0, Math.min(navIndex, cats.length - 1));
        renderNavEditor();
      }, 'boardedit__del')
    );
    row.appendChild(ops);
    list.appendChild(row);
  });
  left.appendChild(list);

  /* ---- 中栏：选中的大分类 ---- */
  const cat = cats[navIndex];
  if (!cat) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent =
      '左边还没有分类。点「＋ 新建大分类」建一个（比如「实体」），再往里加子分类和条目。';
    mid.appendChild(p);
    paintNavPreview(pv);
    return;
  }

  const top = document.createElement('div');
  top.className = 'nv-fields';
  top.append(
    nvField('分类名字', boardInput(cat.title ?? '', '比如 实体', (v) => {
      cat.title = v;
      // 只刷新左栏和预览，别整块重画（正在打字）
      renderNavCatsOnly();
      paintNavPreview(pv);
    }), '页面上那一节的标题'),
    nvField('说明', boardInput(cat.note ?? '', '可选：这一节下面那句小字', (v) => {
      if (v.trim()) cat.note = v;
      else delete cat.note;
      paintNavPreview(pv);
    })),
    /*
      顶上那行里点这个名字跳去哪。
      ⚠ 默认（留空）= 跳到下面自己那一节：一块里只挂了这一个分类时，
      那一节就在紧下面，点它等于什么都没发生 —— 用户报的就是这个
      （「导航二字旁边的纷湖 为什么可以点 点了根本没反应」）。
      所以留空、而且只有一个分类时，页面上渲染成一行字、不做成链接。
    */
    nvField('顶栏点它去哪', boardInput(cat.link ?? '', '留空 = 跳到下面那一节（只有一个分类时不做成链接）', (v) => {
      const s = v.trim();
      if (s) cat.link = s;
      else delete cat.link;
      paintNavPreview(pv);
    }), '页面上「导航 · 名字」那行里，点这个名字跳去哪；站内路径或外链都行')
  );
  mid.appendChild(top);

  const idLine = document.createElement('p');
  idLine.className = 'hint nv-idline';
  idLine.textContent = `分类 id：${cat.id}（页面里引用的就是这个，别改）`;
  mid.appendChild(idLine);

  const gHead = document.createElement('div');
  gHead.className = 'nv-head';
  const gTitle = document.createElement('span');
  gTitle.className = 'nv-head__title';
  gTitle.textContent = '子分类';
  const gCount = document.createElement('em');
  gCount.className = 'nv-head__count';
  gCount.textContent = `${(cat.groups ?? []).length} 个`;
  gHead.append(gTitle, gCount);
  mid.appendChild(gHead);

  const groupsBox = document.createElement('div');
  groupsBox.className = 'nv-groups';
  cat.groups ??= [];
  cat.groups.forEach((g, gi) => groupsBox.appendChild(navGroupBox(cat, g, gi, pv)));
  mid.appendChild(groupsBox);

  const addGroup = document.createElement('button');
  addGroup.type = 'button';
  addGroup.className = 'btn btn--ghost boardedit__mini nv-addgroup';
  addGroup.textContent = '＋ 加子分类';
  addGroup.addEventListener('click', () => {
    cat.groups.push({ id: newNavGroupId(cat), title: '新子分类', items: [] });
    renderNavEditor();
  });
  mid.appendChild(addGroup);

  paintNavPreview(pv);
}

/** 只重画左栏清单（改名字时用，避免把正在打字的输入框换掉） */
function renderNavCatsOnly() {
  const box = els.navsEditor.querySelector('.nv-cats');
  if (!box) return renderNavEditor();
  const cats = navsDraft?.categories ?? [];
  box.textContent = '';
  cats.forEach((cat, i) => {
    const row = document.createElement('div');
    row.className = 'nv-cat' + (i === navIndex ? ' is-active' : '');
    row.dataset.catId = cat.id;
    const name = document.createElement('span');
    name.className = 'nv-cat__name';
    name.textContent = cat.title || '(未命名)';
    const meta = document.createElement('em');
    meta.className = 'nv-cat__meta';
    const used = navUsedBy(cat.id).length;
    meta.textContent = `${navItemCount(cat)} 条${used ? ` · 被 ${used} 个页面引用` : ' · 还没页面用'}`;
    const pick = document.createElement('button');
    pick.type = 'button';
    pick.className = 'nv-cat__pick';
    pick.append(name, meta);
    pick.addEventListener('click', () => {
      navIndex = i;
      renderNavEditor();
    });
    row.appendChild(pick);
    box.appendChild(row);
  });
}

/** `pwField` 的导航面板版本（不依赖 .pw-grid 那一套） */
function nvField(labelText, control, hint) {
  const wrap = document.createElement('label');
  wrap.className = 'nv-field';
  wrap.dataset.field = labelText;
  const cap = document.createElement('span');
  cap.className = 'nv-field__label';
  cap.textContent = labelText;
  wrap.append(cap, control);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'nv-field__hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  return wrap;
}

/** 一个子分类：名字 + 直接挂的条目 + 再往下一层的「细分类」 */
function navGroupBox(cat, g, gi, pv) {
  const box = document.createElement('div');
  box.className = 'nv-group';
  box.dataset.groupId = g.id;

  const top = document.createElement('div');
  top.className = 'nv-group__top';
  const title = boardInput(g.title ?? '', '子分类名字，比如 友好生物', (v) => {
    g.title = v;
    paintNavPreview(pv);
  });
  title.classList.add('nv-group__name');
  g.items ??= [];
  g.subgroups ??= [];

  const mini = (text, t, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn--ghost boardedit__mini ${cls}`.trim();
    b.textContent = text;
    b.title = t;
    b.addEventListener('click', fn);
    return b;
  };
  top.append(
    title,
    mini('↑', '往前挪', () => {
      if (gi === 0) return;
      [cat.groups[gi - 1], cat.groups[gi]] = [cat.groups[gi], cat.groups[gi - 1]];
      renderNavEditor();
    }),
    mini('↓', '往后挪', () => {
      if (gi === cat.groups.length - 1) return;
      [cat.groups[gi + 1], cat.groups[gi]] = [cat.groups[gi], cat.groups[gi + 1]];
      renderNavEditor();
    }),
    mini('删除', '删掉这个子分类和里面的条目 / 细分类', () => {
      const n = g.items.length + g.subgroups.length;
      if (n && !confirm(`「${g.title}」里还有 ${g.items.length} 条条目、${g.subgroups.length} 个细分类，一起删掉吗？`)) return;
      cat.groups.splice(gi, 1);
      renderNavEditor();
    }, 'boardedit__del')
  );
  box.appendChild(top);

  /*
    直接挂在子分类下的条目。有细分类时这块也留着 ——
    站点那边两种都渲染（先铺直接挂的条目，再铺细分类）。
  */
  const directWrap = document.createElement('div');
  directWrap.className = 'nv-slot';
  if (g.subgroups.length) {
    const cap = document.createElement('p');
    cap.className = 'nv-slot__cap';
    cap.textContent = '直接挂在这个子分类下的条目（页面上排在细分类前面）';
    directWrap.appendChild(cap);
  }
  const items = document.createElement('div');
  items.className = 'nv-items';
  g.items.forEach((it, ii) => items.appendChild(navItemRow(cat, g, it, ii, pv)));
  directWrap.appendChild(items);
  const addItem = mini('＋ 加条目', '加一条「图标 + 文字」，点文字跳到地址', () => {
    g.items.push({ id: newNavItemId(cat), text: '新条目' });
    renderNavEditor();
  });
  addItem.classList.add('nv-additem');
  directWrap.appendChild(addItem);
  box.appendChild(directWrap);

  /* ---- 再往下一层：细分类（比如「友好生物」下面再分「无伤害能力」…） ---- */
  const subsBox = document.createElement('div');
  subsBox.className = 'nv-subs';
  g.subgroups.forEach((sg, si) => subsBox.appendChild(navSubgroupBox(cat, g, sg, si, pv)));
  box.appendChild(subsBox);

  const addSub = mini('＋ 细分类', '在「' + (g.title || '这个子分类') + '」下面再分一层（第三级，只做这一层）', () => {
    g.subgroups.push({ id: newNavSubgroupId(g), title: '新细分类', items: [] });
    renderNavEditor();
  });
  addSub.classList.add('nv-addsub');
  box.appendChild(addSub);
  return box;
}

/** 一个细分类（第三级）：名字 + 它自己的条目 */
function navSubgroupBox(cat, g, sg, si, pv) {
  const box = document.createElement('div');
  box.className = 'nv-sub';
  box.dataset.subgroupId = sg.id;
  sg.items ??= [];

  const top = document.createElement('div');
  top.className = 'nv-sub__top';
  const title = boardInput(sg.title ?? '', '细分类名字，比如 无伤害能力', (v) => {
    sg.title = v;
    paintNavPreview(pv);
  });
  title.classList.add('nv-sub__name');

  const mini = (text, t, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn--ghost boardedit__mini ${cls}`.trim();
    b.textContent = text;
    b.title = t;
    b.addEventListener('click', fn);
    return b;
  };
  top.append(
    title,
    mini('↑', '往前挪', () => {
      if (si === 0) return;
      [g.subgroups[si - 1], g.subgroups[si]] = [g.subgroups[si], g.subgroups[si - 1]];
      renderNavEditor();
    }),
    mini('↓', '往后挪', () => {
      if (si === g.subgroups.length - 1) return;
      [g.subgroups[si + 1], g.subgroups[si]] = [g.subgroups[si], g.subgroups[si + 1]];
      renderNavEditor();
    }),
    mini('删除', '删掉这个细分类和它的条目', () => {
      if (sg.items.length && !confirm(`「${sg.title}」里还有 ${sg.items.length} 条条目，一起删掉吗？`)) return;
      g.subgroups.splice(si, 1);
      renderNavEditor();
    }, 'boardedit__del')
  );
  box.appendChild(top);

  const items = document.createElement('div');
  items.className = 'nv-items';
  sg.items.forEach((it, ii) => items.appendChild(navItemRow(cat, sg, it, ii, pv)));
  box.appendChild(items);

  const addItem = mini('＋ 加条目', '加一条「图标 + 文字」，点文字跳到地址', () => {
    sg.items.push({ id: newNavItemId(cat), text: '新条目' });
    renderNavEditor();
  });
  addItem.classList.add('nv-additem');
  box.appendChild(addItem);
  return box;
}

/**
 * 一条条目：文字 / 地址 / 图标 / 提示 / 上下移 / 删除。
 * `holder` 是挂着 `items` 的那一层 —— 子分类（第二级）或细分类（第三级）都用它，
 * 所以三级下来只有这一份条目编辑器。
 */
function navItemRow(cat, holder, it, ii, pv) {
  const row = document.createElement('div');
  row.className = 'nv-item';
  row.dataset.itemId = it.id;

  const top = document.createElement('div');
  top.className = 'nv-item__top';

  const text = boardInput(it.text ?? '', '条目文字（点它跳转）', (v) => {
    it.text = v;
    paintNavPreview(pv);
  });
  text.classList.add('nv-item__text');

  const href = linkField(it.href ?? '', '地址（/huaya/xxx 或 https://…，留空就只是看看）', (v) => {
    if (v.trim()) it.href = v;
    else delete it.href;
    paintNavPreview(pv);
    renderNavItemWarn(row, it);
  }, { anchor: true });
  href.classList.add('nv-item__href');

  const mini = (label, t, fn, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn--ghost boardedit__mini ${cls}`.trim();
    b.textContent = label;
    b.title = t;
    b.addEventListener('click', fn);
    return b;
  };
  top.append(
    text,
    href,
    mini('↑', '往前挪', () => {
      if (ii === 0) return;
      [holder.items[ii - 1], holder.items[ii]] = [holder.items[ii], holder.items[ii - 1]];
      renderNavEditor();
    }),
    mini('↓', '往后挪', () => {
      if (ii === holder.items.length - 1) return;
      [holder.items[ii + 1], holder.items[ii]] = [holder.items[ii], holder.items[ii + 1]];
      renderNavEditor();
    }),
    mini('删除', '删掉这一条', () => {
      holder.items.splice(ii, 1);
      renderNavEditor();
    }, 'boardedit__del')
  );
  row.appendChild(top);

  const bar = document.createElement('div');
  bar.className = 'nv-item__bar';
  bar.appendChild(
    boardCoverControl(it, () => renderNavEditor(), {
      pick: it.image ? '换图标' : '图标',
      pickTitle: '条目左边那个小图标（可选）',
      empty: '还没有图标',
      clear: '去掉图标',
    })
  );
  const tip = boardInput(it.tip ?? '', '提示（可选：鼠标移上去显示）', (v) => {
    if (v.trim()) it.tip = v;
    else delete it.tip;
    paintNavPreview(pv);
  });
  tip.classList.add('nv-item__tip');
  bar.appendChild(tip);
  const warn = document.createElement('span');
  warn.className = 'nv-item__warn';
  bar.appendChild(warn);
  row.appendChild(bar);
  renderNavItemWarn(row, it);
  return row;
}

/** 站内地址查不到就标一句（只在版块树已加载时判断，免得误报） */
function renderNavItemWarn(row, it) {
  const warn = row.querySelector('.nv-item__warn');
  if (!warn) return;
  warn.textContent = '';
  const href = String(it.href ?? '').trim();
  if (!href || navHrefStatus(href) !== 'missing') return;
  warn.textContent = `⚠ 站内没有「${href}」这一页，点它会 404`;
}

/** 右栏：尽量照站点样子的示意图 */
function paintNavPreview(host) {
  host.textContent = '';
  const cats = navsDraft?.categories ?? [];

  const head = document.createElement('div');
  head.className = 'nv-pv__head';
  head.textContent = '预览（示意）';
  host.appendChild(head);

  if (!cats.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有分类，没什么可预览的。';
    host.appendChild(p);
    return;
  }

  const blk = document.createElement('div');
  blk.className = 'nv-pv__blk';

  const bar = document.createElement('div');
  bar.className = 'nv-pv__bar';
  const barLabel = document.createElement('span');
  barLabel.className = 'nv-pv__barLabel';
  barLabel.textContent = '分类';
  barLabel.title = '页面块里可以改成别的字（比如「导航」「图鉴」）';
  bar.appendChild(barLabel);
  cats.forEach((c, i) => {
    if (i) {
      const dot = document.createElement('span');
      dot.className = 'nv-pv__dot';
      dot.textContent = '·';
      bar.appendChild(dot);
    }
    const a = document.createElement('a');
    a.className = 'nv-pv__barLink';
    a.href = `#navcat-${c.id}`;
    a.textContent = c.title || '(未命名)';
    a.addEventListener('click', (ev) => ev.preventDefault());
    bar.appendChild(a);
  });
  blk.appendChild(bar);

  for (const c of cats) {
    const details = document.createElement('details');
    details.className = 'nv-pv__cat';
    details.open = true;
    const sum = document.createElement('summary');
    sum.className = 'nv-pv__summary';
    const t = document.createElement('span');
    t.className = 'nv-pv__catTitle';
    t.textContent = c.title || '(未命名)';
    const fold = document.createElement('span');
    fold.className = 'nv-pv__fold';
    fold.textContent = '收起 / 展开';
    sum.append(t, fold);
    details.appendChild(sum);

    const body = document.createElement('div');
    body.className = 'nv-pv__body';
    if (c.note) {
      const note = document.createElement('p');
      note.className = 'nv-pv__note';
      note.textContent = c.note;
      body.appendChild(note);
    }
    if (!(c.groups ?? []).length) {
      const none = document.createElement('p');
      none.className = 'nv-pv__note';
      none.textContent = '（这个分类还没有子分类）';
      body.appendChild(none);
    }
    /* 一条条目的样子（子分类直接挂的、细分类里的共用这一份） */
    const pvItem = (it) => {
      const href = String(it.href ?? '').trim();
      const el = document.createElement(href ? 'a' : 'span');
      el.className = `nv-pv__item${href ? '' : ' nv-pv__item--plain'}`;
      if (href) {
        el.href = href;
        // 预览里点它别真跳走（要看地址对不对，悬停有 title 就够了）
        el.addEventListener('click', (ev) => ev.preventDefault());
      }
      el.title = it.tip || href || it.text || '';
      if (it.image) {
        const img = document.createElement('img');
        img.className = 'nv-pv__icon';
        img.src = it.image;
        img.alt = '';
        el.appendChild(img);
      }
      const span = document.createElement('span');
      span.className = 'nv-pv__text';
      span.textContent = it.text || '(未命名)';
      el.appendChild(span);
      return el;
    };
    const pvEmpty = () => {
      const empty = document.createElement('span');
      empty.className = 'nv-pv__emptyItem';
      empty.textContent = '（空）';
      return empty;
    };

    /*
      一个子分类 = 一整行：最左边是它的名字（有细分类时纵跨整组），
      右边一列一列地铺：先「直接挂的条目」（留一格空标签，好和细分类对齐），
      再每个细分类一格（细分类名 + 它自己的条目）。
      和页面上 NavBlock.astro 的排法一致。
    */
    for (const g of c.groups ?? []) {
      const gItems = g.items ?? [];
      const subs = g.subgroups ?? [];
      const rowEl = document.createElement('div');
      rowEl.className = `nv-pv__row${subs.length ? ' nv-pv__row--nest' : ''}`;
      const label = document.createElement('div');
      label.className = 'nv-pv__label';
      label.textContent = g.title || '(未命名子分类)';
      const cells = document.createElement('div');
      cells.className = 'nv-pv__cells';

      if (gItems.length) {
        const cell = document.createElement('div');
        cell.className = 'nv-pv__cell';
        // 有细分类时留一格空标签：直接挂的条目就和细分类的条目对齐了
        if (subs.length) {
          const pad = document.createElement('span');
          pad.className = 'nv-pv__sublabel';
          cell.appendChild(pad);
        }
        const items = document.createElement('div');
        items.className = 'nv-pv__items';
        gItems.forEach((it) => items.appendChild(pvItem(it)));
        cell.appendChild(items);
        cells.appendChild(cell);
      }

      for (const sg of subs) {
        const cell = document.createElement('div');
        cell.className = 'nv-pv__cell';
        cell.dataset.subgroupId = sg.id;
        const sl = document.createElement('span');
        sl.className = 'nv-pv__sublabel';
        sl.textContent = sg.title || '(未命名细分类)';
        const items = document.createElement('div');
        items.className = 'nv-pv__items';
        const sItems = sg.items ?? [];
        if (!sItems.length) items.appendChild(pvEmpty());
        sItems.forEach((it) => items.appendChild(pvItem(it)));
        cell.append(sl, items);
        cells.appendChild(cell);
      }

      if (!gItems.length && !subs.length) {
        const items = document.createElement('div');
        items.className = 'nv-pv__items';
        items.appendChild(pvEmpty());
        cells.appendChild(items);
      }

      rowEl.append(label, cells);
      body.appendChild(rowEl);
    }
    details.appendChild(body);
    blk.appendChild(details);
  }

  host.appendChild(blk);
  const note = document.createElement('p');
  note.className = 'hint nv-pv__tip';
  note.textContent =
    '页面上的样子（示意）：顶栏是这一页挂了哪几个大分类，每个分类一整节可以收起/展开；一行一个子分类（名字在左边、纵跨整组），它右边先铺直接挂的条目、再铺细分类（细分类名 + 它自己的条目）——「图标 + 文字」点文字跳地址。';
  host.appendChild(note);
}

async function saveNavs() {
  const btn = els.navsSave;
  const wasText = btn?.textContent ?? '';
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = '正在保存…';
    }
    const res = await fetch('/api/navs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ _readme: navsDraft._readme, categories: navsDraft.categories }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);



    const d = data.dropped ?? {};
    const lost = [];
    if (d.categories) lost.push(`${d.categories} 个大分类`);
    if (d.groups) lost.push(`${d.groups} 个子分类`);
    if (d.subgroups) lost.push(`${d.subgroups} 个细分类`);
    if (d.items) lost.push(`${d.items} 条条目`);

    // 拿服务端那份重新渲染，界面上看到的和落盘的一致
    navsDraft = null;
    await loadNavs();
    if (navIndex >= navsDraft.categories.length) navIndex = Math.max(0, navsDraft.categories.length - 1);
    renderNavEditor();

    if (data.built) {
      toast(
        `导航已保存并重新构建（${data.ms} ms）` +
          (lost.length
            ? `；有 ${lost.join('、')} 没存下（只有没名字的分类/子分类、没文字的条目、不合法的地址会被丢 —— 空分类现在会原样留着）`
            : '')
      );
    } else {
      toast(`导航已保存，但重新构建没成功：${String(data.output || '').split('\n')[0]}`, true);
    }
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = wasText;
    }
  }
}

async function saveBoards({ silent = false } = {}) {  try {
    const res = await fetch('/api/boards', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(boardsDraft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    // 子版块清单变了，勾选框的缓存必须作废重拉 ——
    // 否则刚加的子版块在「所属子版块」里根本选不到。
    state.allSubs = [];
    await loadSubs();
    // 已经被删掉的子版块，从当前文章的归类里剔掉，避免存下悬空 id
    const valid = new Set(state.allSubs.map((s) => s.id));
    const before = state.subs.length;
    state.subs = state.subs.filter((s) => valid.has(s));
    if (state.subs.length !== before) setDirty(true);
    renderSubPicker();

    if (!silent) {
      closeBoardsModal();
      toast('子版块已保存，重新构建后生效');
    }
    return true;
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
    return false;
  }
}

function closeBoardsModal() {
  els.boardsModal.hidden = true;
}

/* ---------------------------------------------------------------
   所属子版块

   子版块清单来自 /api/boards，拉一次缓存到 state.allSubs。
   这里用勾选框而不是自由输入：子版块是固定那几个，
   勾选比让人记 id 靠谱得多。
   --------------------------------------------------------------- */

async function loadSubs() {
  if (state.allSubs.length) return state.allSubs;
  try {
    const res = await fetch('/api/boards');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    // 数据是树（children 可无限嵌套），递归摊平。
    // indent 用全角空格按层数缩进，勾选框里就能看出从属关系。
    const flat = [];
    const walk = (node, board, depth) => {
      if (!node || !node.id) return;
      flat.push({
        id: node.id,
        label: node.title || node.label || '(未命名)',
        board,
        depth,
      });
      for (const child of node.children || []) walk(child, board, depth + 1);
    };
    for (const board of data.boards || []) {
      for (const child of board.children || []) walk(child, board.title, 0);
    }
    state.allSubs = flat;
  } catch {
    state.allSubs = [];
  }
  return state.allSubs;
}

function renderSubPicker() {
  const box = els.subsBox;
  box.textContent = '';

  if (!state.allSubs.length) {
    const s = document.createElement('span');
    s.className = 'hint';
    s.textContent = '还没有子版块。用工具栏的「子版块」按钮添加。';
    box.appendChild(s);
    return;
  }

  for (const sub of state.allSubs) {
    const wrap = document.createElement('label');
    wrap.className = 'subpick__item';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = state.subs.includes(sub.id);
    cb.addEventListener('change', () => {
      if (cb.checked) {
        if (!state.subs.includes(sub.id)) state.subs.push(sub.id);
      } else {
        state.subs = state.subs.filter((x) => x !== sub.id);
      }
      setDirty(true);
      scheduleDraftSave();
    });

    const text = document.createElement('span');
    // 按层级缩进，让人一眼看出这个节点挂在谁下面
    text.textContent = '　'.repeat(sub.depth || 0) + sub.label;

    const meta = document.createElement('em');
    meta.textContent = sub.board;

    wrap.append(cb, text, meta);
    box.appendChild(wrap);
  }
}

/* ---------------------------------------------------------------
   排版微调

   思路：把预览站点（默认 127.0.0.1:4321）的首页 HTML 抓过来，
   塞进一个 srcdoc iframe。srcdoc 里的文档和父页面同源，
   所以父页面能直接操作 iframe 里的 DOM —— 跨域 iframe 就不行了。

   存的是「相对偏移 + 缩放倍数」，用 CSS 的 translate/scale 施加，
   它们是纯视觉变换、不参与布局，所以响应式断点照常生效。
   --------------------------------------------------------------- */

/** 预览站点地址。本地预览服务默认在 4321。 */
const PREVIEW_URL = 'http://127.0.0.1:4321';

/**
 * 每种页面类型拿哪个真实页面来做预览。
 * 大板块页/详情页/列表页都只是「这一类」的代表 ——
 * 同一类里所有页面共用一套微调，所以拿最典型的一个当样板就行。
 *
 * 注意 board 不在这张表里：它的样板页是「第一个大板块」，由 resolveSample()
 * 现从 /api/boards 取。写死成 /yongcheng/ 的话，一旦改了板块地址
 * （比如换成 /yongshen）这里就 404，排版模式直接打不开。
 */
const LAYOUT_SAMPLES = {
  home: '/',
  post: '/posts/hello/',
  list: '/posts/',
};

/**
 * 把版块树摊平并算出每个节点的地址。
 * 规则和 utils/boards.ts 一致：id 去掉父级前缀当路径段，写了 href 就以 href 为准。
 */
function flattenBoardTree(boards) {
  const out = [];
  const walk = (node, parentId, parentUrl, depth) => {
    const seg = parentId && node.id.startsWith(`${parentId}-`)
      ? node.id.slice(parentId.length + 1)
      : node.id;
    const url = node.href || (depth === 0 ? `/${seg}` : `${parentUrl}/${seg}`);
    out.push({ id: node.id, title: node.title || '(未命名)', url, depth });
    for (const kid of node.children ?? []) walk(kid, node.id, url, depth + 1);
  };
  for (const b of boards) walk(b, null, '', 0);
  return out;
}

/** 板块页的样板页下拉：每个版块一页，得让用户自己挑要调哪一个 */
async function fillBoardSampleSelect() {
  if (!els.layoutSample) return;
  if (els.layoutSample.options.length) return;
  try {
    const res = await fetch('/api/boards');
    const data = await res.json();
    for (const n of flattenBoardTree(data.boards || [])) {
      const o = document.createElement('option');
      o.value = n.url.endsWith('/') ? n.url : `${n.url}/`;
      o.textContent = `${'　'.repeat(n.depth)}${n.title}`;
      els.layoutSample.appendChild(o);
    }
  } catch {
    /* 拿不到就退回「第一个大板块」 */
  }
}

/** 第一个大板块的地址，取一次缓存起来 */
let boardSampleUrl = null;

/**
 * 算出某一类页面该拿哪个地址当样板。
 * 大板块页要现查数据，因为地址是可以在编辑器里改的。
 */
async function resolveSample(page) {
  if (page !== 'board') return LAYOUT_SAMPLES[page] || '/';

  // 用户在「哪个板块」里挑过就用他挑的
  if (els.layoutSample && els.layoutSample.value) return els.layoutSample.value;

  if (!boardSampleUrl) {
    try {
      const res = await fetch('/api/boards');
      const data = await res.json();
      const first = (data.boards || [])[0];
      // 板块可以有显式 href，也可以按 id 推导；这里两种都兜住
      boardSampleUrl = first ? (first.href || `/${first.id}`) : '/';
    } catch {
      boardSampleUrl = '/';
    }
  }
  return boardSampleUrl.endsWith('/') ? boardSampleUrl : `${boardSampleUrl}/`;
}

let layoutPage = 'home';

/**
 * 注入进 iframe 的编辑脚本。
 *
 * 三件事：
 *   1. 选中：点谁选谁（最里面那个 [data-edit]）
 *   2. 拖动 / 缩放：拖本体平移（存成相对自身尺寸的百分比），
 *      拖右下角的小方块**自由改变宽高**（存成像素）——类似 PS 的自由变换，
 *      而且缩放时左上角不动
 *   3. 给外面的数字面板提供读写：中心点坐标（页面坐标 px）、宽高、缩放
 *
 * 为什么位置存百分比、尺寸存像素：
 *   位置用百分比 → 和屏幕宽度无关，手机上仍按原版式排，不会跑到屏幕外；
 *   尺寸用像素 → 用户说的是「改成 300 像素宽」，像素最直观，
 *   而且不像 scale 那样把里面的字也一起缩小（字会糊）。
 */
const LAYOUT_SCRIPT = [
  '(function () {',
  '  var state = window.__layoutState = {};',
  '  var sel = null;',
  '  var nodes = [].slice.call(document.querySelectorAll("[data-edit]"));',
  '',
  '  function elOf(key) {',
  '    return nodes.filter(function (n) { return n.dataset.edit === key; })[0] || null;',
  '  }',
  '',
  '  function apply(el) {',
  '    var v = state[el.dataset.edit];',
  '    if (v.dx) el.style.setProperty("--dx", v.dx + "%"); else el.style.removeProperty("--dx");',
  '    if (v.dy) el.style.setProperty("--dy", v.dy + "%"); else el.style.removeProperty("--dy");',
  '    el.style.setProperty("--s", v.s || 1);',
  '    // 宽高同时写成 --w 和真正的 width： --w 给构建产物用（那边是 width:var(--w) !important），',
  '    // 内联 width 保证编辑期立刻看得到、而且压得住数据里 cardW/cardH 那份内联尺寸',
  '    if (v.w) { el.style.setProperty("--w", v.w + "px"); el.style.width = v.w + "px"; }',
  '    else { el.style.removeProperty("--w"); el.style.removeProperty("width"); }',
  '    if (v.h) { el.style.setProperty("--h", v.h + "px"); el.style.height = v.h + "px"; }',
  '    else { el.style.removeProperty("--h"); el.style.removeProperty("height"); }',
  '  }',
  '',
  '  // 初始值：先读构建时写进内联样式的，没有就取默认',
  '  nodes.forEach(function (el) {',
  '    var cs = el.style;',
  '    state[el.dataset.edit] = {',
  '      dx: parseFloat(cs.getPropertyValue("--dx")) || 0,',
  '      dy: parseFloat(cs.getPropertyValue("--dy")) || 0,',
  '      s: parseFloat(cs.getPropertyValue("--s")) || 1,',
  '      w: parseFloat(cs.getPropertyValue("--w")) || 0,',
  '      h: parseFloat(cs.getPropertyValue("--h")) || 0',
  '    };',
  '    // 编辑期关掉过渡，不然拖动会拖泥带水',
  '    el.style.transition = "none";',
  '    el.style.outline = "1px dashed rgba(255,80,170,.75)";',
  '    el.style.outlineOffset = "2px";',
  '    el.style.cursor = "move";',
  '    // 蒸汽波背景那一层是 pointer-events:none（不能让背景挡住正文的点击），',
  '    // 但那样一来里面的落日、塔吊在排版模式里也点不中。编辑期临时放开。',
  '    el.style.pointerEvents = "auto";',
  '  });',
  '',
  '  function select(el) {',
  '    if (sel && sel !== el) sel.style.outlineColor = "rgba(255,80,170,.75)";',
  '    sel = el;',
  '    el.style.outlineColor = "#5ff0ff";',
  '    window.parent.postMessage({ type: "layout-pick", key: el.dataset.edit }, "*");',
  '  }',
  '',
  '  /*',
  '    量一个元素现在的状态。',
  '    注意 rect 是**已经带了 translate/scale** 的视觉盒子，所以要反推出布局位置：',
  '    scale 是绕中心缩放的（中心不动），translate 的百分比是相对布局尺寸的，',
  '    所以 布局尺寸 = 视觉尺寸 / s，视觉中心 - 位移 = 布局中心。',
  '  */',
  '  function metrics(el) {',
  '    var v = state[el.dataset.edit];',
  '    var r = el.getBoundingClientRect();',
  '    var s = v.s || 1;',
  '    var layW = r.width / s;',
  '    var layH = r.height / s;',
  '    return {',
  '      v: v, s: s, layW: layW, layH: layH,',
  '      visualW: r.width, visualH: r.height,',
  '      pageX: r.left + r.width / 2 + window.scrollX,',
  '      pageY: r.top + r.height / 2 + window.scrollY',
  '    };',
  '  }',
  '',
  '  function notify() {',
  '    window.parent.postMessage({ type: "layout-change", state: state }, "*");',
  '    if (sel) window.parent.postMessage({ type: "layout-metrics", key: sel.dataset.edit, m: publicMetrics(sel) }, "*");',
  '  }',
  '',
  '  function publicMetrics(el) {',
  '    var m = metrics(el);',
  '    return {',
  '      x: Math.round(m.pageX), y: Math.round(m.pageY),',
  '      w: Math.round(m.visualW), h: Math.round(m.visualH),',
  '      s: Math.round(m.s * 100) / 100',
  '    };',
  '  }',
  '',
  '  /* 让元素保持左上角不动地改成指定像素尺寸 */',
  '  function resizeFrom(el, w, h) {',
  '    var before = el.getBoundingClientRect();',
  '    var v = state[el.dataset.edit];',
  '    v.w = Math.round(Math.max(20, w));',
  '    v.h = Math.round(Math.max(16, h));',
  '    apply(el);',
  '    var after = el.getBoundingClientRect();',
  '    var m = metrics(el);',
  '    // 左上角被挪动了多少，就用位移补回去',
  '    v.dx = (v.dx || 0) + (before.left - after.left) / Math.max(1, m.layW) * 100;',
  '    v.dy = (v.dy || 0) + (before.top - after.top) / Math.max(1, m.layH) * 100;',
  '    v.dx = Math.round(v.dx * 10) / 10;',
  '    v.dy = Math.round(v.dy * 10) / 10;',
  '    apply(el);',
  '  }',
  '',
  '  function handle() {',
  '    var h = document.createElement("div");',
  '    h.style.cssText = "position:fixed;width:16px;height:16px;right:0;bottom:0;"',
  '      + "background:#5ff0ff;border:2px solid #06131a;border-radius:3px;"',
  '      + "cursor:nwse-resize;z-index:2147483647;display:none";',
  '    h.title = "拖这里自由改宽高（左上角不动）";',
  '    document.body.appendChild(h);',
  '    return h;',
  '  }',
  '  var grip = handle();',
  '',
  '  function placeGrip() {',
  '    if (!sel) { grip.style.display = "none"; return; }',
  '    var r = sel.getBoundingClientRect();',
  '    grip.style.display = "block";',
  '    grip.style.left = (r.right - 10) + "px";',
  '    grip.style.top = (r.bottom - 10) + "px";',
  '    grip.style.right = "auto";',
  '    grip.style.bottom = "auto";',
  '  }',
  '',
  '  var drag = null;',
  '',
  '  document.addEventListener("mousedown", function (e) {',
  '    if (e.target === grip) {',
  '      var r0 = sel.getBoundingClientRect();',
  '      drag = { mode: "resize", el: sel, x: e.clientX, y: e.clientY, w0: r0.width, h0: r0.height };',
  '      e.preventDefault();',
  '      return;',
  '    }',
  '    var el = e.target.closest ? e.target.closest("[data-edit]") : null;',
  '    if (!el) return;',
  '    select(el);',
  '    var v = state[el.dataset.edit];',
  '    var r = el.getBoundingClientRect();',
  '    drag = { mode: "move", el: el, x: e.clientX, y: e.clientY, dx0: v.dx || 0, dy0: v.dy || 0,',
  '             w: r.width, h: r.height };',
  '    window.parent.postMessage({ type: "layout-metrics", key: el.dataset.edit, m: publicMetrics(el) }, "*");',
  '    e.preventDefault();',
  '  });',
  '',
  '  document.addEventListener("mousemove", function (e) {',
  '    if (!drag) return;',
  '    if (drag.mode === "move") {',
  '      var v = state[drag.el.dataset.edit];',
  '      // 换算成「相对自身尺寸的百分比」，这样存下来的值和屏幕宽度无关',
  '      v.dx = Math.round((drag.dx0 + (e.clientX - drag.x) / drag.w * 100) * 10) / 10;',
  '      v.dy = Math.round((drag.dy0 + (e.clientY - drag.y) / drag.h * 100) * 10) / 10;',
  '      apply(drag.el);',
  '    } else {',
  '      // 自由变换：往右往下拖就变大，宽高各自独立',
  '      resizeFrom(drag.el, drag.w0 + (e.clientX - drag.x), drag.h0 + (e.clientY - drag.y));',
  '    }',
  '    placeGrip();',
  '    notify();',
  '  });',
  '',
  '  document.addEventListener("mouseup", function () { drag = null; });',
  '  window.addEventListener("resize", placeGrip);',
  '',
  '  window.__layoutApi = {',
  '    state: state,',
  '    metrics: function (key) { var el = elOf(key); return el ? publicMetrics(el) : null; },',
  '    applyKey: function (key, v) {',
  '      state[key] = { dx: v.dx || 0, dy: v.dy || 0, s: v.s || 1, w: v.w || 0, h: v.h || 0 };',
  '      var el = elOf(key);',
  '      if (el) apply(el);',
  '      placeGrip();',
  '      notify();',
  '    },',
  '    /* 把中心点挪到页面坐标 (x, y)：算差值再补到百分比位移上 */',
  '    setCenter: function (key, x, y) {',
  '      var el = elOf(key);',
  '      if (!el) return;',
  '      var m = metrics(el);',
  '      var v = state[key];',
  '      v.dx = Math.round(((v.dx || 0) + (x - m.pageX) / Math.max(1, m.layW) * 100) * 10) / 10;',
  '      v.dy = Math.round(((v.dy || 0) + (y - m.pageY) / Math.max(1, m.layH) * 100) * 10) / 10;',
  '      apply(el);',
  '      placeGrip();',
  '      notify();',
  '    },',
  '    setSize: function (key, w, h) {',
  '      var el = elOf(key);',
  '      if (!el) return;',
  '      resizeFrom(el, w, h);',
  '      placeGrip();',
  '      notify();',
  '    },',
  '    setScale: function (key, s) {',
  '      var el = elOf(key);',
  '      if (!el) return;',
  '      state[key].s = Math.min(5, Math.max(0.2, s));',
  '      apply(el);',
  '      placeGrip();',
  '      notify();',
  '    },',
  '    reset: function (key) {',
  '      state[key] = { dx: 0, dy: 0, s: 1, w: 0, h: 0 };',
  '      var el = elOf(key);',
  '      if (el) apply(el);',
  '      placeGrip();',
  '      notify();',
  '    },',
  '    resetAll: function () { nodes.forEach(function (n) { window.__layoutApi.reset(n.dataset.edit); }); },',
  '    pick: function (key) {',
  '      var el = elOf(key);',
  '      if (el) { select(el); placeGrip(); }',
  '    }',
  '  };',
  '  window.parent.postMessage({ type: "layout-ready" }, "*");',
  '})();',
].join('\n');

let layoutState = null;
/** iframe 里当前选中的元素 key，重置按钮要用 */
let layoutPicked = null;
/** 数字面板是不是正在被用户输入（输入过程中别用拖动值覆盖他） */
let layoutNumTyping = false;

/** 当前选中元素的实际数字：中心点 / 宽高 / 缩放 */
function layoutMetrics(key) {
  const win = els.layoutFrame.contentWindow;
  if (!win || !win.__layoutApi || !key) return null;
  try {
    return win.__layoutApi.metrics(key);
  } catch {
    return null;
  }
}

/** 把数字回填到输入框（用户正在打字时不动他的框） */
function fillLayoutNumbers(key) {
  const m = layoutMetrics(key);
  if (!m) {
    els.layoutNum.hidden = true;
    return;
  }
  els.layoutNum.hidden = false;
  const set = (el, v) => {
    if (document.activeElement === el || layoutNumTyping) return;
    el.value = v;
  };
  set(els.lnX, m.x);
  set(els.lnY, m.y);
  set(els.lnW, m.w);
  set(els.lnH, m.h);
  set(els.lnS, m.s);
}

/** 数字面板 → iframe */
function bindLayoutNumbers() {
  const call = (fn, ...args) => {
    const win = els.layoutFrame.contentWindow;
    if (!win || !win.__layoutApi || !layoutPicked) return;
    win.__layoutApi[fn](layoutPicked, ...args);
    fillLayoutNumbers(layoutPicked);
  };
  const num = (el) => {
    const n = Number(el.value);
    return Number.isFinite(n) && el.value !== '' ? n : null;
  };

  // 一边打字一边应用，改完不用回车
  for (const el of [els.lnX, els.lnY]) {
    el.addEventListener('input', () => {
      layoutNumTyping = true;
      const x = num(els.lnX);
      const y = num(els.lnY);
      if (x !== null && y !== null) call('setCenter', x, y);
      layoutNumTyping = false;
    });
  }
  for (const el of [els.lnW, els.lnH]) {
    el.addEventListener('input', () => {
      layoutNumTyping = true;
      const w = num(els.lnW) ?? layoutMetrics(layoutPicked)?.w ?? 100;
      const h = num(els.lnH) ?? layoutMetrics(layoutPicked)?.h ?? 60;
      call('setSize', w, h);
      layoutNumTyping = false;
    });
  }
  els.lnS.addEventListener('input', () => {
    layoutNumTyping = true;
    const s = num(els.lnS);
    if (s !== null) call('setScale', s);
    layoutNumTyping = false;
  });
}

async function openLayoutModal() {
  markWorkspaceActive('layout');
  els.layoutModal.hidden = false;
  /*
    每次打开都重新载一页会很稳，但**等于把拖动结果全扔了**。
    所以载过一次就一直用着：iframe 只是被藏起来，没被销毁，
    草稿由 layoutDrafts 记着（见 loadLayoutPage / closeLayoutModal）。
  */
  if (layoutLoadedPage === layoutPage) return;
  await loadLayoutPage(layoutPage);
}

/**
 * 每个页面类型在 iframe 里改过、还没保存的排版草稿。
 *
 * 排版的改动只活在 iframe 里，而换页、关面板都会把 iframe 重新载一次；
 * 不先收一把，用户拖了半天的位置一关面板就没了。
 */
const layoutDrafts = new Map();
/** iframe 里现在载着的是哪一类页面（没载就是 null） */
let layoutLoadedPage = null;

/** 把 iframe 里现在的排版结果收进草稿 */
function stashLayoutDraft() {
  if (!layoutLoadedPage) return;
  const win = els.layoutFrame.contentWindow;
  if (!win || !win.__layoutApi) return;
  try {
    layoutDrafts.set(layoutLoadedPage, JSON.parse(JSON.stringify(win.__layoutApi.state)));
  } catch {
    /* iframe 已经走了 / 读不到：收不到就算了，别把整件事弄挂 */
  }
}

/** 把某个页面类型的样板页载进 iframe */
async function loadLayoutPage(page) {
  // 换页之前先把上一页的改动收起来，不然换过去就找不回来了
  stashLayoutDraft();
  layoutPage = page;
  els.layoutPage.value = page;
  els.layoutPick.textContent = '正在载入页面…';
  els.layoutPick.style.color = '';

  // 大板块页有很多个（每层版块一页），让用户挑一个当样板；其它类型没得挑
  if (page === 'board') {
    await fillBoardSampleSelect();
    if (els.layoutSampleWrap) els.layoutSampleWrap.hidden = false;
  } else if (els.layoutSampleWrap) {
    els.layoutSampleWrap.hidden = true;
  }

  const sample = await resolveSample(page);

  try {
    const [pageRes, layRes] = await Promise.all([
      // 走服务端代理，不直接 fetch 4321 —— 那是跨源，会被 CORS 挡掉
      fetch(`/api/preview?path=${encodeURIComponent(sample)}`, { cache: 'no-store' }),
      fetch('/api/layout'),
    ]);
    if (!pageRes.ok) {
      const detail = await pageRes.text().catch(() => '');
      let msg = `HTTP ${pageRes.status}`;
      try {
        msg = JSON.parse(detail).error || msg;
      } catch {
        /* 不是 JSON 就用状态码 */
      }
      throw new Error(msg);
    }
    if (!layRes.ok) throw new Error(`读取排版数据失败 HTTP ${layRes.status}`);

    layoutState = await layRes.json();
    layoutPicked = null;

    let html = await pageRes.text();
    // 让页面里的相对路径都指向预览服务（iframe 本身是 srcdoc，没有自己的地址）
    html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${PREVIEW_URL}${sample}">`);
    html = html.replace(/<\/body>/i, `<script>${LAYOUT_SCRIPT}<\/script></body>`);

    els.layoutFrame.srcdoc = html;
    layoutLoadedPage = page; // layout-ready 回来时要按这一页的草稿还原
    els.layoutPick.textContent = '点一个元素选中它';
  } catch (err) {
    layoutLoadedPage = null;
    els.layoutPick.textContent = `载入失败：${err.message}`;
    els.layoutPick.style.color = 'var(--danger, #b4443a)';
  }
}

/** 把构建时写进页面里的初始值和编辑器里存的值合并 */
function mergeLayout(iframeState) {
  if (!layoutState || !layoutState.home) return iframeState;
  const merged = {};
  for (const [key, v] of Object.entries(iframeState)) {
    const saved = layoutState.home[key];
    // w / h 也要带上：漏了的话「改过像素宽高」的元素一进来就被还原成自动尺寸
    merged[key] = saved
      ? { dx: saved.dx || 0, dy: saved.dy || 0, s: saved.s || 1, w: saved.w || 0, h: saved.h || 0 }
      : v;
  }
  return merged;
}

async function saveLayout() {
  const win = els.layoutFrame.contentWindow;
  if (!win || !win.__layoutApi) {
    toast('页面还没载入好', true);
    return;
  }
  try {
    const res = await fetch('/api/layout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // 只提交当前这一类页面；服务端会合并，别的页面不受影响
      body: JSON.stringify({ pages: { [layoutPage]: win.__layoutApi.state } }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    layoutState = data;
    closeLayoutModal();
    // 存进去的草稿就算用完了：再打开时该显示盘上的值
    layoutDrafts.delete(layoutPage);
    toast('排版已保存，重新构建后生效');
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
  }
}

function closeLayoutModal() {
  // 先收草稿再拆 iframe —— 反过来就什么都收不到了
  stashLayoutDraft();
  els.layoutModal.hidden = true;
  els.layoutFrame.srcdoc = '';
  layoutLoadedPage = null;
  layoutPicked = null;
  if (els.layoutNum) els.layoutNum.hidden = true;
}

/* ---------------------------------------------------------------
   保存 / 删除
   --------------------------------------------------------------- */

async function save() {
  if (state.saving) return;
  if (!state.current) startNew({ focus: false });

  const fm = collectForm();
  if (!fm.title) {
    toast('标题不能为空', true);
    els.title.focus();
    return;
  }
  if (!fm.date) {
    toast('请选择日期', true);
    els.date.focus();
    return;
  }

  const body = els.body.value;
  const previousFile = state.current.file;
  state.saving = true;
  els.btnSave.disabled = true;

  try {
    let res;
    try {
      res = await apiPost('/api/save', { type: state.type, file: previousFile || '', frontmatter: fm, body });
    } catch (err) {
      if (err.status === 409 && err.data && err.data.suggested) {
        const okGo = confirm(`${err.message}\n\n是否改用文件名「${err.data.suggested}」保存？`);
        if (!okGo) {
          toast('已取消保存', true);
          return;
        }
        res = await apiPost('/api/save', {
          type: state.type,
          file: err.data.suggested,
          frontmatter: fm,
          body,
        });
      } else {
        throw err;
      }
    }

    state.current.file = res.file;
    state.current.frontmatter = fm;
    state.current.body = body;
    clearDraft(state.type, previousFile);
    clearDraft(state.type, res.file);
    setDirty(false);
    renderFilename();
    updateDocTitle();
    els.editMeta.textContent = '';
    toast(`已保存 ${res.file}`);
    await refreshList(state.type);
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
  } finally {
    state.saving = false;
    els.btnSave.disabled = false;
  }
}

async function deleteItem(item) {
  const name = item.title || item.file;
  if (!confirm(`确定删除《${name}》吗？\n文件：${item.file}\n删除后无法撤销。`)) return;
  try {
    await apiPost('/api/delete', { type: state.type, file: item.file });
  } catch (err) {
    toast(`删除失败：${err.message}`, true);
    return;
  }
  clearDraft(state.type, item.file);
  toast(`已删除 ${item.file}`);

  const wasCurrent = state.current && state.current.file === item.file;
  await refreshList(state.type);
  if (wasCurrent) {
    state.current = null;
    setDirty(false);
    const remaining = state.items[state.type] || [];
    if (remaining.length) await openItem(remaining[0].file, { askRestore: false });
    else startNew({ focus: false });
  }
}

/* ---------------------------------------------------------------
   类型切换
   --------------------------------------------------------------- */

async function switchType(type) {
  if (!TYPE_LABEL[type] || type === state.type) return;
  if (state.dirty) {
    writeDraft();
    if (!confirm(`「${TYPE_LABEL[state.type]}」这边还有未保存的修改（已暂存为草稿）。确定要切换到${TYPE_LABEL[type]}吗？`)) {
      return;
    }
  }

  state.type = type;
  document.body.dataset.type = type;
  for (const tab of Array.from(els.typeTabs.querySelectorAll('.tab'))) {
    tab.classList.toggle('is-active', tab.dataset.type === type);
  }
  // 草稿已经落到 localStorage，这里清掉脏标记，免得 openItem 再问一次
  setDirty(false);

  await refreshList(type);

  const items = state.items[type] || [];
  if (items.length) await openItem(items[0].file, { askRestore: true });
  else startNew({ focus: false });
}

/* ---------------------------------------------------------------
   音乐 / 歌单

   曲库和每个页面的歌单都在 src/data/music.json 里，页面 key 由服务端
   按站点那套规则算好（和 src/utils/music.ts 完全一致）。

   打开面板时 GET 一次，之后改标题、换顺序、选第一首、移出歌单都只动
   内存里的草稿；点「保存并重新构建」才整份写回并跑一次构建。
   只有「上传」和「从曲库删除」是当场落盘的动作（服务端那边做，
   故意不每次构建 —— 连着传十首不用等十次构建）。
   --------------------------------------------------------------- */

/** 草稿：{ tracks: [...], pages: { key: { first, list } } } */
let musicDraft = null;
/** 服务端算好的全站页面清单 */
let musicPagesList = [];
/** 单首音频上限（服务端给的，界面上报错时用） */
let musicLimits = { maxBytes: 40 * 1024 * 1024 };
/** 当前选中的页面 key */
let musicKey = '*';
/** 左栏筛选词 */
let musicSearch = '';
/** 曲库区是不是展开的 */
let musicLibOpen = false;
/** 有没保存的改动 */
let musicDirty = false;

/** 左栏分组，顺序就是显示顺序 */
const MUSIC_GROUPS = [
  { id: 'all', label: '通用' },
  { id: 'home', label: '首页' },
  { id: 'list', label: '列表页' },
  { id: 'board', label: '板块页' },
  { id: 'posts', label: '文章' },
  { id: 'notes', label: '手记' },
];

/** 一个页面归到哪一组：文章和手记都是 entry，但清单里分开放好找 */
function musicGroupOf(page) {
  if (page.kind === 'entry') return page.key.startsWith('entry:notes:') ? 'notes' : 'posts';
  return page.kind;
}

function musicPageOf(key) {
  return musicPagesList.find((p) => p.key === key) ?? null;
}

function musicTrackById(id) {
  return (musicDraft?.tracks ?? []).find((t) => t.id === id) ?? null;
}

/** 草稿里这一页的条目；create=true 时没有就建一个 */
function musicEntry(key, create = false) {
  if (!musicDraft) return null;
  let page = musicDraft.pages[key];
  if (!page || typeof page !== 'object') {
    if (!create) return null;
    page = { first: null, list: [] };
    musicDraft.pages[key] = page;
  }
  if (!Array.isArray(page.list)) page.list = [];
  if (page.first === undefined) page.first = null;
  return page;
}

/** 这一页草稿里有几首（first 不在 list 里也算一首 —— 站点会把它补进去） */
function musicCountOf(key) {
  const page = musicDraft?.pages?.[key];
  if (!page || typeof page !== 'object') return 0;
  const list = Array.isArray(page.list) ? page.list.filter((id) => musicTrackById(id)) : [];
  const first = page.first && musicTrackById(page.first) ? page.first : null;
  return list.length + (first && !list.includes(first) ? 1 : 0);
}

function setMusicStatus(text, isError = false) {
  els.musicStatus.textContent = text || '';
  els.musicStatus.classList.toggle('is-error', Boolean(isError));
}

function markMusicDirty() {
  musicDirty = true;
  const page = musicPageOf(musicKey);
  setMusicStatus(`「${page?.label ?? musicKey}」有没保存的改动 —— 点右下角「保存并重新构建」才会进网站`);
}

/** 把服务端返回的 music 收进草稿 */
function adoptMusic(music) {
  musicDraft = {
    tracks: Array.isArray(music?.tracks) ? music.tracks : [],
    pages: music && typeof music.pages === 'object' && music.pages ? music.pages : {},
  };
  musicDirty = false;
}

async function loadMusic() {
  const data = await apiGet('/api/music');
  adoptMusic(data?.music);
  if (Array.isArray(data?.pages)) musicPagesList = data.pages;
  const max = Number(data?.limits?.maxBytes);
  if (Number.isFinite(max) && max > 0) musicLimits = { maxBytes: max };
  // 选中的页面在清单里没了（版块被删了之类）就退回通用歌单
  if (!musicPagesList.some((p) => p.key === musicKey)) {
    musicKey = musicPagesList.length ? musicPagesList[0].key : '*';
  }
}

async function openMusicModal() {
  markWorkspaceActive('music');
  els.musicModal.hidden = false;
  els.musicLog.hidden = true;
  els.musicLog.textContent = '';
  els.musicPages.textContent = '';
  els.musicTrackList.textContent = '';
  els.musicLib.textContent = '';
  setMusicStatus('正在读取歌单…');
  try {
    /*
      已经有草稿就不重新拉一次：重拉会把「排好的顺序、选好的第一首」
      全按盘上的旧值覆盖掉 —— 切面板不该丢改动。想放弃改动就刷新页面。
    */
    if (!musicDraft) await loadMusic();
    els.musicSearch.value = musicSearch;
    renderMusic();
    setMusicStatus(
      musicDirty
        ? '有没保存的改动 —— 点右下角「保存并重新构建」才会进网站'
        : `已读取：曲库 ${musicDraft.tracks.length} 首，单首上限 ${Math.round(musicLimits.maxBytes / 1024 / 1024)}MB`
    );
  } catch (err) {
    setMusicStatus(`读取失败：${err.message}`, true);
    toast(`读取歌单失败：${err.message}`, true);
  }
}

function closeMusicModal() {
  els.musicModal.hidden = true;
  try {
    els.musicPlayer.pause();
  } catch {
    /* 没在播就无所谓 */
  }
}

function renderMusic() {
  renderMusicPages();
  renderMusicTracks();
}

/* ---------- 左栏：页面清单（按 kind 分组 + 筛选） ---------- */

function renderMusicPages() {
  const box = els.musicPages;
  box.textContent = '';

  const kw = musicSearch.trim().toLowerCase();
  const shown = kw
    ? musicPagesList.filter(
        (p) => (p.label || '').toLowerCase().includes(kw) || p.key.toLowerCase().includes(kw)
      )
    : musicPagesList;

  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'pw-tree__empty';
    li.textContent = musicPagesList.length ? '没有匹配的页面' : '没拿到页面清单';
    box.appendChild(li);
    return;
  }

  for (const group of MUSIC_GROUPS) {
    const items = shown.filter((p) => musicGroupOf(p) === group.id);
    if (!items.length) continue;

    const head = document.createElement('li');
    head.className = 'music__group';
    head.textContent = `${group.label}（${items.length}）`;
    box.appendChild(head);

    for (const page of items) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'music__page';
      if (page.key === musicKey) btn.classList.add('is-active');

      const text = document.createElement('span');
      text.className = 'music__page-text';
      const name = document.createElement('span');
      name.className = 'music__page-name';
      name.textContent = page.label || page.key;
      const key = document.createElement('em');
      key.className = 'music__page-key';
      key.textContent = page.href ? `${page.key} · ${page.href}` : page.key;
      key.title = key.textContent;
      text.append(name, key);

      const n = musicCountOf(page.key);
      const badge = document.createElement('span');
      badge.className = 'music__badge';
      if (n) badge.classList.add('is-on');
      badge.textContent = n ? String(n) : '—';
      badge.title = n ? `这一页有 ${n} 首` : '这一页还没有歌';

      btn.append(text, badge);
      btn.addEventListener('click', () => {
        musicKey = page.key;
        renderMusic();
      });
      li.appendChild(btn);
      box.appendChild(li);
    }
  }
}

/* ---------- 右栏：选中页面的歌单 ---------- */

function renderMusicTracks() {
  const box = els.musicTrackList;
  box.textContent = '';

  const page = musicPageOf(musicKey);
  els.musicCurrent.textContent = page ? `${page.label}（${musicKey}）` : musicKey;
  els.musicCurrent.title = page?.href ? `${musicKey} · ${page.href}` : musicKey;

  if (!page) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '没拿到页面清单，重新打开面板试试。';
    box.appendChild(p);
    renderMusicLibrary();
    return;
  }

  const entry = musicEntry(musicKey, false);
  const ids = entry ? entry.list.filter((id) => musicTrackById(id)) : [];
  const firstId = entry?.first && musicTrackById(entry.first) ? entry.first : null;

  const head = document.createElement('div');
  head.className = 'music__secthead';
  head.textContent = ids.length ? `这一页的歌单（${ids.length} 首，播放时随机轮播）` : '这一页还没有歌';
  box.appendChild(head);

  if (!ids.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '点右上角「上传音乐」，或者从下面的曲库里「加入本页歌单」。';
    box.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'music__rows';
    ids.forEach((id, i) => ul.appendChild(musicRow(id, i, ids.length, firstId, entry)));
    box.appendChild(ul);

    // 「不指定」也得有个选项，否则选了第一首就再也取消不掉
    const none = document.createElement('label');
    none.className = 'music__none';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'music-first';
    radio.checked = !firstId;
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      entry.first = null;
      markMusicDirty();
      renderMusicTracks();
    });
    const label = document.createElement('span');
    label.textContent = '不指定第一首（进入这一页随机挑一首播）';
    none.append(radio, label);
    box.appendChild(none);
  }

  renderMusicLibrary();
}

/** 歌单里的一行：曲名（可改）+ 上下移 + 试听 + 设为第一首 + 移出 */
function musicRow(id, index, total, firstId, entry) {
  const t = musicTrackById(id);
  const li = document.createElement('li');
  li.className = 'music__row';
  if (id === firstId) li.classList.add('is-first');

  const pick = document.createElement('input');
  pick.type = 'radio';
  pick.name = 'music-first';
  pick.className = 'music__pick';
  pick.checked = id === firstId;
  pick.title = '设为第一首：进入这一页一定先播这首';
  pick.addEventListener('change', () => {
    if (!pick.checked) return;
    entry.first = id;
    markMusicDirty();
    renderMusicTracks();
  });

  const title = document.createElement('input');
  title.type = 'text';
  title.className = 'input input--sm music__title';
  title.value = t.title;
  title.placeholder = '曲名';
  // 就地改名：失焦时才写进草稿，打字打到一半不会被打断
  title.addEventListener('blur', () => {
    const v = title.value.trim();
    if (!v || v === t.title) {
      title.value = t.title;
      return;
    }
    t.title = v;
    markMusicDirty();
  });

  const ops = document.createElement('div');
  ops.className = 'music__row-ops';

  const up = document.createElement('button');
  up.type = 'button';
  up.className = 'btn btn--sm btn--ghost music__mini';
  up.textContent = '↑';
  up.title = '往上挪';
  up.disabled = index === 0;
  up.addEventListener('click', () => {
    entry.list.splice(index, 1);
    entry.list.splice(index - 1, 0, id);
    markMusicDirty();
    renderMusicTracks();
  });

  const down = document.createElement('button');
  down.type = 'button';
  down.className = 'btn btn--sm btn--ghost music__mini';
  down.textContent = '↓';
  down.title = '往下挪';
  down.disabled = index === total - 1;
  down.addEventListener('click', () => {
    entry.list.splice(index, 1);
    entry.list.splice(index + 1, 0, id);
    markMusicDirty();
    renderMusicTracks();
  });

  const play = document.createElement('button');
  play.type = 'button';
  play.className = 'btn btn--sm btn--ghost music__mini';
  play.textContent = '▶';
  play.title = `试听：${t.title}`;
  play.addEventListener('click', () => {
    // 文件就在磁盘上，服务端把 /audio/uploads/ 发出来（serveAudio）
    els.musicPlayer.src = t.src;
    els.musicPlayer.play().catch((err) => toast(`试听失败：${err.message}`, true));
  });

  const out = document.createElement('button');
  out.type = 'button';
  out.className = 'btn btn--sm btn--ghost music__mini';
  out.textContent = '移出';
  out.title = '移出本页歌单（只改草稿，保存后才生效）';
  out.addEventListener('click', () => {
    entry.list = entry.list.filter((x) => x !== id);
    if (entry.first === id) entry.first = null;
    markMusicDirty();
    renderMusicTracks();
    renderMusicPages();
  });

  ops.append(up, down, play, out);
  li.append(pick, title, ops);
  return li;
}

/* ---------- 曲库（可折叠） ---------- */

function renderMusicLibrary() {
  const box = els.musicLib;
  box.textContent = '';
  const tracks = musicDraft?.tracks ?? [];

  els.musicLibToggle.textContent = `曲库（${tracks.length} 首）${musicLibOpen ? ' ▾' : ' ▸'}`;
  els.musicLibToggle.setAttribute('aria-expanded', musicLibOpen ? 'true' : 'false');
  box.hidden = !musicLibOpen;
  if (!musicLibOpen) return;

  if (!tracks.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '曲库是空的，先上传一首。';
    box.appendChild(p);
    return;
  }

  const entry = musicEntry(musicKey, false);
  const inPage = new Set(entry ? entry.list : []);
  const hasPage = Boolean(musicPageOf(musicKey));

  const ul = document.createElement('ul');
  ul.className = 'music__rows';
  for (const t of tracks) {
    const li = document.createElement('li');
    li.className = 'music__row music__row--lib';

    const text = document.createElement('span');
    text.className = 'music__libtext';
    const name = document.createElement('span');
    name.className = 'music__libname';
    name.textContent = t.title;
    const meta = document.createElement('em');
    meta.className = 'music__libmeta';
    meta.textContent = [
      t.bytes ? `${Math.round(t.bytes / 1024)} KB` : '',
      t.addedAt ? String(t.addedAt).slice(0, 10) : '',
      t.src,
    ]
      .filter(Boolean)
      .join(' · ');
    text.append(name, meta);

    const ops = document.createElement('div');
    ops.className = 'music__row-ops';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--sm btn--ghost music__mini';
    add.textContent = inPage.has(t.id) ? '已在歌单' : '加入本页歌单';
    add.disabled = inPage.has(t.id) || !hasPage;
    add.addEventListener('click', () => {
      const page = musicEntry(musicKey, true);
      if (!page) return;
      if (!page.list.includes(t.id)) page.list.push(t.id);
      markMusicDirty();
      renderMusicTracks();
      renderMusicPages();
    });

    const play = document.createElement('button');
    play.type = 'button';
    play.className = 'btn btn--sm btn--ghost music__mini';
    play.textContent = '▶';
    play.title = `试听：${t.title}`;
    play.addEventListener('click', () => {
      els.musicPlayer.src = t.src;
      els.musicPlayer.play().catch((err) => toast(`试听失败：${err.message}`, true));
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--sm btn--ghost music__mini btn--danger';
    del.textContent = '删除';
    del.title = '从曲库删掉，音频文件一起删（会再问一次）';
    del.addEventListener('click', () => removeMusicTrack(t.id));

    ops.append(add, play, del);
    li.append(text, ops);
    ul.appendChild(li);
  }
  box.appendChild(ul);
}

/* ---------- 上传 / 删除 / 保存 ---------- */

async function uploadMusicFiles(files) {
  const list = Array.from(files || []);
  if (!list.length || !musicDraft) return;

  const targetKey = musicPageOf(musicKey) ? musicKey : '';
  const btn = els.musicUpload;
  const wasText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在上传…';
  let okCount = 0;

  try {
    for (let i = 0; i < list.length; i++) {
      const file = list[i];
      setMusicStatus(`正在上传第 ${i + 1}/${list.length} 首：${file.name}`);
      // 请求体就是 File 本身（原始二进制），服务端边收边写盘，不走 JSON
      const url = `/api/music/upload?name=${encodeURIComponent(file.name)}&key=${encodeURIComponent(targetKey)}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream' },
          body: file,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
          throw new Error((data && data.error) || `HTTP ${res.status}`);
        }
        /*
          只把新的这一首并进本地草稿：草稿里可能还有没保存的改动，
          拿服务端那份整个覆盖会把它们冲掉。文件和数据文件服务端已经写好了。
        */
        const track = data.track;
        if (track && !musicDraft.tracks.some((x) => x.id === track.id)) {
          musicDraft.tracks.push(track);
        }
        if (targetKey && track) {
          const page = musicEntry(targetKey, true);
          if (page && !page.list.includes(track.id)) page.list.push(track.id);
        }
        if (Array.isArray(data.pages)) musicPagesList = data.pages;
        okCount++;
        /*
          服务端上传时会顺手压成 128kbps（原盘 320kbps 一首 8MB，压完约 3MB）。
          这里把压前压后报给用户看，和图片那边一样是真实数字；跳过/失败也说明原因。
        */
        const c = data.compression;
        const note =
          c && c.before && c.after && c.after < c.before
            ? `（已压缩 ${fmt(c.before)} → ${fmt(c.after)}）`
            : c && c.reason
              ? `（${c.reason}）`
              : '';
        toast(`第 ${i + 1}/${list.length} 首好了：${track?.title ?? file.name}${note}`);
        renderMusic();
      } catch (err) {
        toast(`第 ${i + 1}/${list.length} 首（${file.name}）失败：${err.message}`, true);
      }
    }
  } finally {
    btn.disabled = false;
    btn.textContent = wasText;
    els.musicFile.value = '';
  }

  const limitMb = Math.round(musicLimits.maxBytes / 1024 / 1024);
  setMusicStatus(
    okCount === list.length
      ? `${okCount} 首都上传好了（单首上限 ${limitMb}MB）—— 文件已经落盘，点「保存并重新构建」才会上网站`
      : `上传完成：成功 ${okCount} / ${list.length} 首（单首上限 ${limitMb}MB）`,
    okCount !== list.length
  );
}

async function removeMusicTrack(id) {
  const t = musicTrackById(id);
  if (!confirm(`从曲库删掉「${t?.title ?? id}」？音频文件也会一起删掉，删了就找不回来了。`)) return;
  if (musicDirty && !confirm('还有没保存的改动：删除以服务端那份为准，这些改动会被冲掉。继续吗？')) {
    return;
  }
  try {
    const data = await apiPost('/api/music/remove', { id, deleteFile: true });
    adoptMusic(data?.music);
    renderMusic();
    setMusicStatus('已从曲库删除（文件也删了）—— 重新构建后网站上同步');
    toast(`已删除：${t?.title ?? id}`);
  } catch (err) {
    setMusicStatus(`删除失败：${err.message}`, true);
    toast(`删除失败：${err.message}`, true);
  }
}

async function saveMusic() {
  if (!musicDraft) return;
  const btn = els.musicSave;
  const wasText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在保存…';
  setMusicStatus('正在写回歌单并重新构建…');

  try {
    const data = await apiPost('/api/music', {
      music: { tracks: musicDraft.tracks, pages: musicDraft.pages },
    });
    // 存完拿服务端那份重画：写回去的是清洗过的，界面上看到的要和落盘一致
    await loadMusic();
    renderMusic();

    const d = data?.dropped ?? {};
    const lost = [];
    if (d.tracks) lost.push(`${d.tracks} 首曲目`);
    if (d.pages) lost.push(`${d.pages} 个页面条目`);
    if (d.list) lost.push(`${d.list} 个歌单引用`);
    if (d.first) lost.push(`${d.first} 个「第一首」`);

    setMusicStatus(
      `已保存并重新构建（${data?.ms ?? '?'} ms）` + (lost.length ? ` · 服务端丢掉了 ${lost.join('、')}` : ''),
      lost.length > 0
    );
    if (data?.output) {
      els.musicLog.textContent = data.output;
      els.musicLog.hidden = false;
    }
    toast(
      lost.length ? `保存并构建好了，但有 ${lost.join('、')} 没存下` : '歌单已保存并重新构建，刷新页面就能看到',
      lost.length > 0
    );
  } catch (err) {
    setMusicStatus(`保存失败：${err.message}`, true);
    toast(`保存失败：${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = wasText;
  }
}

/* ===============================================================
   首页那几块 + 冰室精华（后加的五块面板）

   数据两份，都在 src/data/ 下：
     home-widgets.json   about / calendar / iceberg / daily
                         → 面板：日历、关于我、冰室冰山
     salon.json          eras / members / essences
                         → 面板：精华、成员

   三条贯穿这几个面板的规矩（照着站点那边的数据契约来的）：

   1. **一个文件、一份草稿。** 写 home-widgets.json 的三个面板共用
      widgetsDraft，写 salon.json 的两个面板共用 salonDraft。面板之间切换
      只是把 DOM 藏起来，草稿一直在内存里 —— 和 boardsDraft / navsDraft 一样，
      改过没保存的内容切走再切回来还在。保存时把整份草稿发上去，
      服务端再逐块清洗（没带的块原样保留），所以「在「成员」里保存」
      绝不会把 735 条精华碰掉。

   2. **成员和精华只靠 id 绑定。** 精华里只存 memberId，名字和头像只在
      members 表里。站点渲染时（src/utils/salon.ts 的 memberName /
      memberAvatar）现查成员表，所以改了名字 / 换了头像，这个人所有的精华
      ——包括首页那条「每日精华」—— 一起跟着变。这里的编辑代码一个字节
      都不往 essences 里塞 name / avatar，服务端写回时也只挑白名单字段。

   3. **改了要保存 + 重新构建才看得到。** 数据落盘只是第一步，
      首页 / /salon/ / /about-me/ / /iceberg/ 都是构建期读这些 JSON 的，
      所以每个面板的保存按钮都跟着跑一次 /api/build（和导航 / 音乐一致）。
   =============================================================== */

/**
 * 五个面板共用的外壳：顶上一排「切换」小按钮 + 标题 + 说明 + 内容区 + 底部动作条。
 *
 * 换成「页面 / 独立页面」那种整块搬 DOM 的做法没必要 —— 这五块各自
 * 只有一份内容，没有共用控件的需求，一个外壳函数就够了。
 */
function panelShell(host, { hint = '', group = '' } = {}) {
  host.textContent = '';
  const wrap = document.createElement('div');
  wrap.className = 'wpanel';

  const sw = document.createElement('span');
  sw.className = 'wsswitch';
  sw.dataset.wsSlot = '';
  wrap.appendChild(sw);

  if (hint) {
    const p = document.createElement('p');
    p.className = 'hint wpanel__hint';
    p.textContent = hint;
    wrap.appendChild(p);
  }

  const body = document.createElement('div');
  body.className = 'wpanel__body';
  wrap.appendChild(body);

  const bar = document.createElement('div');
  bar.className = 'wpanel__bar';
  const status = document.createElement('span');
  status.className = 'wpanel__status';
  bar.appendChild(status);
  wrap.appendChild(bar);

  host.appendChild(wrap);
  paintWorkspaceSwitch();   // 新插进来的 [data-ws-slot] 要立刻填上按钮
  /*
    草稿保护要连「有改动没保存」这句话一起保住：切走再切回来，内容还在、
    状态栏却变回空白，看起来就像改动已经存过了（踩过一次）。

    ⚠ 这里必须说清是**哪一组**的脏标记：写成 markPanelDirty(status)
    会把 home-widgets 和 salon 两组一起标脏，于是「在日历里改一笔」
    会让「精华」面板也显示有改动（踩过第二次）。所以传 group 进来，
    由 markPanelDirty 自己去查那一组的标记。
  */
  const dirty = group === 'salon' ? salonDirty : group === 'widgets' ? widgetsDirty : group === 'iceberg' ? iceDirty : false;
  if (dirty) markPanelDirty(status, group);
  return { body, foot: bar, status };
}

/** 底部动作条上的一个按钮 */
function panelBtn(text, title, onClick, primary = false, id = '') {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = primary ? 'btn btn--primary' : 'btn btn--ghost';
  b.textContent = text;
  if (title) b.title = title;
  if (id) b.id = id;
  b.addEventListener('click', onClick);
  return b;
}

/** 内容区里一块带标题的卡片。编辑区全是这种块，面板长得才一致 */
function panelBox(title, hint = '') {
  const box = document.createElement('section');
  box.className = 'wbox';
  if (title) {
    const h = document.createElement('h4');
    h.className = 'wbox__title';
    h.textContent = title;
    box.appendChild(h);
  }
  if (hint) {
    const p = document.createElement('p');
    p.className = 'hint wbox__hint';
    p.textContent = hint;
    box.appendChild(p);
  }
  return box;
}

/** 一行「标签 + 控件」，各处表单用同一套对齐 */
function panelRow(labelText, control, hint = '') {
  const row = document.createElement('div');
  row.className = 'wrow';
  const lab = document.createElement('label');
  lab.className = 'wrow__label';
  lab.textContent = labelText;
  const cell = document.createElement('div');
  cell.className = 'wrow__cell';
  cell.appendChild(control);
  if (hint) {
    const p = document.createElement('p');
    p.className = 'hint wrow__hint';
    p.textContent = hint;
    cell.appendChild(p);
  }
  row.append(lab, cell);
  return row;
}

/** 多行文本框（正文 / 说明用），高度按行数给 */
function panelArea(value, placeholder, rows, onInput) {
  const ta = document.createElement('textarea');
  ta.className = 'input warea';
  ta.rows = rows;
  ta.placeholder = placeholder || '';
  ta.value = value ?? '';
  ta.addEventListener('input', () => onInput(ta.value));
  return ta;
}

/**
 * 编辑器里给图片做缩略图用的地址。
 *
 * **一律走编辑器自己这个服务（相对路径）**，不指到预览服务 4321：
 *   · 4321 发的是构建产物 dist，而**上传的图要等下一次构建才会进 dist** ——
 *     用户刚拖一张图进来，缩略图就是 404 破图，看着像没传上去（踩过一次）；
 *   · 编辑器自己的服务直接发 `public/`（tools/editor/server.mjs 的 serveImage），
 *     文件一落盘就能看见，改完地址框也是立刻生效。
 * 站内路径照样是 `/img/...`，存进数据里和站点上的写法完全一致，不用转换。
 */
function previewImgSrc(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  return s.startsWith('/') ? s : `/${s}`;
}

/**
 * 一个图片上传点：缩略图 + 「选图片」按钮 + 可选的「清空」。
 *
 * 三条路（点按钮 / 拖进来 / 截图 Ctrl+V）全走 attachImageIntake，
 * 和封面图、地图图、页面图片块是同一套 —— 从 QQ 拖进来和 Ctrl+V 都认。
 * `getValue` 每次都从数据里现读，所以面板重画之后缩略图还是对的。
 *
 * `onValue(v)` 是给**同一个面板里那个手填的地址输入框**用的：缩略图能当场重画，
 * 可那个输入框是另一个控件，不通知它就一直是旧值 —— 用户刚拖完图，看见
 * 「头像图」换了、下面「头像地址」还空着，会以为没传上去（踩过一次）。
 * 那个输入框自己的 input 回调里调 `slot.sync(v, true)`（true = 不用再回头写它一遍）。
 */
function imageSlot({ label, getValue, setValue, onChanged, onValue, accept, multiple = false, hint = '' }) {
  const wrap = document.createElement('div');
  wrap.className = 'wimg';

  const thumb = document.createElement('span');
  thumb.className = 'wimg__thumb';
  const paint = () => {
    const v = String(getValue() || '').trim();
    thumb.textContent = '';
    if (v) {
      const img = document.createElement('img');
      img.src = previewImgSrc(v);
      img.alt = '';
      img.loading = 'lazy';
      thumb.appendChild(img);
      thumb.title = v;
      thumb.classList.remove('wimg__thumb--empty');
    } else {
      thumb.classList.add('wimg__thumb--empty');
      thumb.textContent = '还没传';
      thumb.title = '还没传图';
    }
  };
  paint();

  /*
    写进数据 + 立刻把缩略图和旁边那个地址输入框一起刷新。
    上传（拖 / 粘 / 选文件）和清空都走这儿，保证几处显示永远是一个值。
  */
  const write = (v) => {
    setValue(v);
    paint();
    onValue?.(v);
    onChanged?.();
  };

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = accept || IMAGE_ACCEPT;
  if (multiple) file.multiple = true;
  file.hidden = true;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn btn--ghost boardedit__mini';
  pick.textContent = '选图片';
  pick.title = '也可以直接把图拖进来，或 QQ 截图后 Ctrl+V';
  pick.addEventListener('click', () => file.click());

  const ops = document.createElement('div');
  ops.className = 'wimg__ops';
  ops.append(pick, file);

  if (!multiple) {
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn--ghost boardedit__mini boardedit__del';
    clear.textContent = '清空';
    clear.title = '把这一项改成空（留空时页面上会画占位）';
    clear.addEventListener('click', () => {
      write('');
    });
    ops.appendChild(clear);
  }

  attachImageIntake({
    el: wrap,
    input: file,
    multiple,
    label,
    onFiles: async (files) => {
      for (const f of files) {
        const p = await uploadImage(f);
        write(p);
        toast(`${label}已上传：${p}`);
      }
    },
    onUrl: (url) => {
      write(url);
      toast(`${label}地址已填上（拖进来的是链接）`);
    },
  });

  wrap.append(thumb, ops);
  if (hint) {
    const h = document.createElement('p');
    h.className = 'hint wimg__hint';
    h.textContent = hint;
    wrap.appendChild(h);
  }
  /* 地址输入框自己改了值之后叫一下：刷新缩略图，别反过来再写它一遍 */
  const sync = (v, skipOnValue = false) => {
    setValue(v);
    paint();
    if (!skipOnValue) onValue?.(v);
  };
  return { el: wrap, paint, sync };
}

/* ---------------------------------------------------------------
   日期：日历事件和精华都要挑一天
   --------------------------------------------------------------- */

/** 本地日期 → YYYY-MM-DD（不能用 toISOString：那是 UTC，晚上会差一天） */
function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 日期输入（日历事件 / 精华的日期都走这里）。
 *
 * ⚠ 以前这里是 `<input type="date">` —— 想填日期就得点开系统日历一层层翻
 * （用户这次的原话：「日历页面的时间可以和时间轴一样直接输入数字 不要展开日历点」）。
 * 现在跟时间轴那套**用同一个控件**：左边一个能直接敲数字的框
 * （`20260114` / `2026-1-14` / `2026/1/14` 都认，边打边补横杠），
 * 右边留一个 📅 按钮给"想翻日历"的人，但不点它就永远不会弹出来。
 * 「实时」那个开关是时间轴专有的（哨兵 `today`），这里不出现（hideLive）。
 *
 * 契约没变：值合法或清空时回调 `onInput(iso)`，读不出来就把框标红、不写数据。
 */
function dayPicker(value, onInput) {
  const wrap = dateField(value ?? '', (iso) => onInput(iso), { hideLive: true });
  wrap.classList.add('wdate');
  return wrap;
}

/* ---------------------------------------------------------------
   首页那三块：日历 / 关于我 / 冰室冰山
   --------------------------------------------------------------- */

/** src/data/home-widgets.json 的草稿（三个面板共用一份） */
let widgetsDraft = null;
/** 这一组有没有没保存的改动（切面板回来时状态栏要接着写「有改动没保存」） */
let widgetsDirty = false;

async function loadWidgets() {
  if (widgetsDraft) return widgetsDraft;
  const res = await fetch('/api/widgets');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  widgetsDraft = data && typeof data === 'object' ? data : {};
  if (!widgetsDraft.calendar || typeof widgetsDraft.calendar !== 'object') widgetsDraft.calendar = {};
  if (!widgetsDraft.calendar.events || typeof widgetsDraft.calendar.events !== 'object') {
    widgetsDraft.calendar.events = {};
  }
  if (!widgetsDraft.about || typeof widgetsDraft.about !== 'object') widgetsDraft.about = {};
  if (!widgetsDraft.iceberg || typeof widgetsDraft.iceberg !== 'object') widgetsDraft.iceberg = {};
  return widgetsDraft;
}

/**
 * 面板顶上的「有改动没保存」。
 *
 * group 要传对：写 home-widgets.json 的三个面板传 'widgets'、写 salon.json
 * 的两个传 'salon'、写 iceberg.json 的那个传 'iceberg'。在日历里改一笔不该让
 * 「精华」「冰山图」也跟着显示「有改动没保存」—— 这三份文件互不相干。
 */
function markPanelDirty(statusEl, group = '') {
  if (group === 'salon') salonDirty = true;
  else if (group === 'iceberg') iceDirty = true;
  else widgetsDirty = true;
  if (!statusEl) return;
  statusEl.textContent = '有改动没保存';
  statusEl.classList.add('is-dirty');
}

/**
 * 保存 home-widgets.json 并重新构建。
 *
 * 发的是**整份草稿**（三块一起带上）：写这个文件的三个面板共用一份草稿，
 * 只发自己那一块的话，另一块里「改了还没保存」的内容会被服务端的
 * 盘上值覆盖掉。服务端逐块清洗，所以多带不吃亏。
 */
async function saveWidgets(btn, statusEl) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在保存…';
  statusEl.textContent = '正在保存…';
  statusEl.classList.remove('is-dirty');
  try {
    const res = await fetch('/api/widgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(widgetsDraft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    widgetsDirty = false;
    const lost = data.dropped?.events
      ? `；有 ${data.dropped.events} 个特殊日子没存下（日期必须是 YYYY-MM-DD、名字不能空）`
      : '';
    if (data.built) {
      statusEl.textContent = `已保存并重新构建（${data.ms} ms）`;
      toast(`首页这几块已保存并重新构建（${data.ms} ms）${lost}`);
    } else {
      statusEl.textContent = '已保存，但重新构建没成功';
      toast(`已保存，但重新构建没成功：${String(data.output || '').split('\n')[0]}`, true);
    }
  } catch (err) {
    statusEl.textContent = `出错了：${err.message}`;
    statusEl.classList.add('is-dirty');
    toast(`保存失败：${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/** 三个首页面板共用的开场白：把草稿读回来（有草稿就不重读，改动不会丢） */
async function openWidgetPanel(id, modal, editor, active) {
  markWorkspaceActive(id);
  modal.hidden = false;
  editor.textContent = '正在读取…';
  try {
    await loadWidgets();
    return true;
  } catch (err) {
    editor.textContent = `读取失败：${err.message}`;
    return false;
  }
}

/* ---------- 日历 ---------- */

async function openCalendarModal() {
  if (!(await openWidgetPanel('calendar', els.calendarModal, els.calEditor))) return;
  renderCalendarPanel();
}

function closeCalendarModal() {
  els.calendarModal.hidden = true;
}

function renderCalendarPanel() {
  const cal = widgetsDraft.calendar;
  const { body, foot, status } = panelShell(els.calEditor, {
    hint:
      '首页日历上的特殊日子。日历显示的是**访问者当天那个月**，所以这里按 YYYY-MM-DD 匹配 —— ' +
      '写 2024-06-04 就是每年的 6 月 4 日都会变色（不看年份）；今天没有特殊日子时右下角那个小框写 idleText。',
    group: 'widgets',
  });

  /* ---- 两个句式 ---- */
  const texts = panelBox('今天那句话', '右下角小框里的文案。「{title}」会被换成那天事件的名字。');
  texts.appendChild(
    panelRow(
      '没有特殊日子',
      panelArea(cal.idleText ?? '', '今天依然是等待篠雨的一天', 1, (v) => {
        cal.idleText = v;
        markPanelDirty(status, 'widgets');
      }),
    )
  );
  texts.appendChild(
    panelRow(
      '有特殊日子',
      panelArea(cal.specialText ?? '', '今天是{title}', 1, (v) => {
        cal.specialText = v;
        markPanelDirty(status, 'widgets');
      }),
      '「{title}」是占位符，换成下面那张表里那天的名字。某一格自己填了「自定义文案」时，就用那一格自己的。',
    )
  );
  texts.appendChild(
    panelRow(
      '卡片标题',
      boardInput(cal.title ?? '', '日历', (v) => {
        cal.title = v;
        markPanelDirty(status, 'widgets');
      }),
    )
  );
  body.appendChild(texts);

  /* ---- 特殊日子表 ---- */
  const events = cal.events;
  const dates = Object.keys(events).sort();
  const list = panelBox(
    `特殊日子（${dates.length} 天）`,
    '日期**直接敲数字**就行（20260604 / 2026-6-4 / 2026/6/4 都认，边打边补横杠）；右边那个 📅 才是翻系统日历用的（不点就不会弹出来）。点那天的图标会跳到「跳去哪」那个地址；留空的话那天照样变色，只是点不动。',
  );

  if (!dates.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '还没有特殊日子。点下面的「＋ 添加一天」。';
    list.appendChild(p);
  }

  dates.forEach((date, i) => {
    const ev = events[date];
    const row = document.createElement('div');
    row.className = 'wcal-row';
    row.dataset.date = date;

    const head = document.createElement('div');
    head.className = 'wcal-row__head';
    const tag = document.createElement('em');
    tag.className = 'wcal-row__idx';
    tag.textContent = `#${i + 1}`;
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.title = '删掉这一天（那天就不再变色了）';
    del.addEventListener('click', () => {
      if (!confirm(`删掉 ${date}（${ev.title || '没写名字'}）这一天？`)) return;
      delete events[date];
      markPanelDirty(status, 'widgets');
      renderCalendarPanel();
    });
    head.append(tag, del);

    const fields = document.createElement('div');
    fields.className = 'wcal-row__fields';
    fields.appendChild(
      panelRow(
        '日期',
        dayPicker(date, (v) => {
          const next = String(v || '').trim();
          if (!next || next === date) return;
          if (events[next]) {
            toast(`${next} 已经有特殊日子了，先改那一天的日期`, true);
            renderCalendarPanel();
            return;
          }
          // 键换了：重建这一项，顺便保持原来的顺序（重画后按日期重排）
          events[next] = ev;
          delete events[date];
          markPanelDirty(status, 'widgets');
          renderCalendarPanel();
        }),
        '日历按**月-日**匹配，年份不参与判断（填 2004-07-14 就是每年 7 月 14 日都会变色）。日期直接敲数字就行。',
      )
    );
    fields.appendChild(
      panelRow(
        '是什么日子',
        boardInput(ev.title ?? '', '篠雨的生日', (v) => {
          ev.title = v;
          markPanelDirty(status, 'widgets');
        }),
      )
    );
    fields.appendChild(
      panelRow(
        '跳去哪',
        linkField(ev.href ?? '', '/about-me/ 或 https://…（留空就点不动）', (v) => {
          ev.href = v;
          markPanelDirty(status, 'widgets');
        }, { anchor: true }),
      )
    );
    fields.appendChild(
      panelRow(
        '自定义文案',
        panelArea(ev.text ?? '', '留空就用上面的句式（今天是{title}）', 2, (v) => {
          ev.text = v;
          markPanelDirty(status, 'widgets');
        }),
        '填了就不套上面那个句式，这一格整句照用。',
      )
    );

    row.append(head, fields);
    list.appendChild(row);
  });

  const add = panelBtn('＋ 添加一天', '加一个特殊日子，默认选今天', () => {
    const today = localDateKey();
    let key = today;
    let n = 2;
    while (events[key]) {
      // 同一天已经有就用「今天+N 天」，免得一按就撞
      const d = new Date();
      d.setDate(d.getDate() + (n - 1));
      key = localDateKey(d);
      n += 1;
    }
    events[key] = { title: '', href: '', text: '' };
    markPanelDirty(status, 'widgets');
    renderCalendarPanel();
  });
  list.appendChild(add);
  body.appendChild(list);

  foot.append(
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('重新读取', '把盘上的值重新读一遍（没保存的改动会丢）', async () => {
      if (!confirm('重新读盘会丢掉还没保存的改动，确定吗？')) return;
      widgetsDraft = null;
      widgetsDirty = false;
      await loadWidgets();
      renderCalendarPanel();
    }),
    panelBtn('打开首页', '在新标签页打开预览站点的首页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/home-widgets.json 并重新构建站点', () =>
      saveWidgets(els.calSave, status), true, 'cal-save'),
  );
  els.calSave = $('cal-save');
}

/* ---------- 关于我 ---------- */

async function openAboutModal() {
  if (!(await openWidgetPanel('about', els.aboutModal, els.aboutEditor))) return;
  renderAboutPanel();
}

function closeAboutModal() {
  els.aboutModal.hidden = true;
}

function renderAboutPanel() {
  const about = widgetsDraft.about;
  const { body, foot, status } = panelShell(els.aboutEditor, {
    hint:
      '左上角那个小圆片和 /about-me/ 页面都读这一份：avatar 是那个圆形头像，text 是页面里那段自我介绍（支持 Markdown）。',
    group: 'widgets',
  });

  const box = panelBox('头像', '存到 /img/uploads/ 下。没传的话页面上画一个带塔吊的占位圆。');
  /* 地址框和缩略图是同一个值的两个入口，所以互相同步（见 imageSlot 的 onValue / sync） */
  const avatarInput = boardInput(about.avatar ?? '', '/img/uploads/xxx.png 或 https://…', () => {});
  const slot = imageSlot({
    label: '头像',
    getValue: () => about.avatar,
    setValue: (v) => { about.avatar = v; },
    onValue: (v) => { avatarInput.value = v; },
    onChanged: () => markPanelDirty(status, 'widgets'),
    hint: '建议正方形；圆形裁剪是页面那边做的。',
  });
  // slot 建好了才挂这个回调（不然是 TDZ 里的 slot，一敲字就抛错）
  avatarInput.addEventListener('input', () => {
    slot.sync(avatarInput.value, true);
    markPanelDirty(status, 'widgets');
  });
  box.appendChild(panelRow('头像图', slot.el));
  box.appendChild(
    panelRow('头像地址', avatarInput, '也可以从别处拖一张图进来，或者直接把链接粘在这里。')
  );
  body.appendChild(box);

  const texts = panelBox('文字');
  texts.appendChild(
    panelRow(
      '标题',
      boardInput(about.title ?? '', '关于我', (v) => {
        about.title = v;
        markPanelDirty(status, 'widgets');
      }),
      '页头那个圆片的提示文字，也是 /about-me/ 页面上的大标题。不能留空。',
    )
  );
  texts.appendChild(
    panelRow(
      '正文',
      panelArea(about.text ?? '', '支持 **粗体**、[链接](地址)、- 列表、## 小标题', 12, (v) => {
        about.text = v;
        markPanelDirty(status, 'widgets');
      }),
      'Markdown，和文章正文一个写法（行内图片也认）。',
    )
  );
  texts.appendChild(
    panelRow(
      '跳转地址',
      linkField(about.href ?? '', '/about-me/', (v) => {
        about.href = v;
        markPanelDirty(status, 'widgets');
      }, { anchor: true }),
      '页头那个小圆片点一下去哪，默认 /about-me/。',
    )
  );
  body.appendChild(texts);

  foot.append(
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('打开 /about-me/', '在新标签页打开预览站点里的这一页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/about-me/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/home-widgets.json 并重新构建站点', () =>
      saveWidgets(els.aboutSave, status), true, 'about-save'),
  );
  els.aboutSave = $('about-save');
}

/* ---------- 冰室冰山 ---------- */

async function openIcebergModal() {
  if (!(await openWidgetPanel('iceberg', els.icebergModal, els.icebergEditor))) return;
  renderIcebergPanel();
}

function closeIcebergModal() {
  els.icebergModal.hidden = true;
}

function renderIcebergPanel() {
  const ice = widgetsDraft.iceberg;
  const { body, foot, status } = panelShell(els.icebergEditor, {
    hint: '首页中间那一块。图没传就画一个带塔吊的占位；链接留空的话整块不可点。',
    group: 'widgets',
  });

  const box = panelBox('这张图');
  const iceInput = boardInput(ice.image ?? '', '/img/uploads/xxx.png 或 https://…', () => {});
  const slot = imageSlot({
    label: '冰山图',
    getValue: () => ice.image,
    setValue: (v) => { ice.image = v; },
    onValue: (v) => { iceInput.value = v; },
    onChanged: () => markPanelDirty(status, 'widgets'),
  });
  // 同上：slot 有了才挂回调
  iceInput.addEventListener('input', () => {
    slot.sync(iceInput.value, true);
    markPanelDirty(status, 'widgets');
  });
  box.appendChild(panelRow('图片', slot.el));
  box.appendChild(panelRow('图片地址', iceInput));
  body.appendChild(box);

  const texts = panelBox('文字和链接');
  texts.appendChild(
    panelRow(
      '标题',
      boardInput(ice.title ?? '', '冰室冰山', (v) => {
        ice.title = v;
        markPanelDirty(status, 'widgets');
      }),
      '不能留空。',
    )
  );
  texts.appendChild(
    panelRow(
      '一句话介绍',
      panelArea(ice.text ?? '', '一句话就好', 3, (v) => {
        ice.text = v;
        markPanelDirty(status, 'widgets');
      }),
      '纯文本，这一块不支持 Markdown（页面上就是一行小字）。',
    )
  );
  texts.appendChild(
    panelRow(
      '跳转地址',
      linkField(ice.href ?? '', '/iceberg/ 或 https://…', (v) => {
        ice.href = v;
        markPanelDirty(status, 'widgets');
      }, { anchor: true }),
      '留空的话整块都不好点。',
    )
  );
  body.appendChild(texts);

  foot.append(
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('打开 /iceberg/', '在新标签页打开预览站点里的这一页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/iceberg/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/home-widgets.json 并重新构建站点', () =>
      saveWidgets(els.icebergSave, status), true, 'iceberg-save'),
  );
  els.icebergSave = $('iceberg-save');
}

/* ---------------------------------------------------------------
   冰山图（src/data/iceberg.json）

   整张图就三层结构：分类 / 标签（库）→ 层级（层）→ 条目（点）。
   面板按这个结构分三栏，一栏一件事：

     A 栏  这一页（大标题 + 介绍）+ 分类 + 标签
     B 栏  层级（顺序 = 页面从上往下的顺序）+ 选中那一层的四样东西
     C 栏  选中那一层的条目（搜索 / 新增 / 编辑 / 删 / 上下挪）

   两条规矩面板里照搬页面那一套，绝不让人维护第二份真相：
     · 条目的颜色只由**分类**决定（改一次分类颜色，归在它里的条目一起变）；
     · 完备标识只看**详细描述**填没填（不检测 tag、不检测链接）。

   改动先落在 iceDraft 里（面板重画、切走再切回来都不丢），按「保存并重新构建」
   才写盘，和精华 / 成员那两个面板一个规矩。
   --------------------------------------------------------------- */

/** iceberg.json 的草稿（面板重画、切走切回来读的都是它） */
let iceDraft = null;
/** 这一组有没有没保存的改动 */
let iceDirty = false;
/** 选中的层级 id（'' = 还没选，落到第一层） */
let iceSel = '';
/** 正在写的那一条：'' = 表单没开 / 'new' = 新增 / 别的 = 那个条目的 id */
let iceEditing = '';
/** 新增到一半的那一条（还没进 arrays，按「取消」就当没发生过） */
let iceNewItem = null;
/** 条目搜索词（只筛列出来的，不动数据） */
let iceFind = '';

async function loadIceberg() {
  if (iceDraft) return iceDraft;
  const res = await fetch('/api/iceberg');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  iceDraft = data && typeof data === 'object' ? data : {};
  if (!Array.isArray(iceDraft.categories)) iceDraft.categories = [];
  if (!Array.isArray(iceDraft.tags)) iceDraft.tags = [];
  if (!Array.isArray(iceDraft.layers)) iceDraft.layers = [];
  return iceDraft;
}

const iceLayers = () => iceDraft?.layers ?? [];
const iceCats = () => iceDraft?.categories ?? [];
const iceTagList = () => iceDraft?.tags ?? [];
const iceCatById = (id) => iceCats().find((c) => c.id === id) ?? null;

/**
 * 完备 = 详细描述非空。
 * 和页面上 `src/utils/iceberg.ts` 的 isComplete() 是同一个判断 ——
 * 这条标记两边都是**算出来的**，数据里不存第二份。
 */
const iceComplete = (it) => String(it?.desc ?? '').trim() !== '';

/** 补一个没被占用的 id（前缀 + 两位序号）。保存时服务端还会再核一遍 */
function iceNewId(prefix, used) {
  for (let i = used.size + 1; i < used.size + 500; i++) {
    const id = `${prefix}${String(i).padStart(2, '0')}`;
    if (!used.has(id)) return id;
  }
  return `${prefix}${Date.now().toString(36)}`;
}

/** 当前选中的层级；没选过、或者选的那个被删了，就落到第一层 */
function iceCurrent() {
  const hit = iceLayers().find((l) => l.id === iceSel);
  if (hit) return hit;
  const first = iceLayers()[0] ?? null;
  iceSel = first ? first.id : '';
  return first;
}

/** 面板里那条小灰字 */
function iceHint(text) {
  const p = document.createElement('p');
  p.className = 'hint wice__hint';
  p.textContent = text;
  return p;
}

/** 小方块按钮（↑ ↓ ✕ 这种），disabled 时点不动 */
function iceMiniBtn(text, title, enabled, onClick, danger = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `btn btn--ghost boardedit__mini${danger ? ' boardedit__del' : ''}`;
  b.textContent = text;
  b.title = title;
  b.disabled = !enabled;
  b.addEventListener('click', onClick);
  return b;
}

/** 数组里前后换一位（层级 / 条目排序都走它） */
function iceMove(list, index, delta) {
  const to = index + delta;
  if (to < 0 || to >= list.length) return;
  const [x] = list.splice(index, 1);
  list.splice(to, 0, x);
}

async function openIceChartModal() {
  markWorkspaceActive('ice-chart');
  els.icechartModal.hidden = false;
  els.iceEditor.textContent = '正在读取…';
  try {
    await loadIceberg();
  } catch (err) {
    els.iceEditor.textContent = `读取失败：${err.message}`;
    return;
  }
  iceEditing = '';
  iceNewItem = null;
  renderIceChartPanel();
}

function closeIceChartModal() {
  els.icechartModal.hidden = true;
}

/* ---------- 三栏里的一行一行 ---------- */

/** 一个分类：显示/隐藏（眼睛）+ 颜色 + 名字 + 删 */
function iceCatRow(c, status) {
  const dirty = () => markPanelDirty(status, 'iceberg');
  const row = document.createElement('div');
  row.className = 'wice__cat';
  row.dataset.catId = c.id;

  const eye = document.createElement('button');
  eye.type = 'button';
  eye.className = `wice__eye${c.hidden ? ' is-off' : ''}`;
  eye.dataset.eye = c.id;
  eye.textContent = c.hidden ? '隐藏' : '显示';
  eye.title = c.hidden
    ? '这一类的条目现在在页面上默认不显示 —— 点一下改成显示'
    : '这一类的条目在页面上默认显示 —— 点一下改成不显示（看的人随时能自己开关）';
  eye.addEventListener('click', () => {
    c.hidden = !c.hidden;
    eye.textContent = c.hidden ? '隐藏' : '显示';
    eye.classList.toggle('is-off', c.hidden);
    dirty();
  });

  const color = document.createElement('input');
  color.type = 'color';
  color.className = 'wice__color';
  color.value = /^#[0-9a-f]{6}$/i.test(String(c.color)) ? c.color : '#ff5fb0';
  color.title = '条目在冰山图里的颜色';
  color.addEventListener('input', () => {
    c.color = color.value;
    dirty();
  });

  const name = boardInput(c.name ?? '', '分类名字（例如 花娅奇闻）', (v) => {
    c.name = v;
    dirty();
  });
  name.classList.add('wice__name');

  const del = iceMiniBtn('✕', '删掉这个分类（归在它里面的条目会变成「未分类」，条目本身不删）', true, () => {
    const i = iceCats().indexOf(c);
    if (i < 0) return;
    iceCats().splice(i, 1);
    /* 引用一起清掉：留着一个指向已删分类的 id，页面上那一条会变成默认灰，
       而在编辑器里看起来「还归在某个分类」，两边对不上 */
    for (const l of iceLayers()) for (const it of l.items) if (it.categoryId === c.id) it.categoryId = '';
    dirty();
    renderIceChartPanel();
  }, true);

  row.append(eye, color, name, del);
  return row;
}

/** 一个标签：名字可改 + 显示用了几条 + 删 */
function iceTagRow(t, status) {
  const dirty = () => markPanelDirty(status, 'iceberg');
  const row = document.createElement('div');
  row.className = 'wice__tag';
  row.dataset.tagId = t.id;

  const name = boardInput(t.name ?? '', '标签名字', (v) => {
    t.name = v;
    dirty();
  });
  name.classList.add('wice__name');

  const used = iceLayers().reduce(
    (n, l) => n + l.items.filter((it) => (it.tags ?? []).includes(t.id)).length,
    0
  );
  const count = document.createElement('span');
  count.className = `wice__used${used ? '' : ' is-none'}`;
  count.textContent = used ? `${used} 条在用` : '还没人用';

  const del = iceMiniBtn('✕', '删掉这个标签（条目上勾过的会一起取消）', true, () => {
    const i = iceTagList().indexOf(t);
    if (i < 0) return;
    iceTagList().splice(i, 1);
    for (const l of iceLayers()) for (const it of l.items) it.tags = (it.tags ?? []).filter((x) => x !== t.id);
    dirty();
    renderIceChartPanel();
  }, true);

  row.append(name, count, del);
  return row;
}

/** 层级清单里的一行：点一下选中它（↑ ↓ ✕ 在右边） */
function iceLayerRow(l, index, status) {
  const dirty = () => markPanelDirty(status, 'iceberg');
  const row = document.createElement('div');
  row.className = `wice__layer${l.id === iceSel ? ' is-on' : ''}`;
  row.dataset.layerId = l.id;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'wice__pick';
  const title = document.createElement('b');
  title.textContent = l.title || '（还没有标题）';
  const meta = document.createElement('em');
  const done = l.items.filter(iceComplete).length;
  meta.textContent = l.items.length
    ? `${l.items.length} 条 · ${done} 完备${done < l.items.length ? ` · ${l.items.length - done} 缺描述` : ''}`
    : '还没有条目';
  pick.append(title, meta);
  pick.addEventListener('click', () => {
    iceSel = l.id;
    iceEditing = '';
    iceNewItem = null;
    renderIceChartPanel();
  });

  const ops = document.createElement('div');
  ops.className = 'wice__ops';
  ops.append(
    iceMiniBtn('↑', '往上挪一层（页面上也跟着往上）', index > 0, () => {
      iceMove(iceLayers(), index, -1);
      dirty();
      renderIceChartPanel();
    }),
    iceMiniBtn('↓', '往下挪一层', index < iceLayers().length - 1, () => {
      iceMove(iceLayers(), index, 1);
      dirty();
      renderIceChartPanel();
    }),
    iceMiniBtn('✕', `删掉这一层${l.items.length ? `（连同里面的 ${l.items.length} 条条目一起）` : ''}`, true, () => {
      iceLayers().splice(index, 1);
      if (iceSel === l.id) iceSel = '';
      iceEditing = '';
      dirty();
      renderIceChartPanel();
    }, true)
  );

  row.append(pick, ops);
  return row;
}

/** 条目清单里的一行：分类色点 + 名字 + 归在哪一类 + 完备标识 + 编辑/删/挪 */
function iceItemRow(layer, it, status) {
  const dirty = () => markPanelDirty(status, 'iceberg');
  const row = document.createElement('div');
  row.className = 'wice__item';
  row.dataset.itemId = it.id;
  const cat = iceCatById(it.categoryId);
  row.style.setProperty('--cat', cat ? cat.color : '#b9a6c9');

  const dot = document.createElement('span');
  dot.className = 'wice__dot';

  const name = document.createElement('span');
  name.className = 'wice__itemName';
  name.textContent = it.name || '（还没有名字）';

  const via = document.createElement('span');
  via.className = 'wice__itemVia';
  const tagNames = (it.tags ?? []).map((id) => iceTagList().find((t) => t.id === id)?.name ?? '').filter(Boolean);
  via.textContent = `${cat ? cat.name : '未分类'}${tagNames.length ? ` · ${tagNames.join('/')}` : ''}${it.href ? ' · 有链接' : ''}`;

  const done = iceComplete(it);
  const badge = document.createElement('span');
  badge.className = `wice__badge${done ? '' : ' wice__badge--off'}`;
  badge.textContent = done ? '完备' : '缺描述';
  badge.title = done
    ? '填了详细描述 —— 页面上这一条背后会垫一块粉色带栅格的圆角矩形'
    : '还没写详细描述 —— 页面上这一条不会有完备标识';

  const index = layer.items.indexOf(it);
  const ops = document.createElement('div');
  ops.className = 'wice__ops';
  ops.append(
    iceMiniBtn('改', '编辑这一条（分类 / 标签 / 详细描述 / 链接）', true, () => {
      iceEditing = it.id;
      iceNewItem = null;
      renderIceChartPanel();
    }),
    iceMiniBtn('↑', '往前挪一条', index > 0, () => {
      iceMove(layer.items, index, -1);
      dirty();
      renderIceChartPanel();
    }),
    iceMiniBtn('↓', '往后挪一条', index < layer.items.length - 1, () => {
      iceMove(layer.items, index, 1);
      dirty();
      renderIceChartPanel();
    }),
    iceMiniBtn('✕', '删掉这一条', true, () => {
      layer.items.splice(index, 1);
      if (iceEditing === it.id) iceEditing = '';
      dirty();
      renderIceChartPanel();
    }, true)
  );

  row.append(dot, name, via, badge, ops);
  return row;
}

/**
 * 条目的编辑表单（新增和改都用它）。
 *
 * isNew 的那一条在按「完成」之前**不进 arrays** —— 中途按「取消」就当没发生过，
 * 不会在数据里留下一条没名字的条目（保存时那种条目会被丢掉并报数）。
 */
function iceItemForm(host, layer, item, status, isNew) {
  const dirty = () => markPanelDirty(status, 'iceberg');
  const box = document.createElement('div');
  box.className = 'wice__form';
  box.dataset.formFor = isNew ? 'new' : item.id;

  const nameInput = boardInput(item.name ?? '', '例如：塔吊文化', (v) => {
    item.name = v;
    dirty();
  });
  box.appendChild(panelRow('条目', nameInput));

  const catSel = document.createElement('select');
  catSel.className = 'input wice__select';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '（未分类 · 页面上是灰的）';
  catSel.appendChild(none);
  for (const c of iceCats()) {
    const o = document.createElement('option');
    o.value = c.id;
    o.textContent = `${c.name} · ${c.color}`;
    catSel.appendChild(o);
  }
  catSel.value = item.categoryId ?? '';
  catSel.addEventListener('change', () => {
    item.categoryId = catSel.value;
    dirty();
  });
  box.appendChild(panelRow('分类', catSel, '决定这一条在图里的颜色。'));

  const tagWrap = document.createElement('div');
  tagWrap.className = 'wess__memberGrid';
  if (!iceTagList().length) {
    tagWrap.appendChild(iceHint('还没有标签 —— 先在左边「标签」那一栏建一个，再回来勾。'));
  }
  for (const t of iceTagList()) {
    const label = document.createElement('label');
    label.className = 'wess__member';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (item.tags ?? []).includes(t.id);
    cb.dataset.tagPick = t.id;
    cb.addEventListener('change', () => {
      const set = new Set(item.tags ?? []);
      if (cb.checked) set.add(t.id);
      else set.delete(t.id);
      item.tags = [...set];
      dirty();
    });
    const span = document.createElement('span');
    span.className = 'wess__memberName';
    span.textContent = t.name;
    label.append(cb, span);
    tagWrap.appendChild(label);
  }
  box.appendChild(panelRow('标签', tagWrap, '勾上的会显示在页面上那张悬停卡片的顶部。'));

  const desc = panelArea(item.desc ?? '', '鼠标移到条目上时，卡片里的正文。填了它就有完备标识', 5, (v) => {
    item.desc = v;
    dirty();
    /* 「完备 / 缺描述」那句话要跟着输入实时变，所以只重画这一个角标 */
    const badge = box.querySelector('.wice__descState');
    if (badge) {
      const on = iceComplete(item);
      badge.textContent = on ? '已有详细描述 → 页面上会有完备标识' : '还没写详细描述 → 页面上没有完备标识';
      badge.classList.toggle('is-on', on);
    }
  });
  box.appendChild(panelRow('详细描述', desc));

  const link = linkField(item.href ?? '', '/salon/ 或 https://…', (v) => {
    item.href = v;
    dirty();
  }, { anchor: true });
  box.appendChild(panelRow('链接', link, '留空 = 这一条点不动（只出悬停卡片）。'));

  const state = document.createElement('p');
  state.className = `hint wice__descState${iceComplete(item) ? ' is-on' : ''}`;
  state.textContent = iceComplete(item)
    ? '已有详细描述 → 页面上会有完备标识'
    : '还没写详细描述 → 页面上没有完备标识';
  box.appendChild(state);

  const acts = document.createElement('div');
  acts.className = 'wice__formact';
  acts.append(
    panelBtn('完成', '把这一条收起来', () => {
      if (!String(item.name ?? '').trim()) {
        toast('条目得有个名字', true);
        nameInput.focus();
        return;
      }
      if (isNew) layer.items.push(item);
      iceEditing = '';
      iceNewItem = null;
      dirty();
      renderIceChartPanel();
    }, true),
    panelBtn('取消', isNew ? '不要这一条了' : '收起表单（已经改的留着，按保存才写盘）', () => {
      iceEditing = '';
      iceNewItem = null;
      renderIceChartPanel();
    })
  );
  box.appendChild(acts);

  host.appendChild(box);
  if (isNew) requestAnimationFrame(() => nameInput.focus());
}

/* ---------- 整个面板 ---------- */

function renderIceChartPanel() {
  const { body, foot, status } = panelShell(els.iceEditor, {
    hint:
      '整张冰山图。层级从上往下叠，条目按分类上色：分类先建好（颜色 + 那对小眼睛决定这一类的条目在页面上默认显不显示），' +
      '标签也是先建再到条目上勾。条目的「详细描述」填了就自动打上完备标识（粉色带栅格的那块圆角矩形）。',
    group: 'iceberg',
  });
  body.classList.add('wpanel__body--tall');
  const dirty = () => markPanelDirty(status, 'iceberg');
  const cur = iceCurrent();

  const grid = document.createElement('div');
  grid.className = 'wice';
  const colA = document.createElement('div');
  colA.className = 'wice__col';
  const colB = document.createElement('div');
  colB.className = 'wice__col';
  const colC = document.createElement('div');
  colC.className = 'wice__col wice__col--c';

  /* ---------------- A1：这一页 ---------------- */
  const meta = panelBox('这一页', '大标题 + 标题下面那段介绍（页面最上面那两行）。');
  meta.appendChild(
    panelRow(
      '大标题',
      boardInput(iceDraft.title ?? '', '冰室冰山', (v) => {
        iceDraft.title = v;
        dirty();
      })
    )
  );
  meta.appendChild(
    panelRow(
      '介绍',
      panelArea(iceDraft.intro ?? '', '一两句就好（可以留空）', 3, (v) => {
        iceDraft.intro = v;
        dirty();
      })
    )
  );
  colA.appendChild(meta);

  /* ---------------- A2：分类 ---------------- */
  const catBox = panelBox(
    '分类',
    '条目的颜色只由分类决定 —— 改一次颜色，归在这一类里的条目一起变。左边那颗是「默认显不显示」：' +
      '切到「隐藏」的类，页面上那排分类里的小眼睛默认是闭着的（看的人随时能自己点开）。'
  );
  const catList = document.createElement('div');
  catList.className = 'wice__rows';
  if (!iceCats().length) catList.appendChild(iceHint('还没有分类。先建一个（例如「花娅奇闻」），再给条目选它。'));
  for (const c of iceCats()) catList.appendChild(iceCatRow(c, status));
  catBox.appendChild(catList);
  catBox.appendChild(
    panelBtn('＋ 新增分类', '建一个新分类，然后到条目上选它', () => {
      const used = new Set(iceCats().map((c) => String(c.id ?? '')));
      iceCats().push({ id: iceNewId('c', used), name: '新分类', color: '#ff5fb0', hidden: false });
      dirty();
      renderIceChartPanel();
    })
  );
  colA.appendChild(catBox);

  /* ---------------- A3：标签 ---------------- */
  const tagBox = panelBox(
    '标签',
    '先在这里建好，再到条目上勾。鼠标移到条目上时，卡片顶部显示的就是勾上的这些（没勾就不显示那一行）。'
  );
  const tagRows = document.createElement('div');
  tagRows.className = 'wice__rows';
  if (!iceTagList().length) tagRows.appendChild(iceHint('还没有标签。'));
  for (const t of iceTagList()) tagRows.appendChild(iceTagRow(t, status));
  tagBox.appendChild(tagRows);

  const tagAdd = document.createElement('div');
  tagAdd.className = 'wice__add';
  const tagInput = boardInput('', '新标签名字（回车也行）', () => {});
  const commitTag = () => {
    const name = tagInput.value.trim();
    if (!name) {
      toast('标签得有个名字', true);
      return;
    }
    const used = new Set(iceTagList().map((t) => String(t.id ?? '')));
    iceTagList().push({ id: iceNewId('t', used), name });
    dirty();
    renderIceChartPanel();
  };
  tagInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      commitTag();
    }
  });
  tagAdd.append(tagInput, panelBtn('＋ 添加', '也可以直接在输入框里回车', commitTag));
  tagBox.appendChild(tagAdd);
  colA.appendChild(tagBox);

  /* ---------------- B1：层级 ---------------- */
  const layBox = panelBox(
    '层级',
    '顺序就是页面从上往下的顺序（↑ ↓ 调）。点一行选中它，右边那一栏就是这一层的条目。'
  );
  const layRows = document.createElement('div');
  layRows.className = 'wice__rows';
  if (!iceLayers().length) layRows.appendChild(iceHint('还没有层级。先建一个（例如「漫步花娅街头」）。'));
  iceLayers().forEach((l, i) => layRows.appendChild(iceLayerRow(l, i, status)));
  layBox.appendChild(layRows);
  layBox.appendChild(
    panelBtn('＋ 新建层级', '新的一层加在最下面，然后写标题、传图、加条目', () => {
      const used = new Set(iceLayers().map((l) => String(l.id ?? '')));
      const l = { id: iceNewId('l', used), title: '新层级', subtitle: '', background: '', head: '', items: [] };
      iceLayers().push(l);
      iceSel = l.id;
      iceEditing = '';
      iceNewItem = null;
      dirty();
      renderIceChartPanel();
    })
  );
  colB.appendChild(layBox);

  /* ---------------- B2：选中那一层的四样东西 ---------------- */
  const fieldBox = panelBox(
    `这一层 · ${cur ? cur.title || '（还没有标题）' : '（还没有层级）'}`,
    '标题和副标题写在层的中间；背景图铺满整层（会压一层暗罩，字才看得清），头图是右边竖着的那一条。'
  );
  if (!cur) {
    fieldBox.appendChild(iceHint('左边先建一个层级。'));
  } else {
    fieldBox.appendChild(
      panelRow(
        '标题',
        boardInput(cur.title ?? '', '例如：漫步花娅街头', (v) => {
          cur.title = v;
          dirty();
        })
      )
    );
    fieldBox.appendChild(
      panelRow(
        '副标题',
        panelArea(cur.subtitle ?? '', '例如：只要稍微在冰室里冲浪就能看见的词', 2, (v) => {
          cur.subtitle = v;
          dirty();
        })
      )
    );
    fieldBox.appendChild(imageFieldRow('背景图', cur, 'background', dirty));
    fieldBox.appendChild(imageFieldRow('头图', cur, 'head', dirty));
  }
  colB.appendChild(fieldBox);

  /* ---------------- C：这一层的条目 ---------------- */
  const itemBox = panelBox(
    `条目 · ${cur ? cur.title || '（还没有标题）' : '（还没有层级）'}`,
    '「完备标识」只看详细描述：填了的条目在页面上背后会垫一块粉色带栅格的圆角矩形。分类决定颜色，' +
      '标签显示在悬停卡片顶部，填了链接这一条就能点。'
  );
  if (!cur) {
    itemBox.appendChild(iceHint('先建一个层级，再往里加条目。'));
  } else {
    const bar = document.createElement('div');
    bar.className = 'wice__toolbar';
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'input input--sm wice__search';
    search.placeholder = '在这一层里找条目…';
    search.value = iceFind;
    const count = document.createElement('span');
    count.className = 'wess__count';
    const rows = document.createElement('div');
    rows.className = 'wice__rows wice__items';

    const paintRows = () => {
      const kw = iceFind.trim().toLowerCase();
      const hits = cur.items.filter((it) => {
        if (!kw) return true;
        const cat = iceCatById(it.categoryId);
        const tagNames = (it.tags ?? []).map((id) => iceTagList().find((t) => t.id === id)?.name ?? '');
        return (
          String(it.name ?? '').toLowerCase().includes(kw) ||
          String(it.desc ?? '').toLowerCase().includes(kw) ||
          (cat?.name ?? '').toLowerCase().includes(kw) ||
          tagNames.join('/').toLowerCase().includes(kw)
        );
      });
      const done = cur.items.filter(iceComplete).length;
      count.textContent = `${hits.length} / ${cur.items.length} 条 · ${done} 完备 · ${cur.items.length - done} 缺描述`;
      rows.textContent = '';
      /* 表单排在最上面：正在写的这一条一眼就能看见 */
      if (iceEditing === 'new' && iceNewItem) iceItemForm(rows, cur, iceNewItem, status, true);
      else if (iceEditing) {
        const editing = cur.items.find((it) => it.id === iceEditing);
        if (editing) iceItemForm(rows, cur, editing, status, false);
      }
      if (!cur.items.length) rows.appendChild(iceHint('这一层还没有条目 —— 点「＋ 新增条目」。'));
      else if (!hits.length) rows.appendChild(iceHint(`这一层里没有匹配「${iceFind}」的条目。`));
      for (const it of hits) rows.appendChild(iceItemRow(cur, it, status));
    };

    search.addEventListener('input', () => {
      iceFind = search.value;
      paintRows();
    });

    bar.append(
      search,
      count,
      panelBtn('＋ 新增条目', '往这一层加一条', () => {
        iceNewItem = { id: '', name: '', categoryId: iceCats()[0]?.id ?? '', tags: [], desc: '', href: '' };
        iceEditing = 'new';
        renderIceChartPanel();
      }, true)
    );
    itemBox.append(bar, rows);
    paintRows();
  }
  colC.appendChild(itemBox);

  grid.append(colA, colB, colC);
  body.appendChild(grid);

  /* ---------------- 底栏 ---------------- */
  const totalItems = iceLayers().reduce((n, l) => n + l.items.length, 0);
  const totalDone = iceLayers().reduce((n, l) => n + l.items.filter(iceComplete).length, 0);
  const sum = document.createElement('span');
  sum.className = 'wice__sum';
  sum.textContent = `${iceCats().length} 分类 · ${iceTagList().length} 标签 · ${iceLayers().length} 层 · ${totalItems} 条（${totalDone} 完备）`;
  foot.append(
    sum,
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('打开 /iceberg/', '在新标签页打开预览站点里的这一页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/iceberg/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/iceberg.json 并重新构建站点', () => saveIceberg(els.iceSave, status), true, 'ice-save')
  );
  els.iceSave = $('ice-save');
}

/** 一层里的「图 + 地址框」那一行（背景图 / 头图都用它） */
function imageFieldRow(label, layer, key, dirty) {
  const input = boardInput(layer[key] ?? '', '/img/uploads/xxx.png 或 https://…', () => {});
  const slot = imageSlot({
    label,
    getValue: () => layer[key],
    setValue: (v) => {
      layer[key] = v;
    },
    onValue: (v) => {
      input.value = v;
    },
    onChanged: dirty,
  });
  input.addEventListener('input', () => {
    slot.sync(input.value, true);
    dirty();
  });
  const wrap = document.createElement('div');
  wrap.className = 'wice__imgrow';
  const r1 = panelRow(label, slot.el);
  const r2 = panelRow(`${label}地址`, input);
  wrap.append(r1, r2);
  return wrap;
}

async function saveIceberg(btn, statusEl) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在保存…';
  statusEl.textContent = '正在保存…';
  statusEl.classList.remove('is-dirty');
  try {
    const res = await fetch('/api/iceberg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(iceDraft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    iceDirty = false;
    /*
      拿服务端那份重新来过：它给补过 id、洗过引用（认不出来的分类 / 标签会清掉），
      界面上看到的必须和落盘的一致 —— 不然接着改就是在改一份对不上的草稿。
    */
    iceDraft = null;
    await loadIceberg();
    const d = data.dropped ?? {};
    const lost = [];
    if (d.categories) lost.push(`${d.categories} 个没写名字的分类`);
    if (d.tags) lost.push(`${d.tags} 个没写名字的标签`);
    if (d.items) lost.push(`${d.items} 条没写名字的条目`);
    if (d.refs) lost.push(`${d.refs} 处指向已删分类 / 标签的引用`);
    const c = data.counts ?? {};
    if (data.built) {
      statusEl.textContent = `已保存并重新构建（${data.ms} ms）`;
      toast(
        `冰山图已保存并重新构建（${data.ms} ms）：${c.layers ?? 0} 层 / ${c.items ?? 0} 条` +
          (lost.length ? `；有 ${lost.join('、')} 被丢掉` : '')
      );
    } else {
      statusEl.textContent = '已保存，但重新构建没成功';
      toast(`已保存，但重新构建没成功：${String(data.output || '').split('\n')[0]}`, true);
    }
    if (!els.icechartModal.hidden) renderIceChartPanel();
  } catch (err) {
    statusEl.textContent = `出错了：${err.message}`;
    statusEl.classList.add('is-dirty');
    toast(`保存失败：${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* ---------------------------------------------------------------
   冰室精华 / 成员（src/data/salon.json）
   --------------------------------------------------------------- */

/** salon.json 的草稿（「精华」和「成员」两个面板共用一份） */
let salonDraft = null;
/** 这一组有没有没保存的改动（同上） */
let salonDirty = false;
/** 精华面板的搜索词 / 排序 / 一次画多少条 */
let essSearch = '';
let essSortDesc = true;
/** 已经画了多少条（735 条全画出来会把面板卡住，先画一屏，"加载更多"接着来） */
let essShown = 0;
const ESS_PAGE = 60;

async function loadSalon() {
  if (salonDraft) return salonDraft;
  const res = await fetch('/api/salon');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  salonDraft = data && typeof data === 'object' ? data : {};
  if (!Array.isArray(salonDraft.members)) salonDraft.members = [];
  if (!Array.isArray(salonDraft.eras)) salonDraft.eras = [];
  if (!Array.isArray(salonDraft.essences)) salonDraft.essences = [];
  return salonDraft;
}

/** 改过之后要把服务端算出来的那份换成草稿里的，不然一重读就白改 */
function salonEraName(id) {
  const era = salonDraft?.eras?.find((e) => e.id === id);
  return era ? era.title : '';
}

/** 某一天落在哪个年代里（和服务端 eraIdForDate 同一套规则，页面上即时显示用） */
function eraIdForDate(date) {
  const d = String(date || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '';
  for (const era of salonDraft?.eras ?? []) {
    const from = String(era?.from || '');
    const to = String(era?.to || '');
    if (from && to && d >= from && d <= to) return String(era.id || '');
  }
  return '';
}

const memberById = (id) => (salonDraft?.members ?? []).find((m) => m.id === id) || null;

/**
 * 一条精华的成员 id 列表。
 *
 * 数据里现在存的是 `memberIds`（数组，顺序 = 对话里出现的顺序）；更早那份
 * 存的是单个 `memberId`。**两套都要认** —— 不然刚换成新数据、用户一点保存，
 * 界面这边读的是空数组，748 条的成员看着就全没了（服务端那一侧也有同一套兜底）。
 * 空数组是合法的：那条精华就是没有对应成员，照旧画出来。
 */
function essenceMemberIds(e) {
  const valid = new Set((salonDraft?.members ?? []).map((m) => m.id));
  const out = [];
  const push = (v) => {
    const id = String(v ?? '').trim();
    if (!id || !valid.has(id) || out.includes(id)) return;
    out.push(id);
  };
  if (Array.isArray(e?.memberIds)) for (const v of e.memberIds) push(v);
  if (!out.length && !Array.isArray(e?.memberIds)) push(e?.memberId);
  return out;
}

/** 这条精华牵扯到哪些成员（查不到的那些直接不要了，和 essenceMemberIds 一致） */
const essenceMembers = (e) => essenceMemberIds(e).map(memberById).filter(Boolean);

/** 成员名用「、」连起来；一个都没有就写「未知成员」 */
function essenceMemberText(e) {
  const names = essenceMembers(e).map((m) => m.name);
  return names.length ? names.join('、') : '未知成员';
}

/** 精华的三种来源（只给编辑器看，站点页面不按它分组） */
const ESSENCE_KIND_LABEL = { text: '文字', perfect: '完美对话', ai: 'AI 创作' };
const essenceKindOf = (e) => (ESSENCE_KIND_LABEL[e?.kind] ? e.kind : 'text');

/** 这个成员名下有多少条精华（删成员 / 改名时用来说清后果）。按 memberIds 里包含他算 */
function essenceCountOf(memberId) {
  return (salonDraft?.essences ?? []).filter((e) => essenceMemberIds(e).includes(memberId)).length;
}

/**
 * 新精华的 id：现有的是 e0001…e0735，所以往后接着编。
 * 和服务端的 nextEssenceId 一套规则（那边还会兜一次底）。
 */
function newEssenceId() {
  const used = new Set((salonDraft?.essences ?? []).map((e) => e.id));
  for (let n = 1; n <= 9999; n += 1) {
    const id = `e${String(n).padStart(4, '0')}`;
    if (!used.has(id)) return id;
  }
  return `e-${Date.now().toString(36)}`;
}

/** 新成员 id：`mNN-xxxx`，和现有那批长得一样 */
function newMemberId() {
  const used = new Set((salonDraft?.members ?? []).map((m) => m.id));
  for (let i = 0; i < 500; i += 1) {
    const n = String((salonDraft?.members ?? []).length + 1 + i).padStart(2, '0');
    const id = `m${n}-${Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0')}`;
    if (!used.has(id)) return id;
  }
  return `m-${Date.now().toString(36)}`;
}

/** 保存 salon.json 并重新构建（发整份草稿，两个面板共用一份） */
async function saveSalon(btn, statusEl) {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = '正在保存…';
  statusEl.textContent = '正在保存…';
  statusEl.classList.remove('is-dirty');
  try {
    const res = await fetch('/api/salon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(salonDraft),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
    salonDirty = false;
    const d = data.dropped ?? {};
    const lost = [];
    if (d.members) lost.push(`${d.members} 个成员`);
    if (d.essences) lost.push(`${d.essences} 条精华`);
    /*
      拿服务端那份重新来过：它按日期重排过、eraId 也是它按日期算的，
      界面上看到的必须和落盘的一致。
    */
    salonDraft = null;
    await loadSalon();
    if (data.built) {
      statusEl.textContent = `已保存并重新构建（${data.ms} ms）`;
      toast(
        `冰室精华已保存并重新构建（${data.ms} ms）` +
          (lost.length ? `；有 ${lost.join('、')} 项没存下（成员要有名字、精华要有日期）` : '')
      );
    } else {
      statusEl.textContent = '已保存，但重新构建没成功';
      toast(`已保存，但重新构建没成功：${String(data.output || '').split('\n')[0]}`, true);
    }
  } catch (err) {
    statusEl.textContent = `出错了：${err.message}`;
    statusEl.classList.add('is-dirty');
    toast(`保存失败：${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = was;
  }
}

/* ---------- 精华 ---------- */

async function openEssencesModal() {
  markWorkspaceActive('essences');
  els.essencesModal.hidden = false;
  els.essEditor.textContent = '正在读取…';
  try {
    await loadSalon();
    /*
      顺便把时间轴清单读进内存（有缓存，不会冲掉「时间轴」面板里没保存的改动）：
      这个面板顶上那个「左边放哪条时间轴」的下拉要它，而 renderEssencesPanel() 是同步的。
      读不到就退回空清单 —— 下拉里只剩「（不放时间轴）」，不影响精华本身的编辑。
    */
    await loadTimelines().catch(() => {});
  } catch (err) {
    els.essEditor.textContent = `读取失败：${err.message}`;
    return;
  }
  essShown = ESS_PAGE;
  renderEssencesPanel();
}

function closeEssencesModal() {
  els.essencesModal.hidden = true;
}

/** 按成员名 / 日期 / 正文 / 时间筛。几百条里找一条靠它 */
function filteredEssences() {
  const kw = essSearch.trim().toLowerCase();
  const list = (salonDraft?.essences ?? []).filter((e) => {
    if (!kw) return true;
    // 一条精华可能挂着好几个成员（完美对话就是），**任意一个**的名字命中就算
    const names = essenceMembers(e).map((m) => m.name.toLowerCase());
    return (
      names.some((n) => n.includes(kw)) ||
      String(e.date || '').includes(kw) ||
      String(e.time || '').includes(kw) ||
      String(e.text || '').toLowerCase().includes(kw) ||
      (ESSENCE_KIND_LABEL[essenceKindOf(e)] || '').includes(kw)
    );
  });
  // 数据本来就是按日期排的，这里只翻个向
  return essSortDesc ? [...list].reverse() : list;
}

function renderEssencesPanel() {
  const { body, foot, status } = panelShell(els.essEditor, {
    hint:
      '冰室精华的每一条 = 成员（可以好几个）+ 日期时间 + 正文/图片。成员名和头像**不在**这里存，' +
      '只存成员 id —— 所以给成员改名 / 换头像，他所有的精华一起跟着变（去「成员」面板改）。',
    group: 'salon',
  });

  const all = salonDraft.essences;
  const list = filteredEssences();
  const shown = Math.min(essShown, list.length);

  /* ---- 左边那条时间轴：选站点里已有的一条，**原样**放上去 ---- */
  /*
    用户的要求（原话）：「可以在编辑器里选一个时间轴放在那个位置……放上去以后
    不要做任何改动！！！不要加减删改东西！！！页面上只需要：点刻度跳到离那个日期
    最近的精华」。所以这里只是一个下拉：把 id 存进 salon.json 的 timelineId，
    页面那边 getTimeline(id) 拿出来原样渲染 —— 不带任何"按精华日期生成点"的逻辑。
  */
  const tlBox = panelBox(
    '左边那条时间轴',
    '选一条站点已有的时间轴原样放到冰室精华页左边。**一个点、一段、一个塔吊都不会加、不会改**；' +
      '页面上唯一多出来的行为是：点轴上的刻度（或塔吊）跳到离那天最近的一条精华。'
  );
  const tlSel = document.createElement('select');
  tlSel.className = 'input';
  const tlOpts = [{ id: '', title: '（不放时间轴）' }, ...(timelinesDraft?.timelines ?? []).map((t) => ({ id: t.id, title: t.title }))];
  for (const o of tlOpts) {
    const opt = document.createElement('option');
    opt.value = o.id;
    opt.textContent = o.id ? `${o.title}（${o.id}）` : o.title;
    tlSel.appendChild(opt);
  }
  // 盘上的 id 已经不在清单里（那条轴被删了）也要能显示出来，不然下拉会静默跳到第一项
  const cur = String(salonDraft.timelineId ?? '');
  if (cur && !tlOpts.some((o) => o.id === cur)) {
    const opt = document.createElement('option');
    opt.value = cur;
    opt.textContent = `${cur}（这条时间轴已经不在了）`;
    tlSel.appendChild(opt);
  }
  tlSel.value = cur;
  tlSel.addEventListener('change', () => {
    salonDraft.timelineId = tlSel.value;
    markPanelDirty(status, 'salon');
  });
  tlBox.appendChild(panelRow('时间轴', tlSel));
  if (!(timelinesDraft?.timelines ?? []).length) {
    const p = document.createElement('p');
    p.className = 'hint wbox__hint';
    p.textContent = '一条时间轴都没读到 —— 先去「时间轴」面板建一条，再回来选。';
    tlBox.appendChild(p);
  }
  body.appendChild(tlBox);

  /* ---- 工具条：搜索 + 排序 + 新增 ---- */
  const tools = document.createElement('div');
  tools.className = 'wess__tools';

  const search = document.createElement('input');
  search.type = 'search';
  search.className = 'input input--sm wess__search';
  search.placeholder = '搜成员名 / 日期 / 正文…';
  search.autocomplete = 'off';
  search.value = essSearch;
  let timer = null;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    // 735 条过一遍很快，但连打时没必要每个键都重画
    timer = setTimeout(() => {
      essSearch = search.value;
      essShown = ESS_PAGE;
      renderEssencesPanel();
    }, 120);
  });

  const count = document.createElement('span');
  count.className = 'wess__count';
  /*
    条数旁边带上来源的分布：三种 kind 的条数加起来必然等于总数 ——
    "一条都不能丢"这件事，一眼就能对上账（用户就是按这个核的）。
  */
  const kindTally = Object.keys(ESSENCE_KIND_LABEL)
    .map((k) => [k, all.filter((e) => essenceKindOf(e) === k).length])
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${ESSENCE_KIND_LABEL[k]} ${n}`)
    .join(' · ');
  count.textContent = essSearch.trim()
    ? `命中 ${list.length} / 共 ${all.length} 条`
    : `共 ${all.length} 条${kindTally ? `（${kindTally}）` : ''}`;
  count.title = kindTally ? `按来源分布：${kindTally}（加起来 = 总数）` : '';

  const sort = document.createElement('button');
  sort.type = 'button';
  sort.className = 'btn btn--ghost btn--sm';
  sort.textContent = essSortDesc ? '新的在前 ↓' : '旧的在前 ↑';
  sort.title = '换一下排序方向（只影响这里的显示和新增时的落点，数据本身一直是按日期排的）';
  sort.addEventListener('click', () => {
    essSortDesc = !essSortDesc;
    renderEssencesPanel();
  });

  const addBtn = panelBtn('＋ 新增一条', '在最上面打开新增表单', () => openEssenceForm(tools, status));
  tools.append(search, count, sort, addBtn);
  body.appendChild(tools);

  if (!list.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = all.length ? '没有命中的精华，换个关键词试试。' : '一条精华都没有，点「＋ 新增一条」。';
    body.appendChild(p);
  } else {
    /*
      只画前 essShown 条。735 条全塞进 DOM 面板会明显卡（每次重画都要
      重建上万个节点），所以先画一屏，"加载更多"一次加 60 条。
      行里不放输入框：改内容要点「编辑」进单条表单 —— 一行一个输入框
      不但挤，还会让"每敲一个字就重画列表"变成灾难。
    */
    const ul = document.createElement('ul');
    ul.className = 'wess__rows';
    for (let i = 0; i < shown; i += 1) ul.appendChild(essenceRow(list[i], status));
    body.appendChild(ul);

    if (shown < list.length) {
      const more = document.createElement('div');
      more.className = 'wess__more';
      const b = panelBtn(
        `加载更多（还有 ${list.length - shown} 条）`,
        '接着往下画 60 条',
        () => {
          essShown = Math.min(list.length, essShown + ESS_PAGE);
          renderEssencesPanel();
        },
      );
      more.appendChild(b);
      body.appendChild(more);
    } else if (list.length > ESS_PAGE) {
      const p = document.createElement('p');
      p.className = 'hint wess__end';
      p.textContent = `这 ${list.length} 条都画出来了。`;
      body.appendChild(p);
    }
  }

  foot.append(
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('看 /salon/', '在新标签页打开预览站点里的冰室精华页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/salon/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/salon.json 并重新构建站点', () =>
      saveSalon(els.essSave, status), true, 'ess-save'),
  );
  els.essSave = $('ess-save');
}

/** 一个成员的小圆头像（列表行 / 多选清单里都用它） */
function memberAvatarEl(m) {
  if (m?.avatar) {
    const img = document.createElement('img');
    img.className = 'wess__avatar';
    img.src = previewImgSrc(m.avatar);
    img.alt = '';
    img.loading = 'lazy';
    img.title = m.name;
    return img;
  }
  const ph = document.createElement('span');
  ph.className = 'wess__avatar wess__avatar--none';
  ph.textContent = String(m?.name || '?').slice(0, 1);
  ph.title = m?.name || '未知成员';
  return ph;
}

/**
 * 一条精华的成员那格：头像叠着排 + 名字用「、」连起来。
 *
 * 一条精华可以有多个成员（完美对话就是），所以这里**全部列出来** ——
 * 只显示第一个的话，看起来就像那条精华只属于一个人。
 */
function essenceWhoEl(e) {
  const wrap = document.createElement('span');
  wrap.className = 'wess__who';
  const members = essenceMembers(e);
  if (!members.length) {
    wrap.classList.add('wess__who--missing');
    wrap.textContent = '未知成员';
    return wrap;
  }
  const faces = document.createElement('span');
  faces.className = 'wess__faces';
  for (const m of members) faces.appendChild(memberAvatarEl(m));
  const names = document.createElement('span');
  names.className = 'wess__names';
  names.textContent = members.map((m) => m.name).join('、');
  wrap.append(faces, names);
  return wrap;
}

/** 列表里的一行：日期 时间 成员（可多个） 正文开头 图片数 种类 + 编辑/删除 */
function essenceRow(e, status) {
  const li = document.createElement('li');
  li.className = 'wess__row';
  li.dataset.essId = e.id;

  const when = document.createElement('span');
  when.className = 'wess__when';
  when.textContent = `${e.date}${e.time ? ` ${e.time}` : ''}`;

  const who = essenceWhoEl(e);

  const text = document.createElement('span');
  text.className = 'wess__text';
  const body = String(e.text || '').replace(/\s+/g, ' ').trim();
  text.textContent = body.length > 60 ? `${body.slice(0, 60)}…` : body || '（没有文字）';
  if (!body) text.classList.add('wess__text--empty');

  const meta = document.createElement('span');
  meta.className = 'wess__meta';
  const kind = essenceKindOf(e);
  const tag = document.createElement('em');
  tag.className = `wess__kind wess__kind--${kind}`;
  tag.textContent = ESSENCE_KIND_LABEL[kind];
  tag.title = '这一条的来源（只给编辑器看，站点页面不按它分组）';
  const bits = [];
  if (e.images?.length) bits.push(`${e.images.length} 张图`);
  const eraName = salonEraName(e.eraId);
  bits.push(eraName || '（不在任何年代里）');
  meta.append(tag, document.createTextNode(' ' + bits.join(' · ')));

  const ops = document.createElement('span');
  ops.className = 'wess__ops';
  const edit = panelBtn('编辑', '改这一条（成员 / 日期时间 / 正文 / 图片）', () => {
    openEssenceForm(li, status, e);
  });
  edit.classList.add('boardedit__mini');
  const del = panelBtn('删除', '删掉这一条（会问一次）', () => {
    if (!confirm(`删掉 ${e.date}${e.time ? ` ${e.time}` : ''}「${essenceMemberText(e)}」的一条精华？`)) return;
    const idx = salonDraft.essences.indexOf(e);
    if (idx >= 0) salonDraft.essences.splice(idx, 1);
    markPanelDirty(status, 'salon');
    renderEssencesPanel();
  });
  del.classList.add('boardedit__mini', 'boardedit__del');
  ops.append(edit, del);

  li.append(when, who, text, meta, ops);
  return li;
}

/**
 * 一条精华的表单：新增（`existing` 为空）或者编辑某一条。
 * 插在 `host` 后面（列表行的下面 / 工具条的下面），不进新弹窗 ——
 * 面板已经够深了，再叠一层弹窗只会让人找不到退路。
 *
 * 图片：`images` 数组是唯一的真相，上传就把 /img/uploads/... 追加进去。
 * 从 QQ 拖进来、截图 Ctrl+V、点按钮选文件三条路都在（attachImageIntake）。
 */
function openEssenceForm(host, status, existing = null) {
  host.parentNode?.querySelector('.wess__form')?.remove();

  const isNew = !existing;
  /*
    不管新增还是编辑，表单改的都是**这一份副本**，点「保存这一条」才写回数组。
    编辑时如果直接抓着原对象改，点「取消」也回不去了（改到一半点取消，
    那条精华已经被改脏了）—— 和页面工作台 commitPageBlocks 一个道理。
  */
  const draft = existing
    ? { ...existing, memberIds: [...essenceMemberIds(existing)], images: [...(existing.images ?? [])] }
    : {
        id: newEssenceId(),
        memberIds: salonDraft.members[0] ? [salonDraft.members[0].id] : [],
        kind: 'text',
        date: localDateKey(),
        time: '',
        text: '',
        images: [],
        eraId: '',
      };
  // 老数据只有 memberId：进表单就归一到 memberIds（保存时服务端也认这一套）
  if (!Array.isArray(draft.memberIds)) draft.memberIds = essenceMemberIds(draft);
  delete draft.memberId;

  const form = document.createElement('div');
  form.className = 'wess__form';
  const title = document.createElement('h4');
  title.className = 'wbox__title';
  title.textContent = isNew ? `新增一条精华（id ${draft.id}）` : `编辑 ${draft.id}`;
  form.appendChild(title);

  /*
    成员：一条精华可以挂**好几个**人（2023-07-19 那场完美对话 = 虹星 + 花花），
    所以用勾选清单而不是单选下拉。

    顺序 = 对话里出现的顺序，是有意义的，所以这里维护的是一个**数组**：
    勾上就追加到末尾、取消就摘掉，不去按成员表重排。清单每次按这个数组的顺序
    显示已勾选的人在前，改顺序就是「先全取消再按想要的顺序勾一遍」。
  */
  const members = salonDraft.members;
  const picked = [...draft.memberIds];
  const pickBox = document.createElement('div');
  pickBox.className = 'wess__members';
  const pickHead = document.createElement('p');
  pickHead.className = 'hint wess__membersHead';
  const paintPickHead = () => {
    pickHead.textContent = picked.length
      ? `已选 ${picked.length} 人：${picked.map((id) => memberById(id)?.name || id).join('、')}`
      : '一个人都没选 —— 这条精华在站点上会显示成「未知成员」（保存是允许的）';
    pickHead.classList.toggle('is-bad', !picked.length);
  };
  pickBox.appendChild(pickHead);

  const grid = document.createElement('div');
  grid.className = 'wess__memberGrid';
  const boxes = [];
  for (const m of members) {
    const lab = document.createElement('label');
    lab.className = 'wess__member';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = m.id;
    cb.checked = picked.includes(m.id);
    cb.addEventListener('change', () => {
      const at = picked.indexOf(m.id);
      if (cb.checked) {
        if (at < 0) picked.push(m.id);
      } else if (at >= 0) {
        picked.splice(at, 1);
      }
      paintPickHead();
      // 选中的人排到前面，一眼能看出这条精华现在挂着谁
      boxes.sort((a, b) => {
        const ai = picked.indexOf(a.cb.value);
        const bi = picked.indexOf(b.cb.value);
        return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
      });
      for (const b of boxes) grid.appendChild(b.lab);
    });
    lab.append(cb, memberAvatarEl(m));
    const name = document.createElement('span');
    name.className = 'wess__memberName';
    name.textContent = m.name;
    lab.appendChild(name);
    boxes.push({ lab, cb, name: m.name });
    grid.appendChild(lab);
  }
  pickBox.appendChild(grid);
  const sortBtn = panelBtn('把已选的排到前面', '顺序 = 对话里出现的顺序，勾选的先后就是顺序', () => {
    boxes.sort((a, b) => {
      const ai = picked.indexOf(a.cb.value);
      const bi = picked.indexOf(b.cb.value);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });
    for (const b of boxes) grid.appendChild(b.lab);
  });
  sortBtn.classList.add('boardedit__mini');
  pickBox.appendChild(sortBtn);
  paintPickHead();
  form.appendChild(
    panelRow(
      '成员（可多选）',
      pickBox,
      '成员名和头像来自「成员」面板，这里只存 id。改成员那里保存后，这条会跟着变。',
    )
  );

  /* 种类：只给编辑器看，站点页面不按它分组 */
  const kindSel = document.createElement('select');
  kindSel.className = 'input';
  for (const [k, label] of Object.entries(ESSENCE_KIND_LABEL)) {
    const o = document.createElement('option');
    o.value = k;
    o.textContent = `${label}（${k}）`;
    kindSel.appendChild(o);
  }
  kindSel.value = essenceKindOf(draft);
  kindSel.addEventListener('change', () => {
    draft.kind = kindSel.value;
  });
  form.appendChild(
    panelRow('种类', kindSel, '文字 / 完美对话 / AI 创作。站点不按它分组，只是方便在这儿筛。'),
  );

  const dateWrap = document.createElement('div');
  dateWrap.className = 'wess__dt';
  const eraTag = document.createElement('em');
  eraTag.className = 'wess__era';
  const paintEra = (d) => {
    const id = eraIdForDate(d);
    eraTag.textContent = id ? `落在年代：${salonEraName(id)}` : '不在任何年代里（eraId 留空）';
    eraTag.classList.toggle('wess__era--none', !id);
  };
  const dateEl = dayPicker(draft.date, (v) => {
    draft.date = v;
    paintEra(v);
  });
  const timeEl = boardInput(draft.time ?? '', '19:44', (v) => {
    draft.time = v;
  });
  timeEl.classList.add('wtime');
  dateWrap.append(dateEl, timeEl, eraTag);
  paintEra(draft.date);
  form.appendChild(panelRow('日期 / 时间', dateWrap, '时间是 HH:MM，可以留空。年代（eraId）按日期自动落，不用手填。'));

  form.appendChild(
    panelRow(
      '正文',
      panelArea(draft.text ?? '', '这一条的内容；只有图片的话就留空', 4, (v) => {
        draft.text = v;
      }),
      '纯文本（站点那边不做 Markdown 渲染）。',
    )
  );

  const imgWrap = document.createElement('div');
  imgWrap.className = 'wess__imgs';
  const paintImgs = () => {
    imgWrap.textContent = '';
    if (!draft.images.length) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = '还没有图片。';
      imgWrap.appendChild(p);
    }
    draft.images.forEach((src, i) => {
      const cell = document.createElement('div');
      cell.className = 'wess__imgcell';
      const img = document.createElement('img');
      img.src = previewImgSrc(src);
      img.alt = '';
      img.loading = 'lazy';
      img.title = src;
      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'wess__imgdel';
      del.textContent = '×';
      del.title = '把这张从这一条里去掉（不会删文件）';
      del.addEventListener('click', () => {
        draft.images.splice(i, 1);
        paintImgs();
      });
      cell.append(img, del);
      imgWrap.appendChild(cell);
    });
  };
  paintImgs();

  const imgSlot = document.createElement('div');
  imgSlot.className = 'wess__imgadd';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = IMAGE_ACCEPT;
  file.multiple = true;
  file.hidden = true;
  const pick = panelBtn('＋ 加图片', '一次可以选多张；也可以直接把图拖进来，或截图后 Ctrl+V', () => file.click());
  imgSlot.append(pick, file);
  attachImageIntake({
    el: imgSlot,
    input: file,
    multiple: true,
    label: '精华图片',
    onFiles: async (files) => {
      pick.disabled = true;
      try {
        for (const f of files) {
          const p = await uploadImage(f);
          draft.images.push(p);
          toast(`精华图片已上传：${p}`);
        }
      } finally {
        pick.disabled = false;
        paintImgs();
      }
    },
    // 多图的地方拖进来的是链接的话一律不接（一张链接图不如让他自己贴地址）
    onUrl: () => toast('这里收图片文件：从网页拖过来的链接请用「选图片」上传', true),
  });
  form.appendChild(panelRow('图片', imgSlot, '上传后把 /img/uploads/... 追加进这一条的 images 里，一张一个格子。'));
  form.appendChild(imgWrap);

  const actions = document.createElement('div');
  actions.className = 'wess__formact';
  const save = panelBtn(isNew ? '保存这一条' : '改好了', '写进草稿（整个面板还要点「保存并重新构建」才落盘）', () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      toast('先选个日期', true);
      return;
    }
    /*
      成员**允许一个都不选**：数据里本来就有一条精华挂不到人的情况（群精华里
      那种"系统消息"），站点上渲染成「未知成员」。所以这里只提醒一句，不拦着存 ——
      拦下来就等于"这条精华我存不了"，比存成未知成员糟得多。
    */
    if (!picked.length && !draft.text.trim() && !draft.images.length) {
      toast('正文和图片至少留一样，不然这一条页面上是空的', true);
      return;
    }
    draft.memberIds = [...picked];
    draft.eraId = eraIdForDate(draft.date);
    if (isNew) {
      salonDraft.essences.push(draft);
    } else {
      // 编辑：把这一份改好的副本替回数组里（原地改是取消不掉的，见上面）
      const at = salonDraft.essences.findIndex((e) => e.id === draft.id);
      if (at >= 0) salonDraft.essences[at] = draft;
      else salonDraft.essences.push(draft);
    }
    markPanelDirty(status, 'salon');
    form.remove();
    renderEssencesPanel();
    toast(
      (isNew ? '加好了' : '改好了') +
        (picked.length ? '' : '（一个成员都没选，站点上会显示「未知成员」）') +
        '，记得点「保存并重新构建」',
    );
  }, true);
  const cancel = panelBtn('取消', '这一条不做了', () => form.remove());
  actions.append(save, cancel);
  form.appendChild(actions);

  host.after(form);
  form.scrollIntoView({ block: 'nearest' });
}

/* ---------- 成员 ---------- */

async function openMembersModal() {
  markWorkspaceActive('members');
  els.membersModal.hidden = false;
  els.memEditor.textContent = '正在读取…';
  try {
    await loadSalon();
  } catch (err) {
    els.memEditor.textContent = `读取失败：${err.message}`;
    return;
  }
  renderMembersPanel();
}

function closeMembersModal() {
  els.membersModal.hidden = true;
}

function renderMembersPanel() {
  const { body, foot, status } = panelShell(els.memEditor, {
    hint:
      '精华里**只存成员 id**（一条精华可以挂好几个人），名字和头像全在这张表里现查 —— ' +
      '所以在这里改名字 / 换头像，这个人所有的精华（包括首页那条「每日精华」）都会跟着变。' +
      '改完点「保存并重新构建」才看得到。',
    group: 'salon',
  });

  const members = salonDraft.members;
  const holders = {};

  /*
    「名下 N 条」是按 memberIds 里**包含**这个人算的（不是 memberId 相等）——
    一条精华挂两个人，两个人名下就都算这一条，所以各人条数相加大于等于总条数。
    「被挂到」那行是去重后的条数，用来和精华面板的总数对账。
  */
  const perMemberTotal = members.reduce((n, m) => n + essenceCountOf(m.id), 0);
  const touched = new Set();
  for (const e of salonDraft.essences ?? []) {
    for (const id of essenceMemberIds(e)) touched.add(e.id);
  }
  const total = (salonDraft.essences ?? []).length;

  const note = panelBox(
    `成员（${members.length} 人）`,
    '「精华」面板里的每一条都指向这里的一个 id（可以指向好几个人）。删掉一个成员，引用他的精华会显示成「未知成员」' +
      '（站点那边就是这么兜底的），精华本身不会消失。' +
      '另外：这张表还会被构建期用来把**全站正文里**出现的成员名自动链上（悬停浮出头像名片，点进「介绍页」）——' +
      '只链这里写的名字，所以旧名（比如「花花」）不在表里就永远不会被链；冰室精华页整页跳过。',
  );
  const tally = document.createElement('p');
  tally.className = 'hint';
  tally.textContent =
    `名下条数合计 ${perMemberTotal} 次（一条精华挂 N 个人就算 N 次）· ` +
    `至少挂到一个成员的精华 ${touched.size} / 共 ${total} 条` +
    (total - touched.size > 0 ? `（另 ${total - touched.size} 条一个成员都没挂，站点上显示「未知成员」）` : '');
  note.appendChild(tally);

  if (!members.length) {
    const p = document.createElement('p');
    p.className = 'hint';
    p.textContent = '一个成员都没有。点下面的「＋ 新增成员」。';
    note.appendChild(p);
  }

  members.forEach((m) => {
    const row = document.createElement('div');
    row.className = 'wmem';
    row.dataset.memberId = m.id;

    const head = document.createElement('div');
    head.className = 'wmem__head';
    const idTag = document.createElement('em');
    idTag.className = 'wmem__id';
    idTag.textContent = m.id;
    idTag.title = 'id 是精华指向这个人的依据，改名不改 id';
    const count = document.createElement('span');
    count.className = 'wmem__count';
    const n = essenceCountOf(m.id);
    count.textContent = n ? `名下 ${n} 条精华` : '名下还没有精华';
    count.classList.toggle('wmem__count--none', !n);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.title = '删掉这个成员';
    del.addEventListener('click', () => {
      const msg = n
        ? `${m.name} 名下还有 ${n} 条精华。删掉之后那 ${n} 条会显示成「未知成员」（精华本身不会消失）。确定删掉他吗？`
        : `删掉成员 ${m.name}？`;
      if (!confirm(msg)) return;
      const i = salonDraft.members.indexOf(m);
      if (i >= 0) salonDraft.members.splice(i, 1);
      markPanelDirty(status, 'salon');
      renderMembersPanel();
    });
    head.append(idTag, count, del);

    const fields = document.createElement('div');
    fields.className = 'wmem__fields';

    /* 头像地址框和缩略图同步（和「关于我」那套一样） */
    const avatarInput = boardInput(m.avatar ?? '', '/img/uploads/xxx.png 或 https://…', () => {});
    const slot = imageSlot({
      label: '成员头像',
      getValue: () => m.avatar,
      setValue: (v) => { m.avatar = v; },
      // 头像存的是路径，改了之后列表里那个圆形缩略图要跟着换
      onValue: (v) => {
        avatarInput.value = v;
        refreshEssenceRows([m.id]);
      },
      onChanged: () => {
        markPanelDirty(status, 'salon');
      },
      hint: '留空的话页面上画一个带首字的占位圆。',
    });
    holders[m.id] = slot;
    // 同上：slot 有了才挂回调
    avatarInput.addEventListener('input', () => {
      slot.sync(avatarInput.value, true);
      markPanelDirty(status, 'salon');
      refreshEssenceRows([m.id]);
    });
    fields.appendChild(panelRow('头像', slot.el));
    fields.appendChild(
      panelRow(
        '名字',
        boardInput(m.name ?? '', '成员名', (v) => {
          m.name = v;
          markPanelDirty(status, 'salon');
          // 精华列表里显示的就是这个名字，改一个字它就该跟着变
          refreshEssenceRows([m.id]);
        }),
        '改名不影响 id，所以他名下那几条精华一条都不会丢。',
      )
    );
    fields.appendChild(panelRow('头像地址', avatarInput));

    /* 卡片特效（可选）：名片上那轮落日 + 名字下面那行小字 + 放大头像时固定显示的图。
       三样都只有"特殊化"的成员才用得上（Raw 现在用了全套），留空就什么都不加。 */
    const zoomSlot = imageSlot({
      label: '放大图',
      getValue: () => m.zoom,
      setValue: (v) => { m.zoom = v; },
      onValue: (v) => { zoomInput.value = v; },
      onChanged: () => { markPanelDirty(status, 'salon'); },
      hint: '鼠标移到名片头像上时，放大框里固定显示这张；留空 = 就用头像那张。',
    });
    const zoomInput = boardInput(m.zoom ?? '', '/img/members/xxx.png 或 https://…', (v) => {
      m.zoom = v.trim();
      zoomSlot.sync(zoomInput.value, true);
      markPanelDirty(status, 'salon');
    });
    fields.appendChild(panelRow(
      '卡片特效',
      (() => {
        const box = document.createElement('div');
        box.className = 'wmem__fx';
        const sun = document.createElement('label');
        sun.className = 'wmem__sun';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = m.sun === true;
        cb.addEventListener('change', () => { m.sun = cb.checked; markPanelDirty(status, 'salon'); });
        const cbText = document.createElement('span');
        cbText.textContent = '落日';
        sun.append(cb, cbText);
        box.append(
          sun,
          boardInput(m.title ?? '', '称号，例如：冰室之主', (v) => {
            m.title = v.trim();
            markPanelDirty(status, 'salon');
          }),
        );
        return box;
      })(),
      '落日 = 名片上半画一轮蒸汽波落日；右边填「称号」（名字下面那行小字，例如「冰室之主」）。',
    ));
    fields.appendChild(panelRow('放大图', zoomSlot.el));
    fields.appendChild(panelRow('放大图地址', zoomInput));

    /* 介绍页地址：填了之后，全站正文里出现的这个名字会变成可点的链接
       （悬停浮出头像名片）；留空就只有名片、点不动。构建期由 tools/memlink 用。 */
    fields.appendChild(
      panelRow(
        '介绍页',
        boardInput(m.url ?? '', '/members/xxx/ 或 https://…', (v) => {
          m.url = v.trim();
          markPanelDirty(status, 'salon');
        }),
        '填了之后，全站正文里出现的这个名字会变成可点的链接（悬停浮出头像名片）；留空 = 只有名片、点不动。改完要「保存并重新构建」。',
      ),
    );

    row.append(head, fields);
    note.appendChild(row);
  });

  note.appendChild(
    panelBtn('＋ 新增成员', '新 id 自动生成，不会和现有的撞', () => {
      salonDraft.members.push({ id: newMemberId(), name: `新成员${salonDraft.members.length + 1}`, avatar: '', url: '', aliases: [], title: '', sun: false, zoom: '' });
      markPanelDirty(status, 'salon');
      renderMembersPanel();
    }),
  );
  body.appendChild(note);

  /*
    头像接入口是挂在 DOM 上的，重画面板会把它们带走；被带走的那几个
    在 pruneIntakes() 里会被剔掉，下次重画会自动重新注册，不用手动清理。
  */

  foot.append(
    panelBtn('关闭面板', '关掉这个面板（没保存的改动留着，切回来还在）', () => openWorkspace('docs')),
    panelBtn('重新读取', '把盘上的值重新读一遍（没保存的改动会丢）', async () => {
      if (!confirm('重新读盘会丢掉还没保存的改动，确定吗？')) return;
      salonDraft = null;
      salonDirty = false;
      await loadSalon();
      renderMembersPanel();
    }),
    panelBtn('看 /salon/', '在新标签页打开预览站点里的冰室精华页（要先构建过）', () => {
      window.open(`${PREVIEW_URL}/salon/`, '_blank', 'noopener');
    }),
    panelBtn('保存并重新构建', '写进 src/data/salon.json 并重新构建站点', () =>
      saveSalon(els.memSave, status), true, 'mem-save'),
  );
  els.memSave = $('mem-save');
}

/**
 * 成员改了名字 / 头像之后，把「精华」面板列表里属于他的那几行就地刷一遍。
 *
 * 为什么不整个 renderEssencesPanel()：那会把滚动位置和"加载到第几条"
 * 一起重来，几百条的位置一丢就得重新翻。而这里要改的只是名字和缩略图，
 * 就地改文本最省事，也不打断手上正在做的事。
 *
 * 一条精华挂好几个成员时，只要有**任意一个**改到了就整行的成员那格重画 ——
 * 名字用「、」连着、头像叠着排，单独改一个名字就得两个一起重排。
 */
function refreshEssenceRows(memberIds) {
  if (!els.essencesModal || els.essencesModal.hidden) return;
  const ids = new Set(memberIds);
  for (const li of els.essEditor.querySelectorAll('.wess__row')) {
    const e = (salonDraft?.essences ?? []).find((x) => x.id === li.dataset.essId);
    if (!e || !essenceMemberIds(e).some((id) => ids.has(id))) continue;
    const who = li.querySelector('.wess__who');
    if (!who) continue;
    who.replaceWith(essenceWhoEl(e));
  }
}

/* ---------------------------------------------------------------
   事件绑定
   --------------------------------------------------------------- */

function bindEvents() {
  /*
    先把「页面 / 独立页面」两套面板共用的那几块控件插好锚点，
    之后才能在两个面板之间来回搬（见 mountStudioHost）。
  */
  initStudioAnchors();
  paintWorkspaceSwitch();

  // 左上角总入口：点开是工作面清单，点哪项直接切过去
  els.btnHub.addEventListener('click', (ev) => {
    ev.stopPropagation();
    toggleHubMenu();
  });
  // 点别处、或者窗口大小变了，就把清单收起来（位置是算出来的，留着会错位）
  document.addEventListener('click', (ev) => {
    if (els.hubMenu.hidden) return;
    if (ev.target.closest?.('#hub-menu') || ev.target.closest?.('#btn-hub')) return;
    closeHubMenu();
  });
  window.addEventListener('resize', closeHubMenu);

  // 类型标签
  els.typeTabs.addEventListener('click', (ev) => {
    const tab = ev.target.closest('.tab');
    if (tab && tab.dataset.type) switchType(tab.dataset.type);
  });

  // 搜索
  // 搜索：加 120ms 防抖。连打时没必要每敲一个键就过一遍列表，
  // renderList 里还有一层"结果没变就不重建"的兜底。
  let searchTimer = null;
  els.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = els.search.value;
      renderList();
    }, 120);
  });

  // 新建
  els.btnNew.addEventListener('click', () => {
    if (state.dirty && !confirm('当前这篇还有未保存的修改（已暂存为草稿）。确定新建吗？')) return;
    startNew();
  });

  // 表单
  els.form.addEventListener('input', onFormChanged);
  els.form.addEventListener('change', onFormChanged);

  // 标题变化要同步标签页标题
  els.title.addEventListener('input', updateDocTitle);

  // 封面地址手输
  els.cover.addEventListener('input', () => {
    updateCoverPreview();
    onFormChanged();
  });

  // 封面：按钮 / 拖进来 / 粘进来，三条路都汇到下面这个 onFiles
  els.btnCoverUpload.addEventListener('click', () => els.coverFile.click());
  attachImageIntake({
    el: els.cover.closest('.cover') || els.cover,
    input: els.coverFile,
    label: '封面图',
    hint: '可拖入图片，或 QQ 截图后 Ctrl+V',
    onFiles: async ([file]) => {
      try {
        const p = await uploadImage(file);
        els.cover.value = p;
        updateCoverPreview();
        onFormChanged();
        toast(`封面已上传：${p}`);
      } catch (err) {
        toast(`上传失败：${err.message}`, true);
      }
    },
    // 从网页 / QQ 窗口拖过来的是链接，就当地址填进去
    onUrl: (url) => {
      els.cover.value = url;
      updateCoverPreview();
      onFormChanged();
      toast('封面地址已填上（拖进来的是链接，不是图片文件）');
    },
  });
  els.btnCoverClear.addEventListener('click', () => {
    els.cover.value = '';
    updateCoverPreview();
    onFormChanged();
  });

  // 标签
  els.tagsInput.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ',' || ev.key === '，') {
      ev.preventDefault();
      commitTagInput();
    } else if (ev.key === 'Backspace' && els.tagsInput.value === '' && state.tags.length) {
      ev.preventDefault();
      removeTag(state.tags[state.tags.length - 1]);
    }
  });
  els.tagsInput.addEventListener('input', () => {
    if (/[,，]/.test(els.tagsInput.value)) commitTagInput();
  });
  els.tagsInput.addEventListener('blur', commitTagInput);

  // 正文
  els.body.addEventListener('input', onBodyChanged);
  els.body.addEventListener('keydown', (ev) => {
    // Tab 缩进两个空格
    if (ev.key === 'Tab' && !ev.ctrlKey && !ev.metaKey) {
      ev.preventDefault();
      insertText('  ');
      return;
    }
    // 列表里回车自动续行
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.ctrlKey && !ev.metaKey) {
      const ta = els.body;
      const before = ta.value.slice(0, ta.selectionStart);
      const line = before.slice(before.lastIndexOf('\n') + 1);
      const m = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
      if (m && m[3].trim() !== '') {
        ev.preventDefault();
        const marker = /^\d+\.$/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : m[2];
        insertText(`\n${m[1]}${marker} `);
        return;
      }
      if (m && m[3].trim() === '') {
        ev.preventDefault();
        const ta2 = els.body;
        const lineStart = ta2.value.lastIndexOf('\n', ta2.selectionStart - 1) + 1;
        ta2.value = ta2.value.slice(0, lineStart);
        ta2.setSelectionRange(lineStart, lineStart);
        afterBodyEdit();
      }
    }
  });

  // 工具栏
  els.toolbar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.tool');
    if (btn && btn.dataset.cmd) runToolbar(btn.dataset.cmd);
  });

  // 保存
  els.btnSave.addEventListener('click', save);

  // 主题 / 预览开关
  els.btnTheme.addEventListener('click', cycleTheme);
  els.btnPreview.addEventListener('click', () => {
    state.previewOn = !state.previewOn;
    document.body.dataset.preview = state.previewOn ? 'on' : 'off';
    els.btnPreview.classList.toggle('is-on', state.previewOn);
    els.btnPreview.setAttribute('aria-pressed', state.previewOn ? 'true' : 'false');
    try {
      localStorage.setItem(PREVIEW_KEY, state.previewOn ? 'on' : 'off');
    } catch {
      /* 忽略 */
    }
    if (state.previewOn) renderPreview();
  });

  // 拖拽 / 粘贴插图（正文编辑器自己的那一套）
  bindImageDropAndPaste();

  // 其它上传点（封面、插入图片弹窗、地图、图片块、图标）的拖 / 粘入口
  bindImageIntakeTracking();
  bindImagePasteToIntakes();

  // 图片弹窗：上传那一格也接拖 / 粘
  els.modalPick.addEventListener('click', () => els.modalFile.click());
  attachImageIntake({
    el: els.modalPick.closest('.field') || els.modalFile.parentNode,
    input: els.modalFile,
    label: '插入图片',
    hint: '可拖入图片，或 QQ 截图后 Ctrl+V',
    onFiles: async ([file]) => {
      els.modalUploadHint.textContent = '正在上传……';
      try {
        const p = await uploadImage(file);
        els.modalUrl.value = p;
        if (!els.modalAlt.value) els.modalAlt.value = file.name.replace(/\.[^.]+$/, '');
        els.modalUploadHint.textContent = `已上传：${p}`;
      } catch (err) {
        els.modalUploadHint.textContent = `上传失败：${err.message}`;
      }
    },
    onUrl: (url) => {
      els.modalUrl.value = url;
      els.modalUploadHint.textContent = '已填上拖进来的图片链接';
    },
  });
  els.modalInsert.addEventListener('click', doInsertImage);
  els.imgModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeImageModal();
  });

  // 子版块编辑
  els.btnBoards.addEventListener('click', () => openWorkspace('boards'));
  els.boardsSave.addEventListener('click', () => saveBoards());
  els.boardsModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeBoardsModal();
  });

  // 时间轴
  els.btnTimelines.addEventListener('click', () => openWorkspace('timelines'));
  els.tlSave.addEventListener('click', saveTimelines);
  els.tlModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeTimelinesModal();
  });

  // 导航分类库
  els.btnNavs.addEventListener('click', () => openWorkspace('navs'));
  els.navsSave.addEventListener('click', saveNavs);
  els.navsModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeNavsModal();
  });

  // 页面工作台
  els.btnPages.addEventListener('click', () => openWorkspace('pages'));
  els.pageSave.addEventListener('click', saveStudio);
  els.pwSearch.addEventListener('input', () => {
    studioSearch = els.pwSearch.value;
    renderStudioTree();
  });
  els.pwCopyUrl.addEventListener('click', () => copyText(els.pwUrl.textContent, els.pwUrl));

  // 独立页面工作台（和「页面」共用同一批控件，所以复用的是同一批方法）
  els.soloAdd.addEventListener('click', () => createStandalone(els.soloNewName));
  els.soloNewName.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      createStandalone(els.soloNewName);
    }
  });
  // 清单可能有几十条，筛选也加一层防抖（和左栏搜索一个道理）
  let soloSearchTimer = null;
  els.soloSearch.addEventListener('input', () => {
    clearTimeout(soloSearchTimer);
    soloSearchTimer = setTimeout(() => {
      soloSearch = els.soloSearch.value;
      renderSoloList();
    }, 120);
  });
  els.soloModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeSoloView();
  });
  els.pwAddKid.addEventListener('click', () => {
    if (!studioNode) return;
    if (!Array.isArray(studioNode.children)) studioNode.children = [];
    studioNode.children.push({ title: '' });
    markStudioDirty();
    renderStudioKids();
    renderStudioTree();
    toast('加好了，填个名字再点「保存并重新构建」');
  });
  els.pwAddLink.addEventListener('click', () => {
    if (!studioNode) return;
    if (!Array.isArray(studioNode.children)) studioNode.children = [];
    // 先塞一个占位地址，行才会以「链接版块」的样子出现（有链接输入框、没有「编辑这一页」）
    studioNode.children.push({ title: '', link: 'https://' });
    markStudioDirty();
    renderStudioKids();
    renderStudioTree();
    toast('链接版块加好了：填名字和网址，再点「保存并重新构建」');
  });
  els.pwRebuild.addEventListener('click', async () => {
    els.pwStatus.textContent = '正在重新构建…';
    els.pwStatus.classList.remove('is-dirty');
    try {
      const res = await fetch('/api/build', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await loadStudioFrame({ keepStatus: true });
      els.pwStatus.textContent = `重新构建好了（${data.ms} ms）`;
    } catch (err) {
      els.pwStatus.textContent = `构建失败：${err.message}`;
      els.pwStatus.classList.add('is-dirty');
    }
  });
  els.pwOpen.addEventListener('click', () => {
    window.open(`${PREVIEW_URL}${studioUrl()}`, '_blank', 'noopener');
  });
  els.pagesModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closePagesView();
  });

  // 音乐 / 歌单
  els.btnMusic.addEventListener('click', () => openWorkspace('music'));
  els.musicSave.addEventListener('click', saveMusic);
  els.musicUpload.addEventListener('click', () => els.musicFile.click());
  els.musicFile.addEventListener('change', () => uploadMusicFiles(els.musicFile.files));
  els.musicLibToggle.addEventListener('click', () => {
    musicLibOpen = !musicLibOpen;
    renderMusicLibrary();
  });
  // 文章可能有几十篇，筛选也加一层防抖（和左栏搜索一个道理）
  let musicSearchTimer = null;
  els.musicSearch.addEventListener('input', () => {
    clearTimeout(musicSearchTimer);
    musicSearchTimer = setTimeout(() => {
      musicSearch = els.musicSearch.value;
      renderMusicPages();
    }, 120);
  });
  els.musicModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeMusicModal();
  });

  // 排版
  els.btnLayout.addEventListener('click', () => openWorkspace('layout'));
  els.layoutPage.addEventListener('change', () => loadLayoutPage(els.layoutPage.value));
  bindLayoutNumbers();
  if (els.layoutSample) {
    els.layoutSample.addEventListener('change', () => {
      if (layoutPage === 'board') loadLayoutPage('board');
    });
  }
  els.layoutSave.addEventListener('click', saveLayout);
  els.layoutReset.addEventListener('click', () => {
    const win = els.layoutFrame.contentWindow;
    if (win && win.__layoutApi && layoutPicked) {
      win.__layoutApi.reset(layoutPicked);
      fillLayoutNumbers(layoutPicked);
    }
  });
  els.layoutResetAll.addEventListener('click', () => {
    const win = els.layoutFrame.contentWindow;
    if (win && win.__layoutApi) {
      win.__layoutApi.resetAll();
      els.layoutPick.textContent = '已全部重置（记得保存）';
      fillLayoutNumbers(layoutPicked);
    }
  });
  els.layoutModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeLayoutModal();
  });

  /*
    首页那几块 + 冰室精华 + 冰山图：六个面板都没有顶栏按钮（顶栏已经挤满了），
    入口就两个 —— 左上角「☰ 工作台」的清单和每个面板顶上那排「切换」，
    两个都走 openWorkspace()，那里面已经接好了这六个 id。
    这里只管「点遮罩 / 点取消关掉」，和别的面板一个规矩。
  */
  for (const [modal, close] of [
    [els.calendarModal, closeCalendarModal],
    [els.aboutModal, closeAboutModal],
    [els.icebergModal, closeIcebergModal],
    [els.icechartModal, closeIceChartModal],
    [els.essencesModal, closeEssencesModal],
    [els.membersModal, closeMembersModal],
  ]) {
    modal.addEventListener('click', (ev) => {
      if (ev.target.dataset && ev.target.dataset.close) close();
    });
  }

  // iframe 里的编辑脚本通过 postMessage 回报状态
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'layout-pick') {
      layoutPicked = d.key;
      els.layoutPick.textContent = `已选中：${d.key}`;
      fillLayoutNumbers(d.key);
      return;
    }
    if (d.type === 'layout-metrics') {
      if (d.key === layoutPicked) fillLayoutNumbers(d.key);
      return;
    }
    if (d.type === 'layout-change') {
      els.layoutPick.textContent = `已选中：${layoutPicked || ''}（有改动，记得保存）`;
      // 拖动 / 缩放之后把数字回填，让「拖」和「填数字」始终对得上
      if (layoutPicked) fillLayoutNumbers(layoutPicked);
      return;
    }
    if (d.type === 'layout-ready') {
      /*
        以服务端存下来的值为准覆盖 iframe 里读到的初始值 ——
        页面可能还没重新构建，内联样式是旧的。
        然后，如果这一类页面有**没保存的草稿**（拖过但没点保存），
        再用草稿盖一遍：草稿比盘上的新，切面板回来必须还是那个样子。
      */
      const win = els.layoutFrame.contentWindow;
      if (!win || !win.__layoutApi) return;
      const saved = (layoutState?.pages || {})[layoutPage] || {};
      for (const [key, v] of Object.entries(saved)) {
        win.__layoutApi.applyKey(key, v);
      }
      // 到这里 iframe 里的 state 就是「盘上那份」；拿它当基准判断草稿动过没有
      const baseline = JSON.parse(JSON.stringify(win.__layoutApi.state));
      const draftState = layoutDrafts.get(layoutPage);
      if (!draftState) return;
      for (const [key, v] of Object.entries(draftState)) {
        win.__layoutApi.applyKey(key, v);
      }
      const changed = Object.keys(draftState).some((k) => {
        const a = draftState[k] || {};
        const b = baseline[k] || {};
        return (a.dx || 0) !== (b.dx || 0) || (a.dy || 0) !== (b.dy || 0)
          || (a.s || 1) !== (b.s || 1) || (a.w || 0) !== (b.w || 0) || (a.h || 0) !== (b.h || 0);
      });
      if (changed) els.layoutPick.textContent = '有改动，记得保存';
      return;
    }
  });
  els.modalUrl.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      doInsertImage();
    }
  });

  // 快捷键
  window.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (ev.key === 'Escape' && !els.hubMenu.hidden) {
      closeHubMenu();
      return;
    }
    if (ev.key === 'Escape' && !els.imgModal.hidden) {
      closeImageModal();
      return;
    }
    if (ev.key === 'Escape' && !els.musicModal.hidden) {
      closeMusicModal();
      return;
    }
    /*
      首页那几块 + 冰室精华 + 冰山图的六个面板也吃 Esc。同时只可能开着一个
      （openWorkspace 会先把别的都关掉），所以一个个判就够了。
    */
    if (ev.key === 'Escape') {
      for (const [modal, close] of [
        [els.calendarModal, closeCalendarModal],
        [els.aboutModal, closeAboutModal],
        [els.icebergModal, closeIcebergModal],
        [els.icechartModal, closeIceChartModal],
        [els.essencesModal, closeEssencesModal],
        [els.membersModal, closeMembersModal],
      ]) {
        if (!modal.hidden) {
          close();
          return;
        }
      }
    }
    if (!mod) return;
    const key = ev.key.toLowerCase();
    if (key === 's') {
      ev.preventDefault();
      save();
    } else if (key === 'b' && document.activeElement === els.body) {
      ev.preventDefault();
      runToolbar('bold');
    } else if (key === 'i' && document.activeElement === els.body) {
      ev.preventDefault();
      runToolbar('italic');
    }
  });

  // 未保存提醒
  window.addEventListener('beforeunload', (ev) => {
    if (!state.dirty) return undefined;
    writeDraft();
    ev.preventDefault();
    ev.returnValue = '';
    return '';
  });
}

/* ---------------------------------------------------------------
   启动
   --------------------------------------------------------------- */

async function loadBootstrap() {
  try {
    const data = await apiGet('/api/bootstrap');
    if (data && data.site) state.site = { ...state.site, ...data.site };
    els.brandTitle.textContent = state.site.title || '本地内容编辑器';
    els.brandSub.textContent = state.site.author ? `${state.site.author} · 本地离线编辑器` : '本地离线编辑器';
    els.brandSub.title = state.site.tagline || '';
    document.title = `${state.site.title || '本地内容编辑器'} 编辑器`;
  } catch (err) {
    toast(`读取站点配置失败：${err.message}`, true);
  }
}

async function init() {
  initTheme();
  bindEvents();

  try {
    const saved = localStorage.getItem(PREVIEW_KEY);
    if (saved === 'off') state.previewOn = false;
  } catch {
    /* 忽略 */
  }
  document.body.dataset.preview = state.previewOn ? 'on' : 'off';
  document.body.dataset.type = state.type;
  els.btnPreview.classList.toggle('is-on', state.previewOn);
  els.btnPreview.setAttribute('aria-pressed', state.previewOn ? 'true' : 'false');

  await loadBootstrap();
  await refreshList('posts');
  await refreshList('notes');
  // 子版块清单要先拉回来，勾选框才有内容可渲染
  await loadSubs();
  renderSubPicker();

  const params = new URLSearchParams(location.search);
  const startType = params.get('new');
  if (startType === 'notes' || startType === 'posts') {
    state.type = startType;
    document.body.dataset.type = startType;
    for (const tab of Array.from(els.typeTabs.querySelectorAll('.tab'))) {
      tab.classList.toggle('is-active', tab.dataset.type === startType);
    }
  }

  const items = state.items[state.type] || [];
  if (items.length && !(startType === 'notes' || startType === 'posts')) {
    await openItem(items[0].file, { askRestore: false });
    const draft = readDraft(draftKey(state.type, items[0].file));
    if (draft) renderMeta(draft);
  } else {
    startNew({ focus: false });
  }

  setDirty(false);
  await loadMarked();
}

/*
  验收口子：这个文件是 <script type="module">，顶层函数不在 window 上，
  自动化测试（.tmp 里那几个 CDP 脚本）连 openWorkspace 都叫不到。
  挂一个最小的把手出来，只暴露"打开某个工作面 / 当前是哪个"，
  没有它就只能靠点 DOM 猜，测出来的东西也不牢靠。
*/
window.__openWs = (id) => openWorkspace(id);
window.__activeWs = () => activeWorkspace;

init().catch((err) => {
  console.error(err);
  toast(`初始化失败：${err && err.message ? err.message : err}`, true);
});
