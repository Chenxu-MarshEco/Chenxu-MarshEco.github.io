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
    return { file: f, date, quotes };
  })
  .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s.date) && s.quotes.length > 0);

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
  const fieldBad = [];
  for (const s of raw) {
    if (daysOnDisk.has(s.date)) continue; // 天文件优先的那天不看推导
    const got = byDate.get(s.date) ?? [];
    const want = s.quotes.slice(0, 5);
    if (got.length !== want.length) {
      fieldBad.push(`${s.date} 条数 ${got.length}≠${want.length}`);
      continue;
    }
    want.forEach((q, i) => {
      const g = got[i];
      if (!g) return fieldBad.push(`${s.date}#${i + 1} 少了`);
      if (g.text.trim() !== String(q.content).trim()) fieldBad.push(`${s.date}#${i + 1} 正文对不上`);
      if (g.comment.trim() !== String(q.reason).trim()) fieldBad.push(`${s.date}#${i + 1} 评语对不上`);
      if (!g.member || g.member === q.user_id) fieldBad.push(`${s.date}#${i + 1} 署名还是个匿名 user_id（${g.member}）`);
    });
  }
  check('正文、评语跟群总结里的 content / reason 一字不差，署名认得出成员', fieldBad.length === 0, fieldBad.slice(0, 4).join('；') || `${raw.length} 天全对`);

  /* ---------------------------- ③ 同一天已经有天文件时，以天文件为准（不覆盖） */
  const shadowed = [];
  for (const [date, list] of daysOnDisk) {
    if (!list.length) continue;
    const got = byDate.get(date) ?? [];
    if (got.length !== list.length) shadowed.push(`${date} 天文件 ${list.length} 条、页面 ${got.length} 条`);
    else {
      const a = String(list[0].text).trim();
      const b = String(got[0].text).trim();
      if (a !== b) shadowed.push(`${date} 首条正文不是天文件里那条`);
    }
  }
  check('同一天两边都有时以天文件为准（推导不覆盖直接投递）', shadowed.length === 0, shadowed.slice(0, 3).join('；') || '一致');

  /* ------------------------------------- ④ /bellie.json 和分块接口对得上 */
  let chunkTotal = 0;
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
    };
  })()`);
  check('页面上真的渲染出今天这条（不是只在 JSON 里）', !!visible.found, JSON.stringify(visible));
  check('评语是卡片下面的小字斜体', visible.italic === 'italic' && visible.smaller === true, JSON.stringify({ italic: visible.italic, smaller: visible.smaller }));
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
