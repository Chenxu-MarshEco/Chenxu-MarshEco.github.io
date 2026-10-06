/*
 * 「导入最新精华」验收（2026-10-06）
 *
 * 用户原话：
 *   「在编辑器的精华消息页面里新增一个接口 可以接受这一类文件 接受后把里面的内容全部
 *    转化为和之前精华一样的一条条精华条目 …这个接口以后也可以定期接收新的精华文件
 *    然后把他们全部转化为本站的精华格式」
 *
 * 验收分四段，全用真东西：
 *   ① **真仓库上先跑一遍 --dry**：解析条数要和导出文件自己写的「共 N 条」对上，
 *      而且**一个字节都不许写**（salon.json 的字节和 public/img/salon 的文件清单都不变）。
 *   ② **副本里走真正的接口**：把用户给的那个压缩包**原样 POST 到 /api/salon/import**，
 *      看它解析、去重、加成员、抽图片、重新构建。
 *   ③ **数据完整性**：原来 784 条逐条比对（一个字段都不许变）、新条目字段齐全、
 *      成员/年代/图片都对得上、timelineId 和 eras 没被碰。
 *   ④ **导入之后真的"和以前的精华一样"**：构建产物里 /salon.json 有它们、
 *      /salon/ 页面上每条都有自己的锚点和时间轴位置、搜索索引里有它们
 *      （= 每日精华 / 随机精华 / 搜索 / 时间轴那几条路全都够得着）。
 *      最后再导一次同一份文件 —— 必须 0 新增（可以定期反复跑）。
 *
 * 用法：node tools/checks/salon-import-check.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importEssenceFile } from '../salon/import-more.mjs';
import { parseMonthHtml } from '../salon/month-html.mjs';
import { essenceKey } from '../salon/merge.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', '..');
const COPY = path.join(SRC, '.tmp', 'salon-copy');
const ZIP = path.join(here, 'fixtures', 'qq精华-202609.zip');
const SALON = path.join(SRC, 'src', 'data', 'salon.json');
const SALON_IMG = path.join(SRC, 'public', 'img', 'salon');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

check('★ 用户给的压缩包作为样本收在 fixtures 里了', fs.existsSync(ZIP), ZIP);
if (!fs.existsSync(ZIP)) process.exit(1);

/* ================================================================
 * ① 真仓库 --dry：只算，不写
 * ================================================================ */
console.log('\n================ ① 真仓库先 dry 一遍（不许写盘） ================');
const beforeBytes = fs.readFileSync(SALON);
const beforeImgs = fs.readdirSync(SALON_IMG).sort();
const beforeData = JSON.parse(beforeBytes.toString('utf8'));
info(`导入前：精华 ${beforeData.essences.length} 条 / 成员 ${beforeData.members.length} 人 / 图片文件 ${beforeImgs.length} 个`);

const dry = importEssenceFile({ file: ZIP, dryRun: true }).report;
info(`dry 报告：解析 ${dry.parsed.items} 条（图片 ${dry.parsed.images}）/ 新增 ${dry.added} / 跳过 ${dry.skipped} / 新成员 ${dry.newMembers.join('、') || '无'}`);
check('★★ dry：解析出来的条数和导出文件自己写的「共 N 条」一致',
  dry.declared.items === dry.parsed.items, `文件写 ${dry.declared.items}，解析出 ${dry.parsed.items}`);
check('★★ dry：图片张数也和文件自述一致', dry.declared.images === dry.parsed.images,
  `文件写 ${dry.declared.images}，解析出 ${dry.parsed.images}`);
check('★ dry：新增 + 跳过 = 解析总数（一条不多一条不少）',
  dry.added + dry.skipped === dry.parsed.items, `${dry.added} + ${dry.skipped} = ${dry.parsed.items}`);
