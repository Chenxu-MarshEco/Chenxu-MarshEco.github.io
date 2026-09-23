/**
 * ============================================================================
 * 全站搜索索引（构建期生成 dist/search.json）
 * ----------------------------------------------------------------------------
 * 用户要求（2026-09-22）：
 *   「全局搜索：全局搜索框放在随机跳转框的左边 …… 输入文字搜索以后会在下面展开一列卡片
 *    显示所有相关的结果 点击可以直接跳转到对应页面 如果输入文字后回车或是点击放大镜
 *     那么根据文字的匹配程度 直接进入对应页面或是进入一个新的搜索中转页面 ……
 *     虽然一般点击搜索结果以后会跳转到其所在的页面的默认开始处，但冰室精华页面内的
 *     每一条精华页面都可以单独被跳转，搜索到独立的一条精华以后点击跳转，
 *     会直接跳转到精华页里这条精华所在的位置。」
 *
 * 参考了 Minecraft Wiki（MediaWiki 的搜索建议：输入即出下拉、回车直达/进结果页）和
 * PRTS（同样是"输入即出候选、回车看全部"）那两套做法，这里做成一件事：
 *   **构建期把所有能跳的地方摊成一张索引，浏览器拿它本地过滤** —— 静态站没有后端，
 *   本地过滤是唯一能在输入那一下就给结果的做法，而且不用每次敲字都请求网络。
 *
 * 索引里每一条：{ t: 显示用的标题, s: 搜索用的正文（小写化在浏览器端做）, h: 地址, k: 种类 }
 *   · kind = page      页面（构建产物里**每一个** <title> 读出来的页面，随机跳转的抽签池）
 *   · kind = anchor    页面里的某个标题/图片/段落（anchors.json 带 id → /页面/#锚点）
 *   · kind = essence   冰室精华的**一条**（→ /salon/#<id>，页面那边会精准落到那一条）
 *   · kind = post/note 文章 / 手记
 *   · kind = nav       导航分类库里的条目
 *   · kind = ice       冰山图的条目
 *   · kind = point     时间轴上的时间点（有链接的那些）
 *
 * 为什么放 `astro:build:done`：只有那时候才知道**站点到底生成了哪些页面**
 * （`pages` 参数就是），也才读得到刚写出来的 dist/anchors.json。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_TEXT = 400; // 每条索引里存多少搜索正文（精华有 2800 字的，全存进去索引就太大了）

const readJson = (p, dflt) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return dflt;
  }
};

/** 去掉 HTML 标签 / 多余空白，截断到 MAX_TEXT */
const clean = (s, max = MAX_TEXT) =>
  String(s ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** 从 markdown 的 frontmatter 里抠 title / summary（只认最朴素的 `key: value`，够用） */
function frontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const hit = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!hit) continue;
    out[hit[1]] = hit[2].replace(/^['"]|['"]$/g, '').trim();
  }
  return out;
}

/** 站点名（用来把 <title> 里的「xxx · 花涧堂」尾巴切掉）；读不到就返回空串 */
function siteTitle(root) {
  try {
    const src = fs.readFileSync(path.join(root, 'src', 'site.config.ts'), 'utf8');
    const m = /title\s*:\s*['"]([^'"]+)['"]/.exec(src);
    return m ? m[1] : '';
  } catch {
    return '';
  }
}

const unescapeHtml = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');

/**
 * 从构建出来的 HTML 里抠 <title>，当这一页的标题。
 * 比拿路径凑名字准得多 —— 标签页、板块页的标题都是页面自己写的。
 */
function htmlTitle(dist, pathname, strip) {
  try {
    const html = fs.readFileSync(path.join(dist, pathname), 'utf8');
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    if (!m) return '';
    let t = unescapeHtml(m[1]).replace(/\s+/g, ' ').trim();
    if (strip && t.endsWith(`· ${strip}`)) t = t.slice(0, -`· ${strip}`.length).trim();
    else if (strip && t.endsWith(strip)) t = t.slice(0, -strip.length).replace(/[·|—-]\s*$/, '').trim();
    return t;
  } catch {
    return '';
  }
}

function walkFiles(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, out);
    else out.push(p);
  }
  return out;
}

