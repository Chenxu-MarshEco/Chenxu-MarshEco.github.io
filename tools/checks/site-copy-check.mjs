/*
 * ============================================================================
 * 「站点文案」面板的验收（2026-10-11）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   ①「红圈里这句话改为 等待篠雨的日子里    另外说了不要留任何这种ds味很浓的难以阅读的句子」
 *   ②「要清的都是这些编辑器里编辑不了且我之前也没有要求需要有这些句子存在的句子」
 *   ③「如果你无法判断就都把那种句子加上编辑器可以修改的接口」
 *
 * 于是站点上那些**写死、站长改不了**的介绍 / 说明句搬进了 `src/data/site-copy.json`，
 * 编辑器多了一个「文案」面板（一格一句，留空 = 那一块整块不渲染）。
 * 这个脚本量三件事：
 *
 *   ① **三处对齐**（不启浏览器就能查）：数据文件 `src/data/site-copy.json`、
 *      服务端白名单 `SITE_COPY_SHAPE`（tools/editor/server.mjs）、
 *      面板字段 `COPY_FIELDS`（tools/editor/ui/app.js）—— 少一处就会出
 *      "面板上有格子但存不进去" / "数据里有键但没人读" 这种哑巴亏。
 *   ② **旧句子真的搬走了**：挑几条以前写死在页面里的句子，确认源码里再也找不到它们
 *      （它们现在只住在 JSON 里）。这条是防"改一半留一半"。
 *   ③ **真编辑器 + 真构建**：打开面板 → 每一格都画出来且值和盘上一致 →
 *      改一格 → 保存并重新构建 → **dist 里那一段变成新值** →
 *      清空一格 → 保存 → **那一段整块消失** → 超长被拒 →
 *      最后按原样恢复并重新构建（这个脚本是"会改数据"的那种，跑完必须还原）。
 *
 * 用法：node tools/checks/site-copy-check.mjs
 *   需要编辑器端口 4322 能起来（脚本自己起一个）；构建是本仓库的 astro build。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { chromePath } from './lib/chrome.mjs';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const COPY_FILE = path.join(SRC, 'src', 'data', 'site-copy.json');
const SERVER = path.join(SRC, 'tools', 'editor', 'server.mjs');
const APPJS = path.join(SRC, 'tools', 'editor', 'ui', 'app.js');
const DIST = path.join(SRC, 'dist');
const CHROME = chromePath();
const EDITOR = 'http://127.0.0.1:4322';
const DEBUG_PORT = 9413;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const read = (f) => fs.readFileSync(f, 'utf8');

/* ============================================================ ① 三处对齐 */

console.log('=== ① 三处对齐：数据 / 服务端白名单 / 面板字段 ===');
const copyData = JSON.parse(read(COPY_FILE));
const serverSrc = read(SERVER);
const appSrc = read(APPJS);

/** 从服务端抠出 SITE_COPY_SHAPE：{ 组: [键…] } */
const shapeSrc = /const SITE_COPY_SHAPE = \{([\s\S]*?)\n\};/.exec(serverSrc)?.[1] ?? '';
const shape = {};
for (const m of shapeSrc.matchAll(/^\s{2}(\w+):\s*\{([^}]*)\}/gm)) {
  shape[m[1]] = [...m[2].matchAll(/(\w+):\s*\d+/g)].map((x) => x[1]);
}
/** 从面板抠出 COPY_FIELDS：['组.键'…] */
const fieldsSrc = /const COPY_FIELDS = \[([\s\S]*?)\n\];/.exec(appSrc)?.[1] ?? '';
const panelKeys = [...fieldsSrc.matchAll(/group:\s*'([^']+)',\s*key:\s*'([^']+)'/g)].map((m) => `${m[1]}.${m[2]}`);
/** 数据文件里的键（跳过 _readme） */
const dataKeys = [];
for (const [g, v] of Object.entries(copyData)) {
  if (g === '_readme' || !v || typeof v !== 'object') continue;
  for (const k of Object.keys(v)) dataKeys.push(`${g}.${k}`);
}
const shapeKeys = Object.entries(shape).flatMap(([g, keys]) => keys.map((k) => `${g}.${k}`));

