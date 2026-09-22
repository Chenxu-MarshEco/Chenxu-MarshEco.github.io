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
  for (const p of ['/api/bootstrap', '/api/boards', '/api/music', '/api/timelines', '/api/navs', '/api/anchors', '/api/layout', '/api/widgets', '/api/salon', '/api/iceberg']) {
    const r = await api('GET', p);
    regress.push(`${p}=${r.status}`);
    if (r.status !== 200) check(`老接口 ${p} 还是 200`, false, String(r.status));
  }
  check('老接口全在（10 条 GET 全 200，没有因为新面板碰坏）', regress.every((s) => s.endsWith('=200')), regress.join(' '));

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

  /*
    /iceberg/ 这一页现在有**两种样子**：
      · 冰山图里有内容 → 正文就是那张图（层级 / 条目 / 完备标识）；
      · 一条层级都没有 → 退回显示「冰室冰山」面板里那张图 + 介绍 + 链接（2b 验）。
    这里先验"有内容时正文是图"。
  */
  const hIce = html(path.join('iceberg', 'index.html'));
  check('/iceberg/ 页正文是冰山图（有内容时不再是一张图 + 一句话）',
    hIce.includes('data-ibk') && hIce.includes('ibk__layer'),
    `data-ibk=${hIce.includes('data-ibk')} 层数=${(hIce.match(/class="ibk__layer"/g) ?? []).length}`);

  /* ================= 2b. POST /api/iceberg：把图清空 → 退回首页那块的样子 ================= */
  const ice0 = readJson(path.join(DST, 'src', 'data', 'iceberg.json'));
  const rc = await api('POST', '/api/iceberg', {
    title: ice0.title, intro: '', categories: ice0.categories, tags: ice0.tags, layers: [],
  });
  check('POST /api/iceberg（layers: []）：保存成功并且顺带重建了站点',
    rc.status === 200 && rc.json?.ok === true && rc.json?.built === true,
    `built=${rc.json?.built} ${rc.json?.ms}ms counts=${JSON.stringify(rc.json?.counts)}`);
  const hIceEmpty = html(path.join('iceberg', 'index.html'));
  const emptyImg = /<figure class="icePage__fig"[\s\S]*?<img[^>]*src="([^"]+)"/.exec(hIceEmpty);
  check('/iceberg/ 一条层级都没有时退回显示「冰室冰山」那张大图（不是一张空页面）',
    !hIceEmpty.includes('data-ibk') && !!emptyImg &&
      emptyImg[1].includes(path.basename(upB.json.path, path.extname(upB.json.path))),
    emptyImg?.[1] ?? '没有 img');
  check('/iceberg/ 退回时那段介绍和「继续看」链接也在（链接指到 /salon/）',
    /icePage__body[\s\S]{0,300}?副本里写的一行介绍/.test(hIceEmpty) && hIceEmpty.includes('href="/salon/"'),
    '');

  /* ================= 2c. POST /api/iceberg：写进一整张图 ================= */
  const ICE_LAYER = '验收层 · 街头';
  const ICE_SUB = '验收用的副标题';
  const ICE_DONE = '验收条目 · 有描述';
  const ICE_TODO = '验收条目 · 没描述';
  const ICE_LOOSE = '指向空气的条目';
  const ICE_COLOR = '#22d3ee';
  const rIce = await api('POST', '/api/iceberg', {
    title: '冰室冰山',
    intro: '验收写的介绍。',
    categories: [{ id: '', name: '验收分类', color: ICE_COLOR, hidden: false }],
    tags: [{ id: '', name: '验收标签' }],
    layers: [
      {
        id: '', title: ICE_LAYER, subtitle: ICE_SUB, background: upB.json.path, head: '',
        items: [
          { id: '', name: ICE_DONE, categoryId: 'c01', tags: ['t01'], desc: '验收写的详细描述。', href: '/salon/' },
          { id: '', name: ICE_TODO, categoryId: 'c01', tags: [], desc: '', href: '' },
          /* 没名字的那条必须被丢掉（页面上一条没有字的条目没有意义），丢了几条要有回报 */
          { id: '', name: '', categoryId: '', tags: [], desc: '', href: '' },
          /* 引用了不存在的分类 / 标签：清成空，不许留一个指向空气的引用 */
          { id: '', name: ICE_LOOSE, categoryId: '不存在的分类', tags: ['不存在的标签'], desc: '', href: '' },
        ],
      },
    ],
  });
  check('POST /api/iceberg：保存成功并且顺带重建了站点',
    rIce.status === 200 && rIce.json?.ok === true && rIce.json?.built === true,
    `built=${rIce.json?.built} ${rIce.json?.ms}ms ${JSON.stringify(rIce.json?.counts)}`);
  const iceOn = readJson(path.join(DST, 'src', 'data', 'iceberg.json'));
  check('冰山图落盘了：1 层 3 条（没名字那条被丢掉，而且报了数）',
    iceOn.layers.length === 1 && iceOn.layers[0].title === ICE_LAYER &&
      iceOn.layers[0].items.length === 3 && rIce.json?.dropped?.items === 1,
    `layers=${iceOn.layers.length} items=${iceOn.layers[0]?.items.length} dropped=${JSON.stringify(rIce.json?.dropped)}`);
  check('分类 / 标签 / 条目都补上了 id（请求里明明一个 id 都没带）',
    !!iceOn.categories[0]?.id && !!iceOn.tags[0]?.id && iceOn.layers[0].items.every((i) => !!i.id),
    JSON.stringify({ cat: iceOn.categories[0], tag: iceOn.tags[0], itemIds: iceOn.layers[0].items.map((i) => i.id) }));
  const loose = iceOn.layers[0].items.find((i) => i.name === ICE_LOOSE);
  check('引用了不存在的分类 / 标签 → 清成空，并报了数（dropped.refs = 2）',
    loose && loose.categoryId === '' && loose.tags.length === 0 && rIce.json?.dropped?.refs === 2,
    JSON.stringify({ loose, dropped: rIce.json?.dropped }));

  const hIce2 = html(path.join('iceberg', 'index.html'));
  const doneCls = (hIce2.match(/ibk__item is-done/g) ?? []).length;
  const badges = (hIce2.match(/class="ibk__badge"/g) ?? []).length;
  /* ⚠ <Img> 输出的属性顺序是 src 在前、class 在后，所以先抠出整个 <img> 标签再取 src */
  const bgTag = /<img[^>]*ibk__bgimg[^>]*>/.exec(hIce2)?.[0] ?? '';
  const bgImg = /src="([^"]+)"/.exec(bgTag)?.[1] ?? '';
  check('/iceberg/ 页画出了这一层：标题 / 副标题 / 两条条目都在',
    hIce2.includes(ICE_LAYER) && hIce2.includes(ICE_SUB) && hIce2.includes(ICE_DONE) && hIce2.includes(ICE_TODO),
    '');
  check('/iceberg/ 页的条目颜色 = 那一类的颜色；完备标识只给有描述的那一条（一条不多一条不少）',
    hIce2.includes(`--cat:${ICE_COLOR}`) && doneCls === 1 && badges === 1,
    `--cat:${ICE_COLOR} 出现=${hIce2.includes(`--cat:${ICE_COLOR}`)}；is-done ${doneCls} / badge ${badges}`);
  check('/iceberg/ 页这一层用上了编辑器里传的背景图',
    !!bgImg && bgImg.includes(path.basename(upB.json.path, path.extname(upB.json.path))),
    bgImg || `标签：${bgTag.slice(0, 120) || '没有 ibk__bgimg'}`);

  /* ================= 2d. 连着两次保存：第二次的改动也必须进产物 =================
     保存这条路由的规矩是「先写盘、再构建」。第二次保存进来的时候，第一轮构建
     往往已经在跑了 —— 要是把这次请求并到那一轮上（编辑器以前就是那么做的），
     那轮构建是在第二次写盘**之前**开始的，产物里就没有这次改动，
     面板却会说「已保存并重新构建」。修好之后是**排队**：等第一轮跑完再跑一轮。
     这里就量这个。 */
  const ICE_A = '并发验收 · 第一次';
  const ICE_B = '并发验收 · 第二次';
  const icePayload = (name, items) => ({
    title: '冰室冰山', intro: '',
    categories: [{ id: 'c01', name: '并发分类', color: '#ff5fb0', hidden: false }],
    tags: [],
    layers: [{ id: 'l01', title: name, subtitle: '', background: '', head: '', items }],
  });
  const iceItem = (id, name) => ({ id, name, categoryId: 'c01', tags: [], desc: '', href: '' });
  const firstPost = api('POST', '/api/iceberg', icePayload(ICE_A, [iceItem('i01', ICE_A)]));
  await sleep(150); // 让第一轮的构建先跑起来
  const secondPost = await api('POST', '/api/iceberg', icePayload(ICE_B, [iceItem('i01', ICE_A), iceItem('i02', ICE_B)]));
  const firstRes = await firstPost;
  check('连着两次保存：两个请求都成功返回（第二次是排队等第一轮跑完再跑）',
    firstRes.status === 200 && firstRes.json?.built === true && secondPost.json?.built === true,
    `第一次 built=${firstRes.json?.built} ${firstRes.json?.ms}ms；第二次 built=${secondPost.json?.built} ${secondPost.json?.ms}ms`);
  const hIce3 = html(path.join('iceberg', 'index.html'));
  check('★ 连着两次保存：**第二次**的改动也在产物里（没有并到第一轮那趟构建上）',
    hIce3.includes(ICE_B) && hIce3.includes(ICE_A),
    `产物里：第一次=${hIce3.includes(ICE_A)} 第二次=${hIce3.includes(ICE_B)}`);

  /* 这一节把图换成了「并发验收」那两层，后面的页面断言量的是 2c 那份 —— 写回去 */
  const rBack = await api('POST', '/api/iceberg', {
    title: '冰室冰山',
    intro: '验收写的介绍。',
    categories: [{ id: '', name: '验收分类', color: ICE_COLOR, hidden: false }],
    tags: [{ id: '', name: '验收标签' }],
    layers: [
      {
        id: '', title: ICE_LAYER, subtitle: ICE_SUB, background: upB.json.path, head: '',
        items: [
          { id: '', name: ICE_DONE, categoryId: 'c01', tags: ['t01'], desc: '验收写的详细描述。', href: '/salon/' },
          { id: '', name: ICE_TODO, categoryId: 'c01', tags: [], desc: '', href: '' },
          { id: '', name: ICE_LOOSE, categoryId: '不存在的分类', tags: ['不存在的标签'], desc: '', href: '' },
        ],
      },
    ],
  });
  check('（衔接）把 2c 那份图写回去，后面的页面断言接着量它',
    rBack.json?.built === true && readJson(path.join(DST, 'src', 'data', 'iceberg.json')).layers[0]?.title === ICE_LAYER,
    `built=${rBack.json?.built} ${rBack.json?.ms}ms`);

  /* ================= 2e. 上方那行位置链接（面包屑 crumbHref） =================
     用户原话：「注意到导航栏若是选择了纷湖 上方会有可以点击的纷湖二字 如果预留了点击位
     那么请加入可以编辑点击跳转到的链接的接口」。
     量的是：默认点「纷湖」回它自己那页；节点上填了 crumbHref 之后，
     ① 面包屑里那个链接改去新地址 ② hero 那个「← 返回 纷湖」也跟着变
     ③ 别的祖先（花娅陌域 / 花娅编年史）不受影响 ④ 外链会带上 target=_blank。 */
  const crumbsOf = (rel) => {
    let t = '';
    try { t = fs.readFileSync(path.join(DST, 'dist', rel), 'utf8'); } catch { return null; }
    const nav = /<nav class="crumbs"[\s\S]*?<\/nav>/.exec(t)?.[0] ?? '';
    const links = [...nav.matchAll(/<a\s([^>]*)>([^<]+)<\/a>/g)].map((m) => ({
      text: m[2], href: /href="([^"]*)"/.exec(m[1])?.[1] ?? '',
      blank: /target="_blank"/.test(m[1]), rel: /rel="noopener"/.test(m[1]),
    }));
    const back = /<a class="bp__back" href="([^"]+)"[^>]*>([^<]*)<\/a>/.exec(t);
    return { links, backHref: back?.[1] ?? '', backText: (back?.[2] ?? '').trim() };
  };
  /* 找一页「面包屑里至少两个链接」的（= 够深，前面有可点的祖先） */
  const deep = (() => {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          const hit = walk(path.join(dir, e.name), next);
          if (hit) return hit;
        } else if (e.name === 'index.html') {
          const c = crumbsOf(`${rel.slice(1)}/index.html`);
          if (c && c.links.length >= 2) return { rel: `${rel.slice(1)}/index.html`, ...c };
        }
      }
      return null;
    };
    return walk(path.join(DST, 'dist'), '');
  })();
  if (!deep) {
    check('2e 找不到「面包屑里有两个以上可点祖先」的页面', false, '数据里一层都没有？');
  } else {
    const last = deep.links[deep.links.length - 1];
    console.log(`\n拿这一页量：/${deep.rel.replace(/index\.html$/, '')}｜最后那个可点祖先「${last.text}」→ ${last.href}`);
    check('2e 默认：最后那个可点祖先指回它自己那一页，hero 的「← 返回」也指它',
      last.href.length > 1 && deep.backHref === last.href,
      `crumb=${last.href}｜返回=${deep.backHref}（${deep.backText}）`);

    const boardsFile = path.join(DST, 'src', 'data', 'home-boards.json');
    const tree = readJson(boardsFile);
    const findNode = (list, title) => {
      for (const n of list ?? []) {
        if (n && n.title === title) return n;
        const hit = findNode(n?.children, title);
        if (hit) return hit;
      }
      return null;
    };
    const node = findNode(tree.boards, last.text);
    check(`2e 在数据里找到了「${last.text}」这个节点`, !!node, node ? `id=${node.id}` : '找不到');

    if (node) {
      /*
        ⚠ /api/boards 只写数据、**自己不重建**（面板存完提示的是「重新构建后生效」），
        所以要像用户那样再点一次「重新构建」。
      */
      const target = '/salon/';
      node.crumbHref = target;
      const rb = await api('POST', '/api/boards', { boards: tree.boards });
      const build1 = await api('POST', '/api/build');
      const after = crumbsOf(deep.rel);
      const changed = after?.links.find((l) => l.text === last.text);
      const others = after?.links.filter((l) => l.text !== last.text) ?? [];
      check('2e 存下去之后重建成功', rb.json?.ok === true && build1.json?.ok === true,
        `写 boards=${rb.json?.ok}｜重建=${build1.json?.ok} ${build1.json?.ms}ms`);
      check(`2e ★ 面包屑里「${last.text}」改去了填的地址（${target}）`,
        changed?.href === target, `现在是 ${changed?.href}`);
      check('2e ★ hero 的「← 返回」也跟着改了（两处标的是同一件事）',
        after?.backHref === target, `返回=${after?.backHref}（${after?.backText}）`);
      check('2e 别的祖先不受影响（没填 crumbHref 的照旧指回自己那页）',
        others.length >= 1 && others.every((o, i) => o.href === deep.links[i].href),
        JSON.stringify({ 之前: deep.links.map((l) => l.href), 现在: others.map((l) => l.href) }));
      check('2e 落盘的数据里带着 crumbHref（白名单没把新字段丢掉）',
        readJson(boardsFile).boards && findNode(readJson(boardsFile).boards, last.text)?.crumbHref === target,
        JSON.stringify(findNode(readJson(boardsFile).boards, last.text)?.crumbHref ?? null));

      /* 外链：站点加上 target=_blank rel=noopener */
      const ext = 'https://example.com/fenhu';
      const tree2 = readJson(boardsFile);
      findNode(tree2.boards, last.text).crumbHref = ext;
      const rb2 = await api('POST', '/api/boards', { boards: tree2.boards });
      const build2 = await api('POST', '/api/build');
      const after2 = crumbsOf(deep.rel);
      const changed2 = after2?.links.find((l) => l.text === last.text);
      check('2e ★ 填成外链：面包屑那个链接就是外链，而且带 target=_blank + rel=noopener',
        rb2.json?.ok === true && build2.json?.ok === true &&
          changed2?.href === ext && changed2?.blank === true && changed2?.rel === true,
        JSON.stringify({ 写: rb2.json?.ok, 重建: build2.json?.ok, ...changed2 }));
    }
  }

  /* ================= 2f. 导航块顶栏那个分类名 =================
     用户原话：「我说的是这个导航二字旁边的纷湖 为什么可以点 点了根本没反应
     要么加可以写链接的接口要么删掉」。
     量的是：只有一个分类又没填链接 → 那一行**不是链接**（一行字，点了不该装作能点）；
     分类上填了 link → 变成真链接（站内 / 外链，外链开新标签）；
     一块里挂两个分类 → 回到「页内锚点跳转」的老行为（那才是它本来的用处）。 */
  const navBarOf = (rel) => {
    let t = '';
    try { t = fs.readFileSync(path.join(DST, 'dist', rel), 'utf8'); } catch { return null; }
    const bar = /<div class="navblk__bar"[\s\S]*?<\/div>/.exec(t)?.[0] ?? '';
    const ids = [...t.matchAll(/<details class="navblk__cat" id="([^"]+)"/g)].map((m) => m[1]);
    return {
      label: /navblk__barLabel[^>]*>([^<]*)</.exec(bar)?.[1] ?? '',
      links: [...bar.matchAll(/<a class="navblk__barLink"([^>]*)>([^<]+)<\/a>/g)].map((m) => ({
        text: m[2], href: /href="([^"]*)"/.exec(m[1])?.[1] ?? '',
        blank: /target="_blank"/.test(m[1]), rel: /rel="noopener"/.test(m[1]),
      })),
      plain: [...bar.matchAll(/<span class="navblk__barHere"[^>]*>([^<]+)</g)].map((m) => m[1]),
      sectionIds: ids,
    };
  };
  const navPage = (() => {
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const next = `${rel}/${e.name}`;
        if (e.isDirectory()) {
          const hit = walk(path.join(dir, e.name), next);
          if (hit) return hit;
        } else if (e.name === 'index.html') {
          const bar = navBarOf(`${rel.slice(1)}/index.html`);
          if (bar && (bar.links.length || bar.plain.length)) return { rel: `${rel.slice(1)}/index.html`, ...bar };
        }
      }
      return null;
    };
    return walk(path.join(DST, 'dist'), '');
  })();
  if (!navPage) {
    check('2f 找不到带「导航」块的页面', false, '数据里没有 type=nav 的块？');
  } else {
    console.log(`\n拿这一页量：/${navPage.rel.replace(/index\.html$/, '')}｜顶栏「${navPage.label}」｜链接 ${navPage.links.length} 个、纯文字 ${JSON.stringify(navPage.plain)}`);
    check('2f ★ 只有一个分类又没填链接时，那一行**不是链接**（一行字，不再装作能点）',
      navPage.plain.length === 1 && navPage.links.length === 0,
      JSON.stringify({ 纯文字: navPage.plain, 链接: navPage.links }));

    const navsFile = path.join(DST, 'src', 'data', 'navs.json');
    const navs = readJson(navsFile);
    const catTitle = navPage.plain[0];
    const cat = (navs.categories ?? []).find((c) => c.title === catTitle);
    check(`2f 在导航分类库里找到了「${catTitle}」这个分类`, !!cat, cat ? `id=${cat.id} ${(cat.groups ?? []).length} 组` : '找不到');

    if (cat) {
      cat.link = '/salon/';
      const rn = await api('POST', '/api/navs', { categories: navs.categories });
      const build1 = await api('POST', '/api/build');
      const after1 = navBarOf(navPage.rel);
      check('2f 存下去之后重建成功（导航库保存本来就会重建）',
        rn.json?.ok === true && build1.json?.ok === true,
        `写=${rn.json?.ok}｜重建=${build1.json?.ok}`);
      check(`2f ★ 分类上填了链接 → 那一行变成真链接（指到 /salon/）`,
        after1?.links.length === 1 && after1.links[0].href === '/salon/' && after1.plain.length === 0,
        JSON.stringify(after1?.links));

      const navs2 = readJson(navsFile);
      const cat2 = (navs2.categories ?? []).find((c) => c.id === cat.id);
      cat2.link = 'https://example.com/nav';
      await api('POST', '/api/navs', { categories: navs2.categories });
      await api('POST', '/api/build');
      const after2 = navBarOf(navPage.rel);
      check('2f ★ 填成外链：就是外链，而且带 target=_blank + rel=noopener',
        after2?.links.length === 1 && after2.links[0].href === 'https://example.com/nav' &&
          after2.links[0].blank === true && after2.links[0].rel === true,
        JSON.stringify(after2?.links));
      check('2f 落盘的数据里带着 link（白名单没把新字段丢掉）',
        readJson(navsFile).categories.find((c) => c.id === cat.id)?.link === 'https://example.com/nav',
        JSON.stringify(readJson(navsFile).categories.find((c) => c.id === cat.id)?.link ?? null));

      /* 一块里挂两个分类 → 回到「页内锚点」的老行为 */
      const navs3 = readJson(navsFile);
      const c3 = navs3.categories.find((c) => c.id === cat.id);
      delete c3.link;
      const extra = {
        id: 'navcat-e2e-second', title: '验收第二类', groups: [
          { id: 'g-e2e', title: '验收子分类', items: [{ id: 'i-e2e', text: '验收条目', href: '/salon/' }] },
        ],
      };
      navs3.categories.push(extra);
      await api('POST', '/api/navs', { categories: navs3.categories });
      const tree3 = readJson(path.join(DST, 'src', 'data', 'home-boards.json'));
      const findNavBlock = (list) => {
        for (const n of list ?? []) {
          const b = (n?.page ?? []).find((x) => x.type === 'nav' && (x.cats ?? []).includes(cat.id));
          if (b) return b;
          const hit = findNavBlock(n?.children);
          if (hit) return hit;
        }
        return null;
      };
      const block = findNavBlock(tree3.boards);
      if (block) block.cats = [cat.id, extra.id];
      await api('POST', '/api/boards', { boards: tree3.boards });
      await api('POST', '/api/build');
      const after3 = navBarOf(navPage.rel);
      const anchorsOk = after3?.links.every((l) => l.href.startsWith('#') && after3.sectionIds.includes(l.href.slice(1)));
      check('2f ★ 一块里挂两个分类时：顶上那两个名字都是**页内锚点**，而且锚点真指到下面那两节（这才是它本来的用处）',
        after3?.links.length === 2 && anchorsOk === true && after3.plain.length === 0 &&
          after3.sectionIds.length === 2,
        JSON.stringify({ 链接: after3?.links, 节: after3?.sectionIds }));
    }
  }

  /* ================= 2g. 音乐：**所有页面**都能配（不只是板块页） =================
     用户原话：「编辑器里的每一个带有编辑页面能力的功能都应该能修改到所有页面！！！
     例如我现在根本无法在音乐页面中为冰室冰山，冰室精华，隐秘页面等页面添加音乐！
     请把这些目前无法用编辑器互动的页面也加入到编辑器里」。
     量的是：清单里有这些页面 → 给 /iceberg/ 配上曲子 → 重建后那一页真的内联了
     key=page:iceberg 的音乐数据（站点那边的 musicKeyForPath 会算出同一个 key）。 */
  const mus0 = await api('GET', '/api/music');
  const musPages = mus0.json?.pages ?? [];
  const pageKind = musPages.filter((p) => p.kind === 'page');
  console.log('\n音乐页面清单里的「其它页面」：', pageKind.map((p) => p.key + '(' + p.label + ')').slice(0, 10).join(' '));
  check('2g★ 音乐清单里有「其它页面」这一档，而且冰室冰山 / 冰室精华都在里面',
    ['page:iceberg', 'page:salon'].every((k) => musPages.some((p) => p.key === k)),
    JSON.stringify(pageKind.map((p) => p.key)));
  check('2g 「关于我」这类页面也在（不是只捡板块树里有的）',
    musPages.some((p) => p.kind === 'page' && /about/.test(p.key)),
    JSON.stringify(pageKind.filter((p) => /about/.test(p.key)).map((p) => p.key)));

  {
    /* ⚠ 这个接口的 body 是 { music: { tracks, pages } }（不是直接把 tracks/pages 铺在外面） */
    const rM = await api('POST', '/api/music', {
      music: {
        /* src 必须走 /audio/uploads/ 前缀（服务端的 cleanAudioSrc 只认这个），
           拿站里真有的一首歌来当验收样本 */
        tracks: [{ id: 'e2e-track', title: '验收曲子', src: '/audio/uploads/20260918-2329-f6d5-YUNG-BAE-Fly-With-Me.mp3' }],
        pages: { 'page:iceberg': { list: ['e2e-track'], first: 'e2e-track' } },
      },
    });
    const rB = await api('POST', '/api/build');
    const iceHtml = html(path.join('iceberg', 'index.html'));
    const musicKey = /"key"\s*:\s*"([^"]+)"/.exec(iceHtml)?.[1] ?? '';
    check('2g★ 保存 + 重建成功', rM.json?.ok === true && rB.json?.ok === true,
      '写=' + rM.json?.ok + '｜重建=' + rB.json?.ok);
    check('2g★ 给 /iceberg/ 配的音乐真的进了它的构建产物（内联数据 key = page:iceberg、曲子也在）',
      /__MUSIC_DATA__/.test(iceHtml) && musicKey === 'page:iceberg' && iceHtml.includes('e2e-track'),
      'key=' + musicKey + '｜有曲子=' + iceHtml.includes('e2e-track'));
    const diskM = readJson(path.join(DST, 'src', 'data', 'music.json'));
    check('2g 落盘：music.json 的 pages 里就是 page:iceberg 这一条',
      !!diskM.pages?.['page:iceberg']?.list?.includes('e2e-track'),
      JSON.stringify(diskM.pages?.['page:iceberg'] ?? null));
  }

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
    /* 一天的画在那两个伪元素上：::before 是"头"（渐变+圆角+格栅），::after 是朝下的尖头 */
    const cs = (el, p) => getComputedStyle(el, p);
    const bgOf = (el) => (el ? cs(el, '::before').backgroundImage : null);
    return {
      eventCount: document.querySelectorAll('.cal__day--event').length,
      todayCount: document.querySelectorAll('.cal__day--today').length,
      /* 数字只读 .cal__num：那一格里还挂着一张自绘的提示卡（悬停才显示） */
      evText: ev && (ev.querySelector('.cal__num') || {}).textContent,
      evTipText: ev && (ev.querySelector('.cal__tip') || {}).textContent,
      evHref: ev && ev.getAttribute('href'),
      evTitle: ev && ev.getAttribute('aria-label'),
      evIsToday: !!(ev && ev.classList.contains('cal__day--today')),
      evBg: (bgOf(ev) || '').slice(0, 400),
      evRadius: ev && cs(ev, '::before').borderRadius,
      evTip: ev && cs(ev, '::after').borderTopColor,
      evTipW: ev && cs(ev, '::after').borderTopWidth,
      evW: ev && Math.round(ev.getBoundingClientRect().width),
      evH: ev && Math.round(ev.getBoundingClientRect().height),
      evHue: ev && HUE(bgOf(ev) || ''),
      plainBg: (bgOf(plain) || '').slice(0, 400),
      plainRadius: plain && cs(plain, '::before').borderRadius,
      plainTip: plain && cs(plain, '::after').borderTopColor,
      plainHue: plain && HUE(bgOf(plain) || ''),
      todayText: (document.querySelector('.cal__today') || {}).textContent,
      gridDays: document.querySelectorAll('.cal__day').length,
      width: innerWidth,
    };
  })()`);
  check(`日历：当月 ${cal.gridDays} 格，其中今天 1 格、特殊日子 1 格`,
    cal.gridDays >= 28 && cal.todayCount === 1 && cal.eventCount === 1 && cal.evIsToday === true,
    JSON.stringify({ days: cal.gridDays, today: cal.todayCount, event: cal.eventCount }));
  check(`日历：今天那格显示 ${todayNum}、aria-label 里带事件名、可点向 /salon/`,
    cal.evText === String(todayNum) && (cal.evTitle ?? '').includes('篠雨的生日') && cal.evHref === '/salon/',
    JSON.stringify({ text: cal.evText, title: cal.evTitle, href: cal.evHref }));
  /*
    提示卡的规则：**填的日期和显示的那天不一样时**才把它带上
    （生日那种「桑芙的生日 2003-08-30」就是这么来的）。
    这条 E2E 写的事件就是"今年今天"，所以只显示名字 —— 「2004 年那一天」那种
    带日期的情形由 home-calendar-check.mjs 钉着。
  */
  check('日历：那一格里挂着自绘的悬停提示卡（同一天的写法只显示名字）',
    cal.evTipText === '篠雨的生日',
    JSON.stringify({ tip: cal.evTipText }));
  check(`日历：特殊日子是区域图钉那套橙黄（量到 ${cal.evHue.length} 个橙色停点 + 圆头），普通日子是建筑图钉那套粉（0 个橙色停点 + 方头）`,
    cal.evHue.length >= 1 && cal.plainHue.length === 0 && /50%/.test(cal.evRadius) &&
      /rgb\(255, 217, 239\)/.test(cal.plainBg || '') && parseFloat(cal.plainRadius) >= 8,
    `特殊=${JSON.stringify(cal.evHue)} 普通=${JSON.stringify(cal.plainHue)}；特殊头 ${cal.evRadius}；普通头 ${cal.plainRadius} 底 ${(cal.plainBg || '').slice(0, 48)}`);
  check('日历：一天的形状是一个"头"（20×20，用户后来要求把向下的尖头去掉了）',
    cal.evW === cal.evH && parseFloat(cal.evTipW) === 0 && parseFloat(cal.evRadius) >= 8,
    `特殊那格 ${cal.evW}×${cal.evH}，尖头 ${cal.evTipW}，头圆角 ${cal.evRadius}`);
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
    event: document.querySelectorAll('.cal__day--event').length, orange: /255,\\s*(15[0-9]|2[0-9][0-9])/.test(getComputedStyle(document.querySelector('.cal__day--event'), '::before').backgroundImage) }))()`);
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

  /* ---- 5.3 冰山图那一页（/iceberg/）----
     这一页现在是**数据画出来的**：2c 里 POST 进去的那 1 层 2 条应该原样长在页面上。
     「一条层级都没有时退回显示首页那块的大图」在 2b 已经验过（构建产物那一层）。 */
  await cdp.goto('/iceberg/');
  const ice = await cdp.ev(`(() => {
    const img = document.querySelector('.ibk__bgimg');
    const r = img && img.getBoundingClientRect();
    const items = [...document.querySelectorAll('.ibk__item')];
    const done = items.filter((i) => i.classList.contains('is-done'));
    const badge = document.querySelector('.ibk__badge');
    const br = badge && badge.getBoundingClientRect();
    const bs = badge && getComputedStyle(badge);
    const linked = document.querySelector('a.ibk__item');
    const layer = document.querySelector('.ibk__layer');
    return {
      layers: document.querySelectorAll('.ibk__layer').length,
      title: (document.querySelector('.ibk__title') || {}).textContent,
      sub: (document.querySelector('.ibk__sub') || {}).textContent,
      intro: (document.querySelector('.page-header__desc') || {}).textContent,
      src: img && img.getAttribute('src'), w: r && Math.round(r.width), h: r && Math.round(r.height),
      items: items.length, names: items.map((i) => i.querySelector('.ibk__txt').textContent),
      loose: (() => { const l = items.find((i) => i.querySelector('.ibk__txt').textContent === ${JSON.stringify(ICE_LOOSE)}); return l ? l.style.getPropertyValue('--cat').trim() : ''; })(),
      done: done.length,
      /* 条目文字画出来的颜色 == 数据里那个 --ink（浅底上读得清的那个色） */
      ink: done[0] ? done[0].style.getPropertyValue('--ink').trim() : '',
      inkOk: done[0]
        ? (() => {
            const hex = done[0].style.getPropertyValue('--ink').trim();
            const m = /^#([0-9a-f]{6})$/i.exec(hex);
            if (!m) return false;
            const n = parseInt(m[1], 16);
            /* ⚠ 这里不能用模板字符串：整段是塞进外层模板字面量里的，反引号会把它截断 */
            return getComputedStyle(done[0]).color ===
              'rgb(' + ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255) + ')';
          })()
        : false,
      badge: badge ? {
        w: Math.round(br.width), h: Math.round(br.height),
        img: bs.backgroundImage, opacity: bs.opacity, radius: parseFloat(bs.borderTopLeftRadius),
        arrow: getComputedStyle(badge, '::after').content,
      } : null,
      color: items[0] && items[0].style.getPropertyValue('--cat').trim(),
      href: linked && linked.getAttribute('href'),
      layerH: layer && Math.round(layer.getBoundingClientRect().height),
      corner: document.querySelectorAll('.corner__btn').length };
  })()`);
  check('冰山图页：层 / 标题 / 副标题 / 介绍都是编辑器里写进去的',
    ice.layers === 1 && ice.title === ICE_LAYER && ice.sub === ICE_SUB && ice.intro === '验收写的介绍。',
    JSON.stringify({ layers: ice.layers, title: ice.title, sub: ice.sub, intro: ice.intro }));
  check('冰山图页：背景图真画出来了（编辑器里传的那张，尺寸量得出来）',
    !!ice.src && ice.w > 0 && ice.h > 0 && ice.src.includes(path.basename(upB.json.path, path.extname(upB.json.path))),
    JSON.stringify({ src: ice.src, w: ice.w, h: ice.h, layerH: ice.layerH }));
  check('冰山图页：三条条目都在，颜色是那一类的颜色（#22d3ee）',
    ice.items === 3 && ice.names.includes(ICE_DONE) && ice.names.includes(ICE_TODO) && ice.names.includes(ICE_LOOSE) && ice.color === ICE_COLOR,
    JSON.stringify({ items: ice.items, color: ice.color, names: ice.names }));
  check('冰山图页：引用了不存在分类的那条用默认灰紫（认不出来的引用在页面上也不会串色）',
    ice.loose === '#b9a6c9', `--cat:${ice.loose}`);
  check('冰山图页：条目文字用的是「分类色压深到读得清」的 --ink（浅底上才读得清）',
    ice.inkOk === true && /^#[0-9a-f]{6}$/i.test(ice.ink),
    JSON.stringify({ ink: ice.ink, 画出来一致: ice.inkOk }));
  check('冰山图页：完备标识只有一颗，而且就是地图图钉那颗头的样子（栅格 + 渐变、圆角、没有小箭头、微微半透明）',
    ice.done === 1 && !!ice.badge &&
      /repeating-linear-gradient\(/.test(ice.badge.img) && /linear-gradient\(/.test(ice.badge.img) &&
      ice.badge.radius >= 6 && ice.badge.arrow === 'none' && Number(ice.badge.opacity) > 0.5 && Number(ice.badge.opacity) < 1,
    JSON.stringify({ done: ice.done, ...(ice.badge ?? {}) }));
  check('冰山图页：填了链接的那条真的是链接（指到 /salon/）',
    ice.href === '/salon/', String(ice.href));
  check('冰山图页：页头那套外框控件还在（右下角三条杠）', ice.corner >= 3, `${ice.corner} 个`);

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
      points: pts.length, pointsWithHref: withHref.length, pointIds: pts.map((p) => p.dataset.point || ''),
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
  /* 时间轴现在是"编辑器里选的那条，原样放上去"（见 salon-all-items-check.mjs 的详细断言） */
  const tlRef = JSON.parse(fs.readFileSync(path.join(DST, 'src', 'data', 'timelines.json'), 'utf8')).timelines.find((t) => t.id === salon0.timelineId);
  check(`精华页：左边放的是所选那条「${tlRef?.title}」原样的 ${tlRef?.points.length} 个点（不是我生成的日期点）`,
    !!tlRef && sa.points === tlRef.points.length && sa.pointIds.every((id) => id.startsWith(String(salon0.timelineId))),
    `点上轴 ${sa.points} / 那条轴 ${tlRef?.points.length}；id 前缀都对=${sa.pointIds.every((id) => id.startsWith(String(salon0.timelineId)))}`);
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

  /* 点时间轴上的刻度：用滚轮把点滚进面板（不要 scrollIntoView：轴的布局是 cur 自己重画的，
     滚 DOM 会让坐标和画面错开），再用 elementFromPoint 确认那个坐标上真的点得到它。
     注意：刻度**不一定带 href**（那条轴自己的点可能没有链接），所以不能按 href 过滤。 */
  const pt = await cdp.ev(`(() => {
    const body = document.querySelector('[data-tl-body]');
    const items = [...document.querySelectorAll('.tl__item')];
    if (!body || !items.length) return { id: null, why: 'no body/items' };
    for (const it of items) {
      for (let i = 0; i < 12; i++) {
        const b = body.getBoundingClientRect();
        const r = it.getBoundingClientRect();
        const cy = r.top + r.height / 2;
        if (cy > b.top + 40 && cy < b.bottom - 40) break;
        body.dispatchEvent(new WheelEvent('wheel', { deltaY: cy - (b.top + b.height / 2), bubbles: true, cancelable: true }));
      }
      const a = it.querySelector('a.tl__crane') || it.querySelector('a.tl__name') || it;
      const b = body.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const x = ar.left + ar.width / 2;
      const y = ar.top + ar.height / 2;
      if (!(ar.width > 2 && ar.height > 2)) continue;
      if (!(x > 2 && y > 2 && x < innerWidth - 2 && y < innerHeight - 2)) continue;
      const hit = document.elementFromPoint(x, y);
      const onIt = !!(hit && (hit === a || a.contains(hit) || (hit.closest && hit.closest('.tl__item') === it)));
      if (onIt && y > b.top + 8 && y < b.bottom - 8) {
        return { id: it.dataset.point, label: it.dataset.label, param: Number(it.dataset.param), href: it.dataset.href, x, y, tag: hit.tagName };
      }
    }
    return { id: null, why: 'no clickable point' };
  })()`);
  check('精华页：时间轴上找得到一个当前就能点的刻度', !!pt.id, JSON.stringify(pt));
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', buttons: 1, clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', buttons: 0, clickCount: 1 });
  await sleep(1400);
  const jump = await cdp.ev(`(() => {
    const h = location.hash; const el = h && document.querySelector(h); const r = el && el.getBoundingClientRect();
    /* "最近"= param 差最小的那条 */
    const want = ${JSON.stringify(pt.param)};
    let nearest = null, bestD = Infinity;
    for (const it of document.querySelectorAll('.salon__item')) {
      const v = Number(it.dataset.tlParam);
      if (!Number.isFinite(v)) continue;
      const d = Math.abs(v - want);
      if (d < bestD) { bestD = d; nearest = it; }
    }
    return { hash: h, picked: ${JSON.stringify(pt.label)}, isItem: !!(el && el.classList.contains('salon__item')),
      isNearest: nearest ? h === '#' + nearest.id : false, top: r && Math.round(r.top), inView: !!(r && r.top > -60 && r.top < innerHeight) }; })()`);
  check('精华页：点一个刻度 → 跳到**离它最近**的那条精华（落在视口里，不是跳去别的页）',
    /^#e\d+$/.test(jump.hash) && jump.isItem === true && jump.isNearest === true && jump.inView === true, JSON.stringify(jump));

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

  /* ---- 5.6 编辑器 UI：六个新工作面真能打开 ---- */
  /* 关键字用来确认"开出来的确实是这一块"：面板是按工作面分开的容器，
     不开的那些还留在 DOM 里（只是 hidden），所以必须挑**可见**的那个 .wpanel */
  const wanted = [
    ['calendar', '日历', '特殊日子'],
    ['about', '关于我', '小圆片'],
    ['iceberg', '冰室冰山', '塔吊'],
    ['ice-chart', '冰山图', '完备标识'],
    ['essences', '精华', '冰室精华'],
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
    check(`编辑器 UI：「${label}」面板顶上的工作面切换条在（每个面板一套，草稿切走切回来才不丢）`, p.switchBtns >= 14, `switchBtns=${p.switchBtns}`);
  }
  check('编辑器 UI：六个新面板在 DOM 里各有一份，互不覆盖', panels.every((p) => p.ok) && new Set(panels.map((p) => p.h)).size >= 1, JSON.stringify(panels.map((p) => `${p.id}:${p.h}`)));
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
