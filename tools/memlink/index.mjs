/**
 * ============================================================================
 * 成员名自动链接（构建期 + dev 期都跑）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-09）：
 *   「鼠标移到指定的文字上后（成员名字），会浮现出一个框，内有成员的头像和名字，
 *     点击就可以跳转到成员的介绍页面（链接我自己填，因为页面还没做好）。
 *     需要有一个脚本可以自动读取本网站中所有文字内容里出现的成员名字并自动链接
 *     上去，读取的名字是我输入的那些（比如花花应当叫隰辰煦，所以不能链接花花，
 *     只能链接隰辰煦），另外冰室精华页面内的不要链接，那里面的名字频率过高且没有
 *     意义。」
 *
 * 后来又加的两条：
 *   「把鼠标移到悬停页的头像上 → 放大头像到一个更大的方形框里显示整个图片」
 *   「Raw 的特殊化：卡片上半加半轮蒸汽波落日 + 写「冰室之主」；放大头像固定显示
 *     他给的那张图」—— 这三件事都是成员表里的字段（title / sun / zoom），
 *     不是写死在代码里的，所以以后想给别人加也一样。
 *
 * ── 两条执行路径（务必都保留）──────────────────────────────────────────────
 *   ① `astro:build:done`：构建完逐页重写 dist 里的 HTML。
 *   ② `astro:server:setup`：**dev 模式下**挂一层中间件，把每次请求的 HTML 就地
 *      重写。
 *
 *   ⚠ 第二条是补出来的坑：用户的启动器「看效果」跑的是 `pnpm dev`（astro dev，
 *   端口 4321），dev 是**按请求即时渲染**的，根本不会走到 build 钩子 ——
 *   所以第一版做完用户看到的是"功能没生效"。现在两条路共用同一套
 *   prepare()/rewriteHtml()，dev 下还会盯一眼 salon.json 的修改时间，
 *   改了成员表不用重启 dev 也能立刻跟上。
 *
 * ── 三条边界，缺一条都会出事 ──────────────────────────────────────────────
 *   ① 只在**文本节点**里替换 —— 标签、属性（`title` / `alt` / `class` ……）
 *      一律不碰。属性被改写会让链接、无障碍名字、样式选择器一起坏掉。
 *   ② 一批标签**整块跳过**：`a`（不能嵌套链接）、`pre`/`code`/`kbd`（代码里
 *      出现名字是举例，不是指人）、`script`/`style`/`title`/`head`/`textarea`、
 *      `svg`。任何元素上写 `data-nomem` 也会连它里面的文字一起跳过（逃生口）。
 *   ③ 名字按**长的优先**匹配；纯英文/数字的名字要求两侧不是英文字母或数字
 *      （否则 `Raw` 会在 `Draw` / `raws` 里被链上）；中文名不要求（人名前后
 *      直接接汉字是常态：「隰辰煦的生日」）。
 *
 * ⚠ 旧名（例如「花花」）**不在**成员表里，所以永远不会被链上 —— 这正是用户要的。
 *   真想链旧名，往那个成员的 `aliases` 里加一条即可。
 *
 * 关掉这个功能：`astro.config.mjs` 里去掉这个 integration，或者设 `MEMLINK=0`。
 * 某个页面不想被链：在页面里给根元素写 `data-nomem`。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 这些标签里面的文字**一个都不碰**（连同它们的子元素） */
export const SKIP_TAGS = new Set([
  'head', 'title', 'script', 'style', 'pre', 'code', 'kbd', 'samp', 'var',
  'textarea', 'svg', 'math', 'noscript', 'a', 'button', 'select', 'option',
  'template', 'iframe', 'object', 'canvas',
]);

/** 自闭合标签：不压栈（压了就永远弹不出来，后面的正文全被跳过） */
const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link',
  'meta', 'param', 'source', 'track', 'wbr',
]);

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 纯 ASCII 的名字（Airo / Raw / SSWTLZZ）两侧要求是"词的边界" */
const needsBoundary = (name) => /^[\x20-\x7E]+$/.test(name);
const isWordChar = (ch) => !!ch && /[A-Za-z0-9_]/.test(ch);

/**
 * 建"文本 → 该链谁"的匹配器。
 * 返回的函数给一段纯文本，吐出一串 [{ index, text, member }]（从左到右、互不重叠）。
 */
