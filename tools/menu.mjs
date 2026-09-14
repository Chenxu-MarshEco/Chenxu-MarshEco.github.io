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
  line('   正在启动本地预览。');
  line('');
  line(`   地址是 ${C.cyan}http://localhost:4321${C.r}`);
  note('   浏览器大约 4 秒后自动打开，别急着关这个窗口。');
  note('   想停止预览：回到这个窗口按 Ctrl+C。');
  line('');

  // 延迟几秒再开浏览器，等开发服务器起来
  const opener = setTimeout(() => {
    const url = 'http://localhost:4321';
    if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
  }, 4000);

  await run('pnpm', ['dev']);
  clearTimeout(opener);
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

  // 先确认能连上 GitHub。国内直连 github.com 需要代理，
  // 代理没开的时候这里就会失败——比等 push 到一半报错好。
  if (s.remote) {
    line('   正在检查能否连上 GitHub…');
    const probe = capture('git', ['ls-remote', '--heads', 'origin'], { timeout: 30000 });
    if (!probe.ok) {
      line('');
      bad('连不上 GitHub。');
      line('');
      line('   最常见的原因是代理没开。请：');
      line(`     ${C.white}1.${C.r} 打开 Clash Verge`);
      line(`     ${C.white}2.${C.r} 确认「订阅」里已经导入了节点`);
      line(`     ${C.white}3.${C.r} 打开「系统代理」开关`);
      line('   然后回到菜单重新选 3。');
      await waitKey();
      return;
    }
    ok('连接正常');
  }

  line('');
  execFileSync('git', ['add', '-A'], { cwd: ROOT, stdio: 'inherit' });
  const changed = capture('git', ['status', '--short']);
  if (!changed.ok || !changed.out) {
    line('');
    note('没有任何改动，不用发布。');
    await waitKey();
    return;
  }

  line('   下面列出这次要提交的文件：');
  line('');
  for (const l of changed.out.split('\n')) {
    const flag = l.slice(0, 2).trim();
    const file = l.slice(3);
    const color = flag === '??' ? C.gray : flag.includes('D') ? C.red : C.green;
    console.log(`     ${color}${flag.padEnd(2)}${C.r} ${file}`);
  }
  line('');

  const msg = await ask(`   这次改了什么？${C.gray}（直接回车用「更新内容」）${C.r}: `, '更新内容');

  line('');
  const committed = await commit(msg);
  if (!committed.ok) {
    line('');
    bad('提交失败：');
    note(committed.err.split('\n').slice(0, 4).join('\n   '));
    await waitKey();
    return;
  }
  const first = committed.out.split('\n').find((l) => l.includes('file')) ?? '';
  ok(`已提交  ${first.trim()}`);

  line('');
  line('   正在推送到 GitHub…');
  const push = capture('git', ['push'], { timeout: 180000 });
  if (!push.ok) {
    line('');
    bad('推送失败。常见原因：');
    note('- 代理掉了，重开 Clash Verge 再试');
    note('- 还没登录 GitHub，需要跑 gh auth login');
    note('- 缺 workflow 权限，需要跑 gh auth refresh -s workflow');
    line('');
    note(push.err.split('\n').slice(0, 4).join('\n   '));
    await waitKey();
    return;
  }

  line('');
  console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
  ok(`${C.bold}推送成功！${C.r}`);
  line('');
  line('   等一两分钟，刷新网址就能看到更新。');
  note('   想确认构建结果：仓库页面的 Actions 标签。');
  console.log(`   ${C.gray}${'─'.repeat(54)}${C.r}`);
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
