/*
 * ============================================================================
 * 三路 JSON 合并 —— 两个人同时改同一份数据时，能自动合的就别让人手动合
 * ----------------------------------------------------------------------------
 * 用户 2026-10-12 的要求（原话）：
 *   「因为有许多条目 冰山 页面等进行编写 … 并且因为可能会有多人实时同步进行编辑」
 *
 * 为什么需要它：站点的数据几乎全是**一份大 JSON**（src/data/iceberg.json、
 * home-boards.json、salon.json …）。两个人同一时间改同一份文件，是共享编辑器
 * 最容易出事的场景：
 *   · git 的合并是按**行**看的。JSON 一行一个字段，多数情况能自动合；
 *     但只要两边动到挨着的几行（比如同一张卡片的两个字段），git 就会停下来插
 *     `<<<<<<<`，让人对着一整屏 JSON 手动清标记 —— 这正是共享编辑器最劝退的一幕；
 *   · 更糟的是数组：`"items": [...]` 里加一条，git 看到的是"两个人在同一个位置
 *     各加了几行"，十有八九判成冲突，其实两个人加的是两条不同的条目。
 *
 * 所以这里做的是**语义合并**：按 JSON 的结构合，而不是按行合。
 *   · 对象递归下去，一人改一个字段就两边都要；
 *   · 数组：元素带 id 的按 id 认（各加各的条目、各改各的条目都能合）；
 *     字符串清单按集合合（各自追加的都要）；认不出来的老实报冲突；
 *   · 真正说不到一起去的（同一个字段两边改成了不一样的值）才报冲突，
 *     而且报的是**哪个字段**（`boards[2].blocks[0].title`），不是"第几行"。
 *
 * ⚠ 谁是谁：这个函数被调用的地方是 `git rebase` 撞车之后，那边 git 的称呼
 *   和常理是反的 —— **ours 是远端（被合进来的那一方），theirs 是我这次的提交**
 *   （见 sync.mjs 里 readConflictStages 的说明）。所以数组顺序以 ours 为主。
 *
 * ⚠ 合不了时**绝不猜**：报冲突、把路径列出来，让 sync.mjs 照老规矩中止 rebase、
 *   把仓库恢复原状。宁可让人手动合一回，也不能悄悄丢掉谁的一条内容。
 * ============================================================================
 */

/** 键不存在时的替身（不能用 undefined —— JSON 里 `{"a":null}` 和没有 a 是两回事） */
const MISSING = Symbol('missing');

/** 深比较（键顺序无关） */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === MISSING || b === MISSING) return false;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual(a[k], b[k])) return false;
  }
  return true;
}

const isPlain = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);

/* ------------------------------------------------------------------
 * 「最后写的人赢」的时间戳字段（2026-10-12 加）
 * ------------------------------------------------------------------
 * 用户和朋友一起用编辑器时撞上的真事：一个在改「导航」、一个在改「冰山图」，
 * 两边**内容完全不冲突**，发布却被拦住了 —— 撞的是 src/data/recent-edits.json 的 `updated`。
 *
 * 那份文件是**编辑器自己写的记账表**（「近期更新」那一块用它）：每保存一次，
 * 就把 `updated` 盖成"现在"，再往 edits 里插一条。于是**任何两个人各改各的东西**，
 * 这个字段都会两边各推一格 —— 一个纯粹的记账字段，为它拦下一次发布毫无道理。
 *
 * 所以：键名像时间戳、而且两边的值都是「YYYY-MM-DD…」这种形状 → 取**晚的那一份**（不打冲突）。
 * ⚠ 形状卡得很死（必须以 YYYY-MM-DD 开头）：salon.json 里精华的 `at` 是"几点几分"（20:21），
 *   绝不能被当成时间戳去比大小。
 * ------------------------------------------------------------------ */
const TIME_KEY = /^(updated|updatedAt|savedAt|editedAt|mtime|at|time)$/i;

/** 路径最后那一段：`a.b[href:x].at` → `at`；`a.b` → `b` */
function lastKey(path) {
  const seg = String(path ?? '').split('.').pop() ?? '';
  return seg.replace(/\[[^\]]*\]$/, '');
}

/** 值像不像一个时间戳（必须以 YYYY-MM-DD 开头）；不像就给 NaN，交给正常规则处理 */
function asTime(v) {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return NaN;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : NaN;
}