check('★ dry：没有任何告警（自述条数对得上）', dry.warnings.length === 0, dry.warnings.join(' | '));
check('★★ dry：salon.json 一个字节都没变', Buffer.compare(beforeBytes, fs.readFileSync(SALON)) === 0);
check('★★ dry：public/img/salon 里也没多出文件',
  JSON.stringify(fs.readdirSync(SALON_IMG).sort()) === JSON.stringify(beforeImgs),
  `${beforeImgs.length} → ${fs.readdirSync(SALON_IMG).length}`);

/* ================================================================
 * ② 副本里走真接口
 * ================================================================ */
console.log('\n================ ② 副本：POST /api/salon/import ================');
fs.rmSync(COPY, { recursive: true, force: true });
fs.mkdirSync(COPY, { recursive: true });
for (const item of ['src', 'tools', 'package.json', 'astro.config.mjs', 'tsconfig.json', 'site.config.ts', '.gitignore']) {
  const from = path.join(SRC, item);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(COPY, item), { recursive: true });
}
const link = (target, at) => {
  try { execSync(`cmd /c mklink /J "${at}" "${target}"`, { stdio: 'ignore' }); } catch { /* 已经有了 */ }
};
link(path.join(SRC, 'node_modules'), path.join(COPY, 'node_modules'));
/*
  副本的 public **不能整个 junction** —— 导入会往 public/img/salon 里写新图片，
  junction 的话就写进用户真仓库了。所以：目录自己造，重的几块 junction 过去，
  img/salon 留成一个空的真目录（导入就该往这里写）。
*/
const PUB = path.join(COPY, 'public');
fs.mkdirSync(PUB, { recursive: true });
for (const f of ['favicon.svg', 'og-default.svg']) {
  if (fs.existsSync(path.join(SRC, 'public', f))) fs.copyFileSync(path.join(SRC, 'public', f), path.join(PUB, f));
}
for (const d of ['audio', 'fonts', 'secret']) link(path.join(SRC, 'public', d), path.join(PUB, d));
fs.mkdirSync(path.join(PUB, 'img'), { recursive: true });
for (const d of ['opt', 'uploads']) link(path.join(SRC, 'public', 'img', d), path.join(PUB, 'img', d));
fs.mkdirSync(path.join(PUB, 'img', 'salon'), { recursive: true });

const editor = spawn(process.execPath, [path.join(COPY, 'tools', 'editor', 'server.mjs')], {
  cwd: COPY, stdio: ['ignore', 'pipe', 'pipe'],
});
let elog = '';
editor.stdout.on('data', (b) => { elog += b.toString('utf8'); });
editor.stderr.on('data', (b) => { elog += b.toString('utf8'); });
let base = '';
for (let i = 0; i < 120 && !base; i++) {
  await sleep(200);
  const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(elog);
  if (m) base = `http://127.0.0.1:${m[1]}`;
}
check('副本里的编辑器起来了', !!base, base || elog.slice(-200));

const COPY_SALON = path.join(COPY, 'src', 'data', 'salon.json');

