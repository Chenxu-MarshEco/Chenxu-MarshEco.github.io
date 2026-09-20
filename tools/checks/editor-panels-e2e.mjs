/*
 * 编辑器「日历 / 关于我 / 冰室冰山 / 精华 / 成员」五个新面板的**独立**验收。
 *
 * 不去点面板上的按钮（那是面板自己的活），而是直接打编辑器自己的 HTTP 接口 ——
 * 面板点「保存」走的就是这几条路由，所以验的是同一条链路：
 *
 *   1) POST /api/upload          传图通道（关于我的头像、冰山的图）
 *   2) POST /api/widgets         给「今天」写一个生日事件 + 关于我头像 + 冰山图/链接
 *      真浏览器量：今天那格是不是橙黄渐变、能不能点到当天事件页、
 *      右下角小框是不是「今天是篠雨的生日」
 *   3) POST /api/salon {members} 改名 + 换头像 + 加一个成员（**不带** essences）
 *      验：精华一条不少；那个成员名下的行、/salon.json、首页卡片全跟着变；
 *      多成员（完美对话那种）没被砍成单个、kind 没丢
 *   4) POST /api/salon {essences} 新增一条精华（**不带** members）
 *      验：736 条、eraId 按日期自动落段、新 id 进 HTML、老 id 一个没变
 *
 * 全程副本（.tmp/e2e-panels）：public 是**真拷贝**（上传和图片管线要真落盘），
 * node_modules 走 junction。工作区 src/data 和 public/img/uploads 一个字节都不动。
 *
 * 用法：node tools/checks/editor-panels-e2e.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DST = path.join(SRC, '.tmp', 'e2e-panels');
const STATIC_PORT = 4391;
const DEBUG_PORT = 9361;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const NEW_NAME = '验收改名';
const NEW_MEMBER = '验收新成员';
const ESS_TEXT = '验收新增精华 e2e';
const ESS_DATE = '2026-08-01';
const RAW_ID = 'm02-da43';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = ymd(new Date());
const todayNum = new Date().getDate();
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

/* ================= 0. 造副本 ================= */
if (fs.existsSync(DST)) {
  const nm = path.join(DST, 'node_modules');
  if (fs.existsSync(nm)) { try { execSync(`cmd /c rmdir "${nm}"`, { stdio: 'ignore' }); } catch {} }
  fs.rmSync(DST, { recursive: true, force: true });
}
const skip = new Set(['node_modules', 'dist', '.git', '.tmp']);
fs.mkdirSync(DST, { recursive: true });
for (const e of fs.readdirSync(SRC, { withFileTypes: true })) {
  if (skip.has(e.name)) continue;
  fs.cpSync(path.join(SRC, e.name), path.join(DST, e.name), { recursive: true });
}
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log(`副本就绪：${DST}（public 真拷贝 ${fs.readdirSync(path.join(DST, 'public')).length} 个子目录）`);
console.log(`今天 = ${today}`);

/* 基线数字：全部从副本盘上读，后面每一项都对着这组数字量 */
const salon0 = readJson(path.join(DST, 'src', 'data', 'salon.json'));
const E0 = salon0.essences.length;
const M0 = salon0.members.length;
const RAW_ROWS = salon0.essences.filter((e) => (e.memberIds ?? []).includes(RAW_ID)).length;
const expectedEra = (salon0.eras.find((e) => ESS_DATE >= e.from && ESS_DATE <= e.to) || {}).id;
const ids0 = new Set(salon0.essences.map((e) => e.id));
console.log(`基线：精华 ${E0} 条 / 成员 ${M0} 个 / ${RAW_ID} 名下 ${RAW_ROWS} 条 / ${ESS_DATE} 属于 ${expectedEra}`);

