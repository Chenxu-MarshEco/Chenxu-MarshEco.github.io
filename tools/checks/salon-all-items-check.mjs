/*
 * 「冰室精华一条都不能丢」的验收（真浏览器量，副本不动工作区）。
 *
 * 用户的原话：完美对话 / AI 创作都要在；完美对话那条下面写着所有发言人的名字，
 * 这类精华**属于多个成员**（例：2023-07-19 的那场完美对话有两个人），
 * 显示的时候要把这些成员的名字和头像都列出来 —— 时间、对话图片也要在。
 *
 * 量这些：
 *   ① /salon/ 一共 784 条；按 kind 数：文字 732 / 完美对话 45 / AI 创作 7
 *   ② 每条都有头像位；11 条多成员的，头像个数 = 成员个数、名字用「、」连起来
 *   ③ 头像叠着排（量相邻两个头像的 rect，第二个比第一个往左压 8px）
 *   ④ 16 条没有解析出成员的完美对话 → 显示「冰室群成员」占位；16 条挂「OCR 转录」标签
 *   ⑤ 时间轴：常驻、**450 个日期点**全部带锚点；点一个日期真的跳到那天的精华
 *   ⑥ 搜索：搜新加入的成员「艾林森」命中他那条；搜完美对话正文里的词也命中
 *   ⑦ 首页「每日精华」：跑 24 个不同日期，抽到多成员那条时，卡片要显示**所有**成员的名字和头像
 *   ⑧ 数据层核对：dist/salon.json 的 784 条里，多成员/无成员/图片数都对得上
 *   ⑨ 页头只有标题：原来那行「共 N 条 · 成员 N 人 · 截至 …　由群精华导出文件整理：…」
 *      用户说不需要，整段删掉 —— 这里按**构建出来的 HTML**量（不是靠 CSS 藏起来）
 *
 * 用法：node tools/checks/salon-all-items-check.mjs [<dist目录>]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const ROOT = path.resolve(process.argv[2] ?? path.join(SRC, 'dist'));
const PORT = 4393;
const DEBUG_PORT = 9363;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

const data = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'salon.json'), 'utf8'));
const byId = new Map(data.members.map((m) => [m.id, m.name]));
const total = data.essences.length;
const kinds = data.essences.reduce((a, e) => ((a[e.kind || 'text'] = (a[e.kind || 'text'] || 0) + 1), a), {});
const multiData = data.essences.filter((e) => (e.memberIds ?? []).length > 1);
const noneData = data.essences.filter((e) => !(e.memberIds ?? []).length);
const imgTotal = data.essences.reduce((a, e) => a + e.images.length, 0);
console.log(`盘上数据：${total} 条（文字 ${kinds.text} / 完美对话 ${kinds.perfect} / AI 创作 ${kinds.ai}）｜多成员 ${multiData.length} 条｜无成员 ${noneData.length} 条｜成员 ${data.members.length} 人｜图片 ${imgTotal} 张`);

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-all-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader', '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '));
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('ws')), { once: true }); });
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
  async goto(p, wait = 1600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

  /* ---------- ⑧ 数据层 ---------- */
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'salon.json'), 'utf8'));
  check(`dist/salon.json：${total} 条、${data.members.length} 位成员`,
    j.count === total && j.members === data.members.length && j.essences.length === total,
    `count=${j.count} members=${j.members} essences=${j.essences.length}`);
  const jMulti = j.essences.filter((e) => (e.members ?? []).length > 1);
  check(`dist/salon.json：多成员 ${multiData.length} 条都在，名字也拼好了`,
    jMulti.length === multiData.length && jMulti.every((e) => e.member === e.members.map((m) => m.name).join('、')),
    jMulti.slice(0, 3).map((e) => `${e.id} ${e.member}`).join(' | '));
  const jNone = j.essences.filter((e) => !(e.members ?? []).length);
  check(`dist/salon.json：${noneData.length} 条"没解析出成员"的完美对话也在（成员为空数组，不是被删了）`,
    jNone.length === noneData.length, `${jNone.length} 条：${jNone.slice(0, 4).map((e) => e.id).join(' ')}`);

  /* ---------- ①②③④ /salon/ 页面 ---------- */
  await cdp.goto('/salon/', 2600);
  const page = await cdp.ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const kind = (k) => items.filter((i) => i.dataset.kind === k).length;
    const facesOf = (i) => i.querySelectorAll('.salon__face').length;
    const multi = items.filter((i) => facesOf(i) > 1);
    const none = items.filter((i) => i.querySelector('.salon__name').innerText === '冰室群成员');
    const sample = items.map((i) => ({ id: i.id, kind: i.dataset.kind, faces: facesOf(i), name: i.querySelector('.salon__name').innerText }));
    const noFace = items.filter((i) => facesOf(i) === 0).length;
    return {
      items: items.length, text: kind('text'), perfect: kind('perfect'), ai: kind('ai'),
      multi: multi.length, noneNames: none.length, noFace,
      facesTotal: items.reduce((a, i) => a + facesOf(i), 0),
      badges: document.querySelectorAll('.salon__badge').length,
      dates: document.querySelectorAll('.salon__date').length,
      eras: document.querySelectorAll('.salon__era').length,
      time: document.querySelectorAll('.salon__time').length,
      pics: document.querySelectorAll('.salon__pic').length,
      sample, multiSample: multi.slice(0, 4).map((i) => i.id),
      allMultiNames: multi.map((i) => i.id + ' ' + i.querySelector('.salon__name').innerText),
      h1: document.querySelector('.salon__head h1')?.textContent.trim() || '',
      headParas: document.querySelectorAll('.salon__head p, .salon__meta, .salon__note').length,
      headText: (document.querySelector('.salon__head')?.textContent || '').replace(/\s+/g, ' ').trim(),
    };
  })()`);
  /*
    ⑨ 页头：用户原话「把标题下方那行『共 784 条 · 成员 18 人 · 截至 2026-09-21
      由群精华导出文件整理…』删掉 不需要」——所以标题下面**一个 <p> 都不该有**。
      按构建出来的 HTML 量，防止只是被 CSS 藏起来（藏起来还是会被搜到/被读屏念到）。
  */
  const headHtml = (() => {
    const f = path.join(ROOT, 'salon', 'index.html');
    if (!fs.existsSync(f)) return null;
    const m = fs.readFileSync(f, 'utf8').match(/<header class="salon__head"[\s\S]*?<\/header>/);
    return m ? m[0].replace(/\s+/g, ' ') : null;
  })();
  check('/salon/ 页头 HTML：.salon__head 里只剩一个标题 <h1>，那行统计/说明整段删了',
    !!headHtml && /<h1 class="salon__title"/.test(headHtml) && !/<p[\s>]/.test(headHtml)
      && !/截至/.test(headHtml) && !/三类都在/.test(headHtml),
    headHtml ? headHtml.slice(0, 150) : '没找到 <header class="salon__head">');
  check('页头那段文字在渲染后的 DOM 里也一个都不剩（.salon__meta / .salon__note / 页头里的 <p>）',
    page.headParas === 0 && !/截至|三类都在|一条没丢/.test(page.headText),
    `页头里剩 ${page.headParas} 个元素；文字「${page.headText}」`);
  check(`标题还是数据里那个「${data.title}」（只删了下面那行，标题没动）`,
    page.h1 === data.title, `页面上量到「${page.h1}」`);
  check(`/salon/ 页面：${total} 条一条不少（HTML 里数得出来）`, page.items === total, `salon__item = ${page.items}`);
  check(`/salon/ 页面：文字 ${kinds.text} / 完美对话 ${kinds.perfect} / AI 创作 ${kinds.ai} 三类都在`,
    page.text === kinds.text && page.perfect === kinds.perfect && page.ai === kinds.ai,
    JSON.stringify({ text: page.text, perfect: page.perfect, ai: page.ai }));
  check(`/salon/ 页面：${multiData.length} 条多成员精华，每条的成员名和头像位都对`,
    page.multi === multiData.length && page.facesTotal === total + multiData.reduce((a, e) => a + e.memberIds.length - 1, 0),
    `多成员条 ${page.multi}；头像位合计 ${page.facesTotal}（= ${total} 条 + 多出来的 ${page.facesTotal - total} 个头像）`);
  check('多成员的名字是「、」连起来的（名字不写死：数据里怎么改这儿都跟着）',
    page.allMultiNames.every((s) => /、/.test(s)), page.allMultiNames.slice(0, 5).join(' | '));
  check(`每条都有头像位（没传头像的用首字占位圆）`, page.noFace === 0, `没头像位的 ${page.noFace} 条；占位圆 ${page.noneNames} 条写「冰室群成员」`);
  check(`16 条 OCR 转录的完美对话挂了「OCR 转录」标签`, page.badges === 16, `badge = ${page.badges}`);
  check('日期小标题 + 5 个年代大标题 + 每条都有时间', page.dates > 400 && page.eras === 5 && page.time === total,
    JSON.stringify({ dates: page.dates, eras: page.eras, time: page.time, pics: page.pics }));
  /* 编辑器保存时**不重排**（照客户端给的顺序写回），排序靠站点渲染时排 —— 所以这里量页面 */
  const order = await cdp.ev(`(() => {
    const seq = [...document.querySelectorAll('.salon__item')].map((i) => i.querySelector('.salon__time').getAttribute('datetime'));
    let bad = 0, first = '';
    for (let i = 1; i < seq.length; i++) if (seq[i - 1] > seq[i]) { bad++; if (!first) first = seq[i - 1] + ' > ' + seq[i]; }
    return { n: seq.length, bad, first, head: seq[0], tail: seq[seq.length - 1] };
  })()`);
  check('页面上的条目是按时间正序排的（编辑器保存不重排，排序由站点这套渲染负责）',
    order.bad === 0 && order.n === total, JSON.stringify(order));

  /* ③ 头像叠排：量 2023-07-19 那条（两名成员）的头像 rect
        ⚠ 名字从数据里现查，不写死：成员名随时可能在编辑器里被改
        （实测踩过：用户把「花花」改名成「隰辰煦」，写死名字的断言就凭空失败）。 */
  const pairIds = (data.essences.find((e) => e.id === 'e0022') || {}).memberIds ?? [];
  const pairNames = pairIds.map((id) => byId.get(id)).filter(Boolean);
  const pairText = pairNames.join('、');
  const stack = await cdp.ev(`(() => {
    const it = document.getElementById('e0022');
    if (!it) return null;
    const faces = [...it.querySelectorAll('.salon__face')];
    const avs = faces.map((f) => f.querySelector('.salon__avatar'));
    const r = avs.map((a) => { const b = a.getBoundingClientRect(); return { x: +b.left.toFixed(1), y: +b.top.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), txt: a.textContent.trim(), title: a.parentElement.title }; });
    return { n: faces.length, r, name: it.querySelector('.salon__name').innerText, time: it.querySelector('.salon__time').textContent, imgs: it.querySelectorAll('.salon__pic img').length, kind: it.dataset.kind, members: it.dataset.members };
  })()`);
  check(`2023-07-19 那条完美对话：两个成员（${pairNames.join(' + ')}）、名字 + 时间 + 对话图都在`,
    stack && stack.n === 2 && stack.name === pairText && /2023-07-19/.test(stack.time) && stack.imgs >= 1 && stack.kind === 'perfect',
    JSON.stringify(stack && { n: stack.n, name: stack.name, time: stack.time, imgs: stack.imgs, kind: stack.kind }));
  check('两个头像叠着排（第二个比第一个往左压，量到重叠像素）',
    stack && stack.r[1].x < stack.r[0].x + stack.r[0].w && stack.r[1].x > stack.r[0].x && stack.r[0].y === stack.r[1].y && stack.r[0].w === 28,
    stack ? `${JSON.stringify(stack.r[0])} → ${JSON.stringify(stack.r[1])}（重叠 ${(stack.r[0].x + stack.r[0].w - stack.r[1].x).toFixed(1)}px）` : '');

  /* ⑤ 时间轴：编辑器里选的那条，**原样**渲染；点刻度跳到最近的一条精华 */
  const tlSrc = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'timelines.json'), 'utf8')).timelines.find((t) => t.id === data.timelineId);
  check('salon.json 里选了一条真实存在的时间轴',
    !!tlSrc, `timelineId=${JSON.stringify(data.timelineId)} → ${tlSrc ? `${tlSrc.title}（${tlSrc.points.length} 点 / ${tlSrc.spans.length} 段）` : '找不到'}`);

  /*
    这一页现在默认落在**最新**那条（进页面就滚到最下面），轴的窗口也跟着停在最末一段、
    刻度都贴着面板边缘 —— 挑不到"当前就能点"的那个点。干脆**带一个中段的 hash 重新进页面**（落到 #e0400），轴自然停在中段。
  */
  await cdp.goto('/salon/#e0400', 2600);

  const tl = await cdp.ev(`(() => {
    const t = document.querySelector('.tl');
    const pts = [...document.querySelectorAll('.tl__item')];
    const ids = pts.map((p) => p.dataset.point);
    const params = pts.map((p) => Number(p.dataset.param));
    const bands = document.querySelectorAll('.tl__band, .tl__span');
    const body = document.querySelector('[data-tl-body]');
    /* 挑一个当前就能真点到的点（用滚轮把它滚进面板，别用 scrollIntoView） */
    let pick = null;
    for (const it of pts) {
      for (let i = 0; i < 8; i++) {
        const b = body.getBoundingClientRect(); const r = it.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy > b.top + 40 && cy < b.bottom - 40) break;
        body.dispatchEvent(new WheelEvent('wheel', { deltaY: cy - (b.top + b.height / 2), bubbles: true, cancelable: true }));
      }
      /*
        ⚠ 可点的是刻度里的**塔吊 / 名字**（.tl__crane / .tl__name），
        不是外面那个 .tl__item —— 那是个 0 尺寸的定位壳，量它永远 0×0。
        名字现在也不一定是 <a>（2026-09-22 起名字里面包的是名片链接），所以按类找。
      */
      const a = it.querySelector('.tl__crane') || it.querySelector('.tl__name') || it;
      const b = body.getBoundingClientRect(); const ar = a.getBoundingClientRect();
      const x = ar.left + ar.width / 2, y = ar.top + ar.height / 2;
      if (!(ar.width > 2 && ar.height > 2 && x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2)) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && (hit === a || a.contains(hit) || (hit.closest && hit.closest('.tl__item') === it)) && y > b.top + 8 && y < b.bottom - 8) {
        pick = { id: it.dataset.point, label: it.dataset.label, param: Number(it.dataset.param), href: it.dataset.href, x, y };
        break;
      }
    }
    return { pinned: t.classList.contains('is-pinned'), pinnedAttr: t.dataset.tlPinned === '1',
      hasClose: !!document.querySelector('.tl__close, [data-tl-close]'), hasTab: !!document.querySelector('.tl__tab, [data-tl-tab]'),
      tlId: t.dataset.tlId, points: pts.length, ids, params, bands: bands.length,
      scale: t.dataset.tlScale, min: t.dataset.tlMin, max: t.dataset.tlMax, pick };
  })()`);
  check(`时间轴：放的是所选那条「${tlSrc?.title}」**原样**的 ${tlSrc?.points.length} 个点（一个不多一个不少）`,
    tl.tlId === data.timelineId && tl.points === tlSrc.points.length &&
      tlSrc.points.every((p) => tl.ids.includes(p.id)),
    JSON.stringify({ tlId: tl.tlId, 点上轴: tl.points, 那条轴的点: tlSrc?.points.length, scale: tl.scale }));
  check('时间轴：点/段都是那条轴自己的（没有我按精华日期造的点）',
    tl.ids.every((id) => id.startsWith(data.timelineId)) &&
      tl.bands >= tlSrc.spans.length && tl.bands <= tlSrc.spans.length * 2,
    `点 id 前缀都对=${tl.ids.every((id) => id.startsWith(data.timelineId))}；段带子 ${tl.bands} 条（那条轴 ${tlSrc.spans.length} 段，两侧都挂的段会有两条带子）`);
  check('时间轴：常驻、关不掉（没有关闭按钮也没有折叠标签）',
    tl.pinned === true && tl.pinnedAttr === true && tl.hasClose === false && tl.hasTab === false,
    JSON.stringify({ pinned: tl.pinned, attr: tl.pinnedAttr, close: tl.hasClose, tab: tl.hasTab }));
  check('时间轴：比例尺也用那条轴自己的设置（不再是我写死的 tickDays 2）',
    tl.scale !== '0.05' && String(tl.scale).length > 0,
    `data-tl-scale=${tl.scale}（这条轴数据里 tickDays=${String(tlSrc?.tickDays)}，没写就是默认档）`);

  check(`时间轴：找得到一个当前就能点的刻度（${tl.pick?.label}）`, !!tl.pick, JSON.stringify(tl.pick));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: tl.pick.x, y: tl.pick.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: tl.pick.x, y: tl.pick.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tl.pick.x, y: tl.pick.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1600);
  const jump = await cdp.ev(`(() => {
    const el = document.querySelector('.salon__item--hit') || (location.hash ? document.querySelector(location.hash) : null);
    if (!el) return { hit: false, hash: location.hash };
    const r = el.getBoundingClientRect();
    /* 落点这条的 param 和刚点那个刻度的 param 差多少 */
    const want = ${JSON.stringify(tl.pick.param)};
    const got = Number(el.dataset.tlParam);
    let nearest = null, bestD = Infinity;
    for (const it of document.querySelectorAll('.salon__item')) {
      const v = Number(it.dataset.tlParam);
      if (!Number.isFinite(v)) continue;
      const d = Math.abs(v - want);
      if (d < bestD) { bestD = d; nearest = it; }
    }
    return { hit: true, id: el.id, date: (el.querySelector('.salon__time') || {}).textContent, want, got,
      isNearest: nearest ? nearest.id === el.id : false, top: Math.round(r.top), inView: r.top > -60 && r.top < innerHeight,
      hash: location.hash };
  })()`);
  check('时间轴：点一下刻度 → 跳到**离那个刻度最近**的那条精华（不是跳到别的页，也没乱跳）',
    jump.hit === true && jump.isNearest === true && jump.inView === true && jump.hash === `#${jump.id}`,
    JSON.stringify(jump));

  /* ⑥ 搜索 */
  const search = await cdp.ev(`(async () => {
    const q = document.querySelector('#salon-q');
    const hit = document.querySelector('#salon-hit');
    const set = (v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(q, v); q.dispatchEvent(new Event('input', { bubbles: true })); };
    const out = {};
    set('艾林森'); await new Promise((r) => setTimeout(r, 500)); out.a = hit.textContent;
    set('剪下指甲'); await new Promise((r) => setTimeout(r, 500)); out.b = hit.textContent;
    set('花娅地的彩虹蟑螂'); await new Promise((r) => setTimeout(r, 600)); out.c = hit.textContent;
    set('冰室群成员'); await new Promise((r) => setTimeout(r, 500)); out.d = hit.textContent;
    set(''); await new Promise((r) => setTimeout(r, 500)); out.back = hit.textContent;
    return out; })()`);
  const aiRows = (data.essences.filter((e) => (e.memberIds ?? []).includes(data.members.find((m) => m.name === '艾林森').id))).length;
  check(`搜索：搜新成员「艾林森」命中 ${aiRows} 条（他的完美对话能搜到）`, search.a === `命中 ${aiRows} / ${total} 条`, search.a);
  check('搜索：搜完美对话正文里的词也能命中', /^命中 [1-9]\d* \/ \d+ 条$/.test(search.b), search.b);
  check('搜索：搜 AI 创作正文里的词也能命中', /^命中 [1-9]\d* \/ \d+ 条$/.test(search.c), search.c);
  check(`搜索：搜「冰室群成员」命中 ${noneData.length} 条（那 16 条没解析出成员的）`, search.d === `命中 ${noneData.length} / ${total} 条`, search.d);
  check(`搜索：清空回到 ${total} 条`, search.back === '', JSON.stringify(search.back));

  /* ⑦ 首页每日精华：多成员也要全列出来
     挑法用的是站点自己那份哈希（直接 import src/utils/daily.ts，Node 24 能剥掉类型），
     所以先**算**出哪一天会抽到多成员那条，再用那一天去量 —— 不靠碰运气。 */
  const { dailyIndex, localDateKey } = await import(pathToFileURL(path.join(SRC, 'src', 'utils', 'daily.ts')).href);
  const multiIdx = new Set(multiData.map((e) => data.essences.indexOf(e)));
  let multiDate = '';
  const probeDates = [];
  /* 400 天足够扫到多成员那条（实测 400 天里有 7 天会抽到）；顺便留 10 天做逐条对账 */
  for (let d = 0; d < 400; d++) {
    const dt = new Date();
    dt.setDate(dt.getDate() + d);
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    const idx = dailyIndex(key, total);
    if (multiIdx.has(idx)) {
      if (!multiDate) multiDate = key;
      continue;
    }
    if (probeDates.length < 10) probeDates.push(key);
  }
  console.log(`哈希算出：${multiDate || '（400 天内没有）'} 这天会抽到多成员那条；另外取 ${probeDates.length} 天做逐条对账`);

  const readCard = async (key) => {
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const R = Date; const fixed = new R(${JSON.stringify(key + 'T12:00:00')}).getTime();
        class F extends R { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } }
        window.Date = F; })();`,
    });
    await cdp.goto('/', 1200);
    const card = await cdp.ev(`(() => { const n = document.querySelector('.daily__name'); const faces = [...document.querySelectorAll('.daily__face')];
      return { asked: ${JSON.stringify(key)}, built: (document.querySelector('[data-daily]') || {}).dataset?.built, name: n && n.innerText, faces: faces.length,
        names: faces.map((f) => f.getAttribute('title')), time: (document.querySelector('.daily__time') || {}).textContent, hasText: !!document.querySelector('.daily__text') }; })()`);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    return card;
  };

  const multiCard = multiDate ? await readCard(multiDate) : null;
  const wantMulti = multiDate ? data.essences[dailyIndex(multiDate, total)] : null;
  const wantNames = wantMulti ? wantMulti.memberIds.map((id) => byId.get(id)) : [];
  check(`首页每日精华：${multiDate} 那天抽到多成员那条（${wantNames.join('、')}），卡片把**所有**成员的名字和头像都列出来了`,
    !!multiCard && multiCard.name === wantNames.join('、') && multiCard.faces === wantNames.length && multiCard.names.join('|') === wantNames.join('|') && multiCard.built !== multiDate,
    JSON.stringify(multiCard));

  const probes = [];
  for (const key of probeDates) probes.push(await readCard(key));
  const jByTime = new Map(j.essences.map((e) => [`${e.date} ${e.time}`.trim(), e]));
  const bad = probes.filter((p) => {
    const e = jByTime.get((p.time || '').trim());
    return e && (e.member !== p.name || (e.members ?? []).length !== p.faces);
  });
  check(`首页每日精华：另外 ${probes.length} 天逐条对账（名字 + 头像个数和 /salon.json 一致）`,
    bad.length === 0, bad.length ? JSON.stringify(bad.slice(0, 2)) : JSON.stringify(probes.slice(0, 3)));
  check('首页每日精华：成员 / 时间 / 内容三样都在', probes.every((p) => p.name && p.time && p.hasText), JSON.stringify(probes[0]));
/* ============================================================
     默认落点（用户 2026-09-22）：
     「如果进入精华页面时并没有指定到某条精华的位置 那么默认进入时不要停留在最早的精华处
       而是直接跳转到最晚的一条精华 以后加了新的精华也是默认跳转到最新精华处」
     ============================================================ */
  /* 前面那些段落把页面带去了别处（首页每日精华那段开的就是 /），
     这里必须自己重新进一次 /salon/（不带 hash），才有默认落点这回事。 */
  await cdp.goto('/salon/', 2600);
  const entry = await cdp.ev(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await sleep(1200);
    const items = [...document.querySelectorAll('.salon__item')];
    const first = items[0];
    const last = items[items.length - 1];
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
    const dt = (el) => el.querySelector('.salon__time')?.getAttribute('datetime') || '';
    const all = items.map(dt).filter(Boolean).sort();
    return {
      scrollY: Math.round(scrollY),
      firstId: first.id, firstVisible: inView(first),
      lastId: last.id, lastTop: Math.round(last.getBoundingClientRect().top), lastVisible: inView(last),
      lastDt: dt(last), maxDt: all[all.length - 1],
      items: items.length, vh: innerHeight,
    };
  })()`);
  console.log('默认落点：', JSON.stringify(entry));
  check('★ 不带 hash 进 /salon/：默认**不在**顶上（最早的精华处），页面确实滚下去了',
    entry.scrollY > 1000 && entry.firstVisible === false, `scrollY=${entry.scrollY}｜第一条还在视口里=${entry.firstVisible}`);
  check('★ 落在的是**最后一条**（= 数据里最晚的那一条），而且就在视口里',
    entry.lastVisible === true && entry.lastDt === entry.maxDt && entry.lastId === 'e0784',
    `${entry.lastId}（${entry.lastDt}）｜页面最晚 ${entry.maxDt}｜顶边 ${entry.lastTop}px`);
  check('★ 判据是"时间最晚"而不是"页面最下面"：最后一条的 datetime 就是全部条目里最大的那个',
    entry.maxDt === entry.lastDt && entry.items === total, `${entry.lastDt === entry.maxDt}`);

  /* 带 hash 的落点不能坏（首页「每日精华」那条路） */
  await cdp.goto('/salon/#e0012', 2600);
  const hashEntry = await cdp.ev(`(async () => {
    await new Promise((r) => setTimeout(r, 1200));
    const el = document.getElementById('e0012');
    const items = [...document.querySelectorAll('.salon__item')];
    const last = items[items.length - 1];
    const r = el ? el.getBoundingClientRect() : null;
    return {
      scrollY: Math.round(scrollY),
      top: r ? Math.round(r.top) : null,
      inView: r ? r.bottom > 0 && r.top < innerHeight : false,
      lastVisible: last.getBoundingClientRect().bottom > 0 && last.getBoundingClientRect().top < innerHeight,
    };
  })()`);
  console.log('带 hash 的落点：', JSON.stringify(hashEntry));
  check('带 hash 进来还是落在**那一条**上（没被"默认落最新"抢走）',
    hashEntry.inView === true && hashEntry.top !== null && hashEntry.top >= 0 && hashEntry.top < 200,
    `#e0012 顶边 ${hashEntry.top}px（scrollY=${hashEntry.scrollY}）`);
  check('带 hash 时不会同时落到最后一条（两个落点不打架）',
    hashEntry.lastVisible === false, `最后一条在视口里=${hashEntry.lastVisible}`);

  /* ============================================================
     时间轴那句「xxxxx N 天」（用户 2026-09-22）+ 年代卡上的「N 天」
     ============================================================ */
  const DAY = 86400000;
  const no = (s) => {
    if (String(s ?? '').trim() === 'today') {
      const d = new Date();
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY;
    }
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s ?? '').trim());
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY : NaN;
  };
  const todayNo = (() => { const d = new Date(); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY; })();

  const tlTotal = await cdp.ev(`(() => {
    const el = document.querySelector('[data-tl-total]');
    const days = document.querySelector('[data-tl-totaldays]');
    const label = document.querySelector('.tl__totalLabel');
    const scale = document.querySelector('.tl__scale');
    const r = el ? el.getBoundingClientRect() : null;
    const sr = scale ? scale.getBoundingClientRect() : null;
    return {
      has: !!el, days: days ? Number(days.textContent.trim()) : null,
      label: label ? label.textContent.trim() : '',
      /* 位置：在比例尺条**上方**（用户要的） */
      above: !!(r && sr && r.bottom <= sr.top + 2),
      text: el ? el.textContent.replace(/\s+/g, ' ').trim() : '',
    };
  })()`);
  console.log('时间轴那句：', JSON.stringify(tlTotal));
  const axisDays = [...tlSrc.points.map((p) => no(p.date)), ...tlSrc.spans.flatMap((s) => [no(s.from), no(s.to)])]
    .filter((d) => Number.isFinite(d));
  const wantDays = axisDays.length ? Math.round(Math.max(...axisDays) - Math.min(...axisDays)) + 1 : 0;
  check('★ 时间轴多了一句「{编辑器里写的那句话} N 天」，而且在比例尺条**上方**',
    tlTotal.has === true && tlTotal.above === true && tlTotal.label.length > 0,
    JSON.stringify({ 位置在比例尺上方: tlTotal.above, 文字: tlTotal.text }));
  check(`★ 那个 N 就是这条轴一共跨了多少天（含头含尾，实测 ${wantDays} 天）`,
    tlTotal.days === wantDays, `页面 ${tlTotal.days} / 盘上算 ${wantDays}`);
  check('★ 编辑器里写的那句话原样显示（这条轴写的是「' + (tlSrc.totalLabel ?? '') + '」）',
    tlTotal.label === (tlSrc.totalLabel ?? tlTotal.label) && tlTotal.label.length > 0,
    JSON.stringify({ 页面: tlTotal.label, 盘上: tlSrc.totalLabel ?? '' }));

  /* 年代卡上的天数（用户 2026-09-22） */
  const eraCards = await cdp.ev(`(() => {
    return [...document.querySelectorAll('.salon__era')].map((h) => {
      const d = h.querySelector('.salon__eraDays');
      const cs = d ? getComputedStyle(d) : null;
      return {
        name: (h.querySelector('.salon__eraName') || {}).textContent || '',
        days: d ? Number(d.textContent.replace(/[^0-9]/g, '')) : null,
        live: d ? d.dataset.live === '1' : false,
        from: d ? d.dataset.eraFrom : '', to: d ? d.dataset.eraTo : '',
        hiddenOpacity: cs ? Number(cs.opacity) : null,
        maxH: cs ? cs.maxHeight : '',
        transform: getComputedStyle(h).transform,
      };
    });
  })()`);
  console.log('年代卡：', JSON.stringify(eraCards));
  const eraWant = new Map((data.eras ?? []).map((e) => {
    const from = no(e.from);
    const to = no(e.to);
    const end = Math.min(to, todayNo);
    return [e.title, Math.max(1, Math.round(end - from) + 1)];
  }));
  check('★ 每个年代卡上都写着这个年代一共多少天（按 eras 的起止算，还在继续的钳到今天）',
    eraCards.length >= 3 && eraCards.every((e) => eraWant.get(e.name) === e.days),
    eraCards.map((e) => `${e.name.slice(0, 8)}=${e.days}(要 ${eraWant.get(e.name)})`).join(' '));
  check('★ 平时那行天数是收着的（鼠标移上去才展开）',
    eraCards.every((e) => e.hiddenOpacity === 0), JSON.stringify(eraCards.map((e) => e.hiddenOpacity)));

  /* 真鼠标移上去：卡片微微放大 + 天数露出来；移开还原 */
  const eraHoverPt = await cdp.ev(`(() => {
    const h = document.querySelector('.salon__era');
    h.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = h.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), name: (h.querySelector('.salon__eraName') || {}).textContent || '' };
  })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: eraHoverPt.x, y: eraHoverPt.y, buttons: 0 });
  await sleep(500);
  const hovered = await cdp.ev(`(() => {
    const h = document.querySelector('.salon__era');
    const d = h.querySelector('.salon__eraDays');
    const cs = getComputedStyle(d);
    const m = /matrix3?d?\\(([-\\d.eE]+)/.exec(getComputedStyle(h).transform);
    return { opacity: Number(cs.opacity), scale: m ? Number(m[1]) : 1, days: d.textContent.replace(/[^0-9]/g, '') };
  })()`);
  console.log('鼠标移上去：', JSON.stringify(hovered));
  check('★ 鼠标移到年代卡上：卡片微微放大（>1）而且「xx天」露出来了',
    hovered.scale > 1 && hovered.opacity > 0.5 && Number(hovered.days) > 0,
    JSON.stringify(hovered));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, buttons: 0 });
  await sleep(400);
  const out = await cdp.ev(`(() => {
    const h = document.querySelector('.salon__era');
    const d = h.querySelector('.salon__eraDays');
    const m = /matrix3?d?\\(([-\\d.eE]+)/.exec(getComputedStyle(h).transform);
    return { opacity: Number(getComputedStyle(d).opacity), scale: m ? Number(m[1]) : 1 };
  })()`);
  check('★ 鼠标移开：变回原样（缩放回到 1、天数收回去）',
    Math.abs(out.scale - 1) < 0.02 && out.opacity < 0.5, JSON.stringify(out));

  /*
    时间轴上「写着名字的卡片」（时间段名字卡）也要能 hover 出天数
    —— 用户原话：「鼠标移到年代卡上没有任何反应」。
    这些卡片在轴上一侧一个，名字下面平时收着「xx天」，移上去展开 + 卡片微微放大。
  */
  const spanCard = await cdp.ev(`(() => {
    const el = [...document.querySelectorAll('.tl__spanName')].find((x) => getComputedStyle(x).visibility === 'visible' && x.getBoundingClientRect().width > 20);
    if (!el) return null;
    el.scrollIntoView({ block: 'center', behavior: 'instant' });
    const daysEl = el.querySelector('[data-tl-spanDays]');
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
      name: el.textContent.replace(/[0-9]+\s*天/, '').trim().slice(0, 12),
      days: daysEl ? Number((daysEl.textContent.match(/[0-9]+/) || [0])[0]) : null,
      opacity: daysEl ? Number(getComputedStyle(daysEl).opacity) : null,
      scale: (() => { const m = /matrix3?d?\\(([-\\d.eE]+)/.exec(getComputedStyle(el).transform); return m ? Number(m[1]) : 1; })(),
    };
  })()`);
  console.log('时间轴名字卡：', JSON.stringify(spanCard));
  check('★ 时间轴上那些"写着名字的卡片"平时把天数收着（hover 才展开）',
    !!spanCard && spanCard.days > 0 && spanCard.opacity === 0, JSON.stringify(spanCard));
  check('★ 天数算得对（和这条轴数据里的起止一致）',
    !!spanCard && spanCard.days > 0 && spanCard.days < 4000, `${spanCard?.name} = ${spanCard?.days} 天`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: spanCard.x, y: spanCard.y, buttons: 0 });
  await sleep(450);
  const spanHover = await cdp.ev(`(() => {
    const el = [...document.querySelectorAll('.tl__spanName')].find((x) => getComputedStyle(x).visibility === 'visible' && x.getBoundingClientRect().width > 20);
    const daysEl = el.querySelector('[data-tl-spanDays]');
    const m = /matrix3?d?\\(([-\\d.eE]+)/.exec(getComputedStyle(el).transform);
    return { scale: m ? Number(m[1]) : 1, opacity: Number(getComputedStyle(daysEl).opacity), days: daysEl.textContent.trim() };
  })()`);
  console.log('时间轴名字卡 hover：', JSON.stringify(spanHover));
  check('★ 鼠标移到那张卡上：卡片微微放大 + 名字下面写出「xx天」（用户报的那件事）',
    spanHover.scale > 1 && spanHover.opacity > 0.5 && /\d+ 天/.test(spanHover.days),
    JSON.stringify(spanHover));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4, buttons: 0 });
  await sleep(350);

  check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  server.close();
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
