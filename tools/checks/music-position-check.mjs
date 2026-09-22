/*
 * 歌曲进度记忆（用户 2026-09-22）：
 *   「所有拥有同一首歌的网页播放进度相同。……我在首页听 Fly with Me 30 秒后点进精华页面
 *    开始播放李箱被我玩喷了 播放 10 秒后我回到首页 那么 Fly with Me 还是应该从 30 秒处
 *    开始播放 …… 如果又随机到了李箱 就从第 10 秒开始播放 如果随机到了终焉寻常之人
 *    就从头开始播放」
 *
 * 量四件事：
 *   ① 换页时**收**得下来：在某页把进度推到 N 秒 → 跳到别的页 → sessionStorage 里
 *      这首歌那一格就是 N（不是只有"上一首"那一份）；
 *   ② **每一首各记各的**：两首歌分别听过 → 两个格子各是各的数；
 *   ③ 回到有这首歌的页面会**接着放**（currentTime ≈ 记下的数）；
 *   ④ 没听过的歌还是从 0 开始（不能被上一条的机制带跑）。
 *
 * 用法：node tools/checks/music-position-check.mjs [dist目录]
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';

const root = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('dist');
const PORT = 4422;
const DEBUG_PORT = 9392;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.webp': 'image/webp', '.avif': 'image/avif', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg', '.svg': 'image/svg+xml',
};
let pass = 0;
let fail = 0;
const check = (n, ok, d = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? `   :: ${d}` : ''}`);
};

/* 盘上的歌单：挑出「首页那一首」和「有随机列表的页面」 */
const music = JSON.parse(fs.readFileSync('src/data/music.json', 'utf8'));
const trackOf = (id) => music.tracks.find((t) => t.id === id) ?? null;
const homeList = music.pages?.home?.list ?? [];
const shufflePage = Object.entries(music.pages ?? {}).find(([, v]) => (v?.list?.length ?? 0) >= 2);
if (!homeList.length || !shufflePage) {
  console.error('歌单里没有「首页一首 + 至少一个多首页面」，这个检查没东西可量');
  process.exit(2);
}
const homeTrack = trackOf(homeList[0]);
const [shuffleKey, shuffleVal] = shufflePage;
const shuffleTracks = shuffleVal.list.map(trackOf).filter(Boolean);
console.log(`首页那首：${homeTrack.title}`);
console.log(`随机页 ${shuffleKey}：${shuffleTracks.map((t) => t.title).join(' / ')}`);

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

