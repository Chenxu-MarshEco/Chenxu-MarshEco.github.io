/*
 * ============================================================================
 * 翻页（2026-10-12 加）+ 单日日志页
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「对于一个页面里不断加入文章会让页面越来越长的问题 进行一下优化 超过一定长度
 *    以后就会开始出现翻页 翻页可以点击左右按钮也可以直接点击对应数字也可以在框内
 *    输入数字 就像大部分网站的翻页一样」
 *   「可以把每一天都改为一篇手记 就像铃忆的冰室日记一样」
 *
 * 站上的列表现在都还没超过 37 条（文章 10 / 手记 10 / 日志 16），翻页条按设计
 * **根本不出现** —— 所以这个脚本先用 `PAGER_SIZE=4` 把小页数构建到
 * `.tmp/pager-dist`（真实页面、真实组件，只是把"一页 37 条"临时改成 4 条），
 * 然后照着用户的四句话逐条量：左按钮、右按钮、数字、输入框。
 *
 * 量的是真浏览器里的**可见条目数**（不是数 HTML 里有多少个 li）：
 * 分页的做法是把不在本页的条目 `hidden` 掉，所以"真正看得见的"才算数。
 *
 * 用法：node tools/checks/pager-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(SRC, '.tmp', 'pager-dist');
const CHROME = chromePath();
const PORT = 4362;
const DEBUG_PORT = 9428;
const SIZE = 4; // 「一页 37 条」在验收里临时改成 4
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

/* ---------------------------------------------------------------- 构建 */
info(`先构建一份小页数的站点（PAGER_SIZE=${SIZE}）到 .tmp/pager-dist`);
const built = spawnSync(
  process.execPath,
  [path.join(SRC, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build', '--outDir', '.tmp/pager-dist'],
  { cwd: SRC, encoding: 'utf8', env: { ...process.env, PAGER_SIZE: String(SIZE) } },
);
check('★ 小页数构建能过（真实组件、真实页面，只是"一页几条"临时调小）',
  built.status === 0 && fs.existsSync(path.join(OUT, 'posts', 'index.html')),
  `exit=${built.status} ${String(built.stderr || '').split('\n').filter(Boolean).slice(-1)[0] || ''}`);

/* ------------------------------------------------------- 一个静态小服务 */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.txt': 'text/plain; charset=utf-8',
};
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(OUT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      res.writeHead(200, { 'content-type': MIME[path.extname(f).toLowerCase()] ?? 'application/octet-stream' });
      return fs.createReadStream(f).pipe(res);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(String(m.params.exceptionDetails?.text).slice(0, 120));
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws 连不上')), { once: true });
    });
    return new CDP(ws);
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(`${r.exceptionDetails.text} :: ${String(expr).slice(0, 80)}`);
    return r.result.value;
  }
}

