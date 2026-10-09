/**
 * 把一批「月度导出」解析出来的精华**并进**站里已有的 salon.json（2026-10-06 加）。
 *
 * 和 tools/salon/import.mjs（整份重建）的区别：
 *   · import.mjs      —— 拿最早那份「群精华 图文版」把 784 条**全量重建**一遍，
 *                        精华 id 会整个重排（e0001…），所以它只适合"从头来过"。
 *   · 这个 merge       —— **只增不改**：已有的 784 条一个字节都不动，
 *                        新条目往后接着编号（e0785…），同一份文件重复导入不会多出东西。
 *                        月度新文件就走这条路。
 *
 * 三条规矩：
 *   ① **去重**：日期 + 时刻 + 正文（去掉空白和 `- ` 项目符号后）一样 = 同一条，
 *      跳过。月度文件里常常带着已经在站里的那几天（9 月上半月），不能重复进来。
 *      正文是空的（只有图）那种，就拿"日期+时刻+图片张数"当键。
 *   ② **成员按名字或别名认**：站里的成员表本来就有别名（花花→隰辰煦、Sunf→桑芙、
 *      灵空天仪→灵空、羽之颂→澄净羽之颂…），所以导出文件里叫哪个名字都能对上；
 *      真没见过的名字才新建成员（头像留空，回头在「成员」面板里补）。
 *   ③ **年代按日期落段**：新条目不带年代，按 date 落进现有 eras 的 from~to 里
 *      （站点和编辑器本来就是这么算的，见 server.mjs 的 eraIdForDate）。
 *
 * 时间轴 / 成员头像那些东西全都不碰：timelineId、eras、已有成员的名字与头像照旧。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/** 比正文用的归一：去掉所有空白 + 去掉行首的 `- ` / `• ` 项目符号（两种导出写法不一样） */
export function normText(s) {
  return String(s ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-•*]\s*/, ''))
    .join('')
    .replace(/\s+/g, '');
}

/** 一条精华的去重键 */
export function essenceKey(e) {
  const t = normText(e.text);
  if (t) return `${e.date}|${e.time || ''}|${t}`;
  return `${e.date}|${e.time || ''}|#img${(e.images ?? []).length}`;
}

/* 两个字符串差几个字（Levenshtein，短文本用） */
export function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/**
 * 「同一天同一时刻，正文九成以上像」就算同一条。
 *
 * 为什么不能只比"完全一样"：导出管线偶尔会把个别字弄坏 —— 9 月那份里 09-06 那条的
 * 「你们看这个图**像**」在新文件里成了「图」后面跟一个 U+FFFD（替换字符）。差一个字就当新条目
 * 收进来的话，同一句话会在站里出现两遍。同一天同一分钟、正文 90% 以上重合，
 * 是同一个人的同一句话，没有别的可能。
 */
export function looksSame(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  if (short.length < 8) return false;                 // 太短的没把握，宁可不判
  return 1 - levenshtein(long, short) / long.length >= 0.9;
}

/** 日期落在哪个年代里（和站点、编辑器同一套算法） */
export function eraIdFor(date, eras) {
  const d = String(date || '');
  for (const era of eras ?? []) {
    const from = String(era?.from || '');
    const to = String(era?.to || '');
    if (from && to && d >= from && d <= to) return String(era.id || '');
  }
  return '';
}

