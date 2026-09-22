/**
 * 把「冰室冰山图 · 条目全集」（Markdown）整理成站点数据。
 *
 *   node tools/iceberg/import.mjs [源文件.md]      # 不给参数就用仓库里那份
 *   node tools/iceberg/import.mjs --dry            # 只核对，不写文件
 *
 * 产出：src/data/iceberg.json（/iceberg/ 那一页和编辑器「冰山图」面板都读它）
 * 源文件：tools/iceberg/冰室冰山图-条目全集.md（用户给的文字版，逐字节收进仓库）
 *
 * ⛔ 一条都不能丢。源文件自己写了「88 条条目文本全部取到 / 6 层 / 18 条带悬停注释 /
 *   6 条带外链 / 标签分布 花娅奇闻 52 · 冰室怪谈 21 · 弹设往事 5 · 我所在之城的怪事 4 ·
 *   龙历院古卷 3 · 互联网漫游 3」。脚本跑完会拿这些数**逐项核对**并打 OK/✗，
 *   对不上就 exit 1（和 tools/salon/import.mjs 一个规矩）。
 *   逐条对照（层 / 条目名 / 分类 / 描述 / 链接）由 tools/checks/iceberg-import-check.mjs 做，
 *   它 import 这里的 parseSource()，两边用的是同一套解析规则。
 *
 * ⚠⚠ 用户特别交代过：源文件里的【标签】＝本站的【分类】（categoryId）。
 *   本站自己那套 tag（悬停卡片顶部那排小词）源文件里没有 → 一律留空，
 *   之后在编辑器里另建另勾。**别把这两个混起来。**
 *
 * 映射：
 *   源文件                          → 本站数据
 *   ─────────────────────────────────────────────────────────
 *   ### 层 N　漫步花娅街头            → layers[].title（去掉「层 N」）
 *   > 只要稍微在冰室里冲浪就能看见的词  → layers[].subtitle
 *   - **塔吊文化**〔花娅奇闻〕        → items[].name + items[].categoryId
 *   - [外链](https://…)              → items[].href
 *   - 悬停注释：…                     → items[].desc（填了就自动有完备标识）
 *   （源文件没有的）                  → 背景图 / 头图 / tag 留空，之后在编辑器里传
 *
 * 重复跑不会把你手改的东西冲掉（按名字现查、沿用旧值）：
 *   · 分类颜色 / 显示开关  ← 按分类名字沿用
 *   · 层级的背景图 / 头图  ← 按层级标题沿用
 *   · 条目上勾的 tag      ← 按「层标题 + 条目名」沿用
 *   层级顺序、条目顺序、条目名、分类归属、描述、链接**一律以源文件为准**。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '..', '..');
const OUT = path.join(PROJ, 'src', 'data', 'iceberg.json');
const DEFAULT_SOURCE = path.join(HERE, '冰室冰山图-条目全集.md');

/** 分类（= 源文件里的【标签】）默认颜色。用户说颜色之后自己设 —— 这里只是给个起点 */
export const CATEGORY_COLORS = [
  ['花娅奇闻', '#ff5fb0'],
  ['冰室怪谈', '#3ba7ff'],
  ['龙历院古卷', '#c98a3c'],
  ['互联网漫游', '#35d0c0'],
  ['我所在之城的怪事', '#9aa7c7'],
  ['弹设往事', '#ff5a5a'],
];

/** 本地日期 YYYY-MM-DD（不能用 toISOString：那是 UTC，晚上会差一天） */
export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ------------------------------------------------------------------
   解析：源文件 → { claim, layers }
   ------------------------------------------------------------------ */
