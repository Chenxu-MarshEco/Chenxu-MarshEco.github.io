/*
 * ============================================================================
 * 群总结 JSON → 群圣经条目（/bellie/ 的「铃忆的冰室圣经」）
 * ----------------------------------------------------------------------------
 * 站长 2026-11-22 的原话：
 *   「请你检查一下lingyi机器人今天的推流内容 里面应该附带了一份完整群总结.json
 *    内部包含了昨天的群圣经 请你为网站添加一个自动的功能 每次收到lingyi的推流后
 *    都自动获取每天的这个json并把里面的群圣经部分转录到铃忆圣经里」
 *
 * lingyi 每天推的那一份「完整群总结」就在 `public/data/group-summaries/` 下面，
 * 文件名是 `2026-11-21-group_燃儿求开组_20261121_230000_<trace>.json`。
 * 里面的 5 条群圣经在 `analysis_result.statistics.golden_quotes`：
 *   { content: 群友原句, sender: 群名片, reason: 铃忆的评语, user_id: 匿名的 user-001 }
 * 正好对上「铃忆投递指引.md」的四样（time 可以没有，qq 可以没有，name 就是 sender）。
 *
 * 放在这里而不是 `src/utils/`：它要被**两边**共用 ——
 *   · 站点构建：`src/utils/bellie.ts` 在这里读（没人再手抄一遍，就不会有两套规则）；
 *   · 人工核对 / 落盘：`node tools/bellie/from-summary.mjs`。
 *
 * ⚠ 这个模块**只读**。写 `src/data/bellie/days/` 是 from-summary.mjs 的事，
 *   站点构建时一个字节都不往仓库里写。
 * ⚠ 一天有两条来源时**天文件优先**（lingyi 自己投的 days 文件更准，推导不覆盖它）——
 *   判断在 bellie.ts 里做，这里只负责把群总结解析成条目。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

/** 群总结放在仓库的哪个目录（相对仓库根） */
export const SUMMARY_REL_DIR = path.posix.join('public', 'data', 'group-summaries');

/** 一天最多收几条 —— 和收件台同一条（站长定的「每天五条」） */
export const PER_DAY = 5;

const str = (v) => String(v ?? '').trim();

/** `2026-11-21` 这种格式对、日子也真存在的才算数 */
export function dateOk(v) {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10) === s ? s : '';
}

/** `9:05` / `09:05` → `09:05`；空串和不认识的写法都算「没有时间」 */
export function timeOk(v) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(v));
  if (!m) return '';
  const h = Number(m[1]);
  if (h > 23) return '';
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/**
 * 取出那五条金句。
 * 正常是数组；也见过导出工具把整段压成一个字符串（`"[{...},{...}]"`），
 * 能解就解，解不出来当没有 —— 不瞎猜、不拆行。
 */
