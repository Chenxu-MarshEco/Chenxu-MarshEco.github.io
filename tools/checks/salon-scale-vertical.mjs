/*
 * ============================================================================
 * 手机端冰室精华页：时间轴比例尺**竖排**的验收（真浏览器 + 真拖拽）
 * ----------------------------------------------------------------------------
 * 用户原话（2026-11-20）：
 *   「手机端精华页时间轴比例尺非常难以调整 因为手机端精华页很高却很窄
 *     直接把时间轴比例尺的调整轴竖排过来 放在我发给你的图片的红圈位置
 *     整理一下让它更好操作也更好看」
 *
 * 红圈的位置 = 页脚里「冰室成立至今已经 1411 天」右边那一长条空白。
 * 所以这里量的是「那一块到底能不能用」：
 *   A  390×844：栏里（.tl.is-rail）那根尺子是**竖的**（高 ≫ 宽），
 *      尺子/滑块/标题/读数整块都在页脚里、页脚没溢出、没有被 overflow: hidden 切到；
 *      滑块热区 ≥ 20×20；那一块确实在页脚**右半边**（天数在左、尺子在右）
 *   B  真鼠标按住滑块往下拖 40px → 一格天数变大、aria-valuenow 变大；往上拖 → 反面
 *   C  页面滚到 4000px 之后照样拖得动（它跟着页面滚，不许被别的东西盖住）
 *   D  键盘：↓ 变大、↑ 变小、Home 回到最小（竖滑块的方向要对）
 *   E  1440×900：那根尺子仍然是**横的**（宽 > 高），横拖照样改比例（桌面回归）
 *   F  文案：只用了组件里原有的字（「时间轴比例」/「1 格 ≈ N 天」），没有新写的句子
 *   G  这趟没有 JS 报错
 *
 * 用法：node tools/checks/salon-scale-vertical.mjs [dist目录]
 * ============================================================================
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const ROOT = path.resolve(process.argv[2] ?? 'dist');
const PORT = 4391;
const DEBUG_PORT = 9364;
const CHROME = chromePath();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

if (!fs.existsSync(path.join(ROOT, 'salon', 'index.html'))) {
  console.error(`找不到 ${path.join(ROOT, 'salon', 'index.html')}，先构建`);
  process.exit(2);
}

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404); res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const profile = path.join(process.env.TEMP ?? '.', `dsh-scalev-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
    '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { windowsHide: true, stdio: 'ignore' },
);

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
  async goto(p, wait = 2600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 160; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
  async scrollTo(y) {
    await this.ev(`(() => { window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' }); return Math.round(window.scrollY); })()`);
    await sleep(400);
  }
  /** 从 (x,y) 按住，分 steps 步挪到 (x+dx, y+dy)，再松手 */
  async drag(x, y, dx, dy, steps = 10) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none' });
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= steps; i++) {
      await this.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved', x: x + (dx * i) / steps, y: y + (dy * i) / steps, button: 'left', buttons: 1,
      });
      await sleep(40);
    }
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + dx, y: y + dy, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(700);
  }
  async key(key, code, vk) {
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(350);
  }
}

/**
 * 进 /salon/ 并确认那条轴的标记真的到了。
 *
 * 为什么要重试：这个工作区里可能**有人同时在跑构建**（写的就是这个 dist），
 * 偶尔会赶上 dist 正被覆盖的那一两秒 —— 拿回来的是 404 或半份 HTML，
 * 于是「找不到比例尺」。那不是站点的毛病，等半秒再进一次就行；
 * 真出问题（标记确实没了）时四次都进不来，照样会红。
 */
async function gotoSalon(cdp, wait = 2600) {
  for (let i = 1; i <= 4; i++) {
    await cdp.goto('/salon/', wait);
    const ok = await cdp.ev(`(() => !!(document.querySelector('[data-tl-track]')
      && document.querySelector('[data-tl-rail]') && document.querySelector('[data-tl-knob]')))()`);
    if (ok) return;
    info(`第 ${i} 次进 /salon/ 没拿到比例尺的标记（dist 可能正在被覆盖），重试`);
    await sleep(800);
  }
  throw new Error('连续 4 次进 /salon/ 都找不到比例尺的标记 —— 先确认 dist 是最新的');
}

