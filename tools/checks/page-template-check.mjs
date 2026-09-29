/*
 * ============================================================================
 * 页面模版（保存 / 导入）的验收
 * ----------------------------------------------------------------------------
 * 用户原话（2026-09-28）：
 *   「可以看到在纷湖下的【隰辰煦家】和【虹星家】这两个页面 两者结构完全一样 由目录
 *    主要建筑 溪流之外的轶事 画廊 导航 这些板块组成 现在我要编写第三个板块【吉吉家】了
 *    如果再来一遍这些构筑很麻烦 所以需要一个保存模版功能 可以把一个页面的结构保存下来
 *    文字图片等内容不进行保存 并且命名为xx模板 然后在新建的页面可以导入模版 选择xx模板
 *    即可导入这个页面的结构」
 *
 * 四段：
 *   ① 脱内容：模版块数与类型序列和源页面一致；文字只剩小标题；图片地址/说明、地图的图与图钉、
 *              链接、卡片指向的 id 一个都不许留；排版设置（图片宽窄 / 卡片比例）要留着
 *   ② 接口：列表 / 取一份 / 同名再存就是更新 / 空名与没内容的页面要报错 / 改名重名 409 / 删除
 *   ③ 导入到新页面（真跑）：拿模版建一个「吉吉家」，构建后产物里的小节顺序与块类型序列一致，
 *              而且**没有**把隰辰煦家的文字和图片带过去
 *   ④ 界面（真浏览器）：页面工作台里点「存成模版」「导入模版」，草稿块数与状态栏都对得上
 *
 * 用法：node tools/checks/page-template-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const DST = path.join(SRC, '.tmp', 'tpl-copy');
const DIST = path.join(SRC, 'dist');
const PORT = 4488;
const DEBUG_PORT = 9458;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const BOARDS = path.join(SRC, 'src/data/home-boards.json');
const TPL = path.join(SRC, 'src/data/page-templates.json');
const SRC_NODE = 'page-mu9fd13e'; // 隰辰煦家

for (const [label, p] of [['home-boards.json', BOARDS], ['page-templates.json', TPL]]) {
  if (!fs.existsSync(p)) {
    console.error(`找不到 ${label}（${p}）`);
    process.exit(2);
  }
}

const find = (nodes, id) => {
  for (const n of nodes || []) {
    if (!n) continue;
    if (n.id === id) return n;
    const hit = find(n.children, id);
    if (hit) return hit;
  }
  return null;
};
const boards = readJson(BOARDS);
const page = find(boards.boards, SRC_NODE);
const tplData = readJson(TPL);
const home = tplData.templates.find((t) => t.name === '家页模板') ?? tplData.templates[0];

/* ================================================================
 * ① 脱内容
 * ================================================================ */
console.log('================ ① 模版里只留结构 ================');
const srcTypes = (page.page ?? []).map((b) => b.type);
const tplTypes = (home?.blocks ?? []).map((b) => b.type);
info(`源页面「${page.title}」${srcTypes.length} 块：${[...new Set(srcTypes)].join('/')}`);
info(`模版「${home?.name}」${tplTypes.length} 块：${[...new Set(tplTypes)].join('/')}`);

check('★ 模版是从「隰辰煦家」存的（来源记着）',
  home?.from?.href === '/huaya/years/fenhu/xichenxuhome' && home?.from?.title === '隰辰煦家',
  JSON.stringify(home?.from));
check('★ 块数和类型序列与源页面**一模一样**（结构原样搬过来）',
  tplTypes.length === srcTypes.length && tplTypes.join(',') === srcTypes.join(','),
  `${tplTypes.length} vs ${srcTypes.length}`);

const tplText = JSON.stringify(home?.blocks ?? []);
check('★ 图片地址一个都没带过来（/img/ 不出现）', !tplText.includes('/img/'));
check('★ 图片说明（alt）也没带', !tplText.includes('"alt"'));
check('★ 正文没带过来（抽查源页面里的一句原话）',
  !tplText.includes('最早建成的建筑') && !tplText.includes('樱花屋顶形态'));