export function parseSource(raw) {
  const md = String(raw ?? '').replace(/\r\n?/g, '\n');

  /** 源文件顶部那张元信息表里的数（核对用） */
  const metaValue = (label) => {
    const m = new RegExp(`\\|\\s*${label}\\s*\\|\\s*([^|]+?)\\s*\\|`).exec(md);
    return m ? m[1].trim() : '';
  };
  const claim = {
    total: Number((/(\d+)\s*条条目文本全部取到/.exec(md) ?? [])[1] ?? -1),
    structure: metaValue('结构'),
    dist: metaValue('标签分布'),
    notes: Number((/带悬停注释\s*(\d+)\s*条/.exec(metaValue('注释/外链')) ?? [])[1] ?? -1),
    links: Number((/带外链\s*(\d+)\s*条/.exec(metaValue('注释/外链')) ?? [])[1] ?? -1),
    cats: metaValue('标签').split('/').map((s) => s.trim()).filter(Boolean),
  };

  const layers = [];
  let cur = null;
  for (const line of md.split('\n')) {
    /* ### 层 1　漫步花娅街头 */
    const h = /^###\s*层\s*(\d+)[　\s]+(.+?)\s*$/.exec(line);
    if (h) {
      cur = { num: Number(h[1]), title: h[2], subtitle: '', items: [] };
      layers.push(cur);
      continue;
    }
    if (!cur) continue;
    /* > 只要稍微在冰室里冲浪就能看见的词 */
    const sub = /^>\s*(.+?)\s*$/.exec(line);
    if (sub) {
      if (!cur.subtitle) cur.subtitle = sub[1];
      continue;
    }
    /*   - 悬停注释：…（跟着它上面那一条） */
    const note = /^\s+-\s*悬停注释：(.+?)\s*$/.exec(line);
    if (note) {
      const last = cur.items[cur.items.length - 1];
      if (!last) throw new Error(`第 ${layers.length} 层里有一条悬停注释没有归属的条目`);
      last.desc = last.desc ? `${last.desc}\n${note[1]}` : note[1];
      continue;
    }
    /* - **塔吊文化**　〔花娅奇闻〕　—　[外链](https://…) */
    const it = /^-\s*\*\*(.+?)\*\*\s*〔(.+?)〕\s*(.*)$/.exec(line);
    if (it) {
      const link = /\[外链\]\(([^)\s]+)\)/.exec(it[3] ?? '');
      cur.items.push({ name: it[1].trim(), cat: it[2].trim(), href: link ? link[1] : '', desc: '' });
    }
  }
  return { claim, layers };
}

/* ------------------------------------------------------------------
   拼数据：解析结果 + 上一份数据里手改过的东西
   ------------------------------------------------------------------ */
export function buildData(parsed, prev, updated = localDate()) {
  const { claim, layers } = parsed;
  const prevCat = new Map((prev?.categories ?? []).map((c) => [String(c.name), c]));
  const prevLayer = new Map((prev?.layers ?? []).map((l) => [String(l.title), l]));
  const prevItem = new Map();
  for (const l of prev?.layers ?? []) {
    for (const i of l.items ?? []) prevItem.set(`${l.title}\u0000${i.name}`, i);
  }

  /* 分类顺序 = 源文件元信息里写的顺序，颜色沿用旧的（没有就用默认表） */
  const usedCats = new Set(layers.flatMap((l) => l.items.map((i) => i.cat)));
  const order = [...claim.cats, ...[...usedCats].filter((c) => !claim.cats.includes(c))].filter((c) => usedCats.has(c));
  const categories = order.map((name, idx) => {
    const old = prevCat.get(name);
    const fallback = CATEGORY_COLORS.find(([n]) => n === name);
    return {
      id: String(old?.id || `c${String(idx + 1).padStart(2, '0')}`),
      name,
      color: /^#[0-9a-f]{6}$/i.test(String(old?.color ?? ''))
        ? String(old.color).toLowerCase()
        : (fallback ? fallback[1] : '#b9a6c9'),
      hidden: old?.hidden === true,
    };
  });
  const catId = new Map(categories.map((c) => [c.name, c.id]));

  let seq = 0;
  const outLayers = layers.map((l, li) => {
    const old = prevLayer.get(l.title);
    return {
      id: String(old?.id || `l${String(li + 1).padStart(2, '0')}`),
      title: l.title,
      subtitle: l.subtitle,
      /* 源文件里没有图 —— 之前传过就留着，没传就空着（页面上画占位） */
      background: String(old?.background || ''),
      head: String(old?.head || ''),
      items: l.items.map((i) => {
        seq += 1;
        const before = prevItem.get(`${l.title}\u0000${i.name}`);
        return {
          id: String(before?.id || `i${String(seq).padStart(2, '0')}`),
          name: i.name,
          categoryId: catId.get(i.cat) ?? '',
          /* 本站的 tag（卡片顶部那排小词）源文件里没有：沿用旧值，没勾过就是空 */
          tags: Array.isArray(before?.tags) ? before.tags : [],
          desc: i.desc,
          href: i.href,
        };
      }),
    };
  });

  return {
    _readme: Array.isArray(prev?._readme) ? prev._readme : [
      '冰山图（/iceberg/）的数据。编辑器里的「冰山图」面板写的就是这个文件。',
      '这份是 tools/iceberg/import.mjs 从《冰室冰山图 · 条目全集》导进来的：',
      '源文件里的【标签】＝这里的 categories（分类）；本站的 tags 是另一回事（卡片顶那排小词）。',
    ],
    title: String(prev?.title || '冰室冰山'),
    intro: String(prev?.intro || ''),
    updated,
    categories,
    tags: Array.isArray(prev?.tags) ? prev.tags : [],
    layers: outLayers,
  };
}

