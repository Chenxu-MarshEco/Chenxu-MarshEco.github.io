/*
 * 检查：/bellie/ 与 /salon/ 滚页面时，左边那条常驻时间轴跟不跟得上
 *        （含「翻过首屏那一簇之后」的情况）+ 分块里的成员名有没有名片 + 评语里还有没有 QQ 号
 *
 * 为什么单开一条（2026-11-21 站长报的）：
 *   「在翻动群圣经时群圣经对应的时间轴完全不会跟着运动」
 *   「往上滚群圣经滚到10月 刻度也依然停留在2026-11-19」
 *   「有些点评里的成员人名移上去根本没有成员卡」
 *   —— 三件事都出在"只认首屏那一簇"上，所以这条检查必须**翻过首屏**再读数，
 *   只在落地位置滚两下是量不出来的（原来那条 salon-timeline-sync.mjs 就是这么漏掉的）。
 *
 * 用法：node tools/checks/bellie-timeline-sync.mjs [dist 目录]
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const ROOT = path.resolve(process.argv[2] ?? 'dist');
const PORT = 4391;
const DEBUG_PORT = 9362;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.gif': 'image/gif',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const ymd = (s) => (String(s || '').match(/\d{4}-\d{2}-\d{2}/) || [''])[0];

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-bts-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' }
);

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
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
}

/** 在正文那一栏里发一次真的滚轮事件（比 window.scrollBy 更接近用户的手） */
const pageWheel = async (cdp, dy) => {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 720, y: 450, deltaX: 0, deltaY: dy, modifiers: 0, pointerType: 'mouse' });
  await sleep(320);
};

/* 读数：轴上的"当前日期" + 视口中心那条的日期 + 装载了多少条 */
const SNAP = `(() => {
  const now = document.querySelector('[data-tl-nowdate]');
  const root = document.querySelector('[data-tl]');
  const ruler = document.querySelector('[data-tl-ruler]');
  const items = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden);
  /* 和组件同一个判据：**中线离视口中线最近**的那一条（不是"第一个挨着中线带子的"，
     卡片比那条带子高得多，随便挑第一个会差一天） */
  const mid = items
    .map((el) => { const r = el.getBoundingClientRect(); return { el, d: Math.abs(r.top + r.height / 2 - innerHeight / 2) }; })
    .sort((a, b) => a.d - b.d)[0]?.el;
  const boxes = [...document.querySelectorAll('.salon__chunk')];
  const last = boxes.length ? String(boxes[boxes.length - 1].dataset.chunk) : '';
  return {
    y: Math.round(scrollY),
    now: now ? now.textContent.trim() : null,
    cur: root ? root.dataset.tlCur : null,
    ruler: ruler ? (ruler.getAttribute('d') || '').length : 0,
    mid: mid ? ((mid.querySelector('.salon__time') || {}).textContent || '').trim() : null,
    n: items.length,
    chunks: boxes.map((b) => b.dataset.chunk).join(','),
    last,
  };
})()`;