export function buildMatcher(members) {
  const entries = [];
  for (const m of members) {
    for (const n of [m.name, ...(m.aliases || [])]) {
      const name = String(n ?? '');
      if (name) entries.push({ name, member: m });
    }
  }
  // 长的优先：成员里既有「隰辰煦」也有「辰煦」时，先试长的
  entries.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));

  return (text) => {
    const found = [];
    for (let i = 0; i < text.length; ) {
      let hit = null;
      for (const e of entries) {
        if (!text.startsWith(e.name, i)) continue;
        if (needsBoundary(e.name) && (isWordChar(text[i - 1]) || isWordChar(text[i + e.name.length]))) continue;
        hit = e;
        break;
      }
      if (hit) {
        found.push({ index: i, text: hit.name, member: hit.member });
        i += hit.name.length;
      } else {
        i += 1;
      }
    }
    return found;
  };
}

/**
 * 重写一段 HTML：把文本节点里出现的成员名包成 `.mem`（名片 + 可选链接）。
 *
 * @param html    整页 HTML
 * @param match   buildMatcher() 的返回值
 * @param render  (member, matchedName) => HTML 片段
 * @returns       { html, count, perMember }
 */
export function rewriteHtml(html, match, render) {
  let out = '';
  let last = 0;
  let count = 0;
  const perMember = new Map();
  /** 开标签栈：每一项是 { name, skip }；当前要不要跳过 = 栈里有没有 skip 项 */
  const stack = [];
  const skipping = () => stack.some((s) => s.skip);

  const push = (tagText) => {
    const m = /^<\s*([a-zA-Z][\w:-]*)/.exec(tagText);
    if (!m) return;
    const name = m[1].toLowerCase();
    if (VOID_TAGS.has(name) || /\/\s*>$/.test(tagText)) return;
    stack.push({ name, skip: SKIP_TAGS.has(name) || /\sdata-nomem(?=[\s/>=])/.test(tagText) });
  };
  const pop = (tagText) => {
    const m = /^<\s*\/\s*([a-zA-Z][\w:-]*)/.exec(tagText);
    if (!m) return;
    const name = m[1].toLowerCase();
    /* 找最近的同名开标签，连同它上面的一起弹掉（容错）；
       找不到同名就什么都不做 —— 宁可少链（安全），也不能把 skip 搞乱 */
    for (let i = stack.length - 1; i >= 0; i--) {
      if (stack[i].name === name) {
        stack.length = i;
        return;
      }
    }
  };

  const textOf = (segment) => {
    if (!segment) return segment;
    if (skipping()) return segment;
    const found = match(segment);
    if (!found.length) return segment;
    let s = '';
    let at = 0;
    for (const f of found) {
      s += segment.slice(at, f.index) + render(f.member, f.text);
      at = f.index + f.text.length;
      count++;
      perMember.set(f.member.name, (perMember.get(f.member.name) || 0) + 1);
    }
    return s + segment.slice(at);
  };

  while (last < html.length) {
    /* 注释整块当标签处理（里面有名字也不能改，改了注释就烂了） */
    if (html.startsWith('<!--', last)) {
      const end = html.indexOf('-->', last);
      const stop = end < 0 ? html.length : end + 3;
      out += html.slice(last, stop);
      last = stop;
      continue;
    }
    const lt = html.indexOf('<', last);
    const textEnd = lt < 0 ? html.length : lt;
    out += textOf(html.slice(last, textEnd));
    if (lt < 0) break;
    const gt = html.indexOf('>', lt);
    if (gt < 0) {
      out += html.slice(lt);
      break;
    }
    const tag = html.slice(lt, gt + 1);
    out += tag;
    if (/^<\s*\//.test(tag)) pop(tag);
    else if (/^<\s*[a-zA-Z]/.test(tag)) push(tag);
    last = gt + 1;
  }

  return { html: out, count, perMember };
}

/* ---------------------------------------------------------------------------
   图片地址：清单里挑一档够用的 WebP 小图
   ------------------------------------------------------------------------ */
export function faceUrlOf(src, manifest, base = '/', need = 200) {
  const a = String(src || '').trim();
  if (!a) return '';
  const withBase = (u) => (base && base !== '/' ? base.replace(/\/$/, '') + u : u);
  if (/^(https?:)?\/\//i.test(a) || a.startsWith('data:')) return a;
  const item = manifest?.items?.[a];
  const variants = Array.isArray(item?.variants) ? [...item.variants].sort((x, y) => x.w - y.w) : [];
  const pick = variants.find((v) => v.w >= need) ?? variants[variants.length - 1];
  if (pick?.webp?.url) return withBase(pick.webp.url);
  return withBase(a);
}

/**
 * 一张名片的 HTML。
 *
 * 视觉三件事（后两件是用户后来点名加的）：
 *   · 头像 + 名字 + 可选「介绍页 →」；
 *   · `sun: true` → 卡片上半多一轮**蒸汽波落日**（CSS 画的：半圆 + 横条遮罩 + 粉地平线）；
 *   · `title` → 名字下面一行小字（Raw 是「冰室之主」）；
 *   · `zoom` → 鼠标移到**头像**上时，头像放大成一个方形框显示**整张图**
 *     （`object-fit: contain`）。没填 `zoom` 就用头像自己那张，填了就固定显示那张
 *     （Raw 就是这种情况）。
 */
export function cardHtml(m, name, manifest, base = '/') {
  const face = faceUrlOf(m.avatar, manifest, base, 200);
  /* 放大框：没填 zoom 就复用头像那张地址（同一个 URL 不会再发一次请求） */
  const zoom = m.zoom ? faceUrlOf(m.zoom, manifest, base, 480) : face;
  const card =
    `<span class="mem__card${m.sun ? ' mem__card--sun' : ''}" aria-hidden="true">` +
    (m.sun ? '<span class="mem__sun"></span>' : '') +
    (face
      ? `<img class="mem__face" src="${esc(face)}" alt="" loading="lazy" decoding="async">`
      : `<span class="mem__face mem__face--none">${esc(m.name.slice(0, 1))}</span>`) +
    '<span class="mem__meta">' +
    `<span class="mem__label">${esc(m.name)}</span>` +
    (m.title ? `<span class="mem__title">${esc(m.title)}</span>` : '') +
    '</span>' +
    (m.url ? '<span class="mem__go">介绍页 →</span>' : '') +
    (zoom
      ? `<span class="mem__zoom"><img class="mem__zoomImg" src="${esc(zoom)}" alt="" loading="lazy" decoding="async"></span>`
      : '') +
    '</span>';
  const inner = `<span class="mem__text">${esc(name)}</span>${card}`;
  return m.url
    ? `<a class="mem" data-mem="${esc(m.id)}" href="${esc(m.url)}" data-nomem>${inner}</a>`
    : `<span class="mem mem--nolink" data-mem="${esc(m.id)}" data-nomem>${inner}</span>`;
}

/* ---------------------------------------------------------------------------
   Astro integration 本体：读数据 → 建匹配器 → 两条路都用它
   ------------------------------------------------------------------------ */
const readJson = (file, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return dflt;
  }
};

export default function memlink(opts = {}) {
  const skipPrefixes = opts.skip ?? ['/salon/'];
  const dataFile = opts.data ?? 'src/data/salon.json';
  let base = '/';

  /** 读成员表、建匹配器、渲染器（build 和 dev 共用） */
  function prepare(root) {
    const data = readJson(path.join(root, dataFile), {});
    const members = (Array.isArray(data.members) ? data.members : [])
      .filter((m) => m && m.id && m.name)
      .map((m) => ({
        id: String(m.id),
        name: String(m.name).trim(),
        avatar: String(m.avatar || '').trim(),
        url: String(m.url || '').trim(),
        title: String(m.title || '').trim(),
        zoom: String(m.zoom || '').trim(),
        sun: m.sun === true,
        aliases: (Array.isArray(m.aliases) ? m.aliases : []).map((a) => String(a ?? '').trim()).filter(Boolean),
      }));
    if (!members.length) return null;
    const manifest = readJson(path.join(root, 'public/img/opt/manifest.json'), null);
    return {
      members,
      match: buildMatcher(members),
      render: (m, name) => cardHtml(m, name, manifest, base),
    };
  }

  const stampOf = (root) => {
    try {
      return String(fs.statSync(path.join(root, dataFile)).mtimeMs);
    } catch {
      return '';
    }
  };

  return {
    name: 'memlink',
    hooks: {
      'astro:config:done': ({ config }) => {
        base = config.base || '/';
      },

      /* ── ① 构建期：逐页重写 dist 里的 HTML ────────────────────────── */
      'astro:build:done': async ({ pages, dir, logger }) => {
        if (process.env.MEMLINK === '0') {
          logger?.info?.('MEMLINK=0：跳过成员名自动链接');
          return;
        }
        const root = process.cwd();
        const ctx = prepare(root);
        if (!ctx) {
          logger?.warn?.('成员表是空的，没有可链接的名字');
          return;
        }
        const outDir = dir instanceof URL ? fileURLToPath(dir) : String(dir);
        /* `pages[].pathname` 在各版本里长得不一样：可能是 `huaya/bingshi/index.html`，
           也可能是路由形式 `/huaya/bingshi/`。三种都试一遍，别猜。 */
        const resolvePage = (rel) => {
          const clean = String(rel).replace(/^\/+/, '').replace(/\\/g, '/');
          const tries = [clean, path.posix.join(clean, 'index.html'), `${clean}.html`, path.posix.join(clean, 'index.htm')];
          for (const t of tries) {
            const f = path.join(outDir, t);
            if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
          }
          return null;
        };
        const list = Array.isArray(pages) && pages.length ? pages.map((p) => String(p.pathname ?? p)) : null;
        if (!list) {
          logger?.warn?.('拿不到页面清单，这次不链（重跑一次构建试试）');
          return;
        }
        const files = list.map(resolvePage).filter(Boolean);
        let done = 0;
        let total = 0;
        const tally = new Map();
        for (const file of files) {
          const rel = '/' + path.relative(outDir, file).replace(/\\/g, '/');
          if (skipPrefixes.some((p) => rel.startsWith(p))) continue;
          const html = fs.readFileSync(file, 'utf8');
          const r = rewriteHtml(html, ctx.match, ctx.render);
          if (!r.count) continue;
          fs.writeFileSync(file, r.html);
          done++;
          total += r.count;
          for (const [name, n] of r.perMember) tally.set(name, (tally.get(name) || 0) + n);
        }
        const top = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([n, c]) => `${n}×${c}`).join(' ');
        logger?.info?.(
          `成员名自动链接：${done} 个页面、共 ${total} 处（跳过 ${skipPrefixes.join(' ')}）${top ? `\n    ${top}` : ''}`
        );
      },

      /* ── ② dev 期：挂一层中间件，把每次请求的 HTML 就地重写 ──────────
         用户的「看效果」跑的是 astro dev（4321），dev 不走 build 钩子 ——
         没有这一段，他在本地就永远看不到这个功能。 */
      'astro:server:setup': ({ server, logger }) => {
        if (process.env.MEMLINK === '0') return;
        const root = process.cwd();
        let ctx = prepare(root);
        if (!ctx) {
          logger?.warn?.('成员表是空的，dev 下不做成员名链接');
          return;
        }
        let stamp = stampOf(root);
        logger?.info?.(`成员名自动链接（dev）：${ctx.members.length} 个名字，改了 ${dataFile} 会自动重读`);

        server.middlewares.use((req, res, next) => {
          const url = String(req.url || '').split('?')[0];
          /*
            哪些请求算"页面"：GET、不是模块/静态资源。
            ⚠ 这里**不看 Accept** —— 编辑器的 /api/preview 是 Node 里 fetch 出来的
            （Accept 是通配符），那种请求也是要重写的；真正把关的是下面
            content-type 是不是 text/html，写不进别的东西。
          */
          const isDoc =
            req.method === 'GET' &&
            !url.startsWith('/@') &&
            !url.startsWith('/_') &&
            !url.startsWith('/node_modules') &&
            !/\.[a-z0-9]+$/i.test(url);
          if (!isDoc || skipPrefixes.some((p) => url.startsWith(p))) return next();

          /* 成员表改了就重读（dev 常驻，改完名字不用重启） */
          const now = stampOf(root);
          if (now !== stamp) {
            stamp = now;
            ctx = prepare(root) || ctx;
          }

          const chunks = [];
          const origWrite = res.write.bind(res);
          const origEnd = res.end.bind(res);
          const origWriteHead = res.writeHead.bind(res);
          let ended = false;

          /* 内容长度会变（插入了一堆标记），所以先把 content-length 去掉，
             交给 chunked —— 头一旦发出去就改不了了，必须在这一步处理 */
          res.writeHead = (status, ...rest) => {
            const strip = (h) => {
              if (!h || typeof h !== 'object') return;
              for (const k of Object.keys(h)) if (k.toLowerCase() === 'content-length') delete h[k];
            };
            if (typeof rest[0] === 'string') strip(rest[1]);
            else strip(rest[0]);
            try {
              res.removeHeader('content-length');
            } catch {
              /* 已经发出去了就算了 */
            }
            return origWriteHead(status, ...rest);
          };
          res.write = (chunk, enc, cb) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
            if (typeof enc === 'function') enc();
            else if (typeof cb === 'function') cb();
            return true;
          };
          res.end = (chunk, enc, cb) => {
            if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, typeof enc === 'string' ? enc : 'utf8'));
            if (typeof enc === 'function') enc();
            else if (typeof cb === 'function') cb();
            if (ended) return res;
            ended = true;
            const body = Buffer.concat(chunks).toString('utf8');
            const type = String(res.getHeader('content-type') || '');
            if (!type.includes('text/html')) return origEnd(body);
            const r = rewriteHtml(body, ctx.match, ctx.render);
            if (!r.count) return origEnd(body);
            return origEnd(r.html);
          };
          next();
        });
      },
    },
  };
}
