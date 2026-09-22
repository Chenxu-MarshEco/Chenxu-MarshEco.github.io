/*
 * 「以图片形式保存下来的对话」的文字补全验收（2026-09-22）。
 *
 * 用户原话：
 *   「精华页面里有些以图片形式保存下来的对话，因为文字部分仅有[图片]二字所以难以被搜索。
 *    我发给你了一份文件，里面每一份图片都有对应的文字描述，你根据图片文件名的时间和编号
 *    一一对应找到对应的图片类精华，然后把文件名里写着的内容替换上去」
 *
 * 这份脚本量两件事：
 *   ① 数据里**再没有**"文字只有 [图片]"的精华；而且有图的精华都有文字（不会出现空卡片）；
 *   ② 真的可搜了：在 /salon/ 的搜索框里敲一句**只在某一条里出现过**的话，
 *      那一条会留下来、别的都不见 —— 这就是这次改动的全部意义。
 *
 * 用法：node tools/checks/salon-text-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4414;
const DEBUG_PORT = 9384;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 真鼠标点一下（展开 / 收起要真的点得到才算数） */
const cdpClick = async (send, x, y) => {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, buttons: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, buttons: 0 });
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* ---------------- ① 数据 ---------------- */
const salon = JSON.parse(fs.readFileSync('src/data/salon.json', 'utf8'));
const ess = salon.essences ?? [];
const onlyPic = ess.filter((e) => {
  const t = String(e.text ?? '').trim();
  return t.includes('[图片]') && t.replace(/\[图片\]/g, '').trim() === '';
});
const withImg = ess.filter((e) => (e.images ?? []).length > 0);
const noText = withImg.filter((e) => !String(e.text ?? '').trim());
console.log(`精华 ${ess.length} 条｜有图的 ${withImg.length} 条｜文字只有 [图片] 的 ${onlyPic.length} 条｜有图但没文字的 ${noText.length} 条`);

check('① 数据里**没有**"文字只有 [图片]"的精华了（这次就是清这个）',
  onlyPic.length === 0, onlyPic.slice(0, 8).map((e) => e.id).join(' ') || '0 条');
check('① 有图的精华**都有文字**（不会点开一张图什么都没得读）',
  noText.length === 0, noText.slice(0, 8).map((e) => e.id).join(' ') || '0 条');

/* 几个钉死的例子：时间和编号一对上，文字就该是那一份 */
const pinned = [
  ['e0002', '2023-01-10', '21:26', '提醒睡觉小助手'],
  ['e0003', '2023-01-12', '16:16', '辰煦翻看阿比盖尔的私人物品被抓到了'],
  ['e0009', '2023-07-12', '10:10', 'TeamViewer选项'],
];
const byId = new Map(ess.map((e) => [e.id, e]));
check('① 钉死的三个例子：日期 / 时间 / 文字都对得上（时间是一一对应的那把钥匙）',
  pinned.every(([id, d, t, phrase]) => {
    const e = byId.get(id);
    return e && e.date === d && e.time === t && String(e.text).includes(phrase);
  }),
  pinned.map(([id]) => `${id}=${JSON.stringify(String(byId.get(id)?.text ?? '').slice(0, 18))}`).join('｜'));

/* 抽一句"只在一条里出现过"的话，用来量搜索 */
const rare = (() => {
  for (const e of ess) {
    const t = String(e.text ?? '');
    if (t.length < 12 || t.includes('无文本')) continue;
    const phrase = t.split('\n').map((x) => x.trim()).filter((x) => x.length >= 8)[0];
    if (!phrase) continue;
    const hits = ess.filter((x) => String(x.text ?? '').includes(phrase));
    if (hits.length === 1) return { id: e.id, phrase };
  }
  return null;
})();
console.log('拿来量搜索的那句话：', JSON.stringify(rare));

/* ---------------- ② 页面 + 真浏览器：搜索 ---------------- */
const salonHtml = fs.readFileSync(path.join(root, 'salon', 'index.html'), 'utf8');
check('② 构建产物里出现了这些补上的文字（不再只有 [图片]）',
  pinned.every(([, , , phrase]) => salonHtml.includes(phrase)),
  pinned.map(([, , , p]) => (salonHtml.includes(p) ? '✓' : '✗') + p.slice(0, 8)).join(' '));

