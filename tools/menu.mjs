#!/usr/bin/env node
/**
 * 花娅陌质流 —— 写作、预览、发布、设置的统一入口
 *
 * 为什么菜单逻辑写在 Node 而不是 .cmd 里：
 * cmd.exe 在执行 chcp 65001 之后，是按「字节偏移」重新定位批处理文件的。
 * 文件里多字节的中文字符一多，偏移就会漂到字符中间，导致它从某一行的
 * 中间开始解析——注释被当成命令执行，报出 'xxx' is not recognized。
 * 文件越长越容易触发。所以 .cmd 只保留纯 ASCII 的启动逻辑，
 * 所有中文界面和交互都交给 Node，从根上避开这个问题。
 */
import { spawn, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';
// 推流那一套（先拉后推、永不强推）只有一份实现，和图形启动器共用：
// 见 tools/git/sync.mjs 开头那段说明。
import { publish as safePublish, explain as explainSync, sync as syncRemote,
         status as gitStatus } from './git/sync.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';

// ---------- 颜色 ----------
const C = {
  r: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  white: '\x1b[97m',
};

const clearScreen = () => process.stdout.write('\x1b[2J\x1b[H');

// pnpm / npm 在 Windows 上是 .cmd 批处理，必须经过 shell 才能启动。
// 但 shell:true 同时又传 args 数组会触发 Node 的 DEP0190 警告
// （参数不转义直接拼接，有注入风险），所以这里把整条命令作为
// 单个字符串交给 shell。这些调用的参数全是代码里写死的字面量；
// 唯一的用户输入（提交说明）走 stdin，不经过这里。
const NEEDS_SHELL = /^(pnpm|npm|npx)$/i;

function spawnArgs(cmd, args) {
  if (IS_WIN && NEEDS_SHELL.test(cmd)) return [[cmd, ...args].join(' '), [], true];
  return [cmd, args, false];
}

// ---------- 跑外部命令，实时把输出透到终端 ----------
function run(cmd, args, { cwd = ROOT } = {}) {
  return new Promise((resolve) => {
    // 交给子进程自己处理键盘和 Ctrl+C
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
    }
    const [file, argv, shell] = spawnArgs(cmd, args);
    const child = spawn(file, argv, { cwd, stdio: 'inherit', shell });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', () => resolve(1));
  });
}

// ---------- 跑外部命令，把输出抓成字符串 ----------
function capture(cmd, args, { cwd = ROOT, timeout = 15000 } = {}) {
  const [file, argv, shell] = spawnArgs(cmd, args);
  try {
    return {
      ok: true,
      out: execFileSync(file, argv, {
        cwd,
        timeout,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        shell,
      }).trim(),
    };
  } catch (err) {
    const e = String(err.stderr ?? '') || err.message;
    return { ok: false, out: '', err: e.trim() };
  }
}

// ---------- 提交。说明文字从 stdin 进，避免任何转义问题 ----------
function commit(message) {
  return new Promise((resolve) => {
    const child = spawn('git', ['commit', '-F', '-'], { cwd: ROOT });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, out: '', err: e.message }));
    child.on('exit', (code) => resolve({ ok: code === 0, out: out.trim(), err: err.trim() }));
    child.stdin.end(message + '\n');
  });
}

// ---------- 收集状态 ----------
function status() {
  const deps = existsSync(path.join(ROOT, 'node_modules'));

  const gitVersion = capture('git', ['--version']);
  let remote = null;
  if (gitVersion.ok) {
    const r = capture('git', ['remote', 'get-url', 'origin']);
    if (r.ok && r.out) remote = r.out;
  }

  return { deps, hasGit: gitVersion.ok, remote };
}