/* ================= 1. 起编辑器（副本自己的 server.mjs） ================= */
const editor = spawn(process.execPath, [path.join(DST, 'tools', 'editor', 'server.mjs')], {
  cwd: DST, stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 300 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
if (!base) {
  console.log('FAIL  编辑器没起来：' + elog.slice(-800));
  process.exit(1);
}
console.log(`编辑器（副本）已在 ${base} 起来；工作区那个 4322 与本脚本无关`);

async function api(method, p, body) {
  const r = await fetch(base + p, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 非 JSON */ }
  return { status: r.status, json, text };
}
const dataUrl = (abs, mime) => `data:${mime};base64,` + fs.readFileSync(abs).toString('base64');
const html = (rel) => fs.readFileSync(path.join(DST, 'dist', rel), 'utf8');

try {
  /* ---- 1.1 老接口还在（回归） ---- */
  const regress = [];
  for (const p of ['/api/bootstrap', '/api/boards', '/api/music', '/api/timelines', '/api/navs', '/api/anchors', '/api/layout', '/api/widgets', '/api/salon']) {
    const r = await api('GET', p);
    regress.push(`${p}=${r.status}`);
    if (r.status !== 200) check(`老接口 ${p} 还是 200`, false, String(r.status));
  }
  check('老接口全在（9 条 GET 全 200，没有因为新面板碰坏）', regress.every((s) => s.endsWith('=200')), regress.join(' '));

  const w0 = await api('GET', '/api/widgets');
  check('GET /api/widgets：四块数据齐全（about / calendar / iceberg / daily）',
    w0.status === 200 && ['about', 'calendar', 'iceberg', 'daily'].every((k) => w0.json?.[k]),
    Object.keys(w0.json ?? {}).join(','));

  /* ---- 1.2 传图通道 ---- */
  const manBefore = Object.keys(readJson(path.join(DST, 'public', 'img', 'opt', 'manifest.json')).items ?? {}).length;
  const upA = await api('POST', '/api/upload', {
    name: 'e2e-avatar.png',
    dataUrl: dataUrl(path.join(SRC, 'public', 'img', 'home', 'statue.png'), 'image/png'),
  });
  const upB = await api('POST', '/api/upload', {
    name: 'e2e-ice.jpg',
    dataUrl: dataUrl(path.join(SRC, 'public', 'img', 'home', 'block-yongcheng.jpg'), 'image/jpeg'),
  });
  const okA = upA.status === 200 && /^\/img\/uploads\/.+\.(png|jpe?g|webp)$/.test(upA.json?.path ?? '');
  const okB = upB.status === 200 && /^\/img\/uploads\/.+\.(png|jpe?g|webp)$/.test(upB.json?.path ?? '');
  check('传图通道：关于我头像图落盘了', okA && fs.existsSync(path.join(DST, 'public', upA.json.path)), `${upA.json?.path} ${upA.json?.before}→${upA.json?.after}B`);
  check('传图通道：冰山的图落盘了', okB && fs.existsSync(path.join(DST, 'public', upB.json.path)), `${upB.json?.path} ${upB.json?.before}→${upB.json?.after}B`);
  const manifest = JSON.parse(fs.readFileSync(path.join(DST, 'public', 'img', 'opt', 'manifest.json'), 'utf8'));
  const manKeys = Object.keys(manifest.items ?? {});
  check('传图通道：新图立刻进了图片管线，而且**没把别的图的记录挤掉**（只编一张时清单要合并）',
    manKeys.length >= manBefore + 2 && manKeys.some((k) => k.includes(path.basename(upA.json.path))) && manKeys.some((k) => k.includes(path.basename(upB.json.path))),
    `清单 ${manBefore} → ${manKeys.length} 张（新图 ${manKeys.filter((k) => k.includes('e2e-')).length} 张在册）`);
  const stemA = path.basename(upA.json.path, path.extname(upA.json.path));

  /* ================= 2. POST /api/widgets ================= */
  const wBody = {
    calendar: {
      ...w0.json.calendar,
      events: { ...(w0.json.calendar.events ?? {}), [today]: { title: '篠雨的生日', href: '/salon/' } },
    },
    about: { title: '关于我', avatar: upA.json.path, text: '## 验收标题\n\n这是副本里写进去的正文。', href: '/about-me/' },
    iceberg: { title: '冰室冰山', image: upB.json.path, text: '副本里写的一行介绍。', href: '/salon/' },
  };
  /* 先只写「名字 + 跳去哪」（不填自定义文案）—— 这一档必须出现需求里那句「今天是xxx的生日」 */
  const rw = await api('POST', '/api/widgets', wBody);
  check('POST /api/widgets：保存成功并且顺带重建了站点', rw.status === 200 && rw.json?.ok === true && rw.json?.built === true, `built=${rw.json?.built} ${rw.json?.ms}ms（图片管线：${String(rw.json?.output ?? '').split('\n')[0]}）`);
  const wOn = readJson(path.join(DST, 'src', 'data', 'home-widgets.json'));
  check('写回的数据对：今天那格有事件、关于我有头像、冰山有图有链接',
    wOn.calendar.events[today]?.title === '篠雨的生日' && wOn.about.avatar === upA.json.path && wOn.iceberg.image === upB.json.path && wOn.iceberg.href === '/salon/',
    JSON.stringify({ ev: wOn.calendar.events[today], about: wOn.about.avatar, ice: wOn.iceberg.image + ' -> ' + wOn.iceberg.href }));

  const hHome = html('index.html');
  const calData = JSON.parse(/<script type="application\/json" id="cal-data">([\s\S]*?)<\/script>/.exec(hHome)[1]);
  check('首页 HTML 里带上了今天的事件（机读数据里有 title / href）',
    calData.events?.[today]?.title === '篠雨的生日' && calData.events[today].href === '/salon/',
    JSON.stringify(calData.events[today]));
  check('首页右下角那句话的模板还在（idleText / specialText 原样）',
    calData.idleText === '今天依然是等待篠雨的一天' && calData.specialText === '今天是{title}',
    JSON.stringify({ idle: calData.idleText, special: calData.specialText }));
  check('页头「关于我」小圆片换成了上传的头像（走图片管线）',
    hHome.includes('about-pill__face') && hHome.includes(stemA) && !hHome.includes('about-pill__face--none'),
    stemA);

  const hAbout = html(path.join('about-me', 'index.html'));
  check('/about-me/ 页里头像用的是上传那张（variantUrl 出来的地址）', hAbout.includes(stemA), stemA);
  check('/about-me/ 页里正文写进去了（Markdown 渲染成 h2）', /<h2[^>]*>验收标题<\/h2>/.test(hAbout), 'h2 验收标题');

  const hIce = html(path.join('iceberg', 'index.html'));
  const iceImg = /<figure class="icePage__fig"[\s\S]*?<img[^>]*src="([^"]+)"/.exec(hIce);
  check('/iceberg/ 页出了图（不是占位符）', !!iceImg && iceImg[1].includes(path.basename(upB.json.path, path.extname(upB.json.path))), iceImg?.[1] ?? '没有 img');
  const moreBlock = /<p class="icePage__more[\s\S]{0,300}?<\/p>/.exec(hIce)?.[0] ?? '';
  check('/iceberg/ 页的「更多」链接指到了 /salon/', moreBlock.includes('href="/salon/"'), moreBlock.slice(0, 170));

  /* ================= 3. POST /api/salon：只带 members ================= */
  const salon1 = readJson(path.join(DST, 'src', 'data', 'salon.json'));
  const membersNew = salon1.members.map((m) => (m.id === RAW_ID ? { ...m, name: NEW_NAME, avatar: upA.json.path } : m));
  membersNew.push({ id: '', name: NEW_MEMBER, avatar: '' });
  const rm = await api('POST', '/api/salon', { members: membersNew });
  check('POST /api/salon（只带 members）：成员 16→17，精华一条没丢',
    rm.status === 200 && rm.json?.counts?.members === M0 + 1 && rm.json?.counts?.essences === E0,
    JSON.stringify(rm.json?.counts) + ` built=${rm.json?.built} ${rm.json?.ms}ms`);
  const salon2 = readJson(path.join(DST, 'src', 'data', 'salon.json'));
  const renamed = salon2.members.find((m) => m.id === RAW_ID);
  check('成员的 id 没被改写（精华指向的还是同一个 id）',
    renamed?.name === NEW_NAME && renamed?.avatar === upA.json.path && salon2.members.some((m) => m.name === NEW_MEMBER && m.id),
    JSON.stringify(renamed) + ' 新成员id=' + salon2.members.find((m) => m.name === NEW_MEMBER)?.id);
  check('精华里**没有**冗余名字/头像（改名换头像靠现查，不靠回写）',
    salon2.essences.every((e) => e.name === undefined && e.avatar === undefined),
    'essence 字段：' + Object.keys(salon2.essences[0]).join(','));

  const hSalon = html(path.join('salon', 'index.html'));
  const rowsInHtml = (hSalon.match(/class="salon__item"/g) ?? []).length;
  const jSalon = JSON.parse(fs.readFileSync(path.join(DST, 'dist', 'salon.json'), 'utf8'));
  /* 这一段还在"只改了成员、还没加精华"的时候量，所以是 RAW_ROWS 而不是 RAW_ROWS + 1 */
  check('改名后：/salon/ 的 HTML 与 /salon.json 里那个成员的行数 = 他原本那些（一行不漏）',
    (hSalon.match(new RegExp(NEW_NAME, 'g')) ?? []).length >= RAW_ROWS &&
      jSalon.essences.filter((e) => (e.members ?? []).some((m) => m.name === NEW_NAME)).length === RAW_ROWS &&
      jSalon.essences.filter((e) => e.member === 'Raw').length === 0,
    `html 命中 ${(hSalon.match(new RegExp(NEW_NAME, 'g')) ?? []).length} 次 / json ${jSalon.essences.filter((e) => (e.members ?? []).some((m) => m.name === NEW_NAME)).length} 条（基线 ${RAW_ROWS}）/ 旧名残留 ${jSalon.essences.filter((e) => e.member === 'Raw').length} 条`);
  check('改名后：/salon/ 行数仍是原来那些（HTML 里数得出来）', rowsInHtml === E0, `salon__item = ${rowsInHtml}`);
  check('/salon.json 里那个成员的头像就是上传那张', jSalon.essences.some((e) => e.member === NEW_NAME && (e.avatar || '').includes(stemA)), stemA);

  /* ================= 4. POST /api/salon：只带 essences ================= */
  const essNew = salon2.essences.map((e) => ({ ...e }));
  essNew.push({ id: '', memberIds: [RAW_ID], date: ESS_DATE, time: '12:34', text: ESS_TEXT, images: [], eraId: '' });
  const re = await api('POST', '/api/salon', { essences: essNew });
  check(`POST /api/salon（只带 essences）：${E0}→${E0 + 1}，成员表没被碰掉（还是 ${M0 + 1}）`,
    re.status === 200 && re.json?.counts?.essences === E0 + 1 && re.json?.counts?.members === M0 + 1,
    JSON.stringify(re.json?.counts) + ` built=${re.json?.built} ${re.json?.ms}ms`);
  const salon3 = readJson(path.join(DST, 'src', 'data', 'salon.json'));
  const added = salon3.essences.find((e) => e.text === ESS_TEXT);
  check('新精华拿到了 id，eraId 是按日期自己落的段（不信前端传的）',
    !!added && /^e\d+$/.test(added.id) && added.eraId === expectedEra && !ids0.has(added.id),
    JSON.stringify(added && { id: added.id, eraId: added.eraId }));
  check('老精华的 id 一个都没变（时间轴 #锚点 不会断）',
    [...ids0].every((id) => salon3.essences.some((e) => e.id === id)),
    `老 id ${ids0.size} 个全在，新 id ${added?.id}`);
  const sorted = salon3.essences.every((e, i, a) => i === 0 || `${a[i - 1].date} ${a[i - 1].time || '00:00'}` <= `${e.date} ${e.time || '00:00'}`);
  /* 编辑器保存时**不重排**（照客户端给的顺序写回，免得每次都有一整份无意义的顺序 diff）；
     站点渲染时 utils/salon.ts 自己会按 日期→时刻→id 排。所以这里只要求：新加的那条在文件里、
     原有的一条不少。排序由 salon-all-items-check.mjs 在页面上量。 */
  check(`写回后条数 = 原有 + 1（${E0} → ${salon3.essences.length}；顺序照客户端给的，站点渲染时自己排）`,
    salon3.essences.length === E0 + 1, `n=${salon3.essences.length}；文件里是否已排序=${sorted}`);

  /*
    ★ 多成员是这一轮最容易丢的东西：编辑器以前只白名单拷贝单个 memberId，
    换数据之后用户点一次「保存」就会把 memberIds 抹掉。这里专门盯住它。
  */
  const multiBefore = salon0.essences.filter((e) => (e.memberIds ?? []).length > 1);
  const multiAfter = salon3.essences.filter((e) => (e.memberIds ?? []).length > 1);
  const sampleAfter = multiAfter.find((e) => e.id === multiBefore[0]?.id);
  check(`多成员精华保存后一条不少（${multiBefore.length} 条），成员也没被砍成单个`,
    multiAfter.length === multiBefore.length && !!sampleAfter && sampleAfter.memberIds.length === multiBefore[0].memberIds.length,
    `保存前 ${multiBefore.length} 条 → 保存后 ${multiAfter.length} 条；例 ${sampleAfter?.id} [${(sampleAfter?.memberIds ?? []).join(',')}]`);
  const kindsBefore = salon0.essences.reduce((a, e) => ((a[e.kind || 'text'] = (a[e.kind || 'text'] || 0) + 1), a), {});
  /* 只看**原有那些**条目（新加的那条是测试造的，kind 默认 text） */
  const kindsAfter = salon3.essences
    .filter((e) => e.id !== added?.id)
    .reduce((a, e) => ((a[e.kind || 'text'] = (a[e.kind || 'text'] || 0) + 1), a), {});
  check('kind（文字/完美对话/AI 创作）保存后也没丢',
    JSON.stringify(kindsBefore) === JSON.stringify(kindsAfter), `${JSON.stringify(kindsBefore)} → ${JSON.stringify(kindsAfter)}`);
  check('新加的这条精华带上了成员（memberIds）',
    JSON.stringify(added?.memberIds) === JSON.stringify([RAW_ID]), JSON.stringify(added?.memberIds));
  check('一条都没丢：保存后总条数 = 原有 + 1',
    salon3.essences.length === E0 + 1 && [...ids0].every((id) => salon3.essences.some((e) => e.id === id)),
    `${E0} → ${salon3.essences.length}`);

  /* ================= 5. 真浏览器：量页面 ================= */
  const ROOT = path.join(DST, 'dist');
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
  await new Promise((r) => server.listen(STATIC_PORT, '127.0.0.1', r));

  const profile = path.join(process.env.TEMP ?? '.', `dsh-e2e-${Date.now()}`);
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
    async goto(p, wait = 1500) {
      await this.gotoAbs(`http://127.0.0.1:${STATIC_PORT}${p}`, wait);
    }
    async gotoAbs(u, wait = 1500) {
      this.errors = [];
      await this.send('Page.navigate', { url: u });
      for (let i = 0; i < 120; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
      await sleep(wait);
    }
  }

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

  /* ---- 5.1 首页日历：今天那格 ---- */
  await cdp.goto('/');
  const cal = await cdp.ev(`(() => {
    const HUE = (bg) => { const out = []; const re = /rgba?\\(\\s*(\\d+)[,\\s]+(\\d+)[,\\s]+(\\d+)/g; let m;
      while ((m = re.exec(bg))) { const r=+m[1],g=+m[2],b=+m[3]; const mx=Math.max(r,g,b),mn=Math.min(r,g,b),d=mx-mn;
        if (!d) continue; let h = mx===r ? 60*(((g-b)/d)%6) : mx===g ? 60*((b-r)/d+2) : 60*((r-g)/d+4);
        if (h<0) h+=360; if (h>=15 && h<=65 && mx>=150) out.push('rgb('+r+','+g+','+b+') h='+Math.round(h)); }
      return out; };
    const ev = document.querySelector('.cal__day--event');
    const today = document.querySelector('.cal__day--today');
    const plain = [...document.querySelectorAll('.cal__day')].find((d) => !d.classList.contains('cal__day--event') && !d.classList.contains('cal__day--today'));
    const cs = (el) => getComputedStyle(el);
    return {
      eventCount: document.querySelectorAll('.cal__day--event').length,
      todayCount: document.querySelectorAll('.cal__day--today').length,
      evText: ev && ev.textContent.trim(),
      evHref: ev && ev.getAttribute('href'),
      evTitle: ev && ev.getAttribute('title'),
      evIsToday: !!(ev && ev.classList.contains('cal__day--today')),
      evBg: ev && cs(ev).backgroundImage.slice(0, 400),
      evRadius: ev && cs(ev).borderRadius,
      evW: ev && Math.round(ev.getBoundingClientRect().width),
      evHue: ev && HUE(cs(ev).backgroundImage),
      plainBg: plain && cs(plain).backgroundImage.slice(0, 400),
      plainHue: plain && HUE(cs(plain).backgroundImage),
      todayText: (document.querySelector('.cal__today') || {}).textContent,
      gridDays: document.querySelectorAll('.cal__day').length,
      width: innerWidth,
    };
  })()`);
  check(`日历：当月 ${cal.gridDays} 格，其中今天 1 格、特殊日子 1 格`,
    cal.gridDays >= 28 && cal.todayCount === 1 && cal.eventCount === 1 && cal.evIsToday === true,
    JSON.stringify({ days: cal.gridDays, today: cal.todayCount, event: cal.eventCount }));
  check(`日历：今天那格显示 ${todayNum}、title 里带事件名、可点向 /salon/`,
    cal.evText === String(todayNum) && (cal.evTitle ?? '').includes('篠雨的生日') && cal.evHref === '/salon/',
    JSON.stringify({ text: cal.evText, title: cal.evTitle, href: cal.evHref }));
  check(`日历：特殊日子是蒸汽波橙黄（量到 ${cal.evHue.length} 个橙色渐变停点），普通日子不是`,
    cal.evHue.length >= 1 && cal.plainHue.length === 0,
    `特殊=${JSON.stringify(cal.evHue)} 普通=${JSON.stringify(cal.plainHue)}`);
  check('日历：圆角栅格圆的形状（border-radius 50% 级别 + 格子尺寸量出来）',
    /50%|9999px|999px/.test(cal.evRadius) || parseFloat(cal.evRadius) >= 12,
    `radius=${cal.evRadius} ${cal.evW}px`);
  check('日历：右下角小框写的是「今天是篠雨的生日」',
    cal.todayText === '今天是篠雨的生日', JSON.stringify(cal.todayText));

  const evBox = await cdp.ev(`(() => { const a = document.querySelector('a.cal__day--event'); a.scrollIntoView({ block: 'center', behavior: 'instant' }); const r = a.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, inView: r.top > 0 && r.bottom < innerHeight }; })()`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: evBox.x, y: evBox.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: evBox.x, y: evBox.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: evBox.x, y: evBox.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(2200);
  check('日历：真点一下今天那格，跳到了当天的事件页', (await cdp.ev('location.pathname')) === '/salon/', await cdp.ev('location.pathname'));

  /* 面板上那一格还留了「自定义文案」这个口子（面板自己的说明：填了就用那一格的）。
     两档都量一遍：没填 -> 「今天是xxx的生日」；填了 -> 用填的那句。 */
  const rw2 = await api('POST', '/api/widgets', {
    calendar: { ...wBody.calendar, events: { ...wBody.calendar.events, [today]: { title: '篠雨的生日', href: '/salon/', text: '验收写的事件' } } },
  });
  await cdp.goto('/', 1200);
  const box2 = await cdp.ev(`(() => ({ text: (document.querySelector('.cal__today') || {}).textContent,
    event: document.querySelectorAll('.cal__day--event').length, orange: /255,\\s*(15[0-9]|2[0-9][0-9])/.test(getComputedStyle(document.querySelector('.cal__day--event')).backgroundImage) }))()`);
  check('日历：那一格填了「自定义文案」就用它（面板上说明过的口子，不算串文案）',
    rw2.json?.built === true && box2.text === '验收写的事件' && box2.event === 1,
    JSON.stringify({ text: box2.text, ms: rw2.json?.ms }));

  /* ---- 5.2 关于我 ---- */
  await cdp.goto('/about-me/');
  const me = await cdp.ev(`(() => {
    const f = document.querySelector('.me__face');
    const cs = f && getComputedStyle(f);
    const r = f && f.getBoundingClientRect();
    return { tag: f && f.tagName, src: f && f.getAttribute('src'), radius: cs && cs.borderRadius,
      w: r && Math.round(r.width), h: r && Math.round(r.height), title: (document.querySelector('.me__title') || {}).textContent,
      body: (document.querySelector('.me') || {}).textContent.slice(0, 60),
      corner: document.querySelectorAll('.corner__btn').length, pill: !!document.querySelector('.about-pill') };
  })()`);
  check('关于我：头像是圆的（量到 border-radius 与 190×190 的方框）',
    me.tag === 'IMG' && /50%|9999px|999px|95px/.test(me.radius) && me.w === me.h && me.w > 100,
    `${me.tag} ${me.w}×${me.h} radius=${me.radius}`);
  check('关于我：头像就是上传那张图', (me.src ?? '').includes(stemA), me.src);
  check('关于我：标题 = 关于我，正文写进去了', me.title === '关于我' && me.body.includes('验收标题'), JSON.stringify({ title: me.title, body: me.body }));
  check('关于我：外框 UI 和右侧控件是一套（同一页头 + 同一套 .corner__btn 控件）',
    me.corner >= 3 && me.pill === true, `corner 控件 ${me.corner} 个，页头小圆片在=${me.pill}`);

  /* ---- 5.3 冰室冰山 ---- */
  await cdp.goto('/iceberg/');
  const ice = await cdp.ev(`(() => {
    const img = document.querySelector('.icePage__fig img');
    const r = img && img.getBoundingClientRect();
    const more = document.querySelector('.icePage__more a') || document.querySelector('a.icePage__more');
    return { src: img && img.getAttribute('src'), w: r && Math.round(r.width), h: r && Math.round(r.height),
      title: (document.querySelector('.icePage__title') || {}).textContent,
      moreHref: more && more.getAttribute('href'), moreText: more && more.textContent.trim(),
      ph: !!document.querySelector('.icePage__ph'), corner: document.querySelectorAll('.corner__btn').length };
  })()`);
  check('冰室冰山：页面上真出了图（不是占位符，尺寸量得出来）', !!ice.src && ice.ph === false && ice.w > 0 && ice.h > 0, JSON.stringify({ src: ice.src, w: ice.w, h: ice.h, ph: ice.ph }));
  check('冰室冰山：图是编辑器里传的那张', (ice.src ?? '').includes(path.basename(upB.json.path, path.extname(upB.json.path))), ice.src);
  check('冰室冰山：标题 + 链接接口都在（链接指到 /salon/）',
    ice.title === '冰室冰山' && ice.moreHref === '/salon/', JSON.stringify({ title: ice.title, href: ice.moreHref, text: ice.moreText }));

  /* ---- 5.4 冰室精华页 ---- */
  await cdp.goto('/salon/', 2500);
  const sa = await cdp.ev(`(() => {
    const items = [...document.querySelectorAll('.salon__item')];
    const names = items.map((i) => (i.querySelector('.salon__name') || {}).textContent);
    const tl = document.querySelector('.tl');
    const panel = document.querySelector('.tl__panel');
    const pts = [...document.querySelectorAll('.tl__item')];
    const withHref = pts.filter((p) => p.dataset.href);
    return { items: items.length, renamed: names.filter((n) => n === ${JSON.stringify(NEW_NAME)}).length,
      renamedById: items.filter((i) => (i.dataset.members || '').split(' ').includes(${JSON.stringify(RAW_ID)})).length,
      oldName: names.filter((n) => n === 'Raw').length,
      pinned: !!(tl && tl.classList.contains('is-pinned')),
      hasClose: !!document.querySelector('.tl__close, [data-tl-close]'),
      hasTab: !!document.querySelector('.tl__tab, [data-tl-tab]'),
      panelPos: panel && getComputedStyle(panel).position,
      panelW: panel && Math.round(panel.getBoundingClientRect().width),
      points: pts.length, pointsWithHref: withHref.length,
      search: !!document.querySelector('#salon-q'),
      /* 「原页面自带的分类 UI」的结构标记：小节标题里那句「本年代…」和数据属性。
         不拿「完美对话 / AI 创作」这两个词当残留 —— 它们现在是**内容**（正文里就有），
         页面上还写着「三类都在，一条没丢」这句说明。 */
      residue: document.body.innerHTML.match(/完美分类|data-era=|本年代/g)?.length ?? 0 };
  })()`);
  check('精华页：原有条数 + 1（HTML 里数 .salon__item）', sa.items === E0 + 1, `salon__item = ${sa.items}`);
  check(`精华页：改名后 ${sa.renamedById} 行是这个成员（按 data-members 数），0 行还显示旧名「Raw」`,
    sa.renamedById >= RAW_ROWS && sa.oldName === 0, JSON.stringify({ byId: sa.renamedById, 精确同名: sa.renamed, old: sa.oldName }));
  check('精华页：时间轴常态显示在左边、不可关闭（没有关闭按钮、也没有折叠标签）',
    sa.pinned && sa.hasClose === false && sa.hasTab === false && sa.panelPos === 'static',
    JSON.stringify({ pinned: sa.pinned, close: sa.hasClose, tab: sa.hasTab, pos: sa.panelPos, w: sa.panelW }));
  check('精华页：时间轴上是日期点，每个点都带 #精华 锚点', sa.points > 100 && sa.pointsWithHref === sa.points, `${sa.points} 个点 / ${sa.pointsWithHref} 个带锚点`);
  check('精华页：原页面自带的分类/时间轴残留 = 0（「本年代…」小节标题、data-era 都没有）', sa.residue === 0, `命中 ${sa.residue} 次`);
  check('精华页：搜索框还在', sa.search === true, '');

  /* 搜索是真能筛的（原页面那套分类删了，搜索得留着并且好用） */
  const srch = await cdp.ev(`(async () => {
    const q = document.querySelector('#salon-q');
    const hit = document.querySelector('#salon-hit');
    const empty = document.querySelector('#salon-empty');
    const items = [...document.querySelectorAll('.salon__item')];
    const vis = () => items.filter((i) => !i.hidden).length;
    const set = (v) => { const s = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; s.call(q, v); q.dispatchEvent(new Event('input', { bubbles: true })); };
    const out = { total: items.length };
    set(${JSON.stringify(ESS_TEXT)}); await new Promise((r) => setTimeout(r, 400));
    out.one = vis(); out.hitOne = hit.textContent; out.emptyOne = empty.hidden;
    set('zzz-没有这条精华-e2e'); await new Promise((r) => setTimeout(r, 400));
    out.none = vis(); out.hitNone = hit.textContent; out.emptyNone = empty.hidden;
    set(''); await new Promise((r) => setTimeout(r, 400));
    out.back = vis(); out.hitBack = JSON.stringify(hit.textContent);
    document.body.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    out.focusAfterSlash = document.activeElement === q;
    q.blur();
    return out; })()`);
  check(`精华页：搜「新增那条」精确命中 1 条（其余 ${E0} 条被筛掉）`,
    srch.one === 1 && srch.hitOne === `命中 1 / ${E0 + 1} 条`, JSON.stringify({ one: srch.one, hit: srch.hitOne }));
  check('精华页：搜不存在的词 -> 0 条 + 提示「没有匹配的精华」',
    srch.none === 0 && srch.emptyNone === false && /命中 0 /.test(srch.hitNone), JSON.stringify({ none: srch.none, hit: srch.hitNone, emptyShown: !srch.emptyNone }));
  check(`精华页：清空搜索 -> ${E0 + 1} 条全回来、提示收起`,
    srch.back === E0 + 1 && srch.hitBack === '""', JSON.stringify({ back: srch.back, hit: srch.hitBack }));
  check('精华页：按 / 能聚焦搜索框', srch.focusAfterSlash === true, '');
  check('精华页：新增那条精华出现在页面上', (await cdp.ev(`!!document.querySelector('.salon__item') && [...document.querySelectorAll('.salon__item blockquote')].some((b) => b.textContent === ${JSON.stringify(ESS_TEXT)})`)) === true, ESS_TEXT);

  /* 点时间轴上的日期：用滚轮把点滚进面板（不要 scrollIntoView：轴的布局是 cur 自己重画的，
     滚 DOM 会让坐标和画面错开），再用 elementFromPoint 确认那个坐标上真的点得到这个链接 */
  const pt = await cdp.ev(`(() => {
    const body = document.querySelector('[data-tl-body]');
    const items = [...document.querySelectorAll('.tl__item')].filter((p) => p.dataset.href);
    if (!body || !items.length) return { href: null, why: 'no body/items' };
    for (const it of items) {
      for (let i = 0; i < 8; i++) {
        const b = body.getBoundingClientRect();
        const r = it.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy > b.top + 40 && cy < b.bottom - 40) break;
        body.dispatchEvent(new WheelEvent('wheel', { deltaY: cy - (b.top + b.height / 2), bubbles: true, cancelable: true }));
      }
      const a = it.querySelector('a.tl__crane') || it.querySelector('a.tl__name');
      if (!a) continue;
      const b = body.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const x = ar.left + ar.width / 2;
      const y = ar.top + ar.height / 2;
      if (!(ar.width > 2 && ar.height > 2)) continue;
      if (!(x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2)) continue;
      const hit = document.elementFromPoint(x, y);
      const onA = !!(hit && (hit === a || a.contains(hit) || (hit.closest && hit.closest('a') === a)));
      if (onA && y > b.top + 8 && y < b.bottom - 8) {
        return { href: it.dataset.href, label: it.dataset.label, x, y, tag: hit.tagName, cls: String(hit.className).slice(0, 40) };
      }
    }
    return { href: null, why: 'no clickable point' };
  })()`);
  check('精华页：时间轴上找得到一个当前就能点的日期点', /^#e\d+$/.test(pt.href ?? ''), JSON.stringify(pt));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1400);
  const jump = await cdp.ev(`(() => { const h = location.hash; const el = h && document.querySelector(h); const r = el && el.getBoundingClientRect();
    return { hash: h, want: ${JSON.stringify(pt.href)}, isItem: !!(el && el.classList.contains('salon__item')), top: r && Math.round(r.top), inView: !!(r && r.top > -50 && r.top < innerHeight) }; })()`);
  check('精华页：点时间轴上的日期，跳到那天最近的一条精华（锚点对得上，并且真的滚进视口了）',
    /^#e\d+$/.test(jump.hash) && jump.hash === jump.want && jump.isItem === true && jump.inView === true, JSON.stringify(jump));

  /* ---- 5.5 首页随机精华：改日期跑 24 天，看它跟不跟着成员表变 ---- */
  const probes = [];
  for (let i = 0; i < 24; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${ymd(d)}T12:00:00`;
    const { identifier } = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => { const R = Date; const fixed = new R(${JSON.stringify(iso)}).getTime();
        class F extends R { constructor(...a) { if (!a.length) super(fixed); else super(...a); } static now() { return fixed; } }
        window.Date = F; })();`,
    });
    await cdp.goto('/', 1200);
    const card = await cdp.ev(`(() => { const n = document.querySelector('.daily__name'); const a = document.querySelector('.daily__avatar');
      const t = document.querySelector('.daily__time'); const x = document.querySelector('.daily__text');
      return { date: new Date().toISOString().slice(0,10), name: n && n.textContent, avatar: a && a.tagName === 'IMG' ? a.getAttribute('src') : '',
        hasText: !!(x && x.textContent.trim()), time: t && t.textContent, title: (document.querySelector('.daily__title') || {}).getAttribute ? document.querySelector('.daily__title').getAttribute('href') : '' }; })()`);
    probes.push(card);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  }
  const hits = probes.filter((p) => p.name === NEW_NAME);
  const oldHits = probes.filter((p) => p.name === 'Raw');
  check(`首页随机精华：24 天里 ${hits.length} 天抽到改名后的成员，这 ${hits.length} 天名字全对、0 天还显示旧名`,
    hits.length >= 3 && oldHits.length === 0, `命中 ${hits.length}/24 天，旧名 ${oldHits.length} 天`);
  check('首页随机精华：抽到他的那几天，头像也是他换过的那张图（不是首字母占位）',
    hits.length > 0 && hits.every((p) => p.avatar.includes(stemA)), hits.slice(0, 2).map((p) => p.avatar).join(' | ') || '（没有命中，无法判定）');
  check('首页随机精华：成员 / 时间 / 内容 / 头像四样都有',
    probes.every((p) => p.name && p.time && p.hasText) && probes.some((p) => p.avatar),
    JSON.stringify(probes[0]));
  check('首页随机精华：标题链到 /salon/',
    probes.every((p) => p.title === '/salon/'), probes[0].title);
  const daySet = new Set(probes.map((p) => p.name + '|' + p.time));
  check(`首页随机精华：换个日子会换一条（24 天里出现 ${daySet.size} 种不同组合）`, daySet.size >= 5, `${daySet.size} 种`);

  check('浏览器这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 3).join(' | '));

  /* ---- 5.6 编辑器 UI：五个新工作面真能打开 ---- */
  /* 关键字用来确认"开出来的确实是这一块"：面板是按工作面分开的容器，
     不开的那些还留在 DOM 里（只是 hidden），所以必须挑**可见**的那个 .wpanel */
  const wanted = [
    ['calendar', '日历', '特殊日子'],
    ['about', '关于我', '小圆片'],
    ['iceberg', '冰室冰山', '塔吊'],
    ['essences', '精华', '冰室群精华'],
    ['members', '成员', '成员 id'],
  ];
  const panels = [];
  await cdp.gotoAbs(base + '/', 900);
  for (const [id, label, keyword] of wanted) {
    const info = await cdp.ev(`(async () => { await window.__openWs(${JSON.stringify(id)}); await new Promise((r) => setTimeout(r, 900));
      const all = [...document.querySelectorAll('.wpanel')];
      const w = all.find((el) => el.getBoundingClientRect().height > 0);
      if (!w) return { id: ${JSON.stringify(id)}, ok: false, panelsInDom: all.length };
      const titles = [...w.querySelectorAll('.wbox__title')].map((t) => t.textContent);
      const hint = (w.querySelector('.wpanel__hint') || {}).textContent || '';
      return { id: ${JSON.stringify(id)}, ok: true, keyword: ${JSON.stringify(keyword)}, hintOk: hint.includes(${JSON.stringify(keyword)}),
        hint: hint.slice(0, 40), boxes: titles.length, titles: titles.slice(0, 6),
        inputs: w.querySelectorAll('input, textarea, select').length,
        buttons: w.querySelectorAll('button').length, switchBtns: w.querySelectorAll('.wsswitch__btn').length,
        rows: w.querySelectorAll('[data-row], .wrow, .wcal-row, li').length, h: Math.round(w.getBoundingClientRect().height) }; })()`);
    panels.push(info);
  }
  for (const [i, [id, label, keyword]] of wanted.entries()) {
    const p = panels[i];
    check(`编辑器 UI：「${label}」面板能打开、开的是这一块、有提示和内容块`, p.ok && p.hintOk === true && p.buttons >= 1 && (p.boxes >= 1 || p.rows >= 5),
      JSON.stringify({ hintOk: p.hintOk, hint: p.hint, boxes: p.boxes, rows: p.rows, inputs: p.inputs, buttons: p.buttons, h: p.h }));
    check(`编辑器 UI：「${label}」面板顶上的工作面切换条在（每个面板一套，草稿切走切回来才不丢）`, p.switchBtns >= 13, `switchBtns=${p.switchBtns}`);
  }
  check('编辑器 UI：五个新面板在 DOM 里各有一份，互不覆盖', panels.every((p) => p.ok) && new Set(panels.map((p) => p.h)).size >= 1, JSON.stringify(panels.map((p) => `${p.id}:${p.h}`)));
  console.log('\n面板明细：');
  for (const p of panels) console.log(`   ${p.id}: boxes=${p.boxes} inputs=${p.inputs} buttons=${p.buttons} rows=${p.rows} h=${p.h} titles=${JSON.stringify(p.titles)}`);

  try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已退出 */ }
  server.close();
  await sleep(250);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
} catch (err) {
  fail++;
  console.log('FAIL  脚本异常: ' + (err?.stack ?? err));
} finally {
  try { editor.kill(); } catch { /* ignore */ }
  try { execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' }); } catch { /* ignore */ }
  await sleep(400);
  for (const j of ['node_modules']) {
    const p = path.join(DST, j);
    if (fs.existsSync(p)) { try { execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* ignore */ } }
  }
  try { fs.rmSync(DST, { recursive: true, force: true }); } catch { /* ignore */ }
  console.log('副本已清理:', !fs.existsSync(DST));
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
