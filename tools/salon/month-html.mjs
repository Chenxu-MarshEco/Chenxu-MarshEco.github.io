/**
 * 解析「冰室群精华 · YYYY 年 M 月」这种**月度导出 HTML**（2026-10-06 加）。
 *
 * 这是导出管线（用户压缩包里的 `工具/05_build_docs.py`）生成的单月文件，
 * 和最早那份「群精华 图文版」是**两套标记**：
 *
 *   · 老文件：`<div class="item">`（双引号）+ `<h1 id='era1'>` 年代 + 图片全内嵌
 *   · 月度文件：`<div class='item'>`（**单引号**）+ `<h1 id='d20260901'>2026-09-01 · 周二</h1>` 按天分段
 *     + `<h1 id='dialogs'>` 完美对话 + `<h1 id='people'>` 人物名册 + `<img src='data:image/jpeg;base64,…'>` 内嵌
 *
 * 所以**不能**拿 tools/salon/import.mjs（那份是整份重建、只认老标记）去读月度文件 ——
 * 这就是新写这个模块的原因。两种文件共用的部分（成员表合并、去重、写图片）在
 * tools/salon/merge.mjs 里。
 *
 * 月文件里一条的样子（两种）：
 *
 *   普通：
 *     <div class='item'><p><b>希尔　2026-09-23 15:34</b></p>
 *     <blockquote>[图片]</blockquote>
 *     <img src='data:image/jpeg;base64,…'></div>
 *
 *   完美对话（聊天截图 + OCR 转录）：
 *     <div class='item' id='dlg006'><h4>🗨️ 2026-09-14 15:51　#006　花花</h4>
 *     <img src='data:image/jpeg;base64,…'>
 *     <blockquote>- 京虾杀\n- 【新v】梦之泪伤\n…\n\n*（本条为 OCR 自动转录，可能有个别错字）*</blockquote></div>
 *
 * 人名的取法：
 *   · 普通条目：`<b>名字　2026-09-23 15:34</b>` 里日期前面那段（可能写「花花、虹星」两个人）
 *   · 完美对话：`<h4>` 尾巴上那个名字（`…　#006　花花`），另外顺便认一下 OCR 行里
 *     `- **名字**（…` 那种老写法（老文件里是这么写的，留着兼容）
 *   · 认不出来就是空数组 —— 页面上写「冰室群成员」，编辑器里能自己勾
 *
 * 导出文件自己会在开头写「共 28 条 ｜ 图片 7 张 ｜ 人物 10 位」，解析完要拿它对账，
 * 少了就说明这解析漏了东西（merge.mjs 里会核对）。
 */

