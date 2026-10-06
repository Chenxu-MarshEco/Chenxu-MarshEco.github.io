/*
 * 首页「每日精华」那张卡：不许被内容撑高 + 悬停弹全文浮层 + 图上放大（2026-10-06）
 *
 * 用户原话：
 *   「如果首页的每日精华太长 会拉长框导致日历和冰山会跟着拉长 非常难看 修改一下：
 *    让精华框永远保持默认的大小 鼠标移上去后 会弹出一个大卡片框显示全所有的文字和
 *    图片内容 移到图片内容上也能放大图片（类似成员的移到头像上放大）」
 *
 * 这里要量三件事，一件都不能只靠"看起来对"：
 *   ① **高度不变**：往卡片里塞一条超长精华，日历 / 冰山 / 这一行的高度一个像素都不许变；
 *      而且要做**A/B**：把帧里的内容改回"参与布局"，同样的超长内容必须**真的把行顶高**——
 *      不这么做的话，"没变高"有可能只是因为塞进去的内容根本不够长（那种验收毫无意义）。
 *   ② **浮层里是全文 + 全部图片**：拿页面自己那一条的 id 去 /salon.json 里查原始条目，
 *      逐字比长度、逐张比图片数（不写死任何一条精华的内容）。
 *   ③ **图上的放大是真的**：鼠标移到浮层里的图上，视口上浮出的那张大图就是**同一张图**，
 *      而且它不吃鼠标（`pointer-events: none`）—— 不然鼠标一进去 :hover 就断，图会闪。
 *
 * 用法：node tools/checks/home-daily-card-check.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const ROOT = path.join(SRC, 'dist');
const PORT = 4393;
const DEBUG_PORT = 9363;
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

/* ---------------- 静态服务（dist） ---------------- */
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