// ---------- 画界面 ----------
function draw() {
  const s = status();
  const W = 54;
  const line = '─'.repeat(W);
  const row = (label, text, color = '') =>
    `   ${C.gray}${label.padEnd(6)}${C.r}${color}${text}${C.r}`;

  clearScreen();
  console.log('');
  console.log(`   ${C.bold}${C.cyan}花娅陌质流${C.r}`);
  console.log(`   ${C.gray}${line}${C.r}`);
  console.log('');

  console.log(
    s.deps
      ? row('依赖', '已安装', C.green)
      : row('依赖', '未安装  （请先选 4 做首次设置）', C.yellow)
  );
  console.log(
    !s.hasGit
      ? row('备份', '没找到 git  （只影响发布）', C.yellow)
      : s.remote
        ? row('备份', '已连到 GitHub', C.green)
        : row('备份', '还没连到 GitHub  （请先选 4）', C.yellow)
  );

  /*
    同步状态（2026-10-05 加）：站点的内容不止你一个人在改 —— 另一位会推文章，
    接入的机器人也会定时往里写稿。**开工前先知道远端有没有新东西**，
    比推的时候被拒绝再回头查要省事得多。这里只看本地记录的远端分支，不联网。
  */
  if (s.hasGit && s.remote) {
    const g = gitStatus({ light: true });
    if (g.behind > 0) {
      console.log(row('同步', `远端有 ${g.behind} 个提交还没拉  （选 1 写文章时会自动先拉）`, C.yellow));
    } else if (g.ahead > 0) {
      console.log(row('同步', `本地有 ${g.ahead} 个提交还没发布`, C.yellow));
    } else {
      console.log(row('同步', '和远端一致', C.green));
    }
  }

  console.log('');
  console.log(`   ${C.gray}${line}${C.r}`);
  console.log('');
  console.log(`     ${C.bold}${C.white}1${C.r}   ${C.white}写文章${C.r}      ${C.gray}打开编辑器，在浏览器里写${C.r}`);
  console.log(`     ${C.bold}${C.white}2${C.r}   ${C.white}看效果${C.r}      ${C.gray}在浏览器里预览站点${C.r}`);
  console.log(`     ${C.bold}${C.white}3${C.r}   ${C.white}发布上线${C.r}    ${C.gray}提交并推送到 GitHub${C.r}`);
  console.log(`     ${C.bold}${C.white}4${C.r}   ${C.white}首次设置${C.r}    ${C.gray}检查环境、安装依赖${C.r}`);
  console.log('');
  console.log(`     ${C.bold}${C.white}0${C.r}   ${C.gray}退出${C.r}`);
  console.log('');
  console.log(`   ${C.gray}${line}${C.r}`);
  console.log('');
}

function line(msg = '') {
  console.log(msg);
}

function header(title) {
  clearScreen();
  console.log('');
  console.log(`   ${C.bold}${C.cyan}${title}${C.r}`);
  console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
  console.log('');
}

function ok(msg) {
  console.log(`   ${C.green}[ok]${C.r} ${msg}`);
}
function bad(msg) {
  console.log(`   ${C.red}[x ]${C.r} ${msg}`);
}
function note(msg) {
  console.log(`   ${C.gray}${msg}${C.r}`);
}

// ---------- 等一个按键 ----------
function waitKey(prompt = '按任意键回到菜单') {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) return resolve();
    console.log('');
    process.stdout.write(`   ${C.gray}${prompt}…${C.r}`);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve();
    });
  });
}

// ---------- 提问（需要正常行输入，不能用 raw 模式）----------
function ask(question, fallback = '') {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
      process.stdin.resume();
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      if (process.stdin.isTTY) process.stdin.pause();
      const v = ans.trim();
      resolve(v || fallback);
    });
  });
}

// ---------- 各功能 ----------
async function requireDeps() {
  if (existsSync(path.join(ROOT, 'node_modules'))) return true;
  header('还没装依赖');
  bad('项目依赖还没有安装。');
  line('');
  note('请先回到菜单选 4 做首次设置。');
  await waitKey();
  return false;
}