/** 去掉标签、还原实体，换行按标签边界补上 */
export function decodeHtml(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|blockquote|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/** 收掉多余空白 */
export function tidy(s) {
  return String(s ?? '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** OCR 自动转录那句注记（老文件、月文件都写这句） */
const OCR_NOTE = /\*?（?本条为\s*OCR\s*自动转录[^\n]*/g;

/** 把一个 <div class='item'>…</div> 解析成一条 */
function parseItem(chunk) {
  const idM = /id=['"](dlg\d+)['"]/.exec(chunk);
  const h4 = /<h4>([\s\S]{0,120}?)<\/h4>/.exec(chunk);
  const kind = h4 || idM ? 'perfect' : 'text';

  /* 时刻/日期 */
  let date = '';
  let time = '';
  if (h4) {
    const t = /(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/.exec(decodeHtml(h4[1]));
    date = t?.[1] ?? '';
    time = t?.[2] ?? '';
  }
  const headerM = /<p><b>([\s\S]{0,80}?)<\/b><\/p>/.exec(chunk);
  const header = headerM ? tidy(decodeHtml(headerM[1])) : '';
  if (!date && header) {
    const t = /(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/.exec(header);
    date = t?.[1] ?? '';
    time = t?.[2] ?? '';
  }

  /* 人名 */
  const names = [];
  const push = (n) => {
    const s = String(n ?? '').trim();
    /* 纯数字 / 时刻 / 空 —— 都不是人名 */
    if (!s || /^\d+$/.test(s) || /^\d{1,2}:\d{2}$/.test(s)) return;
    if (!names.includes(s)) names.push(s);
  };
  if (h4) {
    /* 「🗨️ 2026-09-14 15:51　#006　花花」→ 去掉开头的图标、日期时刻、#编号，剩下人名 */
    const tail = tidy(decodeHtml(h4[1]))
      .replace(/^\S*\s*/, '')                                                  // 开头的 🗨️
      .replace(/^\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2})?/, '')                 // 日期 + 时刻
      .replace(/[#＃]\s*\d+/g, ' ');                                           // #006 那种编号
    for (const n of tail.split(/[、,，/]+/)) push(n);
    /* 老写法：OCR 行里 `- **名字**（LV38 管理员）` */
    for (const line of decodeHtml(chunk).split('\n')) {
      const m = /^\s*[-•]?\s*\*\*(.{1,20}?)\*\*\s*[（(]/.exec(line);
      if (m) push(m[1]);
    }
  } else if (header) {
    const who = header.replace(/\s*\d{4}-\d{2}-\d{2}[\s\S]*$/, '').trim();
    for (const part of who.split(/[、,，/]+/)) push(part);
  }

  /* 正文：blockquote 是正文；「[图片]」这种占位不算文字 */
  const quotes = [...chunk.matchAll(/<blockquote>([\s\S]*?)<\/blockquote>/g)].map((q) => tidy(decodeHtml(q[1])));
  let text = tidy(quotes.filter(Boolean).join('\n\n'));
  if (/^\[图片\]$/.test(text)) text = '';
  const ocr = OCR_NOTE.test(text) || /本条为\s*OCR\s*自动转录/.test(text);
  OCR_NOTE.lastIndex = 0;
  if (ocr) text = tidy(text.replace(OCR_NOTE, ''));
  OCR_NOTE.lastIndex = 0;

  /* 内嵌图片（按月文件自己的顺序） */
  const images = [...chunk.matchAll(/<img[^>]*src=['"]data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)['"]/g)]
    .map((m) => ({ ext: m[1] === 'jpeg' ? 'jpg' : m[1], base64: m[2] }));

  return { kind, date, time, names, text, ocr, images };
}

/**
 * 解析整份月度 HTML。
 * 返回 { title, month, counts:{items,images,people}, people:[{name,essences,images,aliases}],
 *        items:[{kind,date,time,names,text,ocr,images}] }
 */
export function parseMonthHtml(html) {
  const src = String(html ?? '');

  const title = tidy(decodeHtml((/<title>([\s\S]*?)<\/title>/.exec(src) ?? [])[1] ?? ''))
    || tidy(decodeHtml((/<h1>([\s\S]*?)<\/h1>/.exec(src) ?? [])[1] ?? ''));
  const monthM = /(\d{4})\s*年\s*(\d{1,2})\s*月/.exec(tidy(decodeHtml(src.slice(0, 4000))));

  /* 开头那句自述：「共 28 条 ｜ 图片 7 张 ｜ 人物 10 位」——拿来对账 */
  const head = tidy(decodeHtml(src.slice(0, 6000)));
  const num = (re) => {
    const m = re.exec(head);
    return m ? Number(m[1]) : -1;
  };
  const counts = {
    items: num(/共\s*(\d+)\s*条/),
    images: num(/图片\s*(\d+)\s*张/),
    people: num(/人物\s*(\d+)\s*位/),
  };

  const items = [];
  for (const m of src.matchAll(/<div class=['"]item['"][^>]*>([\s\S]*?)<\/div>/g)) {
    const it = parseItem(m[1]);
    if (!it.date) continue;             // 没日期的没法用（导出里不该有）
    items.push(it);
  }

  /* 人物名册那张表（规范名 / 精华 / 图片 / 时间跨度 / 马甲） */
  const people = [];
  const tableM = /<table>([\s\S]*?)<\/table>/.exec(src);
  if (tableM) {
    for (const tr of tableM[1].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
      const tds = [...tr[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((t) => tidy(decodeHtml(t[1])));
      if (tds.length < 2) continue;      // <th> 那行
      const aliases = (tds[4] ?? '').split(/[、,，]/).map((s) => s.trim()).filter(Boolean);
      people.push({ name: tds[0], essences: Number(tds[1]) || 0, images: Number(tds[2]) || 0, aliases });
    }
  }

  return {
    title,
    month: monthM ? `${monthM[1]}-${monthM[2].padStart(2, '0')}` : '',
    counts,
    people,
    items,
  };
}
