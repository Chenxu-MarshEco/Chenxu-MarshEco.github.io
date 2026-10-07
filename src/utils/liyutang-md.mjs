/*
 * ============================================================================
 * 黎语堂的 Markdown 渲染器（自己写的，故意很小）
 * ----------------------------------------------------------------------------
 * 用户 2026-10-07 晚上：「帖子类似主网站的文章 可以传图写字」。主站的文章是 Markdown，
 * 所以帖子也存 Markdown —— 但**渲染这件事不能照抄主站**：
 *
 *   主站的 Markdown 是站长自己写的（Astro 构建期、内容可信）；
 *   帖子的 Markdown 是**任何过审用户**写的，渲染出来是直接插进别人浏览器的东西。
 *   这是整个论坛最容易出事的一处，所以：
 *
 *     ① **先转义、再渲染**：整段正文一进来就把 & < > " 转成实体，之后所有标签
 *        都是我们自己拼出来的。用户写 <script> 只会看到「<script>」这几个字。
 *     ② **不引第三方解析器**：marked 之类的库默认允许内联 HTML（要另外配 sanitizer 才安全），
 *        而我们只需要一个论坛够用的子集，自己写反而看得清、审得动。
 *     ③ **链接和图片地址白名单**：只放行 http/https、（链接另加 mailto 和站内 / 开头）、
 *        以及图片的 data:image/…  —— 「javascript:」这类东西连试的机会都没有。
 *     ④ 支持范围刻意保守：标题 / 段落 / 换行 / 粗体 / 斜体 / 删除线 / 行内代码 /
 *        代码块 / 引用 / 有序无序列表 / 分割线 / 链接 / 图片 / 裸网址。
 *        **不支持**表格、脚注、嵌套列表、内联 HTML —— 要加就照着下面的写法加，别再引库。
 *
 * 这个文件同时被三处用：
 *   · 站点上（发帖页的预览、帖子页、版块页的摘要）—— 浏览器里跑；
 *   · 编辑器（版块公告的预览）—— node 里跑。
 * 所以它是纯 ESM、零依赖，放 .mjs 而不是 .ts（node 那边不认 TypeScript）。
 * ============================================================================
 */

/** HTML 里的那几个特殊字符（转义是整条流水线的第一步） */
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/**
 * 把一段文本转义成"只会当字面文字显示"的形式。
 * @param {unknown} s 任意文本
 * @returns {string} 转义后的文本
 */
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/**
 * 地址白名单。注意传进来的是**已经转义过**的文本（`&` 已经变成 `&amp;`）。
 * @param {string} url 地址
 * @param {'link'|'image'} kind 用途
 * @returns {string} 能用的地址；不能用就返回空串
 */
function safeUrl(url, kind) {
  const u = String(url || '').trim();
  if (!u) return '';
  if (kind === 'image') {
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(u)) return u;
    return /^https?:\/\//i.test(u) ? u : '';
  }
  if (/^https?:\/\//i.test(u) || /^mailto:[^@\s]+@[^@\s]+$/i.test(u) || /^[/#][^\s]*$/.test(u)) return u;
  return '';
}

/** 行内代码 / 图片 / 链接 先抠出来存这里，免得后面的强调规则把里面的字符吃了 */
const SENTINEL = '\u0001';

/**
 * 处理一行里的行内语法。
 * @param {string} text 已经转义过的一行
 * @returns {string} HTML
 */
function inline(text) {
  /** @type {string[]} */
  const stash = [];
  const keep = (html) => SENTINEL + (stash.push(html) - 1) + SENTINEL;

  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    /* 行内代码：`x` / ``x``（里面的东西一概不解释） */
    const code = /^(`+)([\s\S]*?)\1(?!`)/.exec(rest);
    if (code) {
      out += keep('<code>' + code[2].trim() + '</code>');
      i += code[0].length;
      continue;
    }

    /* 图片：![说明](地址)　地址允许贴 data URL（用户传的图就是这么内嵌的） */
    if (rest.startsWith('![')) {
      const img = /^!\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^)]*)&quot;)?\s*\)/.exec(rest);
      if (img) {
        const src = safeUrl(img[2], 'image');
        if (src) {
          out += keep(`<img src="${src}" alt="${img[1]}" loading="lazy" decoding="async" />`);
          i += img[0].length;
          continue;
        }
      }
    }

    /* 链接：[文字](地址) */
    if (rest.startsWith('[')) {
      const a = /^\[([^\]]*)\]\(\s*([^\s)]+)(?:\s+&quot;([^)]*)&quot;)?\s*\)/.exec(rest);
      if (a) {
        const href = safeUrl(a[2], 'link');
        if (href) {
          const title = a[3] ? ` title="${a[3]}"` : '';
          out += keep(`<a href="${href}"${title} target="_blank" rel="noopener nofollow">${a[1] || href}</a>`);
          i += a[0].length;
          continue;
        }
      }
    }

    /* 裸网址：https://… （中英文标点都当结尾） */
    if (/^https?:\/\//i.test(rest)) {
      const m = /^https?:\/\/[^\s<>&]+/.exec(rest);
      if (m) {
        const href = safeUrl(m[0], 'link');
        if (href) {
          out += keep(`<a href="${href}" target="_blank" rel="noopener nofollow">${m[0]}</a>`);
          i += m[0].length;
          continue;
        }
      }
    }

    out += rest[0];
    i += 1;
  }

  /* 强调。放在最后做：此时链接/图片/代码都已经被换成占位符了 */
  out = out
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, '<em>$1</em>')
    .replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

  return out.replace(new RegExp(SENTINEL + '(\\d+)' + SENTINEL, 'g'), (_, n) => stash[Number(n)]);
}

