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
  pageModal: $('page-modal'),
  pageEditor: $('page-editor'),
  pageTitle: $('page-modal-title'),
  pageSave: $('page-save'),

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
  if (state.type === 'posts') {
    fm.summary = els.summary.value.trim();
    fm.cover = els.cover.value.trim();
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

async function uploadImage(file) {
  if (!file) throw new Error('没有选择文件');
  if (file.size > 10 * 1024 * 1024) throw new Error('图片超过 10MB，先压缩一下再传');
  const dataUrl = await readFileAsDataURL(file);
  const res = await apiPost('/api/upload', { name: file.name, dataUrl });
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
 */
function renamePasted(file) {
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
  els.boardsEditor.textContent = '正在读取…';
  els.boardsModal.hidden = false;
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
   页面内容编辑器

   每个版块可以写一段自己的内容：介绍文字、图片、链接，
   以及把这一层的子页面插到任意位置。数据存在节点的 page 数组上。

   块 id 是排版模式的锚点（pg-<id>），所以新建块时给它一个
   「节点 id + 序号」的 id —— 全站唯一，换页面也不会撞。
   --------------------------------------------------------------- */

const BLOCK_LABEL = { text: '文字', image: '图片', link: '链接', children: '子页面' };
const TEXT_HINT = '支持 Markdown：**粗体**、[链接](地址)、- 列表、![图](/img/uploads/x.png)、## 小标题';
const IMG_WIDTHS = [['full', '全宽'], ['wide', '宽'], ['half', '半宽'], ['third', '窄']];
const CARD_SHAPES = [['wide', '横（16:3）'], ['square', '方（1:1）'], ['tall', '竖（3:4）']];
const CARD_SIZES = [['l', '大'], ['m', '中'], ['s', '小']];

/** 当前正在编辑哪个节点、它下面那份块的草稿 */
let pageNode = null;
let pageDraft = [];

let blockSeq = 0;
const newBlockId = (nodeId) => `${nodeId}-p${Date.now().toString(36)}${(blockSeq += 1)}`;

function openPageModal(node) {
  pageNode = node;
  // 深拷一份：取消时不该动到原数据
  pageDraft = JSON.parse(JSON.stringify(node.page ?? []));
  els.pageTitle.textContent = `页面内容 · ${node.title || node.id || '未命名'}`;
  els.pageModal.hidden = false;
  renderPageEditor();
}

function closePageModal() {
  els.pageModal.hidden = true;
  pageNode = null;
  pageDraft = [];
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
    pick.addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try {
        block.src = await uploadImage(f);
        paint();
        toast('图片传好了');
      } catch (err) {
        toast(`传图失败：${err.message}`, true);
      }
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
      boardInput(block.href ?? '', '地址（站内写 /huaya，站外写 https://…）', (v) => {
        block.href = v.trim();
      })
    );
    wrap.appendChild(row);
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
  hint.textContent = '子版块会按这里选的比例和大小铺开';
  row.append(shape, size, hint);
  wrap.appendChild(row);
  return wrap;
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

    const head = document.createElement('div');
    head.className = 'pblock-edit__head';

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

    const move = (delta) => {
      const to = i + delta;
      if (to < 0 || to >= pageDraft.length) return;
      [pageDraft[i], pageDraft[to]] = [pageDraft[to], pageDraft[i]];
      renderPageEditor();
    };

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'btn btn--ghost boardedit__mini';
    up.textContent = '↑';
    up.title = '上移';
    up.disabled = i === 0;
    up.addEventListener('click', () => move(-1));

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'btn btn--ghost boardedit__mini';
    down.textContent = '↓';
    down.title = '下移';
    down.disabled = i === pageDraft.length - 1;
    down.addEventListener('click', () => move(1));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn btn--ghost boardedit__mini boardedit__del';
    del.textContent = '删除';
    del.addEventListener('click', () => {
      pageDraft.splice(i, 1);
      renderPageEditor();
    });

    head.append(n, type, idTag, spacer, up, down, del);
    box.appendChild(head);
    box.appendChild(blockFields(block));
    els.pageEditor.appendChild(box);
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
  ];
  for (const [, label, make] of adders) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--ghost';
    btn.textContent = `＋ ${label}`;
    btn.addEventListener('click', () => {
      pageDraft.push(make());
      renderPageEditor();
    });
    addRow.appendChild(btn);
  }
  els.pageEditor.appendChild(addRow);
}