const profile = path.join(process.env.TEMP ?? '.', `dsh-daily-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

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
        this.errors.push(`exception: ${m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text}`);
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(`console.error: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
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
  async move(x, y) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
    await sleep(320);
  }
  async open(url) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${url}` });
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      if ((await this.ev('document.readyState')) === 'complete') break;
    }
    /*
      ⚠ 必须把平滑滚动关掉：站里 `html { scroll-behavior: smooth }`，
      `scrollIntoView()` 会**动画**滚过去 —— 动画还没结束就量位置、移鼠标，
      等动画滚完鼠标早就落在别的元素上了（浮层当然不出现，而且看起来像"功能坏了"）。
    */
    await this.ev(`(() => {
      const s = document.createElement('style');
      s.textContent = 'html{scroll-behavior:auto !important}';
      document.head.appendChild(s);
      return true;
    })()`);
    await sleep(1500);
  }
}

let cdp = null;
for (let i = 0; i < 60 && !cdp; i++) {
  await sleep(300);
  try {
    const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const t = l.find((x) => x.type === 'page');
    if (t) cdp = await CDP.attach(t.webSocketDebuggerUrl);
  } catch { /* 等它起来 */ }
}
check('无头浏览器起来了', !!cdp);
if (!cdp) process.exit(1);
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

/** 量这一屏的几个高度（一个都不许被精华的内容带跑） */
const HEIGHTS = `(() => {
  const h = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().height) : null; };
  return {
    grid: h('.extras__grid'),
    pair: h('.extras__pair'),
    calendar: h('.extras__grid > *:first-child'),
    iceberg: h('.extras__pair > *:first-child'),
    daily: h('.daily'),
    card: h('.daily__card'),
  };
})()`;

/**
 * 把鼠标真的移到某块控件上。
 * ⚠ 必须"滚 → 命中测试 → 再移"这样重试：首页那一屏在懒加载图片落下来之后会被往下推，
 *   滚一次经常会滚空（第一版滚完 y=1007、视口只有 844 高，鼠标点到了屏幕外；
 *   第二版干脆落在了页脚上）—— 所以先用 elementFromPoint 确认那个点上**真的是它**，
 *   是了再移鼠标。
 */
async function hoverWidget(sel) {
  for (let i = 0; i < 10; i++) {
    const r = await cdp.ev(`(() => {
      const el = document.querySelector(${JSON.stringify(sel)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center' });
      const b = el.getBoundingClientRect();
      const x = Math.round(b.x + b.width / 2);
      const y = Math.round(b.y + b.height / 2);
      const at = document.elementFromPoint(x, y);
      return { x, y, inView: b.top >= 0 && b.bottom <= innerHeight, hit: !!(at && at.closest('[data-daily]')) };
    })()`);
    if (r && r.hit) {
      await cdp.move(r.x, r.y);
      return r;
    }
    await sleep(400);
  }
  return { x: 0, y: 0, hit: false };
}

await cdp.open('/');
const wire = await cdp.ev(`(() => ({
  hasWrap: !!document.querySelector('.dailyWrap'),
  boxAbs: (() => { const b = document.querySelector('.daily__box'); return b ? getComputedStyle(b).position : null; })(),
  popOutsideFrame: (() => {
    const pop = document.querySelector('.daily__pop');
    const frame = document.querySelector('.daily');
    return !!pop && !!frame && !frame.contains(pop) && pop.parentElement.classList.contains('dailyWrap');
  })(),
  frameOverflow: (() => { const f = document.querySelector('.daily'); return f ? getComputedStyle(f).overflow : null; })(),
  popBlur: (() => { const p = document.querySelector('.daily__pop'); return p ? getComputedStyle(p).backdropFilter : null; })(),
  overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
}))()`);
check('★ 帧外面多了一层 wrapper，浮层挂在**帧外面**（不然会被帧的 overflow:hidden 裁掉）',
  wire.hasWrap && wire.popOutsideFrame && wire.frameOverflow === 'hidden', JSON.stringify(wire).slice(0, 140));
check('★ 帧里的内容是绝对定位（所以这一格的固有高度是 0，行高交给日历/冰山）',
  wire.boxAbs === 'absolute', String(wire.boxAbs));
check('★ 浮层没有用 backdrop-filter（用了会给 fixed 子元素造包含块，放大层就锚不住视口）',
  !wire.popBlur || wire.popBlur === 'none', String(wire.popBlur));

/* ================================================================
 * ① 高度：塞一条超长精华进去，日历 / 冰山 / 行高一个像素都不许动
 * ================================================================ */
console.log('\n================ ① 再长的精华也顶不高这一行 ================');
const before = await cdp.ev(HEIGHTS);
info(`原样：${JSON.stringify(before)}`);

/** 往卡片里塞一条超长精华（长文 + 复用现有的那张图） */
const stuff = `(() => {
  const card = document.querySelector('.daily__card');
  const long = '这是一条特别长的精华，用来验收卡片会不会被撑高。'.repeat(30);
  /*
    ⚠ 图一定要塞一张（2026-10-06 修）：这一段验的是"内容一旦参与布局就得把行顶高"，
    而正文有 -webkit-line-clamp 封顶（最多几行），光靠文字永远超不过日历那一行的高 ——
    真正把行顶高的是那张图。以前是从卡片里取现成的图，可是"今天抽到哪条精华"是随数据变的，
    抽到一条没有图的精华时这段就变成"没变化"，白红一场。所以取不到就退到页面上任意一张
    已经加载好的图（页头小圆片之类），保证这段 A/B 永远验得动。
  */
  const img = card.querySelector('.daily__pic')?.getAttribute('src')
    || [...document.images].map((i) => i.getAttribute('src')).find((s) => s && s.startsWith('/')) || '';
  card.innerHTML = '<div class="daily__who"><span class="daily__faces"><span class="daily__face">' +
    '<span class="daily__avatar daily__avatar--none">群</span></span></span><b class="daily__name">验收</b>' +
    '<time class="daily__time">2026-10-06 12:00</time></div>' +
    '<blockquote class="daily__text">' + long + '</blockquote>' +
    (img ? '<img class="daily__pic" src="' + img + '" alt="">' : '');
  return { len: long.length, img };
})()`;
const longLen = await cdp.ev(stuff);
info(`塞进去的内容：${JSON.stringify(longLen)}`);
await sleep(600);
const after = await cdp.ev(HEIGHTS);
info(`塞入 ${longLen} 字的正文后：${JSON.stringify(after)}`);
const same = (a, b) => Math.abs((a ?? -1) - (b ?? -2)) <= 1;
check('★★ 塞进超长精华后：**这一行、日历、冰山、精华帧**的高度全都没变',
  same(before.grid, after.grid) && same(before.calendar, after.calendar)
  && same(before.iceberg, after.iceberg) && same(before.daily, after.daily),
  `行 ${before.grid}→${after.grid} / 日历 ${before.calendar}→${after.calendar} / 冰山 ${before.iceberg}→${after.iceberg}`);
check('★ 三张卡还是**一样高**（日历 = 冰山 = 精华帧）',
  same(after.calendar, after.iceberg) && same(after.iceberg, after.daily),
  `${after.calendar} / ${after.iceberg} / ${after.daily}`);
check('★ 卡片里那份是**裁过的**（塞进去 720 字，卡片里只显示得下几行）',
  (await cdp.ev(`(() => {
    const t = document.querySelector('.daily__card .daily__text');
    const cs = getComputedStyle(t);
    const lines = Math.round(t.clientHeight / parseFloat(cs.lineHeight));
    return { lines, clamp: cs.webkitLineClamp || cs.getPropertyValue('-webkit-line-clamp') };
  })()`)).lines <= 6,
  JSON.stringify(await cdp.ev(`(() => {
    const t = document.querySelector('.daily__card .daily__text');
    return { lines: Math.round(t.clientHeight / parseFloat(getComputedStyle(t).lineHeight)) };
  })()`)));

/*
  A/B 对照：把帧里的内容改回"参与布局"，同样的超长内容**必须真的把行顶高**。
  没有这一条的话，"高度没变"有可能只是因为验的内容不够长 —— 那等于没验。
*/
await cdp.ev(`(() => { const s = document.createElement('style'); s.id = 'ab-static'; s.textContent = '.daily__box{position:static !important}'; document.head.appendChild(s); return true; })()`);
await sleep(400);
const ab = await cdp.ev(HEIGHTS);
info(`A/B（内容参与布局时）：${JSON.stringify(ab)}`);
check('★★ A/B 对照：内容一旦参与布局，同样的长文**真的把日历和冰山一起顶高**了（说明上面那条不是白测的）',
  ab.grid > after.grid + 20 && ab.calendar > after.calendar + 20 && ab.iceberg > after.iceberg + 20,
  `行 ${after.grid}→${ab.grid} / 日历 ${after.calendar}→${ab.calendar} / 冰山 ${after.iceberg}→${ab.iceberg}`);
await cdp.ev(`document.getElementById('ab-static')?.remove()`);
await sleep(300);

/* ================================================================
 * ② 悬停浮层：全文 + 全部图片（对着 /salon.json 的原始条目逐项比）
 * ================================================================ */
console.log('\n================ ② 悬停弹出的大卡片 ================');
await cdp.open('/');   // 重新开一次，清掉上面塞进去的假数据
const id = await cdp.ev(`(() => {
  const a = document.querySelector('.daily__card');
  const href = a?.getAttribute('href') || '';
  return href.includes('#') ? href.split('#')[1] : '';
})()`);
const salon = await (await fetch(`http://127.0.0.1:${PORT}/salon.json`)).json();
const item = (salon.essences ?? []).find((e) => e.id === id) ?? null;
check('★ 卡片指向的那一条能在 /salon.json 里查到（验收的数据来源就是页面自己用的那一份）',
  !!id && !!item, `id=${id}`);
if (item) info(`这一条：${item.member} ${item.date} ${item.time}｜正文 ${(item.text || '').length} 字｜图片 ${(item.images || []).length} 张`);

const docH0 = await cdp.ev('document.documentElement.scrollHeight');
const box2 = await hoverWidget('.daily');
const pop = await cdp.ev(`(() => {
  const p = document.querySelector('.daily__pop');
  const cs = getComputedStyle(p);
  const r = p.getBoundingClientRect();
  return {
    visibility: cs.visibility, opacity: Number(cs.opacity), pointer: cs.pointerEvents,
    text: (p.querySelector('.daily__popText')?.textContent || '').length,
    cardText: (document.querySelector('.daily__card .daily__text')?.textContent || '').length,
    pics: p.querySelectorAll('.daily__popPic').length,
    link: !!p.querySelector('.daily__popLink'),
    below: p.classList.contains('is-below'),
    fits: r.top >= -1 && r.bottom <= innerHeight + 1,
    x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
    vh: innerHeight,
  };
})()`);
info(`浮层：${JSON.stringify(pop)}`);
check('★ 鼠标移到卡片上，浮层真的显示出来了（可见 + 能点，不是藏着）',
  pop.visibility === 'visible' && pop.opacity === 1 && pop.pointer === 'auto');
check('★★ 浮层里是**全文**（和 /salon.json 里那一条一个字不差），卡片里那份是截断的',
  !!item && pop.text === (item.text || '').length && pop.text >= pop.cardText,
  `浮层 ${pop.text} 字 / 卡片 ${pop.cardText} 字 / 原始 ${(item?.text || '').length} 字`);
check('★★ 浮层里是**全部**图片（张数和 /salon.json 里那一条一致，不是只有头一张）',
  !!item && pop.pics === (item.images || []).length, `浮层 ${pop.pics} 张 / 原始 ${(item?.images || []).length} 张`);
check('★ 浮层里有通往精华页那一条的链接', pop.link === true);
check('★ 浮层没有把页面撑高（它是绝对定位，不参与布局）',
  (await cdp.ev('document.documentElement.scrollHeight')) === docH0);
check('★★ 浮层整张都在屏幕里（上边放不下时脚本会翻到卡片下面，并把高度夹进可用空间）',
  pop.fits && pop.w > 200 && pop.h > 60,
  `x=${pop.x} y=${pop.y} ${pop.w}×${pop.h} 视口高 ${pop.vh}${pop.below ? '（翻到下面了）' : ''}`);

/* ================================================================
 * ③ 图上的放大：浮出的就是同一张图，而且不吃鼠标
 * ================================================================ */
console.log('\n================ ③ 移到图上放大 ================');
const pic = await cdp.ev(`(() => {
  const im = document.querySelector('.daily__popPic');
  if (!im) return null;
  const r = im.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(Math.max(r.top + 20, Math.min(r.bottom - 20, 300))), src: im.currentSrc || im.src, dispW: Math.round(r.width) };
})()`);
if (!pic) {
  check('★ 这一条有图可以放大（今天这条恰好没图，跳过）', true, '（没图）');
} else {
  await cdp.move(pic.x, pic.y);
  const zoom = await cdp.ev(`(() => {
    const z = document.querySelector('.dailyZoom');
    if (!z) return null;
    const cs = getComputedStyle(z);
    const im = z.querySelector('img');
    return { on: z.classList.contains('is-on'), visibility: cs.visibility, opacity: Number(cs.opacity),
             pointer: cs.pointerEvents, src: im.currentSrc || im.src, w: Math.round(im.getBoundingClientRect().width) };
  })()`);
  info(`放大层：${JSON.stringify(zoom)}`);
  check('★ 鼠标移到浮层里的图上，视口正中浮出大图（同一张图）',
    !!zoom && zoom.on && zoom.visibility === 'visible' && zoom.src === pic.src,
    zoom ? `显示宽 ${zoom.w}px / 浮层里 ${pic.dispW}px` : '没有放大层');
  check('★★ 放大层不吃鼠标（`pointer-events: none`）—— 否则鼠标一进去 :hover 就断，图会一闪一闪',
    !!zoom && zoom.pointer === 'none', zoom ? zoom.pointer : '');
  check('★ 放大后不比浮层里那张小', !!zoom && zoom.w >= pic.dispW - 1, zoom ? `${zoom.w} ≥ ${pic.dispW}` : '');
  check('★ 放大层建在 <body> 上（页面里那些祖先有 transform，挂里面会锚不住视口）',
    (await cdp.ev(`document.querySelector('.dailyZoom')?.parentElement === document.body`)) === true);
}

/* ================================================================
 * ④ 窄屏：浮层不许把页面撑宽，也不许跑出屏外
 * ----------------------------------------------------------------
 * 这里用 `mobile: false` 模拟 390 宽的窗口：验的是**断点之后的版式**，
 * 触屏那套（点一下而不是悬停）另说 —— 而 `mobile: true` 那条路上
 * 首页本身的布局视口就不老实（量到 innerWidth 425 / clientWidth 390），
 * 拿它来量"有没有溢出"只会得到假结论。
 * ================================================================ */
console.log('\n================ ④ 窄屏 ================');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
await cdp.open('/');
const docW0 = await cdp.ev('document.documentElement.scrollWidth');
const mob2 = await hoverWidget('.daily');
const mobPop = await cdp.ev(`(() => {
  const p = document.querySelector('.daily__pop');
  const r = p.getBoundingClientRect();
  const cs = getComputedStyle(p);
  const at = document.elementFromPoint(${mob2.x}, ${mob2.y});
  return { vis: cs.visibility, left: Math.round(r.left), right: Math.round(r.right),
           top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight,
           docW: document.documentElement.scrollWidth, docW0: ${docW0},
           hover: document.querySelector('.dailyWrap').matches(':hover'),
           at: at ? at.tagName.toLowerCase() + '.' + String(at.className || '').split(' ')[0] : null,
           inWrap: at ? !!at.closest('[data-daily]') : null,
           frameW: Math.round(document.querySelector('.daily').getBoundingClientRect().width) };
})()`);
info(`窄屏指针位置：${mob2.x},${mob2.y} → 浮层 ${JSON.stringify(mobPop)}`);
check('★ 手机上浮层左右都在屏内（卡片是整幅宽，浮层跟着铺满）',
  mobPop.vis === 'visible' && mobPop.left >= -1 && mobPop.right <= 390 + 1,
  `vis=${mobPop.vis} 命中=${mobPop.at} hover=${mobPop.hover} inWrap=${mobPop.inWrap}`);
check('★★ 打开浮层**没有**给页面添出横向滚动（窄屏最容易在这里翻车）',
  mobPop.docW <= mobPop.docW0, `打开前 ${mobPop.docW0} → 打开后 ${mobPop.docW}`);
check('★ 手机上浮层上下也在屏内（不是从屏幕外拉出来一条）',
  mobPop.top >= -1 && mobPop.bottom <= mobPop.vh + 1,
  `top=${mobPop.top} bottom=${mobPop.bottom} 视口高 ${mobPop.vh}`);
/*
  ⚠ 这一条是补上来的（第一版漏了，random-essence-check 抓到的）：
  手机上是单列、三张卡各占一行 —— "内容绝对定位"那招在这里会把帧压成 0 高（卡片 2px）。
  窄屏必须回到"按内容自然高度"。所以这里量帧和卡片的高度。
*/
const mobH = await cdp.ev(`(() => {
  const f = document.querySelector('.daily');
  const c = document.querySelector('.daily__card');
  return { frame: Math.round(f.getBoundingClientRect().height), card: Math.round(c.getBoundingClientRect().height) };
})()`);
check('★★ 手机上卡片是正常高度（不是被压成一条线）',
  /*
    ⚠ 门槛按"帧"来卡（≥150px），卡片本身只要求它不是一条线。
    卡片多高取决于今天抽到的那条精华有多长 —— 抽到一句短的、又没图，卡片就是七八十像素，
    那是正常内容，不该判红（2026-10-06 被这条绊过一次：那天刚好抽到一条短句）。
    真正要守住的是"帧没被压成 0 高 / 2px"那个 bug，所以帧 ≥150、卡片 ≥40。
  */
  mobH.frame >= 150 && mobH.card >= 40, JSON.stringify(mobH));
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

await cdp.open('/');
check('★ 首页这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* ================================================================ */
try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ }
server.close();
await sleep(200);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ }

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