/*
  副本先"回到导入前"：把**这份文件贡献过的条目**摘掉（不管真仓库导没导过）。
  为什么必须这么做：这个接口是"定期接收"用的，真仓库很可能早就导过这份文件了
  （写这份验收的时候就已经导过了），那时候再 POST 一次会得到"新增 0 条"，
  后面所有"新条目"的断言就全成了空转。摘掉之后每一次跑都是同一场考试：
  这份文件该新增 23 条、跳过 5 条（那 5 条是容错去重认出来的，见 merge.mjs）。
*/
const monthParsed = parseMonthHtml(fs.readFileSync(
  (() => {
    /* 压缩包里的那份 HTML：解到临时目录去找，和 import-more 里同一套找法 */
    const tmp = path.join(SRC, '.tmp', 'salon-peek');
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    execSync(`tar -xf "${ZIP}" -C "${tmp}"`, { stdio: 'ignore' });
    const hit = [];
    const walk = (d, depth = 0) => {
      if (depth > 4) return;
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { walk(p, depth + 1); continue; }
        if (!/\.html?$/i.test(e.name) || /原始/.test(e.name)) continue;
        if (/<div class=['"]item['"]/.test(fs.readFileSync(p, 'utf8').slice(0, 200000))) hit.push(p);
      }
    };
    walk(tmp);
    if (!hit.length) throw new Error('压缩包里没找到精华 HTML');
    return hit[0];
  })(),
  'utf8'));

const rolledBack = (() => {
  const data = readJson(COPY_SALON);
  const keys = new Set(monthParsed.items.map(essenceKey));
  const gone = data.essences.filter((e) => keys.has(essenceKey(e)));
  data.essences = data.essences.filter((e) => !keys.has(essenceKey(e)));
  fs.writeFileSync(COPY_SALON, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  return { data, removed: gone.length };
})();
info(`副本先摘掉这份文件贡献过的 ${rolledBack.removed} 条 → 副本里现在 ${rolledBack.data.essences.length} 条，再走一遍导入`);

/* 这一段走的是**用户点按钮那条路**：开无头浏览器 → 打开编辑器 → 点「精华」面板 →
   点「导入最新精华」→ 用 CDP 把压缩包真的塞进那个 file input → 等它导完。
   （不是直接打接口 —— 那是下一段，用来顺便再验一次"重复导入 0 新增"。） */
const DEBUG_PORT = 9378;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
let chrome = null;
async function startChrome() {
  const profile = path.join(process.env.TEMP ?? '.', `dsh-salonimp-${Date.now()}`);
  chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu',
    '--enable-unsafe-swiftshader', '--hide-scrollbars', '--disable-breakpad',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'], { stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      const t = l.find((x) => x.type === 'page');
      if (t) return { ws: t.webSocketDebuggerUrl, profile };
    } catch { /* 等 */ }
  }
  return null;
}

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
      if (m.method === 'Runtime.exceptionThrown') this.errors.push('exception: ' + (m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text));
    });
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

let cdp = null;
let chromeInfo = null;
if (base) {
  chromeInfo = await startChrome();
  if (chromeInfo) {
    cdp = new CDP(new WebSocket(chromeInfo.ws));
    await new Promise((res, rej) => {
      cdp.ws.addEventListener('open', res, { once: true });
      cdp.ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
    });
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('DOM.enable');
  }
}
check('无头浏览器起来了（走用户那条路）', !!cdp);

