/*
 * 检查：铃忆每天推上来的「完整群总结」里的群圣经，会不会自动进 /bellie/
 * ----------------------------------------------------------------------------
 * 站长 2026-11-22：「每次收到lingyi的推流后都自动获取每天的这个json并把里面的
 * 群圣经部分转录到铃忆圣经里」。
 *
 * 这条验收量的是**接线**，不是文案：
 *   ① 群总结目录里的每一份，站点数据里都有对应那一天（日期从 source.date 来）；
 *   ② 正文 = golden_quotes[].content、评语 = reason、署名认得出成员（不是 user-001）；
 *   ③ 同一天最多 5 条、id 不重复 —— 一份都不会被抄两遍；
 *   ④ 同一天**已经有天文件时以天文件为准**（推导不覆盖直接投递）；
 *   ⑤ 首页那份数据（/bellie.json）和分块接口（/bellie/chunk/*.json）对得上；
 *   ⑥ 页面上真的渲染出来了：正文在卡片里、评语在小字斜体里、条目挂着时间轴位置。
 *
 * 用法：node tools/checks/bellie-summary-check.mjs [dist]   （默认 dist）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const ROOT = path.resolve(process.argv[2] || 'dist');
const PORT = 4390;
const DEBUG_PORT = 9355;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* --------------------------------------------------------- 入口数据（源） */
const SUMMARIES = path.join(process.cwd(), 'public', 'data', 'group-summaries');
const DAYS = path.join(process.cwd(), 'src', 'data', 'bellie', 'days');

/** 直接从原始 JSON 里读金句 —— 故意**不走**站点那套解析，免得自己验自己 */
const raw = fs
  .readdirSync(SUMMARIES)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => {
    const json = JSON.parse(fs.readFileSync(path.join(SUMMARIES, f), 'utf8'));
    const date = String(json?.source?.date || f.slice(0, 10));
    const quotes = Array.isArray(json?.analysis_result?.statistics?.golden_quotes)
      ? json.analysis_result.statistics.golden_quotes
      : [];
    /* 这份群总结自带的「匿名号 → 群名片」（评语里点人用的就是那个号） */
    const names = {};
    const namesByNum = {};
    for (const [id, v] of Object.entries(json?.analysis_result?.user_analysis ?? {})) {
      if (v?.nickname) {
        names[id] = String(v.nickname);
        namesByNum[String(Number((id.match(/\d+/) ?? [''])[0] || 0))] = String(v.nickname);
      }
    }
    return { file: f, date, quotes, names, namesByNum };
  })
  .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.quotes.length > 0);

/** 站里的成员名（判断"换成了人"用；不从站点那边借解析逻辑） */
const MEMBER_NAMES = (() => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'data', 'salon.json'), 'utf8'));
    return (Array.isArray(j?.members) ? j.members : []).map((m) => String(m?.name ?? '')).filter(Boolean);
  } catch {
    return [];
  }
})();