check('地图块：图和图钉都不带（markers 全空）',
  (home?.blocks ?? []).filter((b) => b.type === 'map').every((b) => (b.pages ?? []).every((pg) => !pg.src && (pg.markers ?? []).length === 0)) &&
    (home?.blocks ?? []).some((b) => b.type === 'map'));
check('卡片 / 卡片框指向的子页面 id 清空了（换一页就指不到了）',
  (home?.blocks ?? []).every((b) => (b.type === 'card' ? b.ref === '' : b.type === 'cardbox' ? (b.refs ?? []).length === 0 : true)));

/* 小标题：源页面里的 ## / ### 应该一个不少 */
const headsOf = (blocks) =>
  blocks
    .filter((b) => b.type === 'text')
    .flatMap((b) => String(b.text ?? '').split('\n').map((l) => l.trim()).filter((l) => /^#{2,4}\s+\S/.test(l)));
const srcHeads = headsOf(page.page ?? []);
const tplHeads = headsOf(home?.blocks ?? []);
info(`小标题：源 ${srcHeads.length} 条 → 模版 ${tplHeads.length} 条`);
check('★ 小节名一个不少（主要建筑 / 溪流之外的轶事 / 画廊 / 导航…）',
  srcHeads.length === tplHeads.length && srcHeads.join('|') === tplHeads.join('|'),
  `${tplHeads.length} 条`);
check('★ 那四句"板块名"确实在模版里',
  ['## 主要建筑', '## 溪流之外的轶事', '## 画廊', '## 导航'].every((h) => tplHeads.includes(h)),
  tplHeads.slice(0, 4).join(' '));
check('文字块里除了小标题没有别的东西（正文都被剪掉了）',
  (home?.blocks ?? [])
    .filter((b) => b.type === 'text')
    .every((b) => String(b.text ?? '').split('\n').every((l) => !l.trim() || /^#{2,4}\s+\S/.test(l.trim()))));

/* 排版设置得留着 */
const widths = (blocks) => blocks.filter((b) => b.type === 'image').map((b) => b.width ?? 'wide');
check('★ 图片块一个不少、宽窄（排版）也留着',
  widths(home?.blocks ?? []).length === widths(page.page ?? []).length &&
    widths(home?.blocks ?? []).join(',') === widths(page.page ?? []).join(','),
  `${widths(home?.blocks ?? []).length} 张：${[...new Set(widths(home?.blocks ?? []))].join('/')}`);
check('导航块：引用的是哪几个分类留着（分类库是站点级的）',
  JSON.stringify((home?.blocks ?? []).find((b) => b.type === 'nav')?.cats ?? []) ===
    JSON.stringify((page.page ?? []).find((b) => b.type === 'nav')?.cats ?? []),
  JSON.stringify((home?.blocks ?? []).find((b) => b.type === 'nav')?.cats));
check('目录块也在（最上面那一块）', (home?.blocks ?? [])[0]?.type === 'toc');

/* ================================================================
 * ② 接口行为（副本里真跑）
 * ================================================================ */
console.log('\n================ ② 存 / 取 / 改名 / 删除 ================');
if (fs.existsSync(DST)) {
  const j = path.join(DST, 'node_modules');
  if (fs.existsSync(j)) { try { execSync(`cmd /c rmdir "${j}"`, { stdio: 'ignore' }); } catch { /* 不是 junction */ } }
  fs.rmSync(DST, { recursive: true, force: true });
}
fs.mkdirSync(DST, { recursive: true });
for (const item of ['src', 'tools', 'astro.config.mjs', 'package.json', 'tsconfig.json']) {
  fs.cpSync(path.join(SRC, item), path.join(DST, item), { recursive: true });
}
fs.cpSync(path.join(SRC, 'public'), path.join(DST, 'public'), {
  recursive: true,
  filter: (from) => !path.relative(path.join(SRC, 'public'), from).replace(/\\/g, '/').startsWith('img/opt'),
});
fs.mkdirSync(path.join(DST, 'public/img/opt'), { recursive: true });
fs.copyFileSync(path.join(SRC, 'public/img/opt/manifest.json'), path.join(DST, 'public/img/opt/manifest.json'));
execSync(`cmd /c mklink /J "${path.join(DST, 'node_modules')}" "${path.join(SRC, 'node_modules')}"`, { stdio: 'ignore' });
console.log('副本就绪：', DST);

const editor = spawn(process.execPath, [path.join(DST, 'tools/editor/server.mjs')], {
  cwd: DST,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 400 && !base; i++) {
  await sleep(150);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
if (!base) {
  console.error('副本里的编辑器没起来：' + elog.slice(-400));
  process.exit(2);
}
info('副本里的编辑器在 ' + base);

const copyTplFile = path.join(DST, 'src/data/page-templates.json');
const copyBoardsFile = path.join(DST, 'src/data/home-boards.json');
const api = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, json: await r.json().catch(() => null) };
};
const post = async (body) => {
  const r = await fetch(`${base}/api/templates`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
};

{
  const list = await api('/api/templates');
  check('GET /api/templates：列出模版（名字 / 来源 / 块数 / 类型）',
    list.status === 200 && list.json?.templates?.length >= 1 &&
      list.json.templates[0].name === '家页模板' && list.json.templates[0].blocks === srcTypes.length,
    JSON.stringify(list.json?.templates?.[0] ?? null));
  check('列表里**不带** blocks（面板不需要那一坨）',
    !('blocks' in (list.json?.templates?.[0] ?? {})) || typeof list.json.templates[0].blocks === 'number');

  const one = await api(`/api/templates?id=${encodeURIComponent(list.json.templates[0].id)}`);
  check('GET /api/templates?id=：取到某一份的完整 blocks',
    one.status === 200 && Array.isArray(one.json?.template?.blocks) &&
      one.json.template.blocks.length === srcTypes.length,
    `${one.json?.template?.blocks?.length} 块`);
  check('取不到就 404', (await api('/api/templates?id=nope')).status === 404);
}

{
  /* 同名再存一次 = 就地更新 */
  const before = readJson(copyTplFile).templates.length;
  const again = await post({ action: 'save', name: '家页模板', nodeId: SRC_NODE });
  const after = readJson(copyTplFile);
  check('同名再存一次 = 更新那一份（不堆出第二个「家页模板」）',
    again.status === 200 && again.json?.replaced === true && after.templates.length === before,
    `replaced=${again.json?.replaced}，共 ${after.templates.length} 份`);

  /* 拿虹星家再存一份（用户说过这两页结构一样） */
  const other = await post({ action: 'save', name: '家页模板2', nodeId: 'page-mu9hfl5z' });
  const otherTpl = readJson(copyTplFile).templates.find((t) => t.name === '家页模板2');
  check('再存一份别的页面（虹星家）也没问题',
    other.status === 200 && !!otherTpl && otherTpl.blocks.length > 0,
    `${otherTpl?.blocks?.length} 块，来自 ${otherTpl?.from?.title}`);
  const twoHeads = ((b) => b.filter((x) => x.type === 'text').flatMap((x) => String(x.text ?? '').split('\n').map((l) => l.trim()).filter((l) => /^#{2,4}\s/.test(l))))(otherTpl?.blocks ?? []);
  info('虹星家的小节：' + twoHeads.join(' | '));

  /* 错误路径 */
  const noName = await post({ action: 'save', name: '   ', nodeId: SRC_NODE });
  check('空名字 → 400', noName.status === 400, String(noName.json?.error));
  /*
    「没有内容块的页面」要**现找一个**：用户随时在编辑器里加页面、也可能删页面 ——
    写死一个 id（以前写的是 huaya-a-2）第二天就找不到人了。
    找法：树里第一个既没有 page、也没有 children、也不是链接版块的节点。
    找不到就跳过这一条（有就一定要报 400）。
  */
  const emptyNode = (() => {
    const walk = (nodes) => {
      for (const n of nodes ?? []) {
        if (!n) continue;
        if (!n.link && !(n.page ?? []).length && !(n.children ?? []).length) return n;
        const hit = walk(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return walk(readJson(copyBoardsFile).boards);
  })();
  if (emptyNode) {
    const empty = await post({ action: 'save', name: '空页面模版', nodeId: emptyNode.id });
    check(`没有内容块的页面（${emptyNode.title}）→ 400，并说清为什么`,
      empty.status === 400 && /没有内容块|没什么结构/.test(String(empty.json?.error)), String(empty.json?.error));
  } else {
    info('树里没有"既没内容也没子版块"的页面，跳过那条 400');
  }

  /* 改名 / 删除 */
  const id = readJson(copyTplFile).templates.find((t) => t.name === '家页模板2').id;
  const clash = await post({ action: 'rename', id, name: '家页模板' });
  check('改名撞上已有的名字 → 409', clash.status === 409, String(clash.json?.error));
  const renamed = await post({ action: 'rename', id, name: '小木屋模板' });
  check('改名成功', renamed.status === 200 && renamed.json?.template?.name === '小木屋模板');
  const del = await post({ action: 'delete', id });
  check('删除成功，列表少一份',
    del.status === 200 && !readJson(copyTplFile).templates.some((t) => t.id === id));
  check('删不存在的 → 404', (await post({ action: 'delete', id: 'nope' })).status === 404);
  check('不认识的 action → 400', (await post({ action: 'wat' })).status === 400);
}

/* ================================================================
 * ③ 导入到一个新页面（真构建）
 * ================================================================ */
console.log('\n================ ③ 拿模版建「吉吉家」 ================');
{
  /*
    模拟客户端导入：把模版里的块换上这一页的 id，挂到「纷湖」下面。
    这一步和编辑器里点「导入模版」得到的东西**一模一样**（同一份 blocks）。

    ⚠ 地址必须**先确认没人用**：用户 2026-09-28 就是在编辑器里自己建了「吉吉家」
    （href 恰好是我原本写死的那一个），两个节点撞同一个地址时 site 只生成先出现的
    那个 —— 我这一页就整页空白，量出来的块数是 0（这一次就是这么踩到的）。
  */
  const tree = readJson(copyBoardsFile);
  const usedUrls = new Set();
  (function collect(nodes) {
    for (const n of nodes ?? []) {
      if (!n) continue;
      if (n.href) usedUrls.add(String(n.href).replace(/\/+$/, ''));
      collect(n.children);
    }
  })(tree.boards);
  let href = '/huaya/years/fenhu/tpl-verify';
  for (let i = 2; usedUrls.has(href) && i < 50; i++) href = `/huaya/years/fenhu/tpl-verify-${i}`;
  const fenhu = find(tree.boards, 'huaya-r2-1') ?? tree.boards[0];
  const blocks = readJson(copyTplFile).templates.find((t) => t.name === '家页模板').blocks;
  const jiji = {
    id: 'page-tpl-verify',
    title: '模版验收页',
    subtitle: '拿家页模板建的',
    href,
    page: blocks.map((b, i) => {
      const out = { ...b, id: `page-tpl-verify-p${i + 1}` };
      if (out.type === 'map' && Array.isArray(out.pages)) {
        out.pages = out.pages.map((pg, k) => ({ ...pg, id: `page-tpl-verify-p${i + 1}-m${k + 1}` }));
      }
      return out;
    }),
  };
  fenhu.children = [...(fenhu.children ?? []), jiji];
  fs.writeFileSync(copyBoardsFile, `${JSON.stringify(tree, null, 2)}\n`, 'utf8');
  info(`新建「${jiji.title}」：${jiji.page.length} 块，挂在「${fenhu.title}」下面，地址 ${href}`);

  const built = spawn(process.execPath, [path.join(SRC, 'node_modules/astro/bin/astro.mjs'), 'build'], {
    cwd: DST,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  built.stdout.on('data', (d) => { out += d; });
  built.stderr.on('data', (d) => { out += d; });
  const ok = await new Promise((res) => built.on('close', (code) => res(code === 0)));
  check('拿模版建出来的新页面能正常构建', ok, out.split(/\r?\n/).filter((l) => /error|Error/.test(l)).slice(-2).join(' | '));
  check('构建日志里没有"地址撞了"的告警（这一页的地址是独一无二的）',
    !out.includes('页面地址撞了'), out.split(/\r?\n/).filter((l) => l.includes('撞')).slice(0, 2).join(' | '));

  const file = path.join(DST, `dist${href}/index.html`);
  check('产物里有这一页', fs.existsSync(file), `dist${href}/index.html`);
  if (fs.existsSync(file)) {
    const html = fs.readFileSync(file, 'utf8');
    const strip = (h) => h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
    const flat = strip(html);
    /* 小节标题按顺序出现（就是模版里那些 ## / ###） */
    const idx = tplHeads.map((h) => ({ h: h.replace(/^#+\s*/, ''), at: flat.indexOf(h.replace(/^#+\s*/, '')) }));
    const missing = idx.filter((x) => x.at < 0).map((x) => x.h);
    const ordered = idx.every((x, i) => i === 0 || x.at >= idx[i - 1].at);
    check('★ 小节名全在、而且顺序和模版一致（主要建筑 → 溪流之外的轶事 → 画廊 → 导航）',
      missing.length === 0 && ordered, missing.length ? `缺：${missing.join('、')}` : '都在，顺序对');
    check('★ 那一页上没有隰辰煦家的文字（正文没被带过来）',
      !flat.includes('最早建成的建筑') && !flat.includes('樱花屋顶形态'));
    check('★ 也没有隰辰煦家的图片（图片块留着，但都是空的，页面上不画图）',
      (flat.match(/class="pfigure"/g) || []).length === 0,
      `${(flat.match(/class="pfigure"/g) || []).length} 张图`);
    check('导航块照旧渲出来了（引用的是同一个分类）',
      /class="pnav|pnavig|navblk/.test(flat) || flat.includes('导航'), '页面上有导航块');
    /*
      块的类型序列：站点会**跳过空格子**（空图 / 空视频 / 空链接 / 带 placeholder 的
      空地图与空两栏）—— 它们画不出东西，读者不该看见。所以这里按同一套规则
      先筛一遍模版，再和页面上的对齐。
    */
    const renderedTypes = (blocks) =>
      blocks
        .filter((b) => {
          if (b.type === 'image' || b.type === 'video') return !!String(b.src ?? '').trim();
          if (b.type === 'link') return !!String(b.text ?? '').trim() && !!String(b.href ?? '').trim();
          if (b.type === 'columns') {
            return !!String(b.left ?? '').trim() || !!String(b.right ?? '').trim();
          }
          if (b.type === 'map') return (b.pages ?? []).some((pg) => String(pg?.src ?? '').trim());
          return true;
        })
        .map((b) => b.type);
    const wantTypes = renderedTypes(home.blocks);
    const gotTypes = (html.match(/data-block-type="([^"]+)"/g) || []).map((s) => s.replace(/.*"([^"]+)"/, '$1'));
    check('这一页的块类型序列 = 模版的类型序列（空格子按站点的规则跳过之后一模一样）',
      gotTypes.length > 0 && gotTypes.join(',') === wantTypes.join(','),
      `${gotTypes.length} 块；模版 ${home.blocks.length} 块里有 ${home.blocks.length - wantTypes.length} 个空格子`);
  }
}

/* ================================================================
 * ④ 界面：真浏览器点一遍
 * ================================================================ */
console.log('\n================ ④ 界面里点「存成模版 / 导入模版」 ================');
const profile = path.join(process.env.TEMP ?? '.', `dsh-tpl-${Date.now()}`);
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
  '--enable-unsafe-swiftshader', '--disable-breakpad', '--window-size=1440,960',
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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push(m.params.exceptionDetails?.exception?.description ?? '');
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
  async open(u, wait = 1200) {
    this.errors = [];
    await this.send('Page.navigate', { url: u });
    for (let i = 0; i < 200; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}
let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const p = list.find((t) => t.type === 'page');
    if (p) cdp = await CDP.attach(p.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) {
  console.error('Chromium 没起来');
  editor.kill();
  process.exit(2);
}
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 960, deviceScaleFactor: 1, mobile: false });

await cdp.open(base + '/', 1400);
/* 面板里的 prompt / confirm 换成固定答案（不然 headless 下会卡住） */
await cdp.ev(`window.prompt = () => '验收模板'; window.confirm = () => true; 1`);

/*
  在左栏那棵树里挑两个"看得见、块又多"的页面。
  ⚠ 两件事都别写死：
    · 树是**可折叠**的、而且**独立页面不在树里**（用户 2026-09-28 把几个页面改成了
      独立页面），写死「隰辰煦家」会点空 —— 第一次跑就是这么翻车的；
    · 块数取现成的，断言才有意义。
*/
const treePages = [];
(function walkTree(nodes) {
  for (const n of nodes ?? []) {
    if (!n || n.link || n.standalone === true) continue;
    treePages.push({ id: n.id, title: n.title, blocks: (n.page ?? []).length });
    walkTree(n.children);
  }
})(readJson(copyBoardsFile).boards);
treePages.sort((a, b) => b.blocks - a.blocks);
const pageA = treePages[0];
const pageB = treePages.find((p) => p.id !== pageA.id && p.blocks >= 1) ?? treePages[1];
info(`界面这一段用这两页：A=「${pageA.title}」（${pageA.blocks} 块）、B=「${pageB.title}」（${pageB.blocks} 块）`);

const pickPage = (name) => `(async () => {
  const box = document.getElementById('pw-search');
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(box, ${JSON.stringify(name)});
  box.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 700));
  const items = [...document.querySelectorAll('.pw-tree__item')];
  const hit = items.find((el) => (el.querySelector('.pw-tree__name') || {}).textContent === ${JSON.stringify(name)});
  if (!hit) return { ok: false, items: items.length, names: items.map((el) => (el.querySelector('.pw-tree__name') || {}).textContent) };
  hit.click();
  await new Promise((r) => setTimeout(r, 1000));
  const field = [...document.querySelectorAll('#pw-fields input')].map((i) => i.value);
  return { ok: true, blocks: document.querySelectorAll('#page-editor .pblock-edit').length, field };
})()`;

const opened = await cdp.ev(`(async () => {
  await window.__openWs('pages');
  await new Promise((r) => setTimeout(r, 1400));
  return { ws: !!document.getElementById('pages-modal') && !document.getElementById('pages-modal').hidden };
})()`);
check('页面工作台打得开', opened.ws === true, JSON.stringify(opened));

const pickA = await cdp.ev(pickPage(pageA.title));
info(`选「${pageA.title}」：` + JSON.stringify(pickA));
check(`★ 左栏搜索能选中页面（选的确实是「${pageA.title}」）`,
  pickA.ok === true && (pickA.field ?? []).includes(pageA.title), JSON.stringify(pickA));
check(`★ 选中之后块列表画出来了（${pageA.blocks} 块）`, pickA.blocks === pageA.blocks, `${pickA.blocks} 块`);
const picked = await cdp.ev(`(() => ({
  tplBtns: [...document.querySelectorAll('.pblock-tpl button')].map((b) => b.textContent.trim()),
}))()`);
check('「这一页的内容」下面有「存成模版 / 导入模版」两颗按钮',
  Array.isArray(picked.tplBtns) && picked.tplBtns.length === 2 &&
    picked.tplBtns.some((t) => t.includes('存成模版')) && picked.tplBtns.some((t) => t.includes('导入模版')),
  JSON.stringify(picked.tplBtns));

/* 点「存成模版」→ 面板里应该多一份「验收模板」 */
const saved = await cdp.ev(`(async () => {
  const btn = [...document.querySelectorAll('.pblock-tpl button')].find((b) => b.textContent.includes('存成模版'));
  btn.click();
  await new Promise((r) => setTimeout(r, 900));
  const t = document.getElementById('toast');
  return { toast: t && !t.hidden ? t.textContent : '' };
})()`);
info('存成模版：' + JSON.stringify(saved));
check('★ 点「存成模版」→ 提示里报出名字和块数',
  /已存成模版「验收模板」（\d+ 块）/.test(saved.toast || ''), String(saved.toast));
{
  const stored = readJson(copyTplFile).templates.find((t) => t.name === '验收模板');
  check(`★ 盘上真的多了一份「验收模板」（来源是「${pageA.title}」、块数对得上）`,
    !!stored && stored.from.title === pageA.title && stored.blocks.length === pageA.blocks,
    stored ? `${stored.blocks.length} 块，来自 ${stored.from.title}` : '没找到');
}

/* 换到另一页（pageB）再点「导入模版」→ 挑「验收模板」→ 草稿块数变多 */
const pickB = await cdp.ev(pickPage(pageB.title));
info(`选「${pageB.title}」：` + JSON.stringify(pickB));
check(`★ 换到另一页「${pageB.title}」也选得中`, pickB.ok === true && pickB.blocks === pageB.blocks, JSON.stringify(pickB));
const imported = await cdp.ev(`(async () => {
  const before = document.querySelectorAll('#page-editor .pblock-edit').length;
  const open = [...document.querySelectorAll('.pblock-tpl button')].find((b) => b.textContent.includes('导入模版'));
  open.click();
  await new Promise((r) => setTimeout(r, 800));
  const modal = document.getElementById('tpl-modal');
  const rows = [...document.querySelectorAll('#tpl-list .tplrow')];
  const pick = rows.find((r) => (r.querySelector('.tplrow__name') || {}).textContent === '验收模板') || rows[0];
  const name = (pick.querySelector('.tplrow__name') || {}).textContent || '';
  const importBtn = [...pick.querySelectorAll('button')].find((b) => b.textContent.trim() === '导入');
  importBtn.click();
  await new Promise((r) => setTimeout(r, 1200));
  const after = document.querySelectorAll('#page-editor .pblock-edit').length;
  const status = [...document.querySelectorAll('.wpanel__status, .pstudio__status')].map((s) => s.textContent).filter(Boolean);
  const t = document.getElementById('toast');
  return { modalShown: modal && !modal.hidden, names: rows.map((r) => (r.querySelector('.tplrow__name') || {}).textContent), name, before, after,
    toast: t && !t.hidden ? t.textContent : '', status, blocksInModal: rows.length };
})()`);
info('导入模版：' + JSON.stringify({ ...imported, names: imported.names }));
check('★ 点「导入模版」弹出面板，里面列着刚存的那份',
  imported.names.includes('验收模板'), JSON.stringify(imported.names));
check('★ 点「导入」之后这一页的草稿块数变多了（结构加进来了）',
  imported.after === imported.before + pageA.blocks,
  `${imported.before} → ${imported.after}（期望 +${pageA.blocks}）`);
check('导入后面板关掉了、提示里报了块数',
  imported.modalShown === false && /已导入模版「验收模板」（\d+ 块）/.test(imported.toast || ''),
  String(imported.toast));
check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

/* 面板里「删除」也要能用 */
const deleted = await cdp.ev(`(async () => {
  const open = [...document.querySelectorAll('.pblock-tpl button')].find((b) => b.textContent.includes('导入模版'));
  open.click();
  await new Promise((r) => setTimeout(r, 700));
  const rows = [...document.querySelectorAll('#tpl-list .tplrow')];
  const pick = rows.find((r) => (r.querySelector('.tplrow__name') || {}).textContent === '验收模板');
  const del = pick && [...pick.querySelectorAll('button')].find((b) => b.textContent.trim() === '删除');
  if (!del) return { ok: false };
  del.click();
  await new Promise((r) => setTimeout(r, 900));
  return { ok: true, names: [...document.querySelectorAll('#tpl-list .tplrow__name')].map((n) => n.textContent) };
})()`);
check('★ 面板里能删掉模版（删完它就不在列表里了）',
  deleted.ok === true && !deleted.names.includes('验收模板'), JSON.stringify(deleted.names));
check('删除之后盘上也没了', !readJson(copyTplFile).templates.some((t) => t.name === '验收模板'));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
editor.kill();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