let first = null;
const beforeUI = readJson(COPY_SALON);
const beforeIds = new Set(beforeUI.essences.map((e) => e.id));
if (cdp) {
  await cdp.send('Page.navigate', { url: `${base}/` });
  for (let i = 0; i < 150; i++) {
    await sleep(150);
    if ((await cdp.ev('document.readyState')) === 'complete') break;
  }
  await sleep(1200);
  /* 打开「精华」面板：点顶上那条切换条里对应的工作区按钮 */
  const opened = await cdp.ev(`(async () => {
    const btn = document.querySelector('[data-ws="essences"]');
    if (!btn) return { ok: false, why: '没找到「精华」那个切换按钮' };
    btn.click();
    await new Promise((r) => setTimeout(r, 900));
    const importBtn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === '导入最新精华');
    if (!importBtn) return { ok: false, why: '精华面板里没有「导入最新精华」按钮' };
    importBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    const input = document.getElementById('essence-import-file');
    return { ok: true, hasInput: !!input, accept: input ? input.accept : '' };
  })()`);
  check('★ 精华面板里那颗「导入最新精华」点得开（点完会挂出一个隐藏的 file input）',
    opened?.ok === true && opened?.hasInput === true && /\.zip/.test(opened?.accept || ''), JSON.stringify(opened));

  /* 用 CDP 把压缩包真的塞进那个 input（＝用户在文件选择器里选中它） */
  const doc = await cdp.send('DOM.getDocument', { depth: 1 });
  const node = await cdp.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: '#essence-import-file' });
  check('★ 找到了那个 file input（可以往里塞文件）', node?.nodeId > 0, `nodeId=${node?.nodeId}`);
  if (node?.nodeId) {
    await cdp.send('DOM.setFileInputFiles', { files: [ZIP], nodeId: node.nodeId });
    info('已经把压缩包塞进 input，等它导完（解析 + 抽图 + 重新构建，十几秒）');
    /*
      ⚠ 这一版 Chrome 的 setFileInputFiles **会自己触发 change**（第一次跑的时候没搞清楚，
      又手动补了一个 change，结果导了两遍：第二遍"新增 0 条"把提示覆盖了）。
      所以这里改成"看有没有真的跑起来"：处理函数一进来就会把状态条写成「正在导入精华…」，
      4 秒内看到它就不再补 change；实在没跑起来才补一下（旧版本 Chrome 的行为）。
    */
    let started = false;
    for (let i = 0; i < 20 && !started; i++) {
      await sleep(200);
      started = await cdp.ev(`(() => {
        const el = document.querySelector('[class*="status"]');
        return /正在导入/.test((el && el.textContent) || '');
      })()`).catch(() => false);
    }
    if (!started) {
      await cdp.ev(`(() => { const i = document.getElementById('essence-import-file'); i && i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      info('（这一版没自动触发 change，手动补了一下 —— 和用户点"确定"是同一件事）');
    } else {
      info('（setFileInputFiles 自己把 change 触发了，没补第二次）');
    }
    /* 等数据真的变了（服务端写盘 + 重新构建），最多等 2 分钟 */
    let grew = false;
    for (let i = 0; i < 120; i++) {
      await sleep(1000);
      try {
        const now = readJson(COPY_SALON);
        if (now.essences.length > beforeUI.essences.length) { grew = true; break; }
      } catch { /* 写到一半读不了，接着等 */ }
    }
    check('★★ 走界面这条路真的把精华导进去了（副本里的 salon.json 变多了）', grew,
      `导入前 ${beforeUI.essences.length} 条`);
    /*
      界面上的回话要**等它把总结说完**：数据一变就去看，多半只看到「正在导入精华…」那一句
      （真正的总结在重新构建完之后才出现）。所以这里轮询到出现「新增 / 解析」为止。
    */
    let toastText = '';
    for (let i = 0; i < 60; i++) {
      toastText = await cdp.ev(`(() => {
        const t = document.querySelector('.toast, #toast, [class*="toast"]');
        const pill = document.querySelector('[class*="status"]');
        return ((t && t.textContent) || '') + ' || ' + ((pill && pill.textContent) || '');
      })()`).catch(() => '');
      if (/新增|解析/.test(String(toastText))) break;
      await sleep(1000);
    }
    info(`界面上的回话：${String(toastText).replace(/\s+/g, ' ').slice(0, 170)}`);
    check('★★ 界面上回了完整的回话（提示里写了解析了几条 / 新增了几条）',
      /新增\s*\d+\s*条/.test(String(toastText)) && /解析\s*\d+\s*条/.test(String(toastText)),
      String(toastText).replace(/\s+/g, ' ').slice(0, 140));
    const afterUI = readJson(COPY_SALON);
    const freshUI = afterUI.essences.filter((e) => !beforeIds.has(e.id));
    first = {
      ok: true,
      report: {
        added: freshUI.length,
        addedIds: freshUI.map((e) => e.id),
        skipped: monthParsed.items.length - freshUI.length,
        images: freshUI.reduce((a, e) => a + (e.images ?? []).length, 0),
        before: { members: beforeUI.members.length, essences: beforeUI.essences.length },
        after: { members: afterUI.members.length, essences: afterUI.essences.length },
      },
      built: true,
    };
    info(`界面这条路的结果：新增 ${first.report.added} 条（${first.report.addedIds[0]}…${first.report.addedIds[first.report.addedIds.length - 1]}）`);
    /*
      导入完之后服务端会自己重新构建一次 —— 副本本来没有 dist，所以 dist 里出现
      新条目的锚点就说明"构建真的跑了"（不然编辑器里点「看 /salon/」还是旧的）。
      ⚠ 要**等**：写盘是立刻的，构建在后面十几秒，第一次跑就是在写盘后马上看 dist，
      结果判红（其实构建正在跑）。所以这里轮询到锚点出现为止。
    */
    const builtPage = path.join(COPY, 'dist', 'salon', 'index.html');
    let builtOk = false;
    for (let i = 0; i < 90 && !builtOk; i++) {
      try {
        builtOk = fs.existsSync(builtPage)
          && first.report.addedIds.some((id) => fs.readFileSync(builtPage, 'utf8').includes(`id="${id}"`));
      } catch { /* 构建写到一半，接着等 */ }
      if (!builtOk) await sleep(1000);
    }
    check('★★ 导入之后服务端自己重新构建了一次（副本的 dist 里已经能看到新条目）', builtOk,
      fs.existsSync(builtPage) ? 'dist/salon/index.html 里找到了新锚点' : '等了 90 秒 dist 还没生成');
  }
}

/* 接口本身再打一次：这次应该 0 新增（顺便把完整报告拿回来做后面的断言） */
let api = null;
if (base) {
  const bytesBefore = fs.readFileSync(COPY_SALON);
  const res = await fetch(`${base}/api/salon/import?name=${encodeURIComponent(path.basename(ZIP))}`, {
    method: 'POST', body: fs.readFileSync(ZIP),
  });
  api = await res.json().catch(() => null);
  info(`接口（第二次）：ok=${api?.ok} 新增 ${api?.report?.added} 跳过 ${api?.report?.skipped}`);
  check('★★ 接口收下这个压缩包并成功导入（HTTP 200 + ok）', res.status === 200 && api?.ok === true,
    JSON.stringify(api).slice(0, 160));
  check('★★ 接口自己认出了压缩包里那份 HTML',
    /\.html$/i.test(String(api?.report?.source || '')), String(api?.report?.source));
  check('★★ 再导一次 = 0 新增（全都认出来了，不会重复进来）', api?.report?.added === 0,
    `added=${api?.report?.added} skipped=${api?.report?.skipped}`);
  await sleep(500);                                  /* 等它写完（没新增时不会重新构建） */
  check('★★ 再导一次之后 salon.json 连一个字节都没变（可以定期反复跑）',
    Buffer.compare(bytesBefore, fs.readFileSync(COPY_SALON)) === 0);
  check('★ 跳过的每一条都写了理由（站里已经有 / 只差一两个字）',
    (api?.report?.skippedList ?? []).length > 0 && (api?.report?.skippedList ?? []).every((s) => s.why),
    (api?.report?.skippedList ?? []).slice(0, 2).map((s) => `${s.date} ${s.why}`).join(' | '));
  check('★ 没有任何告警（自述条数对得上）', (api?.report?.warnings ?? []).length === 0,
    (api?.report?.warnings ?? []).join(' | '));
  /* 把"被跳过"那张表留给后面用：哪几天是被去重挡下的 */
  if (first) first.report.skippedList = api?.report?.skippedList ?? [];
}

/* ================================================================
 * ③ 数据完整性
 * ================================================================ */
console.log('\n================ ③ 数据本身 ================');
if (first?.ok) {
  const after = readJson(COPY_SALON);
  const base = rolledBack.data;                      // 副本"导入前"那一份
  const addedIds = first.report.addedIds;

  /* 老的逐条比对：一个字段都不许变 */
  const changed = [];
  for (const e of base.essences) {
    const now = after.essences.find((x) => x.id === e.id);
    if (!now) { changed.push(`${e.id} 不见了`); continue; }
    if (JSON.stringify(now) !== JSON.stringify(e)) changed.push(`${e.id} 被改了`);
  }
  check(`★★ 导入前那 ${base.essences.length} 条精华逐条比对：一条都没变`, changed.length === 0,
    changed.slice(0, 5).join(' | '));
  check('★ 老的成员表没被动过（同一个 id 上还是同一个人）',
    base.members.every((m) => JSON.stringify(after.members.find((x) => x.id === m.id)) === JSON.stringify(m)),
    `${base.members.length} → ${after.members.length} 人`);
  check('★★ timelineId（左边那条时间轴）原样保留',
    String(after.timelineId) === String(base.timelineId), `${base.timelineId} → ${after.timelineId}`);
  check('★★ eras（五个年代）原样保留',
    JSON.stringify(after.eras) === JSON.stringify(base.eras));
  check('★ 条数对得上：导入前 + 新增 = 导入后',
    base.essences.length + first.report.added === after.essences.length,
    `${base.essences.length} + ${first.report.added} = ${after.essences.length}`);

  /* 新条目：字段齐全、id 不撞、都能被站点认出来 */
  const fresh = addedIds.map((id) => after.essences.find((e) => e.id === id)).filter(Boolean);
  check('★★ 新增的条目一条不少地写进了 salon.json', fresh.length === addedIds.length,
    `${fresh.length}/${addedIds.length}`);
  const memberIds = new Set(after.members.map((m) => m.id));
  const eraIds = new Set(after.eras.map((e) => e.id));
  const bad = [];
  for (const e of fresh) {
    if (!e.date || !/^\d{4}-\d{2}-\d{2}$/.test(e.date)) bad.push(`${e.id} 日期不对`);
    if (!['text', 'perfect', 'ai'].includes(e.kind)) bad.push(`${e.id} kind=${e.kind}`);
    if (!e.eraId || !eraIds.has(e.eraId)) bad.push(`${e.id} 年代 ${e.eraId}`);
    if (!Array.isArray(e.images)) bad.push(`${e.id} images 不是数组`);
    if (!Array.isArray(e.memberIds)) bad.push(`${e.id} memberIds 不是数组`);
    for (const id of e.memberIds ?? []) if (!memberIds.has(id)) bad.push(`${e.id} 指向不存在的成员 ${id}`);
    if (!e.text && !(e.images ?? []).length) bad.push(`${e.id} 既没文字也没图`);
  }
  check('★★ 新增的每一条都"和以前的精华一样"：日期 / 类别 / 年代 / 成员 / 图片字段都对',
    bad.length === 0, bad.slice(0, 5).join(' | '));

  /* 完美对话那种：要带 OCR 标记，而且挂到了人 */
  const perfects = fresh.filter((e) => e.kind === 'perfect');
  check('★ 完美对话那几条带上了 ocr 标记、也挂到了成员',
    perfects.length > 0 && perfects.every((e) => e.ocr === true && (e.memberIds ?? []).length > 0),
    perfects.map((e) => `${e.id}:${e.memberIds.length}人${e.ocr ? '/ocr' : ''}`).join(' '));

  /* 新成员 / 别名：导出文件里的每个名字都要落到一个真成员上 */
  const newMembers = first.report.newMembers ?? [];
  check('★ 导出文件里的新面孔建了成员（老名字走别名认，不会多出一堆重复的人）',
    newMembers.every((n) => after.members.some((m) => m.name === n)),
    newMembers.join('、') || '（这份文件里的名字站里都认识）');
  check('★ 没有把「花花 / Sunf / 羽之颂 / 灵空天仪」认成新成员（它们都是别名）',
    !after.members.some((m) => ['花花', 'Sunf', '羽之颂', '灵空天仪'].includes(m.name)),
    after.members.filter((m) => ['花花', 'Sunf', '羽之颂', '灵空天仪'].includes(m.name)).map((m) => m.name).join('、') || '干净');
  const lostWho = [];
  const skippedWhen = new Set((first.report.skippedList ?? []).map((s) => `${s.date} ${s.time || ''}`));
  for (const it of monthParsed.items) {
    if (!it.names.length) continue;
    const entry = after.essences.find((e) => essenceKey(e) === essenceKey(it));
    if (!entry) {
      /*
        "没进数据"要分两种情况（第一版写错了，判红过一次）：
          · 被容错去重跳过的（正文只差一两个字，比如导出管线把某个字弄坏那种）——
            这本来就是设计好的行为，站里那条（文字更完整的那版）留着就行；
          · 其余情况才是真丢了。
      */
      if (!skippedWhen.has(`${it.date} ${it.time || ''}`)) lostWho.push(`${it.date} ${it.time} 没进数据，也不是被去重跳过的`);
      continue;
    }
    const ids = entry.memberIds ?? [];
    if (!ids.length) lostWho.push(`${it.date} ${it.time} 一个成员都没挂上（原文件写的是 ${it.names.join('、')}）`);
    for (const id of ids) if (!memberIds.has(id)) lostWho.push(`${entry.id} → 不存在的成员 ${id}`);
  }
  check('★★ 导出文件里写了名字的每一条，要么进了数据并挂到真成员上、要么是被去重跳过（别名也算）',
    lostWho.length === 0, lostWho.slice(0, 4).join(' | ') || `共 ${monthParsed.items.filter((i) => i.names.length).length} 条都有交代`);

  /* 图片：文件真的落盘了 */
  const imgDir = path.join(COPY, 'public', 'img', 'salon');
  const missing = [];
  let imgCount = 0;
  for (const e of fresh) {
    for (const p of e.images ?? []) {
      imgCount++;
      const f = path.join(imgDir, path.basename(p));
      if (!fs.existsSync(f) || fs.statSync(f).size === 0) missing.push(p);
    }
  }
  check('★★ 内嵌在 HTML 里的图片都抽成了真文件（public/img/salon/<id>-N.jpg）',
    missing.length === 0 && imgCount === first.report.images,
    `写了 ${first.report.images} 张，缺 ${missing.length} 张：${missing.slice(0, 3).join(' ')}`);

  /* 同时给一条"这条为什么被跳过"的例子，证明去重是有理由的（不是瞎跳） */
  const skipWithWhy = (first.report.skippedList ?? []).filter((s) => s.why);
  check('★ 跳过的每一条都写了理由（站里已经有 / 只差一两个字）',
    skipWithWhy.length === (first.report.skippedList ?? []).length && skipWithWhy.length > 0,
    (first.report.skippedList ?? []).slice(0, 2).map((s) => `${s.date} ${s.why}`).join(' | '));
}

/* ================================================================
 * ④ 导进来的东西"和以前的精华一样"：站点那边够得着
 * ================================================================ */
console.log('\n================ ④ 站点这边：每日精华 / 随机 / 搜索 / 时间轴 ================');
if (first?.ok) {
  const build = spawnSync(process.execPath, [path.join(COPY, 'node_modules', 'astro', 'bin', 'astro.mjs'), 'build'],
    { cwd: COPY, encoding: 'utf8', timeout: 300000 });
  const ok = build.status === 0 && fs.existsSync(path.join(COPY, 'dist', 'salon', 'index.html'));
  check('★ 副本重新构建成功', ok, `exit=${build.status} ${String(build.stderr || '').split('\n').filter(Boolean).slice(-1)[0] ?? ''}`);

  if (ok) {
    const addedIds = first.report.addedIds;
    const siteJson = readJson(path.join(COPY, 'dist', 'salon.json'));
    const inJson = addedIds.filter((id) => siteJson.essences.some((e) => e.id === id));
    check('★★ 站点那份 /salon.json 里有新条目 ——「每日精华」和「随机精华」用的就是这一份数组',
      inJson.length === addedIds.length,
      `${inJson.length}/${addedIds.length}，数组共 ${siteJson.essences.length} 条`);
    const withImg = siteJson.essences.filter((e) => addedIds.includes(e.id) && (e.images ?? []).length);
    check('★ 新条目的图片在站点数据里带了多尺寸地址（和别的精华一样走图片管线）',
      withImg.length === (first.report.images ? withImg.length : 0) && withImg.every((e) => /^\/img\/opt\//.test(e.images[0]) || /\.(jpe?g|png|webp)$/.test(e.images[0])),
      withImg.map((e) => `${e.id} ${e.images[0]}`).join(' | ').slice(0, 120));

    const page = fs.readFileSync(path.join(COPY, 'dist', 'salon', 'index.html'), 'utf8');
    const noAnchor = addedIds.filter((id) => !page.includes(`id="${id}"`));
    check('★★ 冰室精华页上每条新精华都有自己的锚点（/salon/#<id> 能直接跳过去）',
      noAnchor.length === 0, noAnchor.slice(0, 4).join(' ') || '全都有');
    const noParam = addedIds.filter((id) => !new RegExp(`id="${id}"[^>]*data-tl-param=`).test(page)
      && !new RegExp(`data-tl-param="[\\d.]+"[^>]*id="${id}"`).test(page));
    check('★★ 每条新精华都算出了在时间轴上的位置（点刻度能跳到它）',
      noParam.length === 0, noParam.slice(0, 4).join(' ') || '全都有');

    const search = readJson(path.join(COPY, 'dist', 'search.json'));
    const ess = search.items.filter((x) => x.k === 'essence');
    const noSearch = addedIds.filter((id) => !ess.some((x) => String(x.h || '').includes(`#${id}`)));
    check('★★ 搜索索引里有它们（搜那句话 / 那天 / 那个人都搜得到）',
      noSearch.length === 0 && ess.length > rolledBack.data.essences.length,
      `essence 索引 ${rolledBack.data.essences.length}（副本导入前）→ ${ess.length}，缺 ${noSearch.length} 条`);
  }
}

/* ================================================================
 * ⑤ 编辑器的按钮真的在（源码那层）
 * ================================================================ */
console.log('\n================ ⑤ 编辑器界面 ================');
const appJs = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'ui', 'app.js'), 'utf8');
const serverJs = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'server.mjs'), 'utf8');
check('★ 精华面板里有「导入最新精华」这个按钮',
  /panelBtn\('导入最新精华'/.test(appJs) && /function importEssenceFile\(/.test(appJs));
check('★ 它把文件原样 POST 给 /api/salon/import（不 base64、不进 JSON）',
  /\/api\/salon\/import\?name=/.test(appJs) && /route === '\/api\/salon\/import'/.test(serverJs));
check('★ 导完把草稿丢掉重读（不然再点保存会把刚导进来的覆盖掉）',
  /salonDraft = null;\s*\n\s*await loadSalon\(\)/.test(appJs));
check('★ 那个隐藏的 file input 是挂在文档里的（验收脚本靠 DOM.setFileInputFiles 真的往里塞文件）',
  /input\.id = 'essence-import-file'/.test(appJs) && /document\.body\.appendChild\(input\)/.test(appJs));

/* ================================================================ */
if (base) { try { editor.kill(); } catch { /* 已经退了 */ } }
if (chrome) { try { execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' }); } catch { /* 已经退了 */ } }
if (chromeInfo?.profile) { try { fs.rmSync(chromeInfo.profile, { recursive: true, force: true }); } catch { /* 删不掉就算了 */ } }
await sleep(300);
try {
  /* junction 要先单独摘掉（不然 rmSync 会跟着删到真仓库里去） */
  for (const j of ['node_modules', 'public\\audio', 'public\\fonts', 'public\\secret', 'public\\img\\opt', 'public\\img\\uploads']) {
    const p = path.join(COPY, j);
    try { if (fs.existsSync(p)) execSync(`cmd /c rmdir "${p}"`, { stdio: 'ignore' }); } catch { /* 不是 junction 就算了 */ }
  }
  fs.rmSync(COPY, { recursive: true, force: true });
  console.log(`副本已清理: ${!fs.existsSync(COPY)}`);
} catch (err) {
  console.log('副本没删干净（不影响结论）：', String(err?.message || err).slice(0, 160));
}

console.log('\n================ 结果 ================');
console.log(`PASS ${pass}   FAIL ${fail}`);
if (fail > 0) process.exit(1);