/** 现有精华里最大的编号，往后接着编（新的月度文件日期总是更晚，id 和日期顺序就对得上） */
export function nextIdFrom(essences) {
  let max = 0;
  for (const e of essences ?? []) {
    const m = /^e(\d+)$/.exec(String(e?.id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** 新成员 id：`mNN-xxxx`，和现有那批（m01-4780…）长一样，撞了就再摇一个 */
function newMemberId(used) {
  for (let i = 0; i < 500; i++) {
    const n = String(used.size + 1 + i).padStart(2, '0');
    const id = `m${n}-${crypto.randomBytes(2).toString('hex')}`;
    if (!used.has(id)) return id;
  }
  return `m-${Date.now().toString(36)}`;
}

/**
 * 合并。
 *
 * @param {object}  o
 * @param {object}  o.data      现在 src/data/salon.json 的内容（原样，不会被改）
 * @param {object}  o.parsed    parseMonthHtml() 的结果
 * @param {string}  o.imageDir  图片写到哪（public/img/salon）
 * @param {boolean} o.dryRun    true 就只算报告，不写任何文件
 * @returns {{ file: object, report: object }}
 */
export function mergeEssences({ data, parsed, imageDir, dryRun = false }) {
  const file = {
    ...data,
    eras: Array.isArray(data.eras) ? data.eras : [],
    members: (Array.isArray(data.members) ? data.members : []).map((m) => ({ ...m })),
    essences: (Array.isArray(data.essences) ? data.essences : []).map((e) => ({ ...e })),
  };

  /* ---------- 成员：名字或别名认得出来就用老的，认不出来才新建 ---------- */
  const byAlias = new Map();
  for (const m of file.members) {
    if (m?.name) byAlias.set(String(m.name), m);
    for (const a of Array.isArray(m?.aliases) ? m.aliases : []) byAlias.set(String(a), m);
  }
  const usedMemberIds = new Set(file.members.map((m) => String(m.id || '')));
  const newMembers = [];
  const memberOf = (name) => {
    const hit = byAlias.get(name);
    if (hit) return hit;
    const m = { id: newMemberId(usedMemberIds), name, avatar: '' };
    usedMemberIds.add(m.id);
    file.members.push(m);
    byAlias.set(name, m);
    newMembers.push(m);
    return m;
  };

  /* ---------- 去重表 ---------- */
  const seen = new Set(file.essences.map(essenceKey));
  /* 同一天同一时刻的候选（用来做"差一两个字也算同一条"的宽容判断） */
  const byWhen = new Map();
  const remember = (e) => {
    const k = `${e.date}|${e.time || ''}`;
    const arr = byWhen.get(k) ?? [];
    arr.push({ text: normText(e.text) });
    byWhen.set(k, arr);
  };
  for (const e of file.essences) remember(e);

  /* ---------- 逐条 ---------- */
  let nextNum = nextIdFrom(file.essences);
  const usedIds = new Set(file.essences.map((e) => String(e.id || '')));
  const added = [];
  const skipped = [];
  let imgWritten = 0;
  let imgBytes = 0;

  for (const it of parsed.items) {
    const key = essenceKey(it);
    const text = normText(it.text);
    let why = '';
    if (seen.has(key)) why = '站里已经有这一条了';
    else if (text) {
      for (const cand of byWhen.get(`${it.date}|${it.time || ''}`) ?? []) {
        if (looksSame(cand.text, text)) {
          const diff = levenshtein(cand.text, text);
          why = diff ? `站里已经有这一条了（正文只差 ${diff} 个字）` : '站里已经有这一条了';
          break;
        }
      }
    }
    if (why) {
      skipped.push({ date: it.date, time: it.time, text: (it.text || '').slice(0, 40), why });
      continue;
    }
    let id = '';
    while (nextNum < 100000) {
      const cand = `e${String(nextNum).padStart(4, '0')}`;
      nextNum++;
      if (!usedIds.has(cand)) { id = cand; break; }
    }
    if (!id) id = `e-${Date.now().toString(36)}`;
    usedIds.add(id);

    /* 图片：命名沿用老规矩 <id>-<序号>.<ext> */
    const images = [];
    it.images.forEach((im, k) => {
      const name = `${id}-${k + 1}.${im.ext}`;
      images.push(`/img/salon/${name}`);
      if (!dryRun) {
        const buf = Buffer.from(im.base64, 'base64');
        fs.mkdirSync(imageDir, { recursive: true });
        fs.writeFileSync(path.join(imageDir, name), buf);
        imgWritten++;
        imgBytes += buf.length;
      }
    });

    const memberIds = it.names.map((n) => memberOf(n).id);
    const entry = {
      id,
      ...(memberIds.length ? { memberIds } : { memberIds: [] }),
      kind: it.kind,
      date: it.date,
      time: it.time || '',
      text: it.text || '',
      ...(it.ocr ? { ocr: true } : {}),
      images,
      eraId: eraIdFor(it.date, file.eras),
    };
    file.essences.push(entry);
    seen.add(key);
    remember(entry);
    added.push(entry);
  }

  /* ---------- 排一次序（站点读的时候也会排，这里让磁盘上的文件也整齐） ---------- */
  file.essences.sort((a, b) =>
    `${a.date} ${a.time || '00:00'}`.localeCompare(`${b.date} ${b.time || '00:00'}`) || String(a.id).localeCompare(String(b.id)));

  /* ---------- updated 取最新那天（这个字段的意思是"数据截止到哪天"） ---------- */
  const maxDate = file.essences.reduce((acc, e) => (e.date > acc ? e.date : acc), String(file.updated || ''));
  const updatedChanged = maxDate !== String(file.updated || '');
  if (updatedChanged) file.updated = maxDate;

  /* ---------- 对账：导出文件自己写的条数 / 图片张数 ---------- */
  const warnings = [];
  if (parsed.counts?.items >= 0 && parsed.counts.items !== parsed.items.length) {
    warnings.push(`导出文件开头写着「共 ${parsed.counts.items} 条」，实际解析出 ${parsed.items.length} 条 —— 解析可能漏了东西`);
  }
  const parsedImgs = parsed.items.reduce((a, b) => a + b.images.length, 0);
  if (parsed.counts?.images >= 0 && parsed.counts.images !== parsedImgs) {
    warnings.push(`导出文件写着「图片 ${parsed.counts.images} 张」，实际解析出 ${parsedImgs} 张`);
  }

  return {
    file,
    report: {
      month: parsed.month,
      title: parsed.title,
      parsed: { items: parsed.items.length, images: parsedImgs, people: parsed.people.length },
      declared: parsed.counts,
      added: added.length,
      skipped: skipped.length,
      skippedList: skipped.slice(0, 40),
      newMembers: newMembers.map((m) => m.name),
      images: dryRun ? 0 : imgWritten,
      imageBytes: imgBytes,
      updated: updatedChanged ? { from: String(data.updated || ''), to: file.updated } : null,
      before: { members: (data.members ?? []).length, essences: (data.essences ?? []).length },
      after: { members: file.members.length, essences: file.essences.length },
      addedIds: added.map((e) => e.id),
      warnings,
      dryRun,
    },
  };
}
