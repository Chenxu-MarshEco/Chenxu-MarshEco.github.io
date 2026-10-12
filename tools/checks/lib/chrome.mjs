/*
 * ============================================================================
 * 验收脚本用哪个浏览器 —— 一个地方决定，65 个脚本共用
 * ----------------------------------------------------------------------------
 * 2026-10-12 之前，每个验收脚本头上都写死了同一行：
 *
 *     const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\...\chrome.exe`;
 *
 * 那是**站长这台机器**的路径。协作者拿同一个脚本去复验，连浏览器都起不来 ——
 * 而"自己能复验"正是他把编辑器一起写的前提（这条就是协作者那边反馈回来的）。
 *
 * 现在按可信度依次找，用第一个真的存在的：
 *
 *   ① 环境变量 `DSH_CHROME`（要显式指定就设它）
 *   ② `CHROME_PATH` / `PUPPETEER_EXECUTABLE_PATH`（别的工具链的既有约定，顺手认）
 *   ③ Playwright 下下来的 Chromium：`<LOCALAPPDATA>\ms-playwright\chromium-*`，
 *      **版本号大的优先**（原来那行写死的就是这一档）
 *   ④ 系统装的 Chrome（Program Files / Program Files (x86) / LOCALAPPDATA 三档都试）
 *   ⑤ 系统装的 Edge（Windows 上几乎必有，无头跑验收够用）
 *   ⑥ PATH 里的 chrome / chromium / google-chrome / msedge
 *   ⑦ macOS / Linux 的常见安装位置
 *
 * **为什么 Playwright 那份排在最前**：它是这个仓库一直在用的（版本固定、
 * 无头参数都验证过），排最前保证**本机行为与从前完全一致**（找出来的就是原来那一条）；
 * 换台机器时它多半不存在，才往后退到系统 Chrome / Edge。
 *
 * 都找不到就**抛一个说清楚怎么办的错**，而不是让 spawn 抛一句看不懂的 ENOENT。
 * 用法：
 *     import { chromePath } from './lib/chrome.mjs';
 *     const CHROME = chromePath();
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

/** 文件存在（且是文件）才算数 */
const exists = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

/** PATH 里找（Windows 上要自己补 .exe） */
function fromPath(names) {
  const dirs = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const name of names) {
    for (const dir of dirs) {
      const p = path.join(dir, name);
      if (exists(p)) return p;
    }
  }
  return '';
}

/** Playwright 下下来的 Chromium，版本号大的优先 */
function playwrightChromium() {
  const root = process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
    : path.join(process.env.HOME || '', '.cache', 'ms-playwright');
  let entries = [];
  try {
    entries = fs.readdirSync(root).filter((n) => /^chromium-\d+$/.test(n));
  } catch {
    return '';
  }
  entries.sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)));
  const inside = [
    ['chrome-win64', 'chrome.exe'],
    ['chrome-win', 'chrome.exe'],
    ['chrome-linux', 'chrome'],
    ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'],
  ];
  for (const dir of entries) {
    for (const rel of inside) {
      const p = path.join(root, dir, ...rel);
      if (exists(p)) return p;
    }
  }
  return '';
}

/**
 * 所有候选（按优先级）。`DSH_CHROME` 单独拿出来，好让报错说清是"你设错了"
 * 还是"这台机器上没有"。
 * @returns {string[]}
 */
export function chromeCandidates() {
  const out = [];
  const win = process.platform === 'win32';
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';

  if (win) {
    out.push(
      path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(pf, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    );
  } else {
    out.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
      '/usr/bin/microsoft-edge',
    );
  }

  const pw = playwrightChromium();
  const fromP = win
    ? fromPath(['chrome.exe', 'msedge.exe', 'chromium.exe'])
    : fromPath(['google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']);
  return [pw, ...out, fromP].filter(Boolean);
}

/**
 * 这个环境里该用哪个浏览器。
 * @param {{env?:string, exists?:Function}} [opts] 只给验收脚本自己"覆盖实验"用
 * @returns {string} 绝对路径
 */
export function chromePath() {
  const explicit = String(
    process.env.DSH_CHROME || process.env.CHROME_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || '',
  ).trim();
  if (explicit) {
    if (exists(explicit)) return explicit;
    throw new Error(
      `环境变量指定的浏览器不存在：${explicit}\n`
      + '　（DSH_CHROME / CHROME_PATH / PUPPETEER_EXECUTABLE_PATH 三选一，指到 chrome.exe 那种可执行文件）',
    );
  }
  const hit = chromeCandidates()[0];
  if (hit) return hit;
  throw new Error(
    '这台机器上找不到可用的浏览器（验收脚本要无头跑真页面）。三种办法，任选：\n'
    + '　① 装一个 Chrome 或 Edge（Windows 上一般本来就有 Edge）；\n'
    + '　② 设环境变量 DSH_CHROME=C:\\路径\\到\\chrome.exe；\n'
    + '　③ 让 Playwright 下一份：npx playwright install chromium\n'
    + `找过这些地方：\n${chromeCandidates().map((p) => `　　${p}`).join('\n') || '　　（一个候选都没有）'}`,
  );
}