if (!rare) {
  check('② 找不到"只在一条里出现过"的句子，没法量搜索', false, '');
} else {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
      const f = path.join(root, t);
      if (fs.existsSync(f) && fs.statSync(f).isFile()) {
        res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
        return fs.createReadStream(f).pipe(res);
      }
    }
    res.writeHead(404);
    res.end('404');
  });
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  const chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--window-size=1440,900',
     `--user-data-dir=${path.join(process.env.TEMP ?? '.', `dsh-salontxt-${Date.now()}`)}`,
     `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' }
  );
  let target = null;
  for (let i = 0; i < 80 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch { /* 等 */ }
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pend = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text);
  });
  const send = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((r) => pend.set(i, r)); };
  const ev = async (e) => {
    const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/salon/` });
  for (let i = 0; i < 200; i++) { await sleep(150); if ((await ev('document.readyState')) === 'complete') break; }
  await sleep(2500);

  const before = await ev(`(() => ({ items: document.querySelectorAll('.salon__item').length, shown: [...document.querySelectorAll('.salon__item')].filter((el) => !el.hidden).length }))()`);
  const found = await ev(`(async () => {
    const q = document.querySelector('#salon-q') || document.querySelector('input[type="search"]');
    if (!q) return { ok: false, why: '找不到搜索框' };
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(q, ${JSON.stringify(rare.phrase)});
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 700));
    const items = [...document.querySelectorAll('.salon__item')];
    const shown = items.filter((el) => !el.hidden);
    return {
      ok: true, total: items.length, shown: shown.length,
      texts: shown.slice(0, 3).map((el) => (el.querySelector('.salon__text')?.textContent || '').slice(0, 40)),
      empty: document.querySelector('.salon__empty') ? !document.querySelector('.salon__empty').hidden : null,
    };
  })()`);
  console.log('搜索前：', JSON.stringify(before));
  console.log('搜索后：', JSON.stringify(found));
  check(`②★ 在 /salon/ 搜索框里敲「${rare.phrase}」→ 只剩这一条（${rare.id}）`,
    found.ok === true && found.shown === 1 && found.total === before.items &&
      found.texts.some((t) => String(t).includes(rare.phrase)),
    JSON.stringify({ 命中: found.shown, 总数: found.total, 文字: found.texts }));

  /* ---------------- ③ 长文字折起来（用户：「要加折叠」） ---------------- */
  await ev(`(() => { const q = document.querySelector('#salon-q') || document.querySelector('input[type="search"]');
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(q, ''); q.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(800);
  const foldState = await ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const boxOf = (it) => it.querySelector('.salon__text');
    const withBtn = items.filter((it) => it.querySelector('.salon__fold'));
    const clamped = items.filter((it) => boxOf(it)?.classList.contains('is-clamped'));
    /* 挑最长的那条来演一遍展开 / 收起 */
    const longest = items.slice().sort((a, b) => (boxOf(b)?.scrollHeight ?? 0) - (boxOf(a)?.scrollHeight ?? 0))[0];
    const box = boxOf(longest);
    const btn = longest.querySelector('.salon__fold');
    const r = btn?.getBoundingClientRect();
    return {
      items: items.length,
      withBtn: withBtn.length,
      clamped: clamped.length,
      longest: {
        id: longest.dataset.id || '', full: box.scrollHeight, shown: box.clientHeight,
        clamped: box.classList.contains('is-clamped'),
        btnText: btn?.textContent || '', expanded: btn?.getAttribute('aria-expanded'),
        btn: r ? { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } : null,
      },
      shortNoBtn: items.filter((it) => {
        const b = boxOf(it);
        return b && b.textContent.trim().length < 30 && !it.querySelector('.salon__fold') && !b.classList.contains('is-clamped');
      }).length,
    };
  })()`);
  console.log('折叠：', JSON.stringify(foldState));
  check('③★ 长文字被折起来了：折了的那几条有「展开」按钮，而且真的在裁（clientHeight < scrollHeight）',
    foldState.clamped > 0 && foldState.withBtn === foldState.clamped &&
      foldState.longest.clamped === true && foldState.longest.shown < foldState.longest.full &&
      foldState.longest.btnText === '展开' && foldState.longest.expanded === 'false',
    `折了 ${foldState.clamped} 条 / 共 ${foldState.items} 条｜最长那条 ${foldState.longest.full}px 只显示 ${foldState.longest.shown}px`);
  check('③ 短的那些没有按钮、也没被裁（不弄一堆没用的按钮出来）',
    foldState.shortNoBtn > 0, `短条目 ${foldState.shortNoBtn} 条都没有按钮`);

  /* 点「展开」：不裁了、字变「收起」、aria-expanded=true。
     ⚠ 那颗按钮在页面很下面 —— 先把那一条滚进视口再量坐标，
     不然量出来的是 y=21 万，真鼠标点过去等于没点（踩过）。 */
  const buttonPos = async () => ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const boxOf = (it) => it.querySelector('.salon__text');
    const longest = items.slice().sort((a, b) => (boxOf(b)?.scrollHeight ?? 0) - (boxOf(a)?.scrollHeight ?? 0))[0];
    const btn = longest.querySelector('.salon__fold');
    if (!btn) return null;
    /* 滚**按钮自己**：展开之后这张卡有 4000px 高，滚整条的话按钮还在屏外 */
    btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    const r = btn.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  await cdpClick(send, ...Object.values(await buttonPos()));
  await sleep(500);
  const opened = await ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const boxOf = (it) => it.querySelector('.salon__text');
    const longest = items.slice().sort((a, b) => (boxOf(b)?.scrollHeight ?? 0) - (boxOf(a)?.scrollHeight ?? 0))[0];
    const box = boxOf(longest);
    const btn = longest.querySelector('.salon__fold');
    return { clamped: box.classList.contains('is-clamped'), full: box.scrollHeight, shown: box.clientHeight, btnText: btn?.textContent || '', expanded: btn?.getAttribute('aria-expanded') };
  })()`);
  console.log('展开后：', JSON.stringify(opened));
  check('③★ 点一下「展开」：不再裁了（clientHeight 涨到全文高）、按钮变成「收起」、aria-expanded=true',
    opened.clamped === false && opened.shown >= opened.full - 4 && opened.btnText === '收起' && opened.expanded === 'true',
    `${opened.shown} / ${opened.full}｜${opened.btnText}`);

  /* 再点一下：收回去 */
  await cdpClick(send, ...Object.values(await buttonPos()));
  await sleep(500);
  const reclosed = await ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const boxOf = (it) => it.querySelector('.salon__text');
    const longest = items.slice().sort((a, b) => (boxOf(b)?.scrollHeight ?? 0) - (boxOf(a)?.scrollHeight ?? 0))[0];
    const box = boxOf(longest);
    const btn = longest.querySelector('.salon__fold');
    return { clamped: box.classList.contains('is-clamped'), btnText: btn?.textContent || '', expanded: btn?.getAttribute('aria-expanded') };
  })()`);
  check('③ 再点一下就收回去（展开 / 收起来回都能用）',
    reclosed.clamped === true && reclosed.btnText === '展开' && reclosed.expanded === 'false',
    JSON.stringify(reclosed));

  /* 键盘：聚焦按钮按回车也能开 */
  await ev(`(() => { const b = document.querySelector('.salon__fold'); b.focus(); return document.activeElement === b; })()`);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'char', key: 'Enter', text: '\r', unmodifiedText: '\r', windowsVirtualKeyCode: 13 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(400);
  const kbFold = await ev(`(() => { const b = document.querySelector('.salon__fold'); return { text: b.textContent, expanded: b.getAttribute('aria-expanded') }; })()`);
  check('③ 键盘也能展开（聚焦「展开」按回车）', kbFold.text === '收起' && kbFold.expanded === 'true', JSON.stringify(kbFold));

  check('② 这一趟没有 JS 报错', errors.length === 0, errors.slice(0, 2).join(' | '));

  /* ---------------- ④ 没跑 JS 时不裁（渐进增强，别无声切掉内容） ---------------- */
  await send('Emulation.setScriptExecutionDisabled', { value: true });
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/salon/` });
  for (let i = 0; i < 200; i++) { await sleep(150); if ((await ev('document.readyState')) === 'complete') break; }
  await sleep(1200);
  const noJs = await ev(`(() => {
    const boxes = [...document.querySelectorAll('.salon__text')];
    const clamped = boxes.filter((b) => b.classList.contains('is-clamped'));
    const btns = document.querySelectorAll('.salon__fold').length;
    const anyCut = boxes.filter((b) => b.scrollHeight > b.clientHeight + 4).length;
    return { boxes: boxes.length, clamped: clamped.length, btns, anyCut };
  })()`);
  await send('Emulation.setScriptExecutionDisabled', { value: false });
  console.log('关掉 JS：', JSON.stringify(noJs));
  check('④★ 没有 JS 时：一个字都不裁（没有 .is-clamped、没有按钮，全文都看得见）',
    noJs.clamped === 0 && noJs.btns === 0 && noJs.anyCut === 0,
    JSON.stringify(noJs));

  try { await send('Browser.close'); } catch { /* ignore */ }
  chrome.kill();
  server.close();
}

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