export function quotesOf(json) {
  const g = json?.analysis_result?.statistics?.golden_quotes;
  if (Array.isArray(g)) return g;
  if (typeof g === 'string') {
    const s = g.trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** 一条金句 → 一条圣经（字段对不上就返回 null，调用方记一笔） */
function toEntry(q) {
  if (!q || typeof q !== 'object') return null;
  const text = str(q.content ?? q.text ?? q.quote);
  const comment = str(q.reason ?? q.comment ?? q.review);
  if (!text || !comment) return null;
  const name = str(q.sender ?? q.nickname ?? q.name);
  const qqRaw = str(q.qq);
  const time = timeOk(q.time);
  const entry = { text, comment };
  if (time) entry.time = time;
  if (name) entry.name = name;
  if (/^[1-9]\d{4,11}$/.test(qqRaw)) entry.qq = qqRaw;
  return entry;
}

/**
 * 群总结里的 `user-001` 这样的匿名号 → 群名片（**同一份 JSON 里自带**）。
 *
 * 为什么要有这个（2026-11-22 站长发现的）：
 *   导出时为了隐私把发送者换成了 `user-001 / user-002 …`（`privacy.structured_user_ids`），
 *   而铃忆写评语时点人就是写这个号（`「群友们还在正常聊烤鱼…，[user-004] 突然……」`）。
 *   站点只把 **QQ 号**换成成员名（`qqToNames`），`user-004` 不是数字，于是原样露在
 *   圣经卡片的评语里 —— 站长看到的就是「群成员都变成了 user-00x」。
 *
 * 名字的来源（按可靠程度）：
 *   ① `analysis_result.user_analysis[user-001].nickname`  ← 正常都有
 *   ② `statistics.activity_visualization.user_activity_ranking[]`（只有前 10 名）
 *   ③ `topics[].contributor_ids` 和 `contributors` **按下标配**（没有 nickname 时的兜底）
 * 换不换得成站里的**正式成员名**由站点那边决定（它有 aliases 表）；这里只负责把
 * 匿名号对上群名片 —— 匿名号本身绝不留在页面上。
 */
export function nicknamesOf(json) {
  const map = {};
  const ua = json?.analysis_result?.user_analysis;
  if (ua && typeof ua === 'object') {
    for (const [id, v] of Object.entries(ua)) {
      /* 正常是 { nickname, message_count… }；也容一手「直接就是名字」的写法 */
      const n = str(typeof v === 'string' ? v : v?.nickname ?? v?.name);
      if (str(id) && n) map[str(id)] = n;
    }
  }
  const rank = json?.analysis_result?.statistics?.activity_visualization?.user_activity_ranking;
  if (Array.isArray(rank)) {
    for (const r of rank) {
      const id = str(r?.user_id);
      const n = str(r?.nickname);
      if (id && n && !map[id]) map[id] = n;
    }
  }
  const topics = json?.analysis_result?.topics;
  if (Array.isArray(topics)) {
    for (const t of topics) {
      const ids = Array.isArray(t?.contributor_ids) ? t.contributor_ids : [];
      const names = Array.isArray(t?.contributors) ? t.contributors : [];
      ids.forEach((id, i) => {
        const k = str(id);
        const n = str(names[i]);
        if (k && n && !map[k]) map[k] = n;
      });
    }
  }
  return map;
}

/** 一段文字里点到哪些匿名号（`[user-004]` 和裸的 `user-004` 都算） */
export function userIdsIn(s) {
  const out = [];
  for (const m of String(s ?? '').matchAll(/\buser[-_]?\d+\b/gi)) {
    const id = m[0];
    if (!out.some((x) => x.toLowerCase() === id.toLowerCase())) out.push(id);
  }
  return out;
}

/** `user-004` / `user_4` / `user0004` 都按「4」算 —— 导出的写法变一下也认得出 */
export const userNum = (id) => {
  const m = String(id).match(/\d+/);
  return m ? String(Number(m[0])) : '';
};

/**
 * 扫一遍群总结目录，把每一天的圣经解析出来。
 *
 * 按文件名升序读；同一天出现两份时**后一份赢**（文件名里带 trace 的时间戳，
 * lingyi 重跑一遍就是新的那份，旧的留着当历史）。
 *
 * @param {{ root?: string, dir?: string }} [opts]
 * @returns {{
 *   days: { date: string, file: string, entries: object[], over: number, long: string[], users: Record<string, string> }[],
 *   problems: string[],
 * }}
 */
export function readSummaryDays(opts = {}) {
  const root = opts.root ?? process.cwd();
  const dir = opts.dir ?? path.join(root, SUMMARY_REL_DIR);
  const problems = [];
  const days = [];

  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.json'))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    /* 还没有群总结目录 = 还没收到过，不是错 */
    return { days, problems };
  }

  for (const file of files) {
    const abs = path.join(dir, file);
    let json;
    try {
      json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    } catch (e) {
      problems.push(`${file}：不是合法 JSON（${e?.message || e}）`);
      continue;
    }

    const date = dateOk(json?.source?.date) || dateOk(file.slice(0, 10));
    if (!date) {
      problems.push(`${file}：认不出是哪一天（source.date 和文件名都不是 YYYY-MM-DD）`);
      continue;
    }

    const quotes = quotesOf(json);
    if (quotes.length === 0) {
      problems.push(`${file}：里面没有 golden_quotes（${date} 这份没有群圣经）`);
      continue;
    }

    const entries = [];
    const long = [];
    for (const q of quotes.slice(0, PER_DAY)) {
      const e = toEntry(q);
      if (!e) {
        problems.push(`${file}：有一条缺 content 或 reason，跳过`);
        continue;
      }
      if (e.text.length > 500 || e.comment.length > 300) long.push(e.text.slice(0, 12));
      entries.push(e);
    }
    if (entries.length === 0) {
      problems.push(`${file}：五条都不成条目，这一天没有可抄的`);
      continue;
    }

    const over = Math.max(0, quotes.length - PER_DAY);
    if (over) problems.push(`${file}：金句有 ${quotes.length} 条，只抄前 ${PER_DAY} 条`);

    /*
     * 评语里点到的匿名号 → 群名片（见 nicknamesOf 头上的说明）。
     * 只收**这一天真正用到的**那几个号；对不上的记一笔，让人知道为什么页面上
     * 还留着一个 user-00x（站点那边没有名字可换时只能原样留着，不会瞎编）。
     * 按号（`user-004` / `user_4` 都算 4）查，导出换个写法也认得出。
     */
    const nick = nicknamesOf(json);
    const nickByNum = {};
    for (const [id, n] of Object.entries(nick)) nickByNum[userNum(id)] = n;
    const users = {};
    for (const e of entries) {
      for (const id of [...userIdsIn(e.text), ...userIdsIn(e.comment)]) {
        const n = nick[id] ?? nickByNum[userNum(id)];
        if (n) users[id] = n;
        else problems.push(`${file}：${id} 在 user_analysis 里没有名字，评语里换不成人`);
      }
    }

    const at = days.findIndex((d) => d.date === date);
    const day = { date, file: `${SUMMARY_REL_DIR}/${file}`.replace(/\\/g, '/'), entries, over, long, users };
    if (at >= 0) days[at] = day;
    else days.push(day);
  }

  days.sort((a, b) => b.date.localeCompare(a.date));
  return { days, problems };
}