/** 元素的身份字段：`id` 优先，其次 `key`（本仓库两种都有） */
const ID_KEYS = ['id', 'key', 'href', 'url'];

function idOf(el, keys = ID_KEYS) {
  if (!isPlain(el)) return '';
  for (const k of keys) {
    const v = el[k];
    if (typeof v === 'string' && v) return `${k}:${v}`;
    if (typeof v === 'number' && Number.isFinite(v)) return `${k}:${v}`;
  }
  return '';
}

/** 整条数组能不能按 id 认：每个元素都有 id 且互不重复 */
function idKeyed(arr, keys = ID_KEYS) {
  if (!Array.isArray(arr)) return false;
  const seen = new Set();
  for (const el of arr) {
    const id = idOf(el, keys);
    if (!id || seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

const allStrings = (arr) => Array.isArray(arr) && arr.every((v) => typeof v === 'string');

/** 截一小段给人看的值（冲突提示里用，别把整张图片的 base64 打出来） */
function brief(v, max = 60) {
  if (v === MISSING || v === undefined) return '（没有）';
  if (v === null) return 'null';
  if (typeof v === 'string') return v === '' ? '（空）' : (v.length > max ? `${v.slice(0, max)}…` : v);
  if (typeof v === 'boolean' || typeof v === 'number') return String(v);
  let s;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s === undefined) s = String(v);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/**
 * 三路合并。
 * @param {*} base   共同祖先（git 冲突里的 :1:）
 * @param {*} ours   远端那一方（git 冲突里的 :2:；rebase 时是"正在被合进来的"）
 * @param {*} theirs 我这一方（git 冲突里的 :3:）
 * @returns {{ok:boolean, value:*, conflicts:Array, notes:string[]}}
 */
export function mergeJson3(base, ours, theirs, { maxConflicts = 40, depth = 0 } = {}) {
  const conflicts = [];
  const notes = [];
  const value = walk('', base, ours, theirs, depth);
  return { ok: conflicts.length === 0, value, conflicts, notes };

  function conflict(path, why, b, o, t) {
    if (conflicts.length < maxConflicts) {
      conflicts.push({ path: path || '(根)', why, base: brief(b), ours: brief(o), theirs: brief(t) });
    } else if (conflicts.length === maxConflicts) {
      conflicts.push({ path: '…', why: `冲突太多，只列到 ${maxConflicts} 条`, base: '', ours: '', theirs: '' });
    }
    return MISSING; // 占位，最终 ok=false，调用方不会用这个值
  }

  function walk(path, b, o, t, dep) {
    if (deepEqual(o, t)) return o;              // 两边改得一样（或都没改）
    if (deepEqual(b, o)) return t;              // 只有我这边改了
    if (deepEqual(b, t)) return o;              // 只有远端改了
    if (dep > 60) return conflict(path, '嵌套太深，不自动合', b, o, t);

    /* 「最后写的人赢」的时间戳字段（见下面 TIME_KEY 那段）：取晚的那份，不算冲突 */
    const key = lastKey(path);
    const ot = asTime(o);
    const tt = asTime(t);
    if (TIME_KEY.test(key) && Number.isFinite(ot) && Number.isFinite(tt)) {
      const win = ot >= tt ? o : t;
      notes.push(`${path}：两边都往前推了时间戳，取了晚的那份（${ot >= tt ? '你这边' : '远端'}的 ${win}）`);
      return win;
    }

    if (isPlain(b) && isPlain(o) && isPlain(t)) return walkObject(path, b, o, t, dep);
    if (Array.isArray(b) && Array.isArray(o) && Array.isArray(t)) return walkArray(path, b, o, t, dep);

    /* 一边是对象一边是数组 / 标量改得不一样 —— 没法判断意图，报冲突 */
    return conflict(path, '两边改成了不一样的值', b, o, t);
  }

  function walkObject(path, b, o, t, dep) {
    const out = {};
    const keys = new Set([...Object.keys(b), ...Object.keys(o), ...Object.keys(t)]);
    for (const key of keys) {
      const p = path ? `${path}.${key}` : key;
      const bv = Object.prototype.hasOwnProperty.call(b, key) ? b[key] : MISSING;
      const ov = Object.prototype.hasOwnProperty.call(o, key) ? o[key] : MISSING;
      const tv = Object.prototype.hasOwnProperty.call(t, key) ? t[key] : MISSING;

      /*
        `_readme` 这类下划线开头的键是**写给人看的说明**（每个数据文件头上都有一份）。
        两边都动了它（比如各自补了一句说明）没有对错之分，不该为这个拦下一次发布 ——
        谁写得多用谁的，只在 notes 里提一句。
      */
      if (key.startsWith('_') && ov !== MISSING && tv !== MISSING && !deepEqual(ov, tv)) {
        const pick = (Array.isArray(ov) ? ov.length : String(ov).length) >= (Array.isArray(tv) ? tv.length : String(tv).length) ? ov : tv;
        out[key] = pick;
        notes.push(`${p}：两边都改了说明文字，取了长的那一份`);
        continue;
      }

      if (ov === MISSING && tv === MISSING) continue;                 // 两边都删了
      if (ov === MISSING || tv === MISSING) {
        const kept = ov === MISSING ? tv : ov;
        const gone = ov === MISSING ? '你那边' : '远端';
        if (bv === MISSING || deepEqual(kept, bv)) continue;           // 一边删、另一边没动 → 按删的处理
        conflict(p, `${gone}删掉了，另一边改了它`, bv, ov, tv);
        continue;
      }
      const merged = walk(p, bv, ov, tv, dep + 1);
      if (merged !== MISSING) out[key] = merged;
    }
    return out;
  }

  function walkArray(path, b, o, t, dep) {
    // 元素带 id：按 id 认（各加各的条目、各改各的条目）
    if (idKeyed(b) && idKeyed(o) && idKeyed(t)) return walkById(path, b, o, t, dep);
    // 字符串清单（标签之类）：按集合合，各自追加的都要
    if (allStrings(b) && allStrings(o) && allStrings(t)) return walkStrings(path, b, o, t);
    return conflict(path, '两份清单都改了，认不出里面的条目（元素没有 id）', b, o, t);
  }

  function walkStrings(path, b, o, t) {
    const inAll = (arr) => new Set(arr);
    const so = inAll(o);
    const st = inAll(t);
    /*
      一边删掉、另一边原样留着 → 按删的处理（留着的那边本来就没动它）。
      但"一边删、另一边也动过它"在字符串清单里看不出来（只能看见在不在），
      所以只要删掉的那条另一边还在，就老实报冲突，让人自己看一眼。
    */
    const removedByOurs = b.filter((x) => !so.has(x) && st.has(x));
    const removedByTheirs = b.filter((x) => !st.has(x) && so.has(x));
    if (removedByOurs.length || removedByTheirs.length) {
      return conflict(path, `一边删了清单里的：${[...removedByOurs, ...removedByTheirs].map((x) => brief(x, 20)).join('、')}，另一边还留着`, b, o, t);
    }
    const out = b.filter((x) => so.has(x) && st.has(x));
    for (const x of o) if (!out.includes(x)) out.push(x);
    for (const x of t) if (!out.includes(x)) out.push(x);
    notes.push(`${path}：清单按集合合的（各自的追加都保留）`);
    return out;
  }

  function walkById(path, b, o, t, dep) {
    const bm = new Map(b.map((el) => [idOf(el), el]));
    const om = new Map(o.map((el) => [idOf(el), el]));
    const tm = new Map(t.map((el) => [idOf(el), el]));

    /*
      顺序：以 ours（远端那一方）的顺序为主。
      只在 theirs（我这边）新加的条目，按"我在自己那份里排在谁后面"插进去 ——
      这样"我在第 3 条后面加了一条"就真的落在第 3 条后面，而不是被甩到末尾。
    */
    const order = o.map((el) => idOf(el));
    const extra = t.filter((el) => !om.has(idOf(el)));
    for (const el of extra) {
      const id = idOf(el);
      const at = t.findIndex((x) => idOf(x) === id);
      let anchor = -1;
      for (let i = at - 1; i >= 0; i--) {
        const prev = idOf(t[i]);
        const pos = order.indexOf(prev);
        if (pos >= 0 && om.has(prev)) { anchor = pos; break; }
      }
      if (anchor >= 0) order.splice(anchor + 1, 0, id);
      else order.push(id);
    }

    const out = [];
    for (const id of order) {
      const ov = om.get(id);
      const tv = tm.get(id);
      const bv = bm.get(id);
      const p = `${path}[${id}]`;

      /* 两边都有这条 */
      if (ov !== undefined && tv !== undefined) {
        if (bv !== undefined) {
          const merged = walk(p, bv, ov, tv, dep + 1);
          if (merged !== MISSING) out.push(merged);
        } else if (deepEqual(ov, tv)) {
          out.push(ov);                                   // 两边各自新建的同一条，正好一样
        } else {
          conflict(p, '两边各自新建了同一条（id 撞上了），内容还不一样', MISSING, ov, tv);
        }
        continue;
      }

      /* 只有 ours（远端）有 */
      if (ov !== undefined) {
        if (bv === undefined) { out.push(ov); continue; }  // 远端新加的，我这份本来就没有
        if (deepEqual(ov, bv)) continue;                   // 我删了、远端没动它 → 按删的处理
        conflict(p, '我这边删掉了这条，远端改了它', bv, ov, MISSING);
        continue;
      }
      if (tv === undefined) continue;                      // 走不到：order 是 ours ∪ theirs 新加的

      /* 只有 theirs（我）有 —— 上面的 extra 已经把它按位置插进 order 了 */
      if (bv === undefined) { out.push(tv); continue; }    // 我新加的
      if (deepEqual(tv, bv)) continue;                     // 远端删了、我没动它 → 按删的处理
      conflict(p, '远端删掉了这条，我改了它', bv, MISSING, tv);
    }
    return out;
  }
}

/* ------------------------------------------------------------------
 * 字段级差异 —— 「版本」面板里那一列中文摘要用的
 *
 * 用户要的是「方便快捷可视化的版本回滚」：光看 `src/data/iceberg.json | 12 +++---`
 * 这种行数统计，等于让人自己去猜"这一版到底动了什么"。所以这里把两份 JSON
 * 摆在一起走一遍，产出**哪个字段**从什么变成了什么。
 * ------------------------------------------------------------------ */

/**
 * @param {*} before 旧的一版
 * @param {*} after  新的一版
 * @param {{limit?:number, maxText?:number}} opts
 * @returns {Array<{path:string, kind:'add'|'del'|'change', before:string, after:string}>}
 */
export function diffJson(before, after, { limit = 60, maxText = 80 } = {}) {
  const out = [];
  walk('', before, after, 0);
  return out;

  function push(path, kind, b, a) {
    if (out.length >= limit) return;
    /* before / after 一律用 brief：'（没有）' 表示这一版里还没有这一项 —— 比空串清楚 */
    out.push({ path: path || '(根)', kind, before: brief(b, maxText), after: brief(a, maxText) });
  }

  function walk(path, b, a, dep) {
    if (out.length >= limit || dep > 60) return;
    if (deepEqual(b, a)) return;
    if (isPlain(b) && isPlain(a)) {
      const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
      for (const k of keys) {
        const p = path ? `${path}.${k}` : k;
        const bv = Object.prototype.hasOwnProperty.call(b, k) ? b[k] : MISSING;
        const av = Object.prototype.hasOwnProperty.call(a, k) ? a[k] : MISSING;
        if (bv !== MISSING && av === MISSING) push(p, 'del', bv, MISSING);
        else if (bv === MISSING && av !== MISSING) push(p, 'add', MISSING, av);
        else walk(p, bv, av, dep + 1);
      }
      return;
    }
    if (Array.isArray(b) && Array.isArray(a)) {
      /*
        数组：元素带 id 就按 id 说人话（"加了 e0792"），否则只说长度变化 ——
        一条一条按位置比会产出一屏"第 5 项变了"，反而看不清。
      */
      if (idKeyed(b) && idKeyed(a)) {
        const bm = new Map(b.map((el) => [idOf(el), el]));
        const am = new Map(a.map((el) => [idOf(el), el]));
        for (const [id, el] of am) {
          if (!bm.has(id)) push(`${path}[${id}]`, 'add', MISSING, el);
          else walk(`${path}[${id}]`, bm.get(id), el, dep + 1);
        }
        for (const [id, el] of bm) if (!am.has(id)) push(`${path}[${id}]`, 'del', el, MISSING);
        return;
      }
      push(path, 'change', `共 ${b.length} 项`, `共 ${a.length} 项`);
      return;
    }
    push(path, b === MISSING ? 'add' : 'change', b, a);
  }
}