/** 核对：源文件自己写的数 vs 导出来的数 */
export function verify(claim, data) {
  const got = {
    total: data.layers.reduce((n, l) => n + l.items.length, 0),
    layers: data.layers.length,
    notes: data.layers.reduce((n, l) => n + l.items.filter((i) => i.desc).length, 0),
    links: data.layers.reduce((n, l) => n + l.items.filter((i) => i.href).length, 0),
    dist: data.categories
      .map((c) => [c.name, data.layers.reduce((n, l) => n + l.items.filter((i) => i.categoryId === c.id).length, 0)])
      .sort((a, b) => b[1] - a[1]),
  };
  const claimDist = new Map(
    claim.dist.split('·').map((s) => {
      const m = /(\S+)\s*(\d+)/.exec(s.trim());
      return m ? [m[1], Number(m[2])] : null;
    }).filter(Boolean)
  );
  const claimStructure = /(\d+)\s*层\s*×\s*(\d+)\s*条/.exec(claim.structure) ?? [];
  const rows = [
    ['条目总数', claim.total, got.total],
    ['层级数', Number(claimStructure[1] ?? -1), got.layers],
    ['带悬停注释', claim.notes, got.notes],
    ['带外链', claim.links, got.links],
    ...[...claimDist].map(([name, n]) => [`〔${name}〕条数`, n, got.dist.find(([c]) => c === name)?.[1] ?? 0]),
  ];
  return { rows, bad: rows.filter(([, want, have]) => want !== have).length, got };
}

/* ------------------------------------------------------------------
   CLI
   ------------------------------------------------------------------ */
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const arg = process.argv[2] && !process.argv[2].startsWith('--') ? path.resolve(process.argv[2]) : DEFAULT_SOURCE;
  const dry = process.argv.includes('--dry');
  if (!fs.existsSync(arg)) {
    console.error(`找不到源文件：${arg}`);
    process.exit(1);
  }

  let prev = null;
  try {
    prev = JSON.parse(fs.readFileSync(OUT, 'utf8'));
  } catch {
    /* 第一次导入：没有旧数据，正常 */
  }

  const parsed = parseSource(fs.readFileSync(arg, 'utf8'));
  const data = buildData(parsed, prev);
  const { rows, bad, got } = verify(parsed.claim, data);

  console.log(`\n源文件：${path.relative(PROJ, arg)}`);
  console.log('核对（源文件自己写的数 vs 导出来的数）：');
  for (const [name, want, have] of rows) {
    console.log(`  ${want === have ? 'OK ' : '✗  '} ${name.padEnd(16, '　')} 源文件 ${String(want).padStart(4)}  导入 ${String(have).padStart(4)}`);
  }
  console.log(`  层级顺序：${data.layers.map((l) => `${l.title}(${l.items.length})`).join(' → ')}`);
  console.log(`  分类：${data.categories.map((c) => `${c.name}${c.color}`).join(' · ')}`);
  if (bad) {
    console.error(`\n✗ 有 ${bad} 项对不上，没写文件。先看看源文件是不是换了版本。`);
    process.exit(1);
  }

  const text = `${JSON.stringify(data, null, 2)}\n`;
  const before = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (dry) {
    console.log(`\n--dry：核对全过，没有写文件（${before === text ? '盘上那份和它一模一样' : '盘上那份和它不一样，去掉 --dry 就会覆盖'}）。`);
    process.exit(0);
  }
  fs.writeFileSync(OUT, text, 'utf8');
  console.log(`\n写好 ${path.relative(PROJ, OUT)}：${got.layers} 层 / ${got.total} 条 / ${got.notes} 条有描述 / ${got.links} 条有链接${before === text ? '（内容没变）' : ''}`);
  console.log('提醒：分类颜色是导入时给的起点，在编辑器「冰山图」面板里用取色器改；'
    + '再跑一次这个脚本不会把你改过的颜色 / 背景图 / 头图 / tag 冲掉。');
}
