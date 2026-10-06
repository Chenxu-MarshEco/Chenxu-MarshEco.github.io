/*
 * 版块页的「分区版式」不许出现空白（2026-10-06）
 *
 * 用户原话：
 *   「因为花娅编年史有太多板块 大幅拉长 导致涣源溪记忆库和花娅远位面卡片下方出现大量空白
 *    不要出现任何这种现象 卡片的高度要么固定 要么根据最内含子页面最短的那个卡片缩放
 *    不要给我出现空白」
 *
 * 实测到的病因（改之前）：中、右两块跨两行，编年史那 11 条把行高顶到 680，
 * 左列第二块（只有 3 条、内容 190px）被拉成 396 → 底下空 150px；右块空 132px。
 * 一句话：**框比内容高多少，就空多少。**
 *
 * 所以这份脚本量两件事：
 *   ① 每一块框里**不留空**：框高 − （表头 + 清单实际高度）要在一个内边距以内（不是 150px 那种）；
 *   ② **A/B**：往最长那张清单里再塞 20 条假的，别的块的高度必须**一个像素都不动**
 *      —— 不这么做的话，"没空白"有可能只是因为这一页碰巧都差不多长。
 * 挑哪个页面来验是**扫 dist 现找**的（谁有 data-layout="region" 就验谁），不写死页面。
 *
 * 用法：node tools/checks/board-region-check.mjs [--shots]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const ROOT = path.join(SRC, 'dist');
const SHOTS = path.join(SRC, '.tmp', 'block-shots');
const WANT_SHOTS = process.argv.includes('--shots');
const PORT = 4402;
const DEBUG_PORT = 9370;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.mp3': 'audio/mpeg', '.xml': 'application/xml' };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* 谁用了分区版式？扫 dist 现找（不写死页面） */
const regionPages = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (['.prerender', '_astro', 'img', 'audio'].includes(e.name)) continue;
      walk(p);
    } else if (e.name.endsWith('.html')) {
      const html = fs.readFileSync(p, 'utf8');
      if (html.includes('data-layout="region"')) {
        regionPages.push('/' + path.relative(ROOT, p).split(path.sep).join('/').replace(/index\.html$/, ''));
      }
    }
  }
};
walk(ROOT);
info(`用了「分区版式」的页面：${regionPages.join(' ') || '（一个都没有）'}`);
check('★ 找到至少一个用分区版式的页面（找不到就没得验）', regionPages.length > 0);

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-region-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    return new CDP(ws);
  }
  send(m, p = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 120; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    await this.ev(`(() => { const s=document.createElement('style'); s.textContent='html{scroll-behavior:auto !important}'; document.head.appendChild(s); return true; })()`);
    await this.ev(`document.querySelector('.blocks[data-layout="region"]')?.scrollIntoView({block:'center'})`);
    await sleep(1000);
  }
  async shot(name) {
    if (!WANT_SHOTS) return;
    fs.mkdirSync(SHOTS, { recursive: true });
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(r.data, 'base64'));
    info(`拍好 ${name}`);
  }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl);
  } catch { /* 等 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

/** 量每一块：框高、表头高、清单区高、清单实际内容高 → 算出"框里空了多少" */
const MEASURE = `(() => {
  const g = document.querySelector('.blocks[data-layout="region"]');
  if (!g) return null;
  const rows = [...g.children].map((el, i) => {
    const r = el.getBoundingClientRect();
    const head = el.querySelector('.block__head');
    const sc = el.querySelector('.block__scroll');
    const list = el.querySelector('.block__list');
    const pad = sc ? parseFloat(getComputedStyle(sc).paddingTop) + parseFloat(getComputedStyle(sc).paddingBottom) : 0;
    const headH = head ? Math.round(head.getBoundingClientRect().height) : 0;
    const listH = list ? Math.round(list.getBoundingClientRect().height) : 0;
    /* 框里空着的那一截 = 框高 - 表头 - 清单区（清单区自己会尽量贴合内容） */
    const blank = Math.round(r.height - headH - (sc ? sc.getBoundingClientRect().height : 0));
    return {
      i: i + 1,
      name: (el.querySelector('.block__name') || {}).textContent || '',
      h: Math.round(r.height),
      headH,
      scrollH: sc ? Math.round(sc.getBoundingClientRect().height) : null,
      listH,
      pad: Math.round(pad),
      /* 清单区比内容高出来的那一截（去掉内边距）—— 这才是"框里空着"的量 */
      slack: sc && list ? Math.round(sc.clientHeight - listH - pad) : null,
      scrollOver: sc ? sc.scrollHeight - sc.clientHeight : null,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      kids: el.querySelectorAll('.block__list > li').length,
    };
  });
  const gr = g.getBoundingClientRect();
  /* 按"左边缘"分列，看每一列最下面那块的下沿 —— 齐平不齐平就看这个 */
  const cols = {};
  for (const el of g.children) {
    const r = el.getBoundingClientRect();
    const key = String(Math.round(r.left));
    cols[key] = Math.max(cols[key] ?? 0, Math.round(r.bottom));
  }
  return { gridH: Math.round(gr.height), rows, colBottoms: Object.values(cols), errors: 0 };
})()`;

for (const page of regionPages) {
  console.log(`\n================ ${page} ================`);
  await cdp.open(page);
  const m0 = await cdp.ev(MEASURE);
  if (!m0) { check(`${page}：量得到分区版式`, false); continue; }
  for (const r of m0.rows) {
    info(`  ${r.i}. ${r.name}｜框 ${r.h}｜表头 ${r.headH}｜清单区 ${r.scrollH ?? '-'}（内容 ${r.listH}）｜空着 ${r.slack ?? '-'}｜${r.kids} 条${r.scrollOver > 0 ? '（要滚）' : ''}`);
  }
  if (WANT_SHOTS) await cdp.shot(`region-${page.replace(/\W+/g, '_')}`);

  /*
    ① 框里不许留空。
    只对"清单装得下"的那些块要求：装得下还空出一大截 = 用户截图里那个毛病。
    （装不下的那些本来就在滚，slack 会是 0 或负数。）
  */
  const slackers = m0.rows.filter((r) => r.slack !== null && r.slack > 24);
  check(`★★ ${page}：每一块框里都不留空（清单区比内容高出不超过 24px）`,
    slackers.length === 0,
    slackers.length ? slackers.map((r) => `${r.name} 空 ${r.slack}px`).join(' | ') : m0.rows.filter((r) => r.slack !== null).map((r) => `${r.name} ${r.slack}px`).join(' / '));

  /*
    ①-2 **底边齐平**（用户第二次特意强调的硬要求）：
    每一列最下面那块的下沿必须在同一条线上（1px 容差）。
    量的是"列"，不是"每一块" —— 左列上面那块本来就在半腰（它下面还有一块）。
  */
  const flush = Math.max(...m0.colBottoms) - Math.min(...m0.colBottoms);
  check(`★★ ${page}：三列底边齐平（同一列最下面那块的下沿要对齐）`,
    flush <= 1, `各列下沿 ${m0.colBottoms.join(' / ')}（差 ${flush}px）`);

  /* ② 框不能比内容还矮（不许把内容裁掉） */
  const clipped = m0.rows.filter((r) => r.scrollH !== null && r.kids > 0 && r.scrollOver < 0);
  check(`★ ${page}：没有哪一块被裁掉内容（清单区不会比内容还小）`, clipped.length === 0,
    clipped.map((r) => r.name).join(' | '));

  /*
    ③ A/B：往最长的那张清单里再塞 20 条 —— 别的块一个像素都不许动。
    这正是用户报的那个因果（编年史太长 → 把别人拉长），所以必须真的演一遍。
  */
  const longest = m0.rows.reduce((a, b) => ((b.listH ?? 0) > (a.listH ?? 0) ? b : a), m0.rows[0]);
  const ab = await cdp.ev(`(() => {
    const g = document.querySelector('.blocks[data-layout="region"]');
    const el = [...g.children][${longest.i - 1}];
    const ul = el.querySelector('.block__list');
    const proto = ul.querySelector('li');
    for (let i = 0; i < 20; i++) {
      const li = proto.cloneNode(true);
      li.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
      const name = li.querySelector('.subcard__name, .subcard__title, a, span');
      if (name) name.textContent = '验收临时项 ' + (i + 1);
      ul.append(li);
    }
    return { kids: ul.querySelectorAll('li').length };
  })()`);
  await sleep(500);
  const m1 = await cdp.ev(MEASURE);
  info(`往「${longest.name}」塞到 ${ab.kids} 条之后的各块高度：${m1.rows.map((r) => `${r.name} ${r.h}`).join(' / ')}`);
  const moved = m1.rows.filter((r, idx) => idx !== longest.i - 1 && r.h !== m0.rows[idx].h);
  check(`★★ ${page}：给最长那张清单再塞 20 条，**别的块高度一个像素都不动**`,
    moved.length === 0,
    moved.length ? moved.map((r) => `${r.name} ${m0.rows[r.i - 1].h}→${r.h}`).join(' | ') : '没动');
  check(`★ ${page}：撑长的那一块自己改成"在里面滚"（不是把整页拉长）`,
    (m1.rows[longest.i - 1].scrollOver ?? 0) > (m0.rows[longest.i - 1].scrollOver ?? 0),
    `可滚 ${m0.rows[longest.i - 1].scrollOver} → ${m1.rows[longest.i - 1].scrollOver}`);
  check(`★ ${page}：整块栅格也没有被撑高`, m1.gridH <= m0.gridH + 2, `${m0.gridH} → ${m1.gridH}`);
  const flush1 = Math.max(...m1.colBottoms) - Math.min(...m1.colBottoms);
  check(`★★ ${page}：塞了 20 条之后**底边照样齐平**`, flush1 <= 1,
    `各列下沿 ${m1.colBottoms.join(' / ')}（差 ${flush1}px）`);
  check(`★ ${page}：塞了 20 条之后框里还是不留空`,
    m1.rows.every((r) => r.slack === null || r.slack <= 24),
    m1.rows.filter((r) => r.slack !== null).map((r) => `${r.name} ${r.slack}px`).join(' / '));

  check(`★ ${page} 这一趟没有 JS 报错`, cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));
}

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