try {
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {}
  }
  if (!target) throw new Error('没等到 Chrome 的调试端口');
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  for (const page of ['/bellie/', '/salon/']) {
    cdp.errors.length = 0;
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${page}?sync=1` });
    for (let i = 0; i < 120; i++) {
      await sleep(150);
      if ((await cdp.ev('document.readyState')) === 'complete') break;
    }
    await sleep(2200);
    const label = page.replace(/\//g, '');

    const start = await cdp.ev(SNAP);
    /* 一路往上翻，每屏读一次（这一段就是要"翻过首屏那一簇"） */
    const trace = [start];
    for (let k = 0; k < 18; k++) {
      await cdp.ev(`window.scrollBy({ top: -Math.round(innerHeight * 0.85), behavior: 'instant' }); 1`);
      await sleep(650);
      trace.push(await cdp.ev(SNAP));
    }
    const dates = trace.map((t) => ymd(t.now));
    const uniq = [...new Set(dates)];
    const end = trace[trace.length - 1];
    const curs = [...new Set(trace.map((t) => t.cur))];
    /* 每一屏都对一遍：轴上的日期不许和视口中心那条差天（构建机与访问者差一天时就会差） */
    const offBy = trace.filter((t) => t.mid && ymd(t.now) && ymd(t.now) !== ymd(t.mid));

    console.log(
      `\n--- ${page}\n` +
        trace.map((t) => `  y=${String(t.y).padStart(6)} 轴=${t.now} 中间=${t.mid} 条=${t.n} 簇=[${t.chunks}]`).join('\n')
    );

    check(`[${label}] 往上翻时轴上的日期一直在变（不是冻在落地那一刻）`, uniq.length >= 4, `变过 ${uniq.length} 个日期：${uniq.join(' → ')}`);
    check(`[${label}] 上翻到最后，轴的日期跟着退到了更早那天`, ymd(end.now) && ymd(end.now) < ymd(start.now), `落地 ${start.now} → 上翻到底 ${end.now}`);
    check(`[${label}] 轴的日期和视口中心那条对得上`, ymd(end.now) === ymd(end.mid), `轴 ${end.now} / 列表 ${end.mid}`);
    check(
      `[${label}] 每一屏都对得上（轴上读出的日期一天都不差）`,
      offBy.length === 0,
      offBy.length ? offBy.map((t) => `y=${t.y} 轴${ymd(t.now)}≠列表${ymd(t.mid)}`).join('、') : '全部一致'
    );
    check(`[${label}] 弧顶那个位置参数一直在变（轴真的在挪，不是只换了行字）`, curs.length >= 4, `变过 ${curs.length} 个位置：${curs.slice(0, 6).join(' → ')}${curs.length > 6 ? ' …' : ''}`);
    check(`[${label}] 轴上的刻度尺跟着重画了`, end.ruler > 0 && trace.some((t) => t.ruler !== start.ruler), `${start.ruler} → ${end.ruler} 字节的 path`);
    check(`[${label}] 这一趟真的翻过了首屏那一簇`, end.chunks !== start.chunks || end.n > start.n, `条数 ${start.n} → ${end.n}，簇 [${start.chunks}] → [${end.chunks}]`);

    /* 点轴上的塔吊 → 跳到离它最近的那条（顺带验回跳方向也通） */
    const jumped = await cdp.ev(`(async () => {
      const before = scrollY;
      const item = document.querySelector('.tl [data-tl-item]');
      if (!item) return { ok: false, why: '轴上没有塔吊' };
      item.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 1600));
      return { ok: true, before, after: scrollY, hash: location.hash };
    })()`);
    check(`[${label}] 点时间轴上的塔吊会跳到那一条（页面真的滚了）`, jumped.ok && jumped.after !== jumped.before, JSON.stringify(jumped));

    /* 分块里的成员名有没有名片 */    const mem = await cdp.ev(`(() => {
      const chunks = [...document.querySelectorAll('.salon__chunk')];
      const dyn = chunks.filter((b) => b.dataset.chunk !== String(document.querySelector('[data-salon]')?.dataset.chunkLast));
      const inDyn = dyn.reduce((n, b) => n + b.querySelectorAll('.mem').length, 0);
      const anyBox = dyn.find((b) => b.querySelector('.mem'));
      let card = 0;
      if (anyBox) {
        const el = anyBox.querySelector('.mem');
        el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }));
        const layer = document.querySelector('.memlayer');
        card = layer ? layer.querySelectorAll('.mem__card').length : 0;
        el.dispatchEvent(new PointerEvent('pointerout', { bubbles: true }));
      }
      const total = document.querySelectorAll('.salon__list .mem').length;
      return { total, inDyn, card, chunks: chunks.length, dynChunks: dyn.length };
    })()`);
    check(`[${label}] 上翻才装载进来的那些条目里，成员名也有名片标记`, mem.dynChunks > 0 && mem.inDyn > 0, JSON.stringify(mem));
    check(`[${label}] 把鼠标移到那种名字上，名片浮层真的出来了`, mem.card > 0, `浮层里的名片数 ${mem.card}`);

    /* 评语 / 正文里还有没有没换掉的 QQ 号（9~10 位数字） */
    const qq = await cdp.ev(`(() => {
      const texts = [...document.querySelectorAll('.salon__list .salon__comment, .salon__list .salon__text')].map((el) => el.textContent || '');
      const hits = texts.flatMap((t) => t.match(/\\d{6,12}/g) || []);
      return { hits: [...new Set(hits)].slice(0, 8), n: hits.length };
    })()`);
    check(`[${label}] 评语 / 正文里没有剩下的 QQ 号`, qq.n === 0, `还剩 ${qq.n} 个：${qq.hits.join(' ')}`);

    /* 搜索 / 成员筛选：只能在自己那份索引上算（圣经页曾经拿精华的 /salon.json 去筛，
       一个 id 都对不上 —— 一搜就把整页搜空） */
    const idxName = page === '/bellie/' ? 'bellie' : 'salon';
    const kw = await cdp.ev(`(async () => {
      try {
        const r = await fetch('/${idxName}.json');
        const j = await r.json();
        const rows = j.entries || j.essences || [];
        for (const e of rows) {
          const t = String(e.comment || e.text || '').replace(/[^\\u4e00-\\u9fa5]/g, '');
          if (t.length >= 6) return t.slice(0, 6);
        }
        return '';
      } catch { return ''; }
    })()`);
    const found = await cdp.ev(`(async () => {
      const q = document.getElementById('salon-q');
      if (!q) return { ok: false, why: '没有搜索框' };
      q.value = ${JSON.stringify('')};
      q.value = ${JSON.stringify(kw)};
      q.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 1800));
      const hit = (document.getElementById('salon-hit') || {}).textContent || '';
      const visible = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden).length;
      const n = Number((hit.match(/命中\\s*(\\d+)/) || [])[1] || 0);
      return { ok: true, kw: q.value, hit: hit.trim(), n, visible };
    })()`);
    check(
      `[${label}] 搜索能搜到自己那些条目（不是一搜就空）`,
      !!kw && found.ok && found.n > 0 && found.visible > 0,
      `关键词「${kw}」→ ${found.hit}，可见 ${found.visible} 条`
    );

    /* 点亮一个成员 → 只剩他的条目；再点一下 → 恢复 */
    const filt = await cdp.ev(`(async () => {
      const card = document.querySelector('.salon__memCard[data-mem]');
      if (!card) return { ok: false, why: '没有成员卡' };
      const id = card.dataset.mem;
      const q = document.getElementById('salon-q');
      if (q && q.value) { q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); await new Promise((r) => setTimeout(r, 900)); }
      const before = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden).length;
      card.click();
      await new Promise((r) => setTimeout(r, 900));
      const shown = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden);
      const wrong = shown.filter((el) => !(el.dataset.members || '').split(' ').includes(id)).length;
      card.click();
      await new Promise((r) => setTimeout(r, 900));
      const after = [...document.querySelectorAll('.salon__list .salon__item')].filter((el) => !el.hidden).length;
      return { ok: true, id, before, shown: shown.length, wrong, after };
    })()`);
    check(
      `[${label}] 点成员卡只看这个人的条目、再点一下恢复`,
      filt.ok && filt.shown > 0 && filt.wrong === 0 && filt.after === filt.before,
      JSON.stringify(filt)
    );

    /*
      手动滚一下轴（指针放在左边那条轴里）、再滚页面：
      轴必须被"接回来"按页面重新算 —— 站长 2026-11-21：「一旦鼠标手动滚动了时间轴
      或是点击了时间轴上的点进行跳转后 继续滚动圣经页 时间轴又不会跟着动了」。
    */
    const axisBox = await cdp.ev(`(() => {
      const b = document.querySelector('[data-tl-body]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    })()`);
    for (let i = 0; i < 4; i += 1) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: axisBox.x, y: axisBox.y, deltaX: 0, deltaY: -320, modifiers: 0, pointerType: 'mouse',
      });
      await sleep(90);
    }
    const afterAxis = await cdp.ev(SNAP);
    const afterAxisTrace = [];
    for (let k = 0; k < 3; k += 1) {
      /* 往下滚（前面几次跳转可能已经把我们带到列表最顶上，那儿再往上滚是不动的，
         页面不动就不会有 scroll 事件 —— 那样测的就不是"接回来"了） */
      await pageWheel(cdp, +520);
      await sleep(500);
      afterAxisTrace.push(await cdp.ev(SNAP));
    }
    const axisBackOff = afterAxisTrace.filter((t) => t.mid && ymd(t.now) && ymd(t.now) !== ymd(t.mid));
    check(
      `[${label}] 手动滚过轴之后，再滚页面轴会被接回来（不是一直冻在手动滚到的位置）`,
      afterAxisTrace.length === 3 && axisBackOff.length === 0,
      `手动滚到 ${afterAxis.now} → ` +
        (axisBackOff.length ? axisBackOff.map((t) => `轴${ymd(t.now)}≠列表${ymd(t.mid)}`).join('、') : afterAxisTrace.map((t) => t.now).join(' → ')) +
        ``
    );

    /*
      点轴上的塔吊跳一次，然后再往上 / 往下滚：每屏都要对得上
      （整簇被换掉的时候名单会整个过期，正是这里出过"轴从此不动"的毛病）。
    */
    await cdp.ev(`(() => {
      const list = [...document.querySelectorAll('.tl [data-tl-item]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return el.style.visibility !== 'hidden' && r.top > 120 && r.top < innerHeight - 120;
      });
      const it = list[Math.floor(list.length / 2)];
      if (it) it.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return !!it;
    })()`);
    await sleep(2200);
    const jumpTrace = [];
    for (const dy of [+450, +450, -450, -450, +450]) {
      await pageWheel(cdp, dy);
      await sleep(500);
      jumpTrace.push(await cdp.ev(SNAP));
    }
    const jumpOff = jumpTrace.filter((t) => t.mid && ymd(t.now) && ymd(t.now) !== ymd(t.mid));
    check(
      `[${label}] 点轴跳转之后再上上下下滚，轴每一屏都还跟得上`,
      jumpOff.length === 0,
      jumpOff.length ? jumpOff.map((t) => `轴${ymd(t.now)}≠列表${ymd(t.mid)}`).join('、') : jumpTrace.map((t) => t.now).join(' → ') +
        ``
    );

    check(`[${label}] 这一趟没有 JS 报错`, cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
  }
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