/** 保存页面内容：写回草稿，然后连同整棵版块树一起落盘 */
async function savePageContent() {
  if (!pageNode) return;
  // 空块（没写字的文字、没选图的图片、缺字段的链接）直接丢掉，别存垃圾
  const kept = pageDraft.filter((b) => {
    if (b.type === 'text') return String(b.text ?? '').trim();
    if (b.type === 'image') return String(b.src ?? '').trim();
    if (b.type === 'link') return String(b.text ?? '').trim() && String(b.href ?? '').trim();
    return true;
  });
  pageNode.page = kept;
  closePageModal();
  await saveBoards();
}

/**
 * 版块封面图：缩略图 + 上传 + 去掉。
 *
 * 图传到 public/img/uploads/ 下，路径写进节点的 image 字段
 * （服务端 cleanNode 会原样保留）。页面上这张图就是卡片左边那格；
 * 没设的话用渐变兜底，不会是块空白。
 */
function boardCoverControl(node) {
  const wrap = document.createElement('span');
  wrap.className = 'boardedit__cover';

  const thumb = document.createElement('span');
  thumb.className = 'boardedit__thumb';
  if (node.image) {
    thumb.style.backgroundImage = `url(${node.image})`;
    thumb.title = node.image;
  } else {
    thumb.classList.add('boardedit__thumb--empty');
    thumb.title = '还没有封面图';
  }

  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/gif,image/webp,image/svg+xml';
  file.hidden = true;

  const pick = document.createElement('button');
  pick.type = 'button';
  pick.className = 'btn btn--ghost boardedit__mini';
  pick.textContent = node.image ? '换图' : '封面图';
  pick.title = '给这个版块选一张封面（页面上卡片左边那张图）';
  pick.addEventListener('click', () => file.click());

  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    file.value = '';
    if (!f) return;
    try {
      node.image = await uploadImage(f);
      renderBoardsEditor();
      toast('封面图传好了，记得保存');
    } catch (err) {
      toast(`传图失败：${err.message}`, true);
    }
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'btn btn--ghost boardedit__mini';
  clear.textContent = '去掉图';
  clear.hidden = !node.image;
  clear.addEventListener('click', () => {
    delete node.image;
    renderBoardsEditor();
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

      // 加下级：这是「一层里能再加更多层」的入口
      const addKid = document.createElement('button');
      addKid.type = 'button';
      addKid.className = 'btn btn--ghost boardedit__mini';
      addKid.textContent = '＋下级';
      addKid.title = '在这个版块下面再加一层';
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

      row.append(title, href, addKid, del);
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
      meta.appendChild(boardCoverControl(node));

      // 页面内容：这一页自己的介绍 / 图片 / 链接 / 子页面
      const content = document.createElement('button');
      content.type = 'button';
      content.className = 'btn btn--ghost boardedit__mini';
      content.textContent = (node.page ?? []).length ? `页面内容（${node.page.length}）` : '页面内容';
      content.title = '写这一页的介绍文字、插图片、插链接，或把子页面插到指定位置';
      content.addEventListener('click', () => openPageModal(node));
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
    head.textContent = `大板块　${board.id}`;
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

    const topContent = document.createElement('button');
    topContent.type = 'button';
    topContent.className = 'btn btn--ghost boardedit__mini';
    topContent.textContent = (board.page ?? []).length ? `页面内容（${board.page.length}）` : '页面内容';
    topContent.title = '写这一页的介绍文字、插图片、插链接，或把子页面插到指定位置';
    topContent.addEventListener('click', () => openPageModal(board));
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

async function saveBoards() {
  try {
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

    closeBoardsModal();
    toast('子版块已保存，重新构建后生效');
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
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

/** 注入进 iframe 的编辑脚本。字符串拼接，避免和外层的模板字面量打架。 */
const LAYOUT_SCRIPT = [
  '(function () {',
  '  var state = window.__layoutState = {};',
  '  var sel = null;',
  '  var nodes = [].slice.call(document.querySelectorAll("[data-edit]"));',
  '',
  '  function apply(el) {',
  '    var v = state[el.dataset.edit];',
  '    el.style.setProperty("--dx", v.dx + "%");',
  '    el.style.setProperty("--dy", v.dy + "%");',
  '    el.style.setProperty("--s", v.s);',
  '  }',
  '',
  '  // 初始值：先读构建时写进内联样式的，没有就取默认',
  '  nodes.forEach(function (el) {',
  '    var cs = el.style;',
  '    state[el.dataset.edit] = {',
  '      dx: parseFloat(cs.getPropertyValue("--dx")) || 0,',
  '      dy: parseFloat(cs.getPropertyValue("--dy")) || 0,',
  '      s: parseFloat(cs.getPropertyValue("--s")) || 1',
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
  '    if (sel) sel.style.outlineColor = "rgba(255,80,170,.75)";',
  '    sel = el;',
  '    el.style.outlineColor = "#5ff0ff";',
  '    window.parent.postMessage({ type: "layout-pick", key: el.dataset.edit }, "*");',
  '  }',
  '',
  '  function handle(el) {',
  '    var h = document.createElement("div");',
  '    h.style.cssText = "position:fixed;width:16px;height:16px;right:0;bottom:0;"',
  '      + "background:#5ff0ff;border:2px solid #06131a;border-radius:3px;"',
  '      + "cursor:nwse-resize;z-index:2147483647;display:none";',
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
  '      drag = { mode: "scale", el: sel, x: e.clientX, y: e.clientY,',
  '               s0: state[sel.dataset.edit].s, w: sel.getBoundingClientRect().width };',
  '      e.preventDefault();',
  '      return;',
  '    }',
  '    var el = e.target.closest ? e.target.closest("[data-edit]") : null;',
  '    if (!el) return;',
  '    select(el);',
  '    var v = state[el.dataset.edit];',
  '    drag = { mode: "move", el: el, x: e.clientX, y: e.clientY, dx0: v.dx, dy0: v.dy,',
  '             w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height };',
  '    e.preventDefault();',
  '  });',
  '',
  '  document.addEventListener("mousemove", function (e) {',
  '    if (!drag) return;',
  '    var v = state[drag.el.dataset.edit];',
  '    if (drag.mode === "move") {',
  '      // 换算成「相对自身尺寸的百分比」，这样存下来的值和屏幕宽度无关',
  '      v.dx = Math.round((drag.dx0 + (e.clientX - drag.x) / drag.w * 100) * 10) / 10;',
  '      v.dy = Math.round((drag.dy0 + (e.clientY - drag.y) / drag.h * 100) * 10) / 10;',
  '    } else {',
  '      var next = drag.s0 * (1 + (e.clientX - drag.x) / Math.max(60, drag.w));',
  '      v.s = Math.round(Math.min(5, Math.max(0.2, next)) * 100) / 100;',
  '    }',
  '    apply(drag.el);',
  '    placeGrip();',
  '    window.parent.postMessage({ type: "layout-change", state: state }, "*");',
  '  });',
  '',
  '  document.addEventListener("mouseup", function () { drag = null; });',
  '  window.addEventListener("resize", placeGrip);',
  '',
  '  window.__layoutApi = {',
  '    state: state,',
  '    applyKey: function (key, v) {',
  '      state[key] = { dx: v.dx, dy: v.dy, s: v.s };',
  '      var el = nodes.filter(function (n) { return n.dataset.edit === key; })[0];',
  '      if (el) apply(el);',
  '      placeGrip();',
  '    },',
  '    reset: function (key) {',
  '      state[key] = { dx: 0, dy: 0, s: 1 };',
  '      var el = nodes.filter(function (n) { return n.dataset.edit === key; })[0];',
  '      if (el) apply(el);',
  '      placeGrip();',
  '    },',
  '    resetAll: function () { nodes.forEach(function (n) { window.__layoutApi.reset(n.dataset.edit); }); },',
  '    pick: function (key) {',
  '      var el = nodes.filter(function (n) { return n.dataset.edit === key; })[0];',
  '      if (el) { select(el); placeGrip(); }',
  '    }',
  '  };',
  '  window.parent.postMessage({ type: "layout-ready" }, "*");',
  '})();',
].join('\n');

let layoutState = null;
/** iframe 里当前选中的元素 key，重置按钮要用 */
let layoutPicked = null;

async function openLayoutModal() {
  els.layoutModal.hidden = false;
  await loadLayoutPage(layoutPage);
}

/** 把某个页面类型的样板页载进 iframe */
async function loadLayoutPage(page) {
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
    els.layoutPick.textContent = '点一个元素选中它';
  } catch (err) {
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
    merged[key] = saved ? { dx: saved.dx, dy: saved.dy, s: saved.s } : v;
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
    toast('排版已保存，重新构建后生效');
  } catch (err) {
    toast(`保存失败：${err.message}`, true);
  }
}

function closeLayoutModal() {
  els.layoutModal.hidden = true;
  els.layoutFrame.srcdoc = '';
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
   事件绑定
   --------------------------------------------------------------- */

function bindEvents() {
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

  // 封面按钮
  els.btnCoverUpload.addEventListener('click', () => els.coverFile.click());
  els.coverFile.addEventListener('change', async () => {
    const file = els.coverFile.files && els.coverFile.files[0];
    els.coverFile.value = '';
    if (!file) return;
    try {
      const p = await uploadImage(file);
      els.cover.value = p;
      updateCoverPreview();
      onFormChanged();
      toast(`封面已上传：${p}`);
    } catch (err) {
      toast(`上传失败：${err.message}`, true);
    }
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

  // 拖拽 / 粘贴插图
  bindImageDropAndPaste();

  // 图片弹窗
  els.modalPick.addEventListener('click', () => els.modalFile.click());
  els.modalFile.addEventListener('change', async () => {
    const file = els.modalFile.files && els.modalFile.files[0];
    els.modalFile.value = '';
    if (!file) return;
    els.modalUploadHint.textContent = '正在上传……';
    try {
      const p = await uploadImage(file);
      els.modalUrl.value = p;
      if (!els.modalAlt.value) els.modalAlt.value = file.name.replace(/\.[^.]+$/, '');
      els.modalUploadHint.textContent = `已上传：${p}`;
    } catch (err) {
      els.modalUploadHint.textContent = `上传失败：${err.message}`;
    }
  });
  els.modalInsert.addEventListener('click', doInsertImage);
  els.imgModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeImageModal();
  });

  // 子版块编辑
  els.btnBoards.addEventListener('click', openBoardsModal);
  els.boardsSave.addEventListener('click', saveBoards);
  els.pageSave.addEventListener('click', savePageContent);
  els.boardsModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeBoardsModal();
  });
  els.pageModal.addEventListener('click', (ev) => {
    // 取消/点遮罩：只关这一层，版块树还开着，方便接着编辑别的
    if (ev.target.dataset && ev.target.dataset.close) closePageModal();
  });

  // 排版
  els.btnLayout.addEventListener('click', openLayoutModal);
  els.layoutPage.addEventListener('change', () => loadLayoutPage(els.layoutPage.value));
  if (els.layoutSample) {
    els.layoutSample.addEventListener('change', () => {
      if (layoutPage === 'board') loadLayoutPage('board');
    });
  }
  els.layoutSave.addEventListener('click', saveLayout);
  els.layoutReset.addEventListener('click', () => {
    const win = els.layoutFrame.contentWindow;
    if (win && win.__layoutApi && layoutPicked) win.__layoutApi.reset(layoutPicked);
  });
  els.layoutResetAll.addEventListener('click', () => {
    const win = els.layoutFrame.contentWindow;
    if (win && win.__layoutApi) {
      win.__layoutApi.resetAll();
      els.layoutPick.textContent = '已全部重置（记得保存）';
    }
  });
  els.layoutModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeLayoutModal();
  });

  // iframe 里的编辑脚本通过 postMessage 回报状态
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || typeof d !== 'object') return;

    if (d.type === 'layout-pick') {
      layoutPicked = d.key;
      els.layoutPick.textContent = `已选中：${d.key}`;
      return;
    }
    if (d.type === 'layout-change') {
      els.layoutPick.textContent = `已选中：${layoutPicked || ''}（有改动，记得保存）`;
      return;
    }
    if (d.type === 'layout-ready') {
      // 以服务端存下来的值为准覆盖 iframe 里读到的初始值 ——
      // 页面可能还没重新构建，内联样式是旧的。
      const win = els.layoutFrame.contentWindow;
      if (!win || !win.__layoutApi || !layoutState) return;
      const saved = (layoutState.pages || {})[layoutPage] || {};
      for (const [key, v] of Object.entries(saved)) {
        win.__layoutApi.applyKey(key, v);
      }
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
    if (ev.key === 'Escape' && !els.imgModal.hidden) {
      closeImageModal();
      return;
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

init().catch((err) => {
  console.error(err);
  toast(`初始化失败：${err && err.message ? err.message : err}`, true);
});