const profile = path.join(process.env.TEMP ?? '.', `dsh-muspos-${Date.now()}`);
const chrome = spawn(
  CHROME,
  ['--headless=new', '--no-sandbox', '--mute-audio', '--disable-gpu', '--enable-unsafe-swiftshader',
   '--autoplay-policy=no-user-gesture-required', '--window-size=1440,900',
   `--user-data-dir=${profile}`, `--remote-debugging-port=${DEBUG_PORT}`, 'about:blank'],
  { stdio: 'ignore' }
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
  send(m, p = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method: m, params: p }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  }
  async goto(p, wait = 1600) {
    this.errors = [];
    await this.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${p}` });
    for (let i = 0; i < 160; i++) { await sleep(120); if ((await this.ev('document.readyState')) === 'complete') break; }
    await sleep(wait);
  }
}

let cdp = null;
for (let i = 0; i < 80 && !cdp; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
    const page = list.find((t) => t.type === 'page');
    if (page) cdp = await CDP.attach(page.webSocketDebuggerUrl);
  } catch { /* 还没起来 */ }
}
if (!cdp) { console.error('Chromium 没起来'); process.exit(2); }
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');

/*
  页面里能问到的东西：
    · 现在放的是哪一首 —— 音量键的 title 里带着歌名（播放器自己写的）；
    · 进度 —— #music-audio 的 currentTime；
    · 每首歌的存档 —— sessionStorage['huajiantang.music.positions']。
*/
const PROBE = `(() => {
  const a = document.getElementById('music-audio');
  const btn = document.getElementById('music-vol-btn');
  let pos = {};
  try { pos = JSON.parse(sessionStorage.getItem('huajiantang.music.positions') || '{}'); } catch (e) {}
  return {
    hasAudio: !!a,
    src: a ? (a.getAttribute('src') || '') : '',
    t: a ? Math.round((a.currentTime || 0) * 10) / 10 : -1,
    dur: a && isFinite(a.duration) ? Math.round(a.duration) : null,
    paused: a ? a.paused : null,
    title: btn ? (btn.title || '') : '',
    pos,
  };
})()`;

const waitFor = async (expr, ms = 4000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await cdp.ev(expr);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(150);
  }
};

/* ---------------- ① 首页：听到 30 秒 ---------------- */
await cdp.goto('/', 2200);
const onHome = await cdp.ev(PROBE);
console.log('首页：', JSON.stringify(onHome));
check('首页有播放器，放的就是首页认领的那首', onHome.hasAudio && onHome.title.includes(homeTrack.title.slice(0, 6)),
  onHome.title);
check('第一次进来（这首歌没听过）→ 从头开始', onHome.t < 3, `currentTime=${onHome.t}`);

/* 真推进 30 秒（快进到那儿，然后让 timeupdate 把存档写下来） */
await cdp.ev(`(() => {
  const a = document.getElementById('music-audio');
  a.currentTime = 30;
  return true;
})()`);
await sleep(1200);
const afterSeek = await cdp.ev(PROBE);
check('把进度推到 30 秒后，这首歌自己的存档就是 30 上下',
  Math.abs((afterSeek.pos?.[homeTrack.src] ?? -1) - 30) <= 1.5,
  JSON.stringify({ 存档: afterSeek.pos?.[homeTrack.src], 进度: afterSeek.t }));

/* ---------------- ② 点进随机播放那一页：听到 10 秒 ---------------- */
await cdp.goto(`/${shuffleKey.replace(/^board:|^page:/, '').replace(/^list:/, '')}/`, 2400);
const onShuffle = await cdp.ev(PROBE);
console.log('随机页：', JSON.stringify(onShuffle));
const picked = shuffleTracks.find((t) => onShuffle.src.endsWith(t.src)) ?? null;
check('随机页开始放它自己歌单里的一首', !!picked, onShuffle.src || onShuffle.title);
check('这一首**以前没听过** → 从头开始（不能把上一页那 30 秒捡过来）', onShuffle.t < 3, `currentTime=${onShuffle.t}`);

await cdp.ev(`(() => { document.getElementById('music-audio').currentTime = 10; return true; })()`);
await sleep(1200);
const afterShuffleSeek = await cdp.ev(PROBE);
check('这一首自己的存档是 10 上下，而首页那首的存档没被动',
  picked && Math.abs((afterShuffleSeek.pos?.[picked.src] ?? -1) - 10) <= 1.5 &&
    Math.abs((afterShuffleSeek.pos?.[homeTrack.src] ?? -1) - 30) <= 1.5,
  JSON.stringify(afterShuffleSeek.pos));

/* ---------------- ③ 回首页：Fly with Me 应该从 30 秒接着放 ---------------- */
await cdp.goto('/', 2400);
const backHome = await cdp.ev(PROBE);
console.log('回首页：', JSON.stringify(backHome));
/*
  判据说明：播放器**故意**把"跳页耗掉的时间"算进落点（resumeAt = 存档 + 跳页耗时，
  这样跨页听着才连贯），落地之后那首歌还会继续往前走一两秒 ——
  所以这里量的是"明显不是从头"，而不是正好 30。
*/
check('★ 回首页：Fly with Me 从上次那个位置接着放（不是从头）',
  backHome.src.endsWith(homeTrack.src) && backHome.t >= 28 && backHome.t < 60,
  `currentTime=${backHome.t}（把进度推到了 30，接着放就应该 >= 28）`);

/* ---------------- ④ 再回随机页：抽到谁就接着谁 ---------------- */
const round2 = [];
for (let i = 0; i < 6; i++) {
  await cdp.goto(`/${shuffleKey.replace(/^board:|^page:/, '').replace(/^list:/, '')}/`, 2400);
  const s = await cdp.ev(PROBE);
  const who = shuffleTracks.find((t) => s.src.endsWith(t.src)) ?? null;
  const want = who && who.src === picked.src ? 10 : 0;
  round2.push({ who: who?.title.slice(-8) ?? s.src, t: s.t, want });
  if (who?.src === picked.src && Math.abs(s.t - 10) <= 2.5) break;
}
console.log('再回随机页：', JSON.stringify(round2));
const replayedSame = round2.find((r) => r.want === 10);
const freshOther = round2.find((r) => r.want === 0);
check('★ 随机又抽到**听过的那一首** → 从它停下的地方接着放（不是从头）',
  !!replayedSame && replayedSame.t >= 10 && replayedSame.t < 60,
  replayedSame ? `${replayedSame.who}：${replayedSame.t}（推到过 10）` : '这几轮没抽到它');
check('★ 抽到**没听过的那一首** → 从头开始（不能被"接着放"带跑）',
  !!freshOther && freshOther.t < 8,
  freshOther ? `${freshOther.who}：${freshOther.t}（这一首没听过，落地后又走了几秒）` : '这几轮没抽到另一首');

check('这一趟没有 JS 报错', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '));

try { await cdp.send('Browser.close'); } catch { /* ignore */ }
chrome.kill();
server.close();
try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 }); } catch { /* ignore */ }

console.log(`\n${fail === 0 ? '全部通过' : '有失败项'}：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