const same = (a, b) => a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');
info(`数据 ${dataKeys.length} 格 · 白名单 ${shapeKeys.length} 格 · 面板 ${panelKeys.length} 格`);
check('★ 数据文件里的键 == 服务端白名单', same(dataKeys, shapeKeys), `数据少/多的：${dataKeys.filter((k) => !shapeKeys.includes(k)).join(',') || '—'}`);
check('★ 面板字段 == 服务端白名单（面板上有的都存得进去）', same(panelKeys, shapeKeys), `面板少/多的：${panelKeys.filter((k) => !shapeKeys.includes(k)).join(',') || '—'}`);
check('★ 白名单不认识的键真的会被丢掉（cleanSiteCopy 只按 SHAPE 收）',
  /for \(const \[group, keys\] of Object\.entries\(SITE_COPY_SHAPE\)\)/.test(serverSrc));
check('★ _readme 以盘上那份为准（面板冲不掉它）', /if \(Array\.isArray\(current\._readme\)\) file\._readme = current\._readme/.test(serverSrc));
check('★ 超长直接报错（不悄悄截断）', /太长/.test(serverSrc) && /throw httpError\(400/.test(serverSrc));

/* 每一格都要有页面在读它（读法：copy.<组>?.<键> 或 data-copy="<组>.<键>"） */
const pageFiles = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(astro|ts)$/.test(e.name)) pageFiles.push(p);
  }
};
walk(path.join(SRC, 'src'));
const allSrc = pageFiles.map((f) => read(f)).join('\n');
/*
  读法有两种，两种都算（**先去注释**：注释里引用那句老话不算"还留着"）：
    · `data-copy="组.键"` / 三元里写 `'组.键'` 这种**字面量**；
    · `.组?.键` 这种成员访问（别名 import 过，所以前缀不一定是 copy —— 只认后半截）。
*/
const stripComments = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const allCode = stripComments(allSrc);
const unread = dataKeys.filter((k) => {
  const [g, key] = k.split('.');
  return (
    !allCode.includes(`data-copy="${k}"`) &&
    !allCode.includes(`'${k}'`) &&
    !new RegExp(`\\.${g}\\?\\.${key}\\b`).test(allCode)
  );
});
check('★ 每一格都有页面在读（不然就是"面板上改了没反应"）', unread.length === 0, unread.join(', ') || '全部都有');

/* ============================================================ ② 旧句子搬走了 */

console.log('\n=== ② 那几句以前写死在页面里的句子，现在只住在 JSON 里 ===');
const gone = [
  '一个记录想法、笔记和一些不成熟作品的个人站点。',
  '这里还没有写自我介绍。',
  '这里可以放朋友的站点，把这段换成真的就行。',
  '还没有友链。打开 <code>src/site.config.ts</code>',
];
const leftovers = gone.filter((s) => allCode.includes(s));
check('★ 生造句在源码里一个都找不到（它们只在 src/data/site-copy.json 里）', leftovers.length === 0, leftovers.join(' | ') || '干净');
check('★ 文案都从那一份数据读（src/utils/site-copy.ts 是唯一的读法）',
  /import raw from '\.\.\/data\/site-copy\.json'/.test(read(path.join(SRC, 'src', 'utils', 'site-copy.ts'))));