export function buildIndex(root, builtPages = [], dist = path.join(root, 'dist')) {
  const items = [];
  const add = (t, s, h, k, extra) => {
    const title = clean(t, 120);
    const href = String(h ?? '').trim();
    if (!title || !href) return;
    /*
      站外的那些（导航库里挂的 bilibili / 维基 / 网易云…）标一个 ext：
      它们在产物里没有对应页面可查，跳转时也该新开一个标签页把人留在站里。
      留着它们是有用的 —— 那一栏本来就是收藏夹。
    */
    const ext = /^https?:/i.test(href);
    items.push({ t: title, s: clean(s ?? title), h: href, k, ...(ext ? { ext: 1 } : {}), ...(extra ?? {}) });
  };

  /* ---- ① 页面 + 页面里的锚点（构建产物里那张清单） ---- */
  const anchors = readJson(path.join(root, 'dist', 'anchors.json'), { pages: [] });
  const pages = Array.isArray(anchors.pages) ? anchors.pages : [];
  for (const p of pages) {
    add(p.title || p.href, `${p.title ?? ''} ${p.href ?? ''}`, p.href, 'page');
    for (const a of p.anchors ?? []) {
      const text = clean(a.text, 80);
      if (!text) continue;
      add(text, `${text} ${p.title ?? ''}`, `${String(p.href).replace(/\/$/, '')}/#${a.id}`, 'anchor');
    }
  }

  /* ---- ② 冰室精华的每一条（→ /salon/#<id>，能精准落到那一条） ---- */
  const salon = readJson(path.join(root, 'src', 'data', 'salon.json'), {});
  const memberName = new Map((salon.members ?? []).map((m) => [m.id, m.name]));
  for (const e of salon.essences ?? []) {
    const who = (e.memberIds ?? []).map((id) => memberName.get(id)).filter(Boolean).join('、');
    const text = clean(e.text, MAX_TEXT);
    add(text || `${who} ${e.date}`, `${text} ${who} ${e.date} ${e.time ?? ''} ${e.id}`, `/salon/#${e.id}`, 'essence', {
      sub: `${e.date}${e.time ? ' ' + e.time : ''}${who ? ' · ' + who : ''}`,
    });
  }
  add(salon.title || '冰室精华', '冰室精华 精华 聊天记录', '/salon/', 'page');

  /* ---- ③ 文章 / 手记 ---- */
  for (const [dir, kind, base] of [
    ['posts', 'post', '/posts/'],
    ['notes', 'note', '/notes/'],
  ]) {
    for (const abs of walkFiles(path.join(root, 'src', 'content', dir))) {
      if (!/\.(md|mdx)$/i.test(abs)) continue;
      const fm = frontmatter(fs.readFileSync(abs, 'utf8'));
      const slug = path.basename(abs).replace(/\.(md|mdx)$/i, '');
      add(fm.title || slug, `${fm.title ?? ''} ${fm.summary ?? ''} ${slug}`, `${base}${slug}/`, kind, {
        sub: fm.date ?? '',
      });
    }
  }

  /* ---- ④ 导航分类库里的条目 ---- */
  const navs = readJson(path.join(root, 'src', 'data', 'navs.json'), { categories: [] });
  for (const cat of navs.categories ?? []) {
    for (const g of cat.groups ?? []) {
      for (const it of [...(g.items ?? []), ...(g.subgroups ?? []).flatMap((s) => s.items ?? [])]) {
        if (!it.href) continue;
        add(it.text, `${it.text} ${g.title ?? ''} ${cat.title ?? ''}`, it.href, 'nav', { sub: cat.title ?? '' });
      }
    }
  }

  /* ---- ⑤ 冰山图的条目（点到 /iceberg/，图上就是那一条） ---- */
  const ice = readJson(path.join(root, 'src', 'data', 'iceberg.json'), { layers: [] });
  for (const layer of ice.layers ?? []) {
    for (const it of layer.items ?? []) {
      add(it.name, `${it.name} ${it.desc ?? ''} ${layer.title ?? ''}`, it.href || '/iceberg/', 'ice', {
        sub: layer.title ?? '',
      });
    }
  }

  /* ---- ⑥ 时间轴上带链接的时间点 ---- */
  const tls = readJson(path.join(root, 'src', 'data', 'timelines.json'), { timelines: [] });
  for (const tl of tls.timelines ?? []) {
    for (const p of tl.points ?? []) {
      if (!p.href) continue;
      add(p.label || p.id, `${p.label ?? ''} ${p.date ?? ''} ${tl.title ?? ''}`, p.href, 'point', {
        sub: `${tl.title ?? ''}${p.date ? ' · ' + p.date : ''}`,
      });
    }
  }

  /* ---- ⑦ 地图图钉（带链接的那些） ---- */
  const boards = readJson(path.join(root, 'src', 'data', 'home-boards.json'), { boards: [] });
  const flatBoards = [];
  const walkBoards = (list) => {
    for (const n of list ?? []) {
      flatBoards.push(n);
      walkBoards(n.children);
    }
  };
  walkBoards(boards.boards);
  for (const node of flatBoards) {
    for (const block of node.page ?? []) {
      for (const page of block.pages ?? []) {
        for (const m of page.markers ?? []) {
          if (!m.href) continue;
          add(m.title || m.id, `${m.title ?? ''} ${node.title ?? ''}`, m.href, 'map', { sub: node.title ?? '' });
        }
      }
    }
  }

  /* ---- ⑧ 构建产物里的**每一个**页面 ----
     上面 ① 只覆盖了「首页两棵板块树」里有自己内容的页面（anchors.json 里那 10 个），
     但站里实际有 50 个页面：文章、手记、标签页、归档、冰山图、冰室精华、花娅域主……
     随机跳转要「跳到本站任意一个页面」，搜索也不该漏掉它们，
     所以这里把 astro 真正生成出来的页面全收进来（标题直接读那页的 <title>）。
     已经在上面的条目（比如 /salon/、/huaya/…）按地址去重，不会变成两条。 */
  const known = new Set(items.filter((it) => it.k === 'page').map((it) => it.h.replace(/\/$/, '')));
  const strip = siteTitle(root);
  for (const p of builtPages) {
    /*
      ⚠ astro 给的 pathname 是**站点相对的路由**（"about/"、"posts/xxx/"，末尾带斜杠，
      没有 index.html，也没有开头的斜杠）；**首页是空字符串**。
      刚写这版时按 "xxx/index.html" 去匹配 → 50 个页面一个都没进来
      （构建日志里 page 一直是 11，当场看出来的）；补上路由格式之后又漏了首页，
      是验收脚本里那条「构建出来的每个页面都在索引里」把它抓出来的。
    */
    const pathname = String(p?.pathname ?? '').replace(/^\/+/, '');
    const href = `/${pathname}`;
    if (pathname === '404/' || pathname === '404.html') continue; // 走丢页不该被搜到、更不该被随机跳到
    if (known.has(href.replace(/\/$/, ''))) continue;
    known.add(href.replace(/\/$/, ''));
    const file = !pathname
      ? 'index.html'
      : /\.html?$/i.test(pathname)
        ? pathname
        : `${pathname.replace(/\/$/, '')}/index.html`;
    const t = htmlTitle(dist, file, strip) || href;
    add(t, `${t} ${href}`, href, 'page', { sub: href });
  }

  /* 去重（同一个地址 + 同一段文字只留一条） */
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = `${it.h}:${it.t}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

export default function searchIndex() {
  return {
    name: 'dsh-search-index',
    hooks: {
      'astro:build:done': async ({ dir, pages }) => {
        const root = process.cwd();
        /*
          ⚠ dir 是个 **file URL**（/D:/repo/dist 这种，前面带一个斜杠）——
          path.resolve('/D:/repo/dist') 在 Windows 上会拼成 D:\D:\repo\dist（踩过两次）。
          正确做法是 fileURLToPath()。
        */
        const dist = dir ? fileURLToPath(dir) : path.join(root, 'dist');
        const items = buildIndex(root, pages ?? [], dist);
        const file = path.join(dist, 'search.json');
        fs.writeFileSync(
          file,
          JSON.stringify({
            note: '全站搜索索引：构建期由 tools/search/index.mjs 生成。每一条 {t 标题, s 搜索正文, h 地址, k 种类, sub 副标题}',
            count: items.length,
            kinds: items.reduce((m, it) => ((m[it.k] = (m[it.k] ?? 0) + 1), m), {}),
            items,
          }),
          'utf8'
        );
        const kb = (fs.statSync(file).size / 1024).toFixed(0);
        const kinds = items.reduce((m, it) => ((m[it.k] = (m[it.k] ?? 0) + 1), m), {});
        console.log(`[search] 搜索索引：${items.length} 条 / ${kb}KB（${JSON.stringify(kinds)}）`);
      },
    },
  };
}