/** 把 `[user-004]` / 裸的 `user-004` 从文字里摘掉（两边都摘了再比，才看得见"别的字有没有被改"） */
const stripIds = (s) =>
  String(s ?? '')
    .replace(/\[\s*user[-_]?\d+\s*\]/gi, ' ')
    .replace(/(?<![\w-])user[-_]?\d+(?![\w-])/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** 匿名号写法可能不一样（`user-004` / `user_4`），一律按数字对齐 */
const idsIn = (s) => [...String(s ?? '').matchAll(/\buser[-_]?\d+\b/gi)].map((m) => m[0]);
const numOf = (id) => {
  const m = String(id).match(/\d+/);
  return m ? String(Number(m[0])) : '';
};
/** 这一天某个匿名号对应的群名片（先按原样查，再按数字查） */
const nickOf = (day, id) => day.names?.[id] ?? day.namesByNum?.[numOf(id)] ?? '';

/**
 * 比对用的归一化：把匿名号和**人名**都抹掉再看剩下的字。
 * 评语里那处 `[user-004]` 会被换成 `Raw`，两边都抹掉人名之后才能证明
 * 「除了换名字，一个字都没动」。
 */
const NAME_POOL = [...new Set([...MEMBER_NAMES, ...raw.flatMap((s) => [...Object.values(s.names), ...Object.values(s.namesByNum)])])]
  .filter((n) => n && n.length >= 2)
  .sort((a, b) => b.length - a.length);
const normalize = (s) => {
  let t = stripIds(s);
  for (const n of NAME_POOL) if (t.includes(n)) t = t.split(n).join(' ');
  return t.replace(/\s+/g, ' ').trim();
};

const daysOnDisk = new Map();
for (const f of fs.readdirSync(DAYS).filter((n) => n.endsWith('.json'))) {
  const j = JSON.parse(fs.readFileSync(path.join(DAYS, f), 'utf8'));
  daysOnDisk.set(f.replace(/\.json$/, ''), Array.isArray(j.entries) ? j.entries : []);
}

/* ---------------------------------------------------------------- 服务端 */
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const getJson = async (u) => (await fetch(`http://127.0.0.1:${PORT}${u}`)).json();

const profile = path.join(process.env.TEMP ?? '.', `dsh-bellie-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });

class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = []; ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); }); }
  static async attach(u) { const ws = new WebSocket(u); await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); }); return new CDP(ws); }
  send(m, p = {}) { const id = ++this.id; this.ws.send(JSON.stringify({ id, method: m, params: p })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  async ev(e) { const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '')); return r.result.value; }
}

try {
  check('群总结目录里有可以抄的那一天（lingyi 推的完整群总结）', raw.length > 0, `${raw.map((s) => s.date).join('、') || '一份都没有'}`);

  const data = await getJson('/bellie.json');
  const entries = Array.isArray(data.entries) ? data.entries : [];
  const byDate = new Map();
  for (const e of entries) {
    if (!byDate.has(e.date)) byDate.set(e.date, []);
    byDate.get(e.date).push(e);
  }

  /* ---------------------------------------------------- ① 每天都有、条数对 */
  const missing = raw.filter((s) => !byDate.has(s.date)).map((s) => s.date);
  check('群总结里有的每一天，/bellie.json 里都有', missing.length === 0, missing.join('、') || '全部在');

  const tooMany = raw.filter((s) => (byDate.get(s.date)?.length ?? 0) > 5).map((s) => `${s.date}:${byDate.get(s.date).length}`);
  check('一天最多 5 条（多出来的不抄，不会越攒越多）', tooMany.length === 0, tooMany.join('、') || '都在 5 条以内');

  const dupIds = entries.map((e) => e.id).filter((id, i, arr) => arr.indexOf(id) !== i);
  check('条目 id 不重复（同一条没被抄两遍）', dupIds.length === 0, dupIds.slice(0, 5).join('、') || '无重复');

  /* ------------------------------ ② 正文/评语/署名：拿原始 JSON 逐字对一遍 */
  /*
   * ⚠ 2026-11-22 起评语里的 `[user-004]` 会被换成成员名（站长：「群成员都变成了
   *   user-00x」）。所以比对时**两边都把匿名号摘掉**再比 —— 这样既证明"除了换名字，
   *   一个字都没动"，也不会因为换名字就误报。
   * ⚠ 2026-11-23 起还有**查重**（站长：「正文内容完全一样……只保留时间最早的一条」）：
   *   某天的一条要是跟更早的某条正文一样，站上只留最早那条 —— 所以逐条比的时候
   *   按"这条正文最早出现在哪一天"筛一遍，只比该留的那些。
   */
  const keyOf = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  /** 每条正文最早出现在哪天（天文件优先：被天文件盖住的那天群总结不进站，也不算） */
  const earliest = new Map();
  const bumpEarliest = (text, date) => {
    const k = keyOf(text);
    if (!k) return;
    const cur = earliest.get(k);
    if (!cur || date < cur) earliest.set(k, date);
  };
  for (const [date, list] of daysOnDisk) for (const e of list) bumpEarliest(e.text, date);
  for (const s of raw) {
    if (daysOnDisk.has(s.date)) continue;
    for (const q of s.quotes) bumpEarliest(q.content, s.date);
  }

  const fieldBad = [];
  for (const s of raw) {
    if (daysOnDisk.has(s.date)) continue; // 天文件优先的那天不看推导
    const got = byDate.get(s.date) ?? [];
    const want = s.quotes.slice(0, 5).filter((q) => earliest.get(keyOf(q.content)) === s.date);
    if (got.length !== want.length) {
      fieldBad.push(`${s.date} 条数 ${got.length}≠${want.length}（查重后该留 ${want.length}）`);
      continue;
    }
    want.forEach((q, i) => {
      const g = got[i];
      if (!g) return fieldBad.push(`${s.date}#${i + 1} 少了`);
      if (normalize(g.text) !== normalize(q.content)) fieldBad.push(`${s.date}#${i + 1} 正文对不上`);
      if (normalize(g.comment) !== normalize(q.reason)) fieldBad.push(`${s.date}#${i + 1} 评语对不上`);
      if (!g.member || g.member === q.user_id) fieldBad.push(`${s.date}#${i + 1} 署名还是个匿名 user_id（${g.member}）`);
    });
  }
  check('正文、评语跟群总结里的 content / reason 一字不差（只允许匿名号换成名字、复读的只留最早），署名认得出成员', fieldBad.length === 0, fieldBad.slice(0, 4).join('；') || `${raw.length} 天全对`);

  /* ---- ②a 查重：任何一条正文在整页里最多出现一次（复读的只留最早那条） ---- */
  const seenText = new Map();
  const textDups = [];
  for (const e of entries) {
    const k = keyOf(e.text);
    if (!k) continue;
    if (seenText.has(k)) textDups.push(`${seenText.get(k).date}/${e.date}`);
    else seenText.set(k, e);
  }
  check('★★ 正文查重：没有任何一条正文出现两次（复读的只留最早那条）', textDups.length === 0, textDups.slice(0, 4).join('、') || `全站 ${entries.length} 条各不相同`);

  /* -------- ②b 匿名号 user-00X：先查数据够不够换，再查页面上真的换成了人 -------- */
  const noName = [];
  for (const s of raw) {
    for (const q of s.quotes) {
      for (const id of [...idsIn(q.content), ...idsIn(q.reason)]) {
        if (!nickOf(s, id)) noName.push(`${s.date}:${id}`);
      }
    }
  }
  check(
    '★★ 评语里点到的 user-00X 都能在同一份群总结里找到名字（找不到就一定会露在页面上）',
    noName.length === 0,
    noName.slice(0, 5).join('、') || '都有名字'
  );

  const notPerson = [];
  let idQuotes = 0;
  for (const s of raw) {
    if (daysOnDisk.has(s.date)) continue;
    const got = byDate.get(s.date) ?? [];
    s.quotes.slice(0, 5).forEach((q, i) => {
      const ids = [...idsIn(q.content), ...idsIn(q.reason)];
      if (!ids.length) return;
      idQuotes += 1;
      const g = got[i];
      if (!g) return;
      const text = `${g.text} ${g.comment}`;
      if (/\buser[-_]?\d+\b/i.test(text)) notPerson.push(`${s.date}#${i + 1} 还留着 user-00X`);
      /* 换出来得是个"人"：成员名，或者那块群名片本身（认不出来的成员保留群名片） */
      const known = ids.every((id) => {
        const nick = nickOf(s, id);
        return [nick, ...MEMBER_NAMES].some((t) => t && g.comment.includes(t));
      });
      if (!known) notPerson.push(`${s.date}#${i + 1} 评语里没换成名字（${ids.join('/')}）`);
    });
  }
  check(
    '★★ 评语里点到的群成员换成了名字（不是 user-00X，也不是空）',
    notPerson.length === 0 && (idQuotes > 0 || raw.length === 0),
    notPerson.slice(0, 4).join('；') || `${idQuotes} 条点过人的评语都换成了名字`
  );

  const strayInData = entries.filter((e) => /\buser[-_]?\d+\b/i.test(`${e.text} ${e.comment}`)).length;
  check('★ /bellie.json 里一个 user-00X 都没有（正文 / 评语）', strayInData === 0, `${strayInData} 条`);

  /* ---------------------------- ③ 同一天已经有天文件时，以天文件为准（不覆盖） */
  /*
   * ⚠ 2026-11-23 起这里也要按查重算：天文件里 5 条，其中一条跟更早那天正文一样，
   *   站上就只剩 4 条 —— 那是查重删的，不是"被推导覆盖"，所以按"查重后该留的条数"比。
   */
  const shadowed = [];
  for (const [date, list] of daysOnDisk) {
    if (!list.length) continue;
    const expect = list.filter((e) => {
      const k = keyOf(e.text);
      return k ? earliest.get(k) === date : true;
    });
    const got = byDate.get(date) ?? [];
    if (got.length !== expect.length) shadowed.push(`${date} 天文件 ${list.length} 条（查重后该留 ${expect.length}）、页面 ${got.length} 条`);
    else {
      const a = String(expect[0]?.text ?? '').trim();
      const b = String(got[0]?.text ?? '').trim();
      if (a !== b) shadowed.push(`${date} 首条正文不是天文件里那条`);
    }
  }
  check('同一天两边都有时以天文件为准（推导不覆盖直接投递；复读的按查重算）', shadowed.length === 0, shadowed.slice(0, 3).join('；') || '一致');

  /* ------------------------------------- ④ /bellie.json 和分块接口对得上 */
  let chunkTotal = 0;
  let chunkStray = 0;
  const chunkIds = new Set();
  for (let i = 0; ; i++) {
    let c;
    try {
      c = await getJson(`/bellie/chunk/${i}.json`);
    } catch {
      break;
    }
    const html = String(c?.html ?? '');
    if (!html) break;
    chunkStray += [...html.matchAll(/\buser[-_]?\d+\b/gi)].length;
    /* 分块接口给的是排好的标记（不是数组）：数卡片、抠 id */
    const ids = [...html.matchAll(/class="salon__item" id="([^"]+)"/g)].map((m) => m[1]);
    for (const id of ids) {
      chunkTotal += 1;
      chunkIds.add(id);
    }
    if (i > 60) break;
  }
  check('分块接口里的条数和 /bellie.json 一致（推到站点上不会缺一块）', chunkTotal === entries.length, `${chunkTotal} vs ${entries.length}`);
  check('分块接口里也没有重复 id', chunkIds.size === chunkTotal, `${chunkIds.size} / ${chunkTotal}`);
  check('★ 分块接口里也没有一个 user-00X', chunkStray === 0, `${chunkStray} 处`);

  /* ------------------------------------------------------------ ⑤ 真的渲染 */
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/bellie/` });
  for (let i = 0; i < 120; i++) {
    await sleep(150);
    if ((await cdp.ev('document.readyState')) === 'complete') break;
  }
  await sleep(2500);

  const newest = raw.map((s) => s.date).sort().slice(-1)[0];
  const quote = (raw.find((s) => s.date === newest)?.quotes ?? [])[0] ?? {};
  const wantText = String(quote.content || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  const visible = await cdp.ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const hit = items.find((el) => el.textContent.replace(/\\s+/g, ' ').includes(${JSON.stringify(wantText)}));
    if (!hit) return { found: false, items: items.length };
    const c = hit.querySelector('.salon__comment');
    const t = hit.querySelector('.salon__text') || hit;
    const cs = c ? getComputedStyle(c) : null;
    const ts = t ? getComputedStyle(t) : null;
    return {
      found: true,
      items: items.length,
      param: hit.getAttribute('data-tl-param'),
      comment: c ? c.textContent.replace(/\\s+/g, ' ').trim().slice(0, 20) : null,
      italic: cs ? cs.fontStyle : null,
      smaller: cs && ts ? parseFloat(cs.fontSize) < parseFloat(ts.fontSize) : null,
      tlId: (document.querySelector('[data-tl-id]') || {}).getAttribute?.('data-tl-id') ?? null,
      stray: (document.body.innerText.match(/\\buser[-_]?\\d+\\b/gi) || []).length,
    };
  })()`);
  check('页面上真的渲染出今天这条（不是只在 JSON 里）', !!visible.found, JSON.stringify(visible));
  check('评语是卡片下面的小字斜体', visible.italic === 'italic' && visible.smaller === true, JSON.stringify({ italic: visible.italic, smaller: visible.smaller }));
  check('★ 整页文字里没有一个 user-00X（评语里点的人都成了名字）', visible.stray === 0, `${visible.stray} 处`);
  const paramNum = Number(visible.param);
  check('这一条挂着时间轴的位置（0~1，点轴上刻度找得到它）', visible.param !== null && Number.isFinite(paramNum) && paramNum >= 0 && paramNum <= 1, `${visible.param}`);
  check('圣经页挂的还是那条时间轴', !!visible.tlId, `${visible.tlId}`);
  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch {}
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