const profile = path.join(process.env.TEMP ?? '.', `dsh-pager-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
  '--disable-breakpad', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });

let cdp = null;
try {
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch { /* 等 */ }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 950, deviceScaleFactor: 1, mobile: false });

  const go = async (url) => {
    await cdp.send('Page.navigate', { url: url.startsWith('http') ? url : BASE + url });
    for (let i = 0; i < 120; i += 1) {
      await sleep(120);
      try {
        if ((await cdp.ev('document.readyState')) === 'complete') break;
      } catch { /* 还在导航 */ }
    }
    await sleep(700);
  };

  /* 一屏上"真正看得见"的条目数 —— 分页就是靠 hidden 藏条目，所以只能这么数 */
  const STATE = (target) => `(() => {
    const nav = document.querySelector('.pager');
    const list = document.querySelector(${JSON.stringify(target)});
    const cur = list ? [...list.querySelectorAll('[data-pager-item]')].filter((e) => !e.hidden) : [];
    const groups = list ? [...list.querySelectorAll('[data-pager-group]')] : [];
    return {
      hasPager: !!nav,
      nums: nav ? [...nav.querySelectorAll('.pager__num')].map((a) => ({ n: Number(a.dataset.page), cur: a.classList.contains('is-current'), href: a.getAttribute('href') })) : [],
      prevOff: nav ? !!nav.querySelector('[data-pager-prev]')?.classList.contains('is-off') : null,
      nextOff: nav ? !!nav.querySelector('[data-pager-next]')?.classList.contains('is-off') : null,
      status: nav ? (nav.querySelector('.pager__status')?.textContent || '').replace(/\\s+/g, ' ').trim() : '',
      input: nav ? nav.querySelector('.pager__input')?.value : '',
      ariaCurrent: nav ? nav.querySelectorAll('.pager__num[aria-current="page"]').length : 0,
      search: location.search,
      visible: cur.length,
      total: list ? list.querySelectorAll('[data-pager-item]').length : 0,
      firstVisible: cur[0]?.querySelector('time, .plogs__datelink, .post-item__title')?.textContent?.trim().slice(0, 12) || '',
      /* 年份那种分组壳：有可见条目的才该露着 */
      groupsShown: groups.filter((g) => !g.hidden).length,
      groupsTotal: groups.length,
      groupsConsistent: groups.every((g) => g.hidden === (g.querySelectorAll('[data-pager-item]:not([hidden])').length === 0)),
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  })()`;

  /* ==================================================================
     ① 文章页：数字 / 左右按钮 / 输入框（用户点名的四样）
     ================================================================== */
  await go('/posts/');
  const p1 = await cdp.ev(STATE('#posts-list'));
  info(`文章页第一页：数字 ${p1.nums.map((x) => x.n).join(',')}；看得见 ${p1.visible} 条 / 共 ${p1.total}`);
  check('★ 文章页出现了翻页条（条目超过一页才会有）', p1.hasPager && p1.nums.length >= 2, `数字 ${p1.nums.length} 个`);
  check('★ 第一页只显示一页的量（一页 4 条）', p1.visible === SIZE && p1.total > SIZE, `${p1.visible} / ${p1.total}`);
  check('第一页：上一页是不可点的（到头了）', p1.prevOff === true && p1.nextOff === false);
  check('第一页：数字 1 高亮、带 aria-current', p1.nums[0].cur && p1.ariaCurrent === 1, JSON.stringify(p1.nums[0]));
  check('每个数字都是**真链接**（中键 / 复制链接也能到）', p1.nums.every((x) => /^\?page=\d+$|^\?$/.test(x.href || '')), JSON.stringify(p1.nums.map((x) => x.href)));
  check('左边写了"共 N 条 · 第 1 / N 页"', /共 \d+ 条 · 第 1 \/ \d+ 页/.test(p1.status), p1.status);

  /* 点数字 2 */
  await cdp.ev(`document.querySelector('.pager__num[data-page="2"]').click()`);
  await sleep(500);
  const p2 = await cdp.ev(STATE('#posts-list'));
  const pages = p1.nums.length;
  const lastPageCount = p1.total - SIZE * (pages - 1);
  info(`点了数字 2：看得见 ${p2.visible} 条；URL ${p2.search}`);
  check('★ 点数字 2 → 换页（换上第二条那批）',
    p2.nums[1].cur && p2.visible === (pages === 2 ? lastPageCount : SIZE) && p2.firstVisible !== p1.firstVisible,
    `${p2.visible} 条，第一条是「${p2.firstVisible}」（第一页是「${p1.firstVisible}」）`);
  check('★ 页码写进 URL（?page=2）—— 刷新 / 复制给别人都是这一页', p2.search === '?page=2', p2.search);
  check('翻到第 2 页后：上一页可以点了（没到头的"下一页"看下一页数）',
    p2.prevOff === false && p2.nextOff === (pages === 2), `prevOff=${p2.prevOff} nextOff=${p2.nextOff}`);

  /* 点「下一页」 */
  await cdp.ev(`document.querySelector('[data-pager-next]').click()`);
  await sleep(500);
  const p3 = await cdp.ev(STATE('#posts-list'));
  info(`点了下一页：看得见 ${p3.visible} 条；URL ${p3.search}`);
  check('★ 点「下一页」→ 到最后一页，且"下一页"变成不可点',
    p3.nums.at(-1).cur && p3.nextOff === true && p3.visible === p3.total - SIZE * (p3.nums.length - 1),
    `${p3.visible} 条，URL ${p3.search}`);

  /* 输入框跳页 */
  await cdp.ev(`(() => { const i = document.querySelector('.pager__input'); i.value = '1'; i.form.requestSubmit(); return 'ok'; })()`);
  await sleep(500);
  const pJump = await cdp.ev(STATE('#posts-list'));
  check('★ 在框里输入数字 + 跳转 → 到那一页（用户点名的第四样）',
    pJump.nums[0].cur && pJump.visible === SIZE && pJump.search === '', `URL ${pJump.search || '(空)'}`);
  /* 框里乱填：不该跳走，也不该变成空白 */
  await cdp.ev(`(() => { const i = document.querySelector('.pager__input'); i.value = '999'; i.form.requestSubmit(); return 'ok'; })()`);
  await sleep(400);
  const pClamp = await cdp.ev(STATE('#posts-list'));
  check('框里填一个超范围的数 → 落到最后一页（不会白屏）',
    pClamp.nums.at(-1).cur && pClamp.visible === lastPageCount, `看得见 ${pClamp.visible} 条`);
  await cdp.ev(`(() => { const i = document.querySelector('.pager__input'); i.value = ''; i.form.requestSubmit(); return 'ok'; })()`);
  await sleep(400);
  const pEmpty = await cdp.ev(STATE('#posts-list'));
  check('框里留空 + 跳转 → 不动（还停在原来那页，框里回填当前页码）',
    pEmpty.nums.at(-1).cur && pEmpty.input === String(pages), `输入框="${pEmpty.input}"`);

  /* 年份分组的两条规矩 */
  check('分组的年份标题跟着本页走：没有可见条目的年份整组藏起来（含标题），有的露着',
    p1.groupsConsistent && p3.groupsConsistent && p1.groupsTotal >= 1,
    `第一页露出 ${p1.groupsShown}/${p1.groupsTotal} 年，末页 ${p3.groupsShown}/${p3.groupsTotal} 年`);

  /* 越界与乱填 */
  await go('/posts/?page=99');
  const pOver = await cdp.ev(STATE('#posts-list'));
  check('URL 上写 ?page=99（超出范围）→ 落到最后一页，不会白屏',
    pOver.hasPager && pOver.nums.at(-1).cur && pOver.visible > 0, `看得见 ${pOver.visible} 条`);
  await go('/posts/?page=abc');
  const pBad = await cdp.ev(STATE('#posts-list'));
  check('URL 上写 ?page=abc → 当成第一页', pBad.nums[0].cur && pBad.visible === SIZE, `看得见 ${pBad.visible} 条`);

  /* ==================================================================
     ② 手记页：同一套东西也要在
     ================================================================== */
  await go('/notes/');
  const n1 = await cdp.ev(STATE('#notes-list'));
  info(`手记页：数字 ${n1.nums.map((x) => x.n).join(',')}；看得见 ${n1.visible} 条 / 共 ${n1.total}`);
  check('★ 手记页也翻页了，一页同样是 4 条（其它都藏起来了）', n1.hasPager && n1.visible === SIZE && n1.total > SIZE,
    `${n1.visible} / ${n1.total}`);
  await cdp.ev(`document.querySelector('.pager__num[data-page="2"]').click()`);
  await sleep(500);
  const n2 = await cdp.ev(STATE('#notes-list'));
  check('手记页换页也正常，并且第一条换了人', n2.visible === SIZE && n2.firstVisible !== n1.firstVisible, `「${n2.firstVisible}」`);

  /* ==================================================================
     ③ 眠鱼志：一天一张卡 + 翻页 + 旧锚点照样跳得到
     ================================================================== */
  await go('/huaya/memory/mianyu');
  /* 列表的 id 是 `plogs-<块下标>`（版块树上这一块是第几个块，别写死） */
  const logId = await cdp.ev(`document.querySelector('.plogs__list')?.id || ''`);
  check('眠鱼志那一页有日志列表（id 形如 plogs-N）', /^plogs-\d+$/.test(logId), logId);
  const l1 = await cdp.ev(STATE(`#${logId}`));
  const cards = await cdp.ev(`(() => {
    const host = document.getElementById(${JSON.stringify(logId)});
    const items = [...host.querySelectorAll('.plogs__item')];
    return {
      n: items.length,
      excerpt: items.filter((i) => i.querySelector('.plogs__excerpt')).length,
      more: items.filter((i) => i.querySelector('.plogs__more')).length,
      /* 列表里**不该**再有整篇正文了（那是单日页的事） */
      body: host.querySelectorAll('.plogs__body').length,
      firstHref: items[0]?.querySelector('.plogs__more')?.getAttribute('href') || '',
      lastHref: items.at(-1)?.querySelector('.plogs__more')?.getAttribute('href') || '',
      lastDateId: items.at(-1)?.querySelector('.plogs__date')?.id || '',
      lastDate: items.at(-1)?.dataset.logDate || '',
    };
  })()`);
  info(`眠鱼志：${cards.n} 天；看得见 ${l1.visible} 天；第一张卡指向 ${cards.firstHref}`);
  check('★ 眠鱼志列表：一天一张卡（日期 + 摘要 + "读这一天"），正文不再堆在列表里',
    cards.n > SIZE && cards.excerpt === cards.n && cards.more === cards.n && cards.body === 0,
    `摘要 ${cards.excerpt} / 卡片 ${cards.n}、正文块 ${cards.body}`);
  check('★ 列表也翻页了（一页 4 天）', l1.hasPager && l1.visible === SIZE, `看得见 ${l1.visible} 天`);
  check('每张卡的「读这一天」都指向 /logs/<日期>/',
    /^\/logs\/\d{4}-\d{2}-\d{2}\/$/.test(cards.firstHref), cards.firstHref);

  /* 旧的带锚点链接（时间轴的点、编辑器导出的 anchors.json 都用这种）：
     它那天可能落在最后一页 —— 进去必须**自己把那一页翻出来**，不能"跳到了但看不见" */
  await go(`/huaya/memory/mianyu#${cards.lastDateId}`);
  const lHash = await cdp.ev(STATE(`#${logId}`));
  const hashVisible = await cdp.ev(
    `(() => { const el = document.getElementById(${JSON.stringify(cards.lastDateId)}); return !!el && !el.closest('[data-pager-item]').hidden; })()`,
  );
  const hashPage = lHash.nums.find((x) => x.cur)?.n;
  info(`旧链接 #${cards.lastDateId}（${cards.lastDate}，最早那天）→ 落在第 ${hashPage} / ${lHash.nums.length} 页`);
  check('★ 带锚点的旧链接（#2026914 这种数字 id）也照样跳得到：脚本自己把那一页翻出来',
    hashVisible === true && l1.hasPager && hashPage === lHash.nums.length,
    `那一天可见=${hashVisible}，第 ${hashPage} 页`);

  /* ==================================================================
     ④ 单日日志页（"每一天都像一篇手记"）
     ================================================================== */
  const dayHref = cards.firstHref;
  await go(dayHref);
  const day = await cdp.ev(`(() => {
    const art = document.querySelector('article.crt-screen');
    const nav = [...document.querySelectorAll('.post-nav a')].map((a) => ({ label: a.querySelector('.post-nav__label')?.textContent || '', href: a.getAttribute('href') }));
    return {
      title: document.querySelector('.post-header__title')?.textContent?.trim() || '',
      body: (document.querySelector('.prose')?.textContent || '').trim().length,
      paragraphs: document.querySelectorAll('.prose p').length,
      nav,
      kicker: document.querySelector('.log-header__kicker')?.textContent?.replace(/\\s+/g, ' ').trim() || '',
      canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href') || '',
      hasArticle: !!art,
    };
  })()`);
  info(`单日页 ${dayHref}：「${day.title}」，正文 ${day.body} 字 / ${day.paragraphs} 段；${
    day.nav.map((x) => `${x.label}→${x.href}`).join('  ')}`);
  check('★ 单日日志页有完整正文（和手记页同一套版式）', day.hasArticle && day.body > 40 && day.paragraphs >= 1,
    `${day.body} 字`);
  check('单日页头写着来路「眠鱼志 · 助手日志」', /眠鱼志/.test(day.kicker) && /助手日志/.test(day.kicker), day.kicker);
  check('单日页有「前后一天」和「全部日志」的链接', day.nav.length >= 2, JSON.stringify(day.nav.map((x) => x.label)));
  check('「全部日志」指回眠鱼志那一页', day.nav.some((x) => x.href === '/huaya/memory/mianyu'), JSON.stringify(day.nav.map((x) => x.href)));

  /* 最早那一天的页面：没有"前一天"（前头没日子了） */
  await go(cards.lastHref);
  const firstDay = await cdp.ev(`(() => {
    const labels = [...document.querySelectorAll('.post-nav a')].map((a) => a.querySelector('.post-nav__label')?.textContent || '');
    const title = document.querySelector('.post-header__title')?.textContent?.trim() || '';
    return { labels, title, url: location.pathname };
  })()`);
  info(`最早那一天 ${cards.lastHref}：「${firstDay.title}」→ ${firstDay.labels.join(' / ')}`);
  check('最早那一天的页面里没有「前一天」（到头了不装作有）',
    !firstDay.labels.some((l) => /前一天/.test(l)) && firstDay.labels.some((l) => /后一天/.test(l)),
    JSON.stringify(firstDay.labels));

  /* ==================================================================
     ⑤ 别的地方不该被牵连 + 手机宽度不出横向滚动
     ================================================================== */
  await go('/huaya/farland');
  const noPager = await cdp.ev(`document.querySelectorAll('.pager').length`);
  check('没有列表的页面不会凭空多出一条翻页条', noPager === 0, `找到 ${noPager} 条`);

  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await go('/posts/');
  const pm = await cdp.ev(STATE('#posts-list'));
  check('手机宽度（390px）下翻页条不横向溢出', pm.scrollW <= pm.clientW + 1, `${pm.scrollW} / ${pm.clientW}`);

  check('全程没有 JS 异常', cdp.errors.length === 0, cdp.errors.join(' | ') || '干净');
} catch (err) {
  fail += 1;
  console.log(`FAIL  ★ 脚本自己炸了：${err?.message || err}`);
} finally {
  try { cdp?.ws.close(); } catch { /* 忽略 */ }
  try { chrome.kill(); } catch { /* 忽略 */ }
  try { server.close(); } catch { /* 忽略 */ }
  await sleep(500);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 还占着就算了 */ }
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