/**
 * 一次量全：页脚、轨道、尺子、滑块、标题、读数、面板。
 * 另外记一份「滑块正中点现在是谁」—— 它被别的东西盖住的话，拖拽根本到不了滑块。
 */
const PROBE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1),
      w: +r.width.toFixed(1), h: +r.height.toFixed(1), cx: +((r.left + r.right) / 2).toFixed(1), cy: +((r.top + r.bottom) / 2).toFixed(1) };
  };
  const root = q('.tl.is-rail') || q('[data-tl]');
  const foot = q('.tl__foot');
  const track = q('[data-tl-track]');
  const rail = q('[data-tl-rail]');
  const knob = q('[data-tl-knob]');
  const label = q('.tl__scaleLabel');
  const val = q('[data-tl-scaleval]');
  const total = q('.tl__total');
  const panel = q('.tl__panel');
  const kb = box(knob);
  const cs = rail ? getComputedStyle(rail) : null;
  const hit = kb ? document.elementFromPoint(Math.round(kb.cx), Math.round(kb.cy)) : null;
  const hitName = hit ? String((hit.closest && hit.closest('[data-tl-knob]')) ? 'knob' : (hit.className.baseVal !== undefined ? hit.className.baseVal : hit.className)) : '';
  return {
    isRail: !!(root && root.classList.contains('is-rail')),
    foot: box(foot), panel: box(panel), track: box(track), rail: box(rail), knob: kb,
    label: box(label), val: box(val), total: box(total),
    labelText: label ? label.textContent.trim() : '',
    valText: val ? val.textContent.trim() : '',
    ariaNow: knob ? Number(knob.getAttribute('aria-valuenow')) : null,
    ariaOri: knob ? knob.getAttribute('aria-orientation') : null,
    role: knob ? knob.getAttribute('role') : null,
    tabindex: knob ? knob.getAttribute('tabindex') : null,
    axisVar: cs ? cs.getPropertyValue('--tl-scale-axis').trim() : '',
    hitName,
    footOverflow: foot ? { sh: foot.scrollHeight, ch: foot.clientHeight, sw: foot.scrollWidth, cw: foot.clientWidth } : null,
    scrollY: Math.round(window.scrollY),
    vh: window.innerHeight,
  };
})()`;

const daysOf = (s) => {
  const m = String(s || '').match(/≈\s*([\d.]+)\s*天/);
  return m ? Number(m[1]) : NaN;
};
/** a 完全落在 b 里（容差 t px） */
const inside = (a, b, t = 0.6) => !!a && !!b
  && a.l >= b.l - t && a.r <= b.r + t && a.t >= b.t - t && a.b <= b.b + t;

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 还没起来 */ }
  }
  if (!target) throw new Error('Chromium 没起来');
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  /* ================================================================
   * A. 手机 390×844：竖排的几何
   * ================================================================ */
  console.log('================ A. 手机 390×844：比例尺是竖的 ================');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await gotoSalon(cdp);
  const m = await cdp.ev(PROBE);
  if (!m.track || !m.rail || !m.knob) throw new Error('找不到比例尺（data-tl-track / data-tl-rail / data-tl-knob）');
  info(`页脚 ${m.foot.w}px 宽、${m.foot.h}px 高；轨道 ${m.track.w}×${m.track.h}；尺子 ${m.rail.w}×${m.rail.h}；滑块 ${m.knob.w}×${m.knob.h}`);
  check('这一页确实是窄栏模式（.tl.is-rail）', m.isRail === true);
  check('样式里给了「竖排」这个记号（--tl-scale-axis: y，脚本按它读 clientY）', m.axisVar === 'y', m.axisVar || '(空)');
  check('尺子是竖的：高远大于宽（≥ 90px 高，宽不超过轨道）',
    m.rail.h > m.rail.w * 2 && m.rail.h >= 90 && m.rail.w <= m.track.w, `${m.rail.w}×${m.rail.h}`);
  check('轨道本身也是竖的（高度是宽度的 3 倍以上）', m.track.h > m.track.w * 3, `${m.track.w}×${m.track.h}`);
  check('尺子的可点宽度 ≥ 18px（手指按得着，不只是画出来那条细线）', m.rail.w >= 18, `${m.rail.w}px`);
  check('滑块热区 ≥ 20×20px', m.knob.w >= 20 && m.knob.h >= 20, `${m.knob.w}×${m.knob.h}`);
  check('滑块摆在竖条的中线上（水平对齐轨道中心，差 ≤ 4px）',
    Math.abs(m.knob.cx - m.track.cx) <= 4, `滑块 ${m.knob.cx} vs 轨道中心 ${m.track.cx}`);
  /* 红圈那一块：右半边。天数在左、尺子在右 */
  check('竖尺在页脚的**右半边**（红圈那一条），天数在它左边',
    m.track.l > m.foot.l + m.foot.w * 0.5 && m.total.r <= m.track.l + 1,
    `尺子左边 ${m.track.l} / 页脚中线 ${(m.foot.l + m.foot.w * 0.5).toFixed(1)} / 天数右边 ${m.total.r}`);
  /* 不许越界、不许被裁 */
  check('整条尺子都在页脚里（上下左右都不越界）', inside(m.rail, m.foot) && inside(m.track, m.foot),
    `尺子 ${m.rail.t}→${m.rail.b} / 页脚 ${m.foot.t}→${m.foot.b}`);
  check('滑块整只在页脚里（拖到两头也不会被切）', inside(m.knob, m.foot));
  check('标题「时间轴比例」和读数都在页脚里、没被裁',
    inside(m.label, m.foot) && inside(m.val, m.foot) && m.label.w > 0 && m.val.w > 0,
    `${m.label.w}×${m.label.h} / ${m.val.w}×${m.val.h}`);
  check('页脚自身没有溢出（内容没被 overflow: hidden 啃掉）',
    !!m.footOverflow && m.footOverflow.sh <= m.footOverflow.ch + 1 && m.footOverflow.sw <= m.footOverflow.cw + 1,
    JSON.stringify(m.footOverflow));
  check('页脚整个也在面板里（底边不越出面板，不然最后一行会被裁）',
    m.foot.b <= m.panel.b + 1, `页脚底 ${m.foot.b} vs 面板底 ${m.panel.b}`);
  check('滑块正中心点到的就是它（没被别的层盖住）', m.hitName === 'knob', m.hitName);
  check('还是个 role=slider、带 aria-valuenow、能 Tab 到（原有行为没丢）',
    m.role === 'slider' && Number.isFinite(m.ariaNow) && m.tabindex === '0',
    `role=${m.role} now=${m.ariaNow} tabindex=${m.tabindex}`);
  check('朝向也告诉读屏了（aria-orientation = vertical）', m.ariaOri === 'vertical', String(m.ariaOri));

  /* ================================================================
   * B. 真鼠标往下 / 往上拖
   * ================================================================ */
  console.log('\n================ B. 按住滑块上下拖 ================');
  /*
    先把比例拨回中间档再开始量：它的初值来自 sessionStorage（同一次会话里上一趟
    按过 Home / End 就会留在极端那档），从头两头上再拖是不会有变化的 ——
    那是测试的锅，不是滑块的锅。按一下竖尺正中 = 中间档。
  */
  const mid0 = await cdp.ev(PROBE);
  await cdp.drag(mid0.track.cx, (mid0.rail.t + mid0.rail.b) / 2, 0, 0, 1);
  const before = await cdp.ev(PROBE);
  info(`拖之前：${before.valText}｜aria-valuenow=${before.ariaNow}`);
  await cdp.drag(before.knob.cx, before.knob.cy, 0, 40);
  const down = await cdp.ev(PROBE);
  info(`往下拖 40px：${down.valText}｜aria-valuenow=${down.ariaNow}`);
  check('按住滑块往下拖 40px → 一格的天数**变大**（比例尺变小 = 缩得更狠）',
    daysOf(down.valText) > daysOf(before.valText) * 1.05,
    `${daysOf(before.valText).toFixed(1)} → ${daysOf(down.valText).toFixed(1)} 天`);
  check('同时 aria-valuenow 也跟着变大（读屏读到的是同一个变化）',
    down.ariaNow > before.ariaNow, `${before.ariaNow} → ${down.ariaNow}`);
  check('拖完滑块真的往下走了（位置不是冻住的）', down.knob.cy > before.knob.cy + 20,
    `${before.knob.cy.toFixed(0)} → ${down.knob.cy.toFixed(0)}`);

  await cdp.drag(down.knob.cx, down.knob.cy, 0, -40);
  const up = await cdp.ev(PROBE);
  info(`再往上拖 40px：${up.valText}｜aria-valuenow=${up.ariaNow}`);
  check('往上拖回去 → 一格的天数**变小**（和往下拖相反）',
    daysOf(up.valText) < daysOf(down.valText) / 1.05,
    `${daysOf(down.valText).toFixed(1)} → ${daysOf(up.valText).toFixed(1)} 天`);
  check('滑块也回到了上面', up.knob.cy < down.knob.cy - 20, `${down.knob.cy.toFixed(0)} → ${up.knob.cy.toFixed(0)}`);

  /* ================================================================
   * C. 滚到 4000px 之后还能拖
   * ================================================================ */
  console.log('\n================ C. 页面滚到 4000px 之后还拖得动 ================');
  await cdp.scrollTo(4000);
  const scrolled = await cdp.ev(PROBE);
  info(`scrollY=${scrolled.scrollY}；滑块 ${scrolled.knob.cx},${scrolled.knob.cy}；正中心点到的是 ${scrolled.hitName}`);
  check('滚下去以后滑块还在屏幕上（栏是 fixed，跟着页面不跑）',
    scrolled.knob.t > 0 && scrolled.knob.b < scrolled.vh, `${scrolled.knob.t}→${scrolled.knob.b} / 视口 ${scrolled.vh}`);
  check('滚下去以后滑块正中点到的还是它（没被正文 / 搜索栏盖住）', scrolled.hitName === 'knob', scrolled.hitName);
  await cdp.drag(scrolled.knob.cx, scrolled.knob.cy, 0, 40);
  const scrolledDrag = await cdp.ev(PROBE);
  info(`滚动之后往下拖 40px：${scrolledDrag.valText}`);
  check('滚到 4000px 之后往下拖，比例照样变',
    daysOf(scrolledDrag.valText) > daysOf(scrolled.valText) * 1.05,
    `${daysOf(scrolled.valText).toFixed(1)} → ${daysOf(scrolledDrag.valText).toFixed(1)} 天`);
  await cdp.scrollTo(0);

  /* ================================================================
   * D. 键盘
   * ================================================================ */
  console.log('\n================ D. 键盘（竖滑块的方向） ================');
  await cdp.ev(`(() => { const k = document.querySelector('[data-tl-knob]'); k.focus(); return document.activeElement === k; })()`);
  const k0 = await cdp.ev(PROBE);
  await cdp.key('ArrowDown', 'ArrowDown', 40);
  const k1 = await cdp.ev(PROBE);
  check('按 ↓ → 变大（竖着的滑块就该往下走是变大）', k1.ariaNow > k0.ariaNow, `${k0.ariaNow} → ${k1.ariaNow}`);
  await cdp.key('ArrowUp', 'ArrowUp', 38);
  const k2 = await cdp.ev(PROBE);
  check('按 ↑ → 变小', k2.ariaNow < k1.ariaNow, `${k1.ariaNow} → ${k2.ariaNow}`);
  await cdp.key('Home', 'Home', 36);
  const k3 = await cdp.ev(PROBE);
  check('按 Home → 回到最小（一天一格那端）', k3.ariaNow === 0, String(k3.ariaNow));
  await cdp.key('End', 'End', 35);
  const k4 = await cdp.ev(PROBE);
  check('按 End → 到最大（一年一格那端）', k4.ariaNow === 100, String(k4.ariaNow));
  /* 收尾：按在竖尺正中，把比例放回中间档（别给 sessionStorage 留个极端值） */
  const kk = await cdp.ev(PROBE);
  await cdp.drag(kk.track.cx, (kk.rail.t + kk.rail.b) / 2, 0, 0, 1);

  /* ================================================================
   * E. 桌面 1440×900：还是横的
   * ================================================================ */
  console.log('\n================ E. 桌面 1440×900：那根尺子还是横的 ================');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await gotoSalon(cdp);
  /* 同样先拨到靠左（小比例）那一档，否则"往右拖变大"在最大档上量不出变化 */
  const midD = await cdp.ev(PROBE);
  await cdp.drag(midD.rail.l + midD.rail.w * 0.2, midD.knob.cy, 0, 0, 1);
  const d0 = await cdp.ev(PROBE);
  info(`桌面上：轨道 ${d0.track.w}×${d0.track.h}、尺子 ${d0.rail.w}×${d0.rail.h}、记号 --tl-scale-axis=${d0.axisVar || '(没写=横)'}`);
  check('桌面上那根尺子是**横的**（宽 > 高）',
    d0.rail.w > d0.rail.h * 8 && d0.track.w > d0.track.h, `${d0.rail.w}×${d0.rail.h}`);
  check('桌面上没有竖排记号（--tl-scale-axis 不是 y）', d0.axisVar !== 'y', d0.axisVar || '(没写)');
  check('桌面上比例尺还在面板里、没被挤出去',
    inside(d0.rail, d0.panel) && d0.knob.t > 0 && d0.knob.b < d0.vh,
    `尺子 ${d0.rail.l}→${d0.rail.r} / 面板 ${d0.panel.l}→${d0.panel.r}`);
  check('桌面上朝向是 horizontal（读屏也读对）', d0.ariaOri === 'horizontal', String(d0.ariaOri));
  /* 桌面还是横着拖：往右 → 天数变大 */
  const dx = d0.rail.r - 6 - d0.knob.cx;
  await cdp.drag(d0.knob.cx, d0.knob.cy, dx > 0 ? dx : 40, 0);
  const d1 = await cdp.ev(PROBE);
  info(`桌面往右拖：${d0.valText} → ${d1.valText}`);
  check('桌面上往右拖照样能把比例调大（横着的交互没坏）',
    daysOf(d1.valText) > daysOf(d0.valText) * 1.05,
    `${daysOf(d0.valText).toFixed(1)} → ${daysOf(d1.valText).toFixed(1)} 天`);
  check('桌面上滑块跟着横着走（不是竖着动）',
    Math.abs(d1.knob.cy - d0.knob.cy) <= 2 && d1.knob.cx > d0.knob.cx + 20,
    `x ${d0.knob.cx} → ${d1.knob.cx}，y ${d0.knob.cy} → ${d1.knob.cy}`);

  /* ================================================================
   * F. 文案（铁律：不许自己写新的给人看的字）
   * ================================================================ */
  console.log('\n================ F. 文案只有一个来源 ================');
  check('标题还是组件原来那四个字「时间轴比例」', d0.labelText === '时间轴比例', d0.labelText);
  check('读数还是组件原来那句「1 格 ≈ N 天」（没有加解释、没有加提示语）',
    /^1 格 ≈ [\d.]+ 天$/.test(d0.valText), d0.valText);
  const copy = await cdp.ev(`(() => {
    const foot = document.querySelector('.tl__foot');
    /* 去掉所有空白再比：换行处的空白是排版产生的，不是字 */
    const norm = (s) => String(s).replace(/\\s+/g, '');
    const boxed = [...foot.querySelectorAll('.tl__side, .tl__total, .tl__scaleLabel, .tl__scaleValue')];
    return { all: norm(foot.textContent), joined: norm(boxed.map((e) => e.textContent).join('')), count: boxed.length };
  })()`);
  check('页脚里的字全在那五块里（历名 ×2 + 天数 + 标题 + 读数），没有多写的句子',
    copy.count === 5 && copy.all === copy.joined, JSON.stringify(copy));

  /* ================================================================
   * G. 报错
   * ================================================================ */
  console.log('\n================ G. 报错 ================');
  check('这趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { windowsHide: true, stdio: 'ignore' }); } catch { /* 已经退了 */ }
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* 删不掉也无所谓 */ }
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