/** 列表项 / 引用里也可能有行内语法，先按行处理再拼块 */
const listItem = (line) => /^\s*([-*+]|\d+\.)\s+(.*)$/.exec(line);

/**
 * Markdown → HTML。**用户写的东西一律当字面文字**（见文件头那四条）。
 * @param {unknown} md Markdown 正文
 * @returns {string} 安全的 HTML
 */
export function renderMarkdown(md) {
  const src = escapeHtml(md).replace(/\r\n?/g, '\n');
  const lines = src.split('\n');
  /** @type {string[]} */
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    /* 空行：块与块之间的间隔 */
    if (!line.trim()) {
      i += 1;
      continue;
    }

    /* 代码块：``` 或 ~~~（围栏后面的语言名忽略，不做高亮） */
    const fence = /^\s*(```+|~~~+)\s*[\w+-]*\s*$/.exec(line);
    if (fence) {
      const mark = fence[1][0];
      const body = [];
      i += 1;
      while (i < lines.length && !new RegExp('^\\s*' + mark + '{3,}\\s*$').test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; /* 跳过收尾那行（没有收尾就到文件末尾） */
      html.push('<pre><code>' + body.join('\n') + '</code></pre>');
      continue;
    }

    /* 分割线 */
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      html.push('<hr />');
      i += 1;
      continue;
    }

    /* 标题 # ~ ###### */
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      html.push(`<h${level}>${inline(h[2].trim())}</h${level}>`);
      i += 1;
      continue;
    }

    /*
      引用：连续的 > 行并成一段。
      ⚠ 这里匹配的是 `&gt;` 而不是 `>` —— renderMarkdown 一进来就把整段正文转义过了，
      行首那个 `>` 到这一步已经是实体。写成 `>` 的话引用块**永远不会生效**，
      而且不会报错，只会安安静静地显示成一个「&gt; 引一句」的段落
      （2026-10-07 晚上被 tools/checks/liyutang-posts-check.mjs 的行为断言逮住的：
       那条断言是"真跑一遍渲染器看输出"，不是 grep 源码 —— 光看源码两种写法都"看着对"）。
    */
    if (/^\s*&gt;\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*&gt;\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^\s*&gt;\s?/, ''));
        i += 1;
      }
      html.push('<blockquote>' + renderMarkdown(unescapeForNesting(body.join('\n'))) + '</blockquote>');
      continue;
    }

    /* 列表：同一种记号连着的算一个列表 */
    const li = listItem(line);
    if (li) {
      const ordered = /\d+\./.test(li[1]);
      const items = [];
      while (i < lines.length) {
        const m = listItem(lines[i]);
        if (!m) break;
        if (/\d+\./.test(m[1]) !== ordered) break;
        let text = m[2];
        i += 1;
        /* 缩进的续行算这一项的后续 */
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !listItem(lines[i])) {
          text += ' ' + lines[i].trim();
          i += 1;
        }
        items.push('<li>' + inline(text) + '</li>');
      }
      html.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    /* 普通段落：连续的非空行算一段，行内换行按 Markdown 的规矩转成 <br /> */
    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !listItem(lines[i]) &&
      /* 行首记号也要按**转义后**的样子匹配（见上面引用块那段解释） */
      !/^\s*(#{1,6}\s|&gt;|```|~~~)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    /* 段落里如果只有一行，就不必包 <p>？—— 包着更好排版，统一包 */
    html.push('<p>' + para.map((l) => inline(l)).join('<br />') + '</p>');
  }

  return html.join('\n');
}

/**
 * 引用块内部要递归渲染，但那个字符串**已经被转义过一次**了。
 * 直接反解回原文（只有我们自己的五个实体，反解是安全的），再交给 renderMarkdown 走一遍。
 * @param {string} s 转义过的文本
 * @returns {string} 原文
 */
function unescapeForNesting(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Markdown → 纯文本（列表里的摘要、搜索用）。
 * @param {unknown} md 正文
 * @returns {string} 纯文本（换行压成空格）
 */
export function plainText(md) {
  return unescapeForNesting(escapeHtml(md))
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s*/gm, '')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 摘要（比 plainText 多一步截断）。云函数那边有一份同样的逻辑（存 excerpt 用），
 * 这里这份是页面侧的兜底 —— 两边都是"看着差不多就行"，不要求逐字一致。
 * @param {unknown} md 正文
 * @param {number} [max] 最长多少字
 * @returns {string} 摘要
 */
export function excerptOf(md, max = 90) {
  const text = plainText(md);
  return text.length > max ? text.slice(0, max) + '…' : text;
}