async function doWrite() {
  if (!(await requireDeps())) return;
  header('写文章');

  /*
    开工前先拉一下（2026-10-05 加）。
    机器人 / 另一位可能刚往仓库里推了文章；如果本地还是老的，写的时候脑子里的
    "现在站上有什么"和实际就对不上了。这里拉一次，几秒钟的事。
    工作区还有没发布的改动时 sync() 不会擅自合并，只会提示一句。
  */
  if (status().remote) {
    const r = syncRemote({ log: (m) => line(m) });
    if (r.code !== 'ok') {
      line('');
      bad(explainSync(r).split('\n')[0]);
      note(explainSync(r).split('\n').slice(1).join('\n'));
      line('');
      note('（不影响写作，继续打开编辑器；发布的时候还会再拉一次。）');
    }
  } else {
    line(`   ${C.gray}还没连到 GitHub，跳过同步检查。${C.r}`);
  }

  line('');
  line('   正在启动写作编辑器，浏览器会自动打开。');
  line('');
  note('写完想退出时，回到这个窗口按 Ctrl+C，就会回到菜单。');
  line('');
  await run('pnpm', ['editor', '--open']);
  line('');
  ok('编辑器已经停止。');
  await waitKey();
}

async function doPreview() {
  if (!(await requireDeps())) return;
  header('看效果');

  // 看效果也先拉一下：别人刚写的文章，本地预览里也该看得见（理由同 doWrite）
  if (status().remote) {
    const r = syncRemote({ log: (m) => line(m) });
    if (r.code !== 'ok') {
      line('');
      for (const l of explainSync(r).split('\n')) line(`   ${l}`);
    }
    line('');
  }
  line('   正在启动本地预览。');
  line('');
  /*
    ⚠ 地址一律写字面量 127.0.0.1，**不要写 localhost**（2026-09-29 改）。

    两个原因叠在一起：Windows 上 `localhost` 先解析成 IPv6 的 ::1，而预览服务是
    显式绑在 127.0.0.1（IPv4）上的；没有代理时浏览器收到"立刻被拒"会飞快退回 IPv4，
    看不出问题 —— 但开着代理/梯子（Clash 一类，尤其 fake-ip DNS / TUN 模式）时，
    那一次 ::1 尝试可能被拖住、或者 localhost 干脆被解析到别的地址，
    表现就是「看效果时好时坏、要反复开关梯子、甚至完全打不开」。
    127.0.0.1 是字面地址，不经过 DNS，也不出本机回环 —— 梯子开着关着都一样。
    （启动器 studio.py 那边同一处也一起改了。）
  */
  const url = 'http://127.0.0.1:4321';
  line(`   地址是 ${C.cyan}${url}${C.r}`);
  note('   浏览器会在服务真的起来之后自动打开，别急着关这个窗口。');
  note('   想停止预览：回到这个窗口按 Ctrl+C。');
  line('');

  // 等服务真的在听了再开浏览器 —— 依赖装完第一次跑要编译一阵子，
  // 无脑定时打开的话浏览器会先撞上「无法访问此网站」，看起来像坏了。
  let stopped = false;
  const opener = (async () => {
    const http = await import('node:http');
    for (let i = 0; i < 60 && !stopped; i++) {
      const up = await new Promise((res) => {
        const req = http.get(`${url}/`, (r) => { r.resume(); res(true); });
        req.on('error', () => res(false));
        req.setTimeout(800, () => { req.destroy(); res(false); });
      });
      if (up) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (stopped) return; // 预览已经停了就别再开浏览器了
    if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  })();
  void opener;

  await run('pnpm', ['dev', '--host', '127.0.0.1']);
  stopped = true;
  line('');
  ok('预览已经停止。');
  await waitKey();
}

async function doPublish() {
  if (!(await requireDeps())) return;
  const s = status();

  if (!s.hasGit) {
    header('发布上线');
    bad('没有找到 git，没办法发布。');
    line('');
    note('请先回到菜单选 4 做首次设置。');
    await waitKey();
    return;
  }

  header('发布上线');

  /*
    发布流程整个搬到 tools/git/sync.mjs 了（探连接 → 提交 → **先拉取** → 推送，
    被拒绝就再拉一次重推）。和图形启动器共用同一份实现，这里只负责把每一步
    的话打到屏幕上。

    以前这里是 add -A → commit → push，中间没有拉取：别人先推了的话必然被拒绝，
    而报错文案说的是「代理掉了 / 没登录 GitHub」——三句里没有一句是真正的原因，
    用户顺着提示怎么试都推不上去。
  */
  const msg = await ask(`   这次改了什么？${C.gray}（直接回车用「更新内容」）${C.r}: `, '更新内容');
  line('');
  const r = safePublish({ message: msg, log: (m) => line(m) });
  line('');

  const lines = explainSync(r).split('\n');
  if (r.code === 'ok') {
    console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
    ok(`${C.bold}${lines[0]}${C.r}`);
    line('');
    line('   等一两分钟，刷新网址就能看到更新。');
    note('   想确认构建结果：仓库页面的 Actions 标签。');
    console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
  } else if (r.code === 'nothing') {
    note(lines[0]);
  } else {
    bad(lines[0]);
    for (const l of lines.slice(1)) line(l);
  }
  await waitKey();
}

async function doSetup() {
  header('首次设置');

  const nodeV = capture('node', ['-v']);
  if (!nodeV.ok) {
    bad('没有找到 Node.js');
    line('');
    note('请到 https://nodejs.org/ 下载 LTS 版本安装，');
    note('一路点「下一步」即可，装完重新双击本文件。');
    await waitKey();
    return;
  }
  ok(`Node.js ${nodeV.out.replace(/^v/, '')}`);

  let pnpmV = capture('pnpm', ['-v']);
  if (!pnpmV.ok) {
    note('没有找到 pnpm，正在安装…');
    const code = await run('npm', ['install', '-g', 'pnpm']);
    if (code !== 0) {
      line('');
      bad('pnpm 安装失败，检查一下网络再重试。');
      await waitKey();
      return;
    }
    pnpmV = capture('pnpm', ['-v']);
  }
  ok(`pnpm ${pnpmV.out}`);

  const gitV = capture('git', ['--version']);
  if (!gitV.ok) {
    note('没有找到 git（本地写作和预览不受影响，只影响发布）');
  } else {
    ok(gitV.out);
  }

  line('');
  line('   正在安装项目依赖，第一次会慢一些，请耐心等…');
  line('');
  const code = await run('pnpm', ['install']);
  if (code !== 0) {
    line('');
    bad('依赖安装失败，把上面的报错发给我看看。');
    await waitKey();
    return;
  }

  line('');
  console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
  ok(`${C.bold}全部就绪！回到菜单就能开始写了。${C.r}`);
  console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
  await waitKey();
}

// ---------- 主循环 ----------
const ACTIONS = {
  '1': doWrite,
  '2': doPreview,
  '3': doPublish,
  '4': doSetup,
};

let busy = false;

// 子进程在跑的时候，Ctrl+C 也会发给我们。
// 这里吞掉它，让子进程自己退出，然后我们回到菜单。
process.on('SIGINT', () => {
  if (!busy) process.exit(0);
});

function waitForKey() {
  return new Promise((resolve) => {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.once('data', async (buf) => {
      const key = buf.toString('utf8');
      if (key === '\u0003') {
        // Ctrl+C
        process.stdin.setRawMode(false);
        process.stdin.pause();
        clearScreen();
        resolve(null);
        return;
      }
      process.stdin.setRawMode(false);
      process.stdin.pause();
      resolve(key);
    });
  });
}

async function main() {
  if (!process.stdin.isTTY) {
    console.log('这个菜单需要在真正的终端窗口里运行，请在资源管理器里双击 花娅陌质流.cmd。');
    process.exit(1);
  }
  process.title = '花娅陌质流';

  for (;;) {
    draw();
    process.stdout.write(`   ${C.gray}请按数字键选择（0 = 退出）：${C.r}`);
    const key = await waitForKey();

    if (key === null || key === '0' || key === 'q' || key === '\u001b') {
      clearScreen();
      process.exit(0);
    }

    const action = ACTIONS[key];
    if (!action) continue;

    busy = true;
    try {
      await action();
    } catch (err) {
      header('出错了');
      bad(String(err.message ?? err));
      await waitKey();
    }
    busy = false;
  }
}

// 除了交互菜单，也可以直接跑单个动作，方便自动化：
//   node tools/menu.mjs setup
//   node tools/menu.mjs publish
const DIRECT = {
  write: doWrite,
  preview: doPreview,
  publish: doPublish,
  setup: doSetup,
};

const direct = process.argv[2];
if (direct && DIRECT[direct]) {
  DIRECT[direct]()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
} else {
  main();
}
