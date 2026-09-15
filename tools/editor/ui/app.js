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

  renderChips();
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

function renderBoardsEditor() {
  els.boardsEditor.textContent = '';

  for (const board of boardsDraft.boards) {
    const box = document.createElement('div');
    box.className = 'boardedit';

    const head = document.createElement('div');
    head.className = 'boardedit__head';
    head.textContent = `${board.title}　${board.id}`;
    box.appendChild(head);

    board.items.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'boardedit__row';

      const label = document.createElement('input');
      label.type = 'text';
      label.className = 'input';
      label.placeholder = '子版块名称';
      label.value = item.label || '';
      label.addEventListener('input', () => {
        item.label = label.value;
      });

      const href = document.createElement('input');
      href.type = 'text';
      href.className = 'input';
      href.placeholder = '地址（留空 = 待定占位）';
      href.value = item.href || '';
      href.addEventListener('input', () => {
        item.href = href.value;
      });

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'btn btn--ghost boardedit__del';
      del.textContent = '删除';
      del.addEventListener('click', () => {
        board.items.splice(idx, 1);
        renderBoardsEditor();
      });

      row.append(label, href, del);
      box.appendChild(row);
    });

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'btn btn--ghost boardedit__add';
    add.textContent = '＋ 添加子版块';
    add.addEventListener('click', () => {
      board.items.push({ label: '' });
      renderBoardsEditor();
      const rows = box.querySelectorAll('.boardedit__row .input');
      const last = rows[rows.length - 2];
      if (last) last.focus();
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
  els.boardsModal.addEventListener('click', (ev) => {
    if (ev.target.dataset && ev.target.dataset.close) closeBoardsModal();
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