check('★ 留空 = 不渲染（页面里都是 xxx && <p …> 这种写法，不是渲染空盒子）',
  /data-copy="search\.lead"/.test(allSrc) && /\{lead && <p class="page-header__desc" data-copy="search\.lead">/.test(allSrc) &&
    /\{enterText && <span class="cover__hintText" data-copy="home\.enter">/.test(allSrc));

/* ============================================================ ③ 真编辑器 + 真构建 */

console.log('\n=== ③ 真编辑器：面板画得出来、改得动、清得掉（跑完还原）===');
const backup = read(COPY_FILE);
let editor = null;
let chrome = null;
let profile = '';
const api = (p, body) =>
  new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const req = http.request(
      `${EDITOR}${p}`,
      { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {} },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          let json = null;
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            /* 非 JSON */
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });

try {
  editor = spawn(process.execPath, [SERVER], { cwd: SRC, stdio: 'ignore' });
  let up = false;
  for (let i = 0; i < 60 && !up; i += 1) {
    await sleep(400);
    try {
      const r = await api('/api/site-copy');
      up = r.status === 200;
    } catch {
      /* 还没起来 */
    }
  }
  if (!up) throw new Error('编辑器 4322 没起来');
  info('编辑器起来了');

  /* ---- 服务端白名单：不认识的键丢掉、超长被拒 ---- */
  const huge = await api('/api/site-copy', { ...copyData, site: { ...copyData.site, tagline: 'x'.repeat(500) }, 不认识的组: { foo: 'bar' } });
  check('★ 有一格超长 → 400 并说清是哪一格（不悄悄截断）',
    huge.status === 400 && /site\.tagline/.test(String(huge.json?.error ?? '')), JSON.stringify(huge.json));
  const badShape = await api('/api/site-copy', { site: { tagline: '只发一格', 多出来的键: '丢掉' } });
  check('★ 只发一格时，别的格被当成空串（按白名单收），不认识的键丢掉',
    badShape.status === 200 && badShape.json?.copy?.site?.tagline === '只发一格' &&
      badShape.json.copy.site.description === '' && badShape.json.copy.site.多出来的键 === undefined,
    JSON.stringify(badShape.json?.copy?.site));
  check('★ 保存时会留一份 .bak（改坏了能回滚）', fs.existsSync(`${COPY_FILE}.bak`));
  /* 这一发把数据清成了"只有 site.tagline"，立刻还原回来再往下测 */
  fs.writeFileSync(COPY_FILE, backup, 'utf8');

  /* ---- 真浏览器：开面板、看每一格 ---- */
  chrome = spawn(
    CHROME,
    ['--headless=new', '--no-sandbox', '--disable-gpu', '--enable-unsafe-swiftshader', '--mute-audio', '--disable-breakpad',
      `--user-data-dir=${path.join(process.env.TEMP ?? '.', `dsh-sitecopy-${Date.now()}`)}`,
      `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
    { stdio: 'ignore' }
  );
  let target = null;
  for (let i = 0; i < 60 && !target; i += 1) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  if (!target) throw new Error('无头 Chrome 没起来');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(String(m.params.exceptionDetails?.text).slice(0, 140));
  });
  const send = (method, params = {}) => {
    const n = ++id;
    ws.send(JSON.stringify({ id: n, method, params }));
    return new Promise((resolve, reject) => pending.set(n, { resolve, reject }));
  };
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + String(expr).slice(0, 80));
    return r.result.value;
  };
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: `${EDITOR}/` });
  for (let i = 0; i < 150; i += 1) {
    await sleep(120);
    try {
      if ((await ev('document.readyState')) === 'complete') break;
    } catch {
      /* 还在导航 */
    }
  }
  await sleep(1200);
  const opened = await ev(`(() => {
      const hub = document.querySelector('#btn-hub');
      if (!hub) return '没有 #btn-hub';
      hub.click();
      const btn = document.querySelector('#hub-menu-list button[data-ws="copy"]');
      if (!btn) return '菜单里没有「文案」';
      btn.click();
      return 'ok';
    })()`);
  await sleep(800);
  check('★ 从总入口菜单能打开「文案」面板', opened === 'ok', String(opened));
  const fields = await ev(`(() => {
      const list = [...document.querySelectorAll('#copy-editor [data-copy-field]')];
      return { n: list.length, keys: list.map((t) => t.dataset.copyField), values: list.map((t) => t.value), title: (document.querySelector('#copy-editor') || {}).textContent ? '有内容' : '空' };
    })()`);
  info(`面板画了 ${fields.n} 格（数据里 ${dataKeys.length} 格）`);
  check('★ 面板把每一格都画出来了', fields.n === dataKeys.length, `${fields.n} / ${dataKeys.length}`);
  const wrongValue = dataKeys.find((k) => {
    const [g, key] = k.split('.');
    const want = String(copyData[g]?.[key] ?? '');
    const got = fields.values[fields.keys.indexOf(k)];
    return got !== undefined && got !== want;
  });
  check('★ 每一格显示的值就是盘上那份', !wrongValue, wrongValue ? `${wrongValue} 显示的不是盘上的值` : '全部一致');

  /* ---- 改一格 → 保存并重新构建 → dist 里真的变了 ---- */
  const marker = `检查用签名${Date.now().toString().slice(-6)}`;
  await ev(`(() => {
      const t = document.querySelector('[data-copy-field="site.tagline"]');
      t.value = ${JSON.stringify(marker)};
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  const dirty = await ev(`String((document.querySelector('#copy-editor .wpanel__status') || {}).textContent || '')`);
  check('改一格之后状态栏显示「有改动没保存」', /有改动/.test(dirty), dirty);
  await ev(`(document.querySelector('#copy-save') || {}).click ? document.querySelector('#copy-save').click() : null`);
  let saved = null;
  for (let i = 0; i < 80; i += 1) {
    await sleep(500);
    const st = await ev(`String((document.querySelector('#copy-editor .wpanel__status') || {}).textContent || '')`);
    if (/已保存|没成功|出错了/.test(st)) {
      saved = st;
      break;
    }
  }
  info('保存结果：' + String(saved));
  check('★ 保存并重新构建成功', /已保存并重新构建/.test(String(saved)), String(saved));
  const onDisk = JSON.parse(read(COPY_FILE));
  check('★ 新的值写进了 src/data/site-copy.json', onDisk.site.tagline === marker, String(onDisk.site.tagline));
  check('★ 别的格没被这一发清掉（面板发的是整份，服务端逐格清洗）',
    onDisk.friends.lead === copyData.friends.lead && onDisk.notes.lead === copyData.notes.lead);
  const builtHome = read(path.join(DIST, 'index.html'));
  check('★ 重新构建之后 dist 里的首页也用上了新值（站点那边真读到了）',
    builtHome.includes(marker), marker);

  /* ---- 清空一格 → 那一段整块消失 ---- */
  await ev(`(() => {
      const t = document.querySelector('[data-copy-field="friends.lead"]');
      t.value = '';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  await ev(`document.querySelector('#copy-save').click()`);
  for (let i = 0; i < 80; i += 1) {
    await sleep(500);
    const st = await ev(`String((document.querySelector('#copy-editor .wpanel__status') || {}).textContent || '')`);
    if (/已保存|没成功|出错了/.test(st)) break;
  }
  const friendsHtml = read(path.join(DIST, 'friends', 'index.html'));
  check('★ 把一格清空之后，页面上那一段**整块消失**（不是留一个空盒子）',
    !friendsHtml.includes('data-copy="friends.lead"') && !friendsHtml.includes('想交换链接'), '留空生效');
  check('同一页别的格还在（清一格不影响别人）', friendsHtml.includes('data-copy="friends.empty"'));
  check('这一趟没有未捕获的 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '));
  ws.close();
} catch (err) {
  fail += 1;
  console.log('FAIL  那一段异常: ' + (err?.stack ?? err));
} finally {
  /* 还原：这个脚本改过站点数据，跑完必须一模一样地放回去，再重新构建一次 */
  try {
    fs.writeFileSync(COPY_FILE, backup, 'utf8');
    execSync(`node node_modules/astro/bin/astro.mjs build`, { cwd: SRC, stdio: 'ignore', timeout: 600000 });
    info('已把 src/data/site-copy.json 还原并重新构建');
  } catch (err) {
    console.log('⚠ 还原/重建失败：' + String(err?.message ?? err));
  }
  if (chrome) {
    try {
      execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* 已退 */
    }
  }
  if (editor) {
    try {
      execSync(`taskkill /pid ${editor.pid} /T /F`, { stdio: 'ignore' });
    } catch {
      /* 已退 */
    }
  }
  await sleep(300);
}

console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
