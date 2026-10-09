/*
 * ============================================================================
 * 把云函数代码部署上去（2026-10-09 加）
 * ----------------------------------------------------------------------------
 * 为什么有这个东西：以前每次改云函数，都要"复制这一份 → 去腾讯云控制台 → 全选删掉 →
 * 粘上去 → 保存 → 部署"，一步做错就白忙一轮（2026-10-07 还被编码坑过一次）。
 * 现在改成：**推送时由 GitHub Actions 自动部署**（.github/workflows/deploy-function.yml），
 * 密钥放在仓库的 Secrets 里（`TENCENT_SECRET_ID` / `TENCENT_SECRET_KEY`），
 * 站长自己不用复制粘贴，我也不用拿密钥。
 *
 * 它干三件事，一件都不多：
 *   ① 把 index.js + package.json 打成一个几十 KB 的 zip（**不含 node_modules**：
 *      云上用 `InstallDependency: TRUE` 按 package.json 自己装依赖，见下面的注释）；
 *   ② 用 TC3-HMAC-SHA256 签名，调云开发的 `UpdateFunctionCode`（只更新代码，
 *      不碰环境变量、不碰触发器、不碰函数配置）；
 *   ③ **部署完自己验一遍**：调那条公开的 HTTP 网关，看新事件认不认
 *      （回"要登录/过审"= 新代码在跑；回"站长密码不对"= 还是旧代码）。
 *
 * 用法：
 *   node tools/liyutang-backend/deploy.mjs            # 真部署（需要两个环境变量）
 *   node tools/liyutang-backend/deploy.mjs --dry      # 只打包 + 打印要发什么，不调 API
 *   node tools/liyutang-backend/deploy.mjs --local    # 用本机那把钥匙（%USERPROFILE%\.huajiantang\tcb-key.json）
 *
 * 环境变量：TENCENT_SECRET_ID / TENCENT_SECRET_KEY（必填；临时密钥再加 TENCENT_TOKEN）
 *          LT_TCB_ENV_ID（可选，默认从 src/data/liyutang.json 里那条网关地址里取）
 *          LT_TCB_FUNCTION（可选，默认 twikoo）
 * ============================================================================
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const ENDPOINT = 'tcb.tencentcloudapi.com';
const SERVICE = 'tcb';
const VERSION = '2018-06-08';
const ACTION = 'UpdateFunctionCode';

/* ============================================================ 打 zip（零依赖） */

/** CRC32 查表（ZIP 里每个文件条目都要） */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

/**
 * @param {Buffer} buf 数据
 * @returns {number} CRC32
 */
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/**
 * 打一个 zip（**只用 store 方式**，不压缩）。
 *
 * 为什么自己写而不是找个库：这个脚本要在 GitHub Actions 的 ubuntu 上跑，
 * 那边没有 PowerShell 的 Compress-Archive；而为了一个几十 KB 的 zip 引一个依赖不值得。
 * store 方式（method 0）字节最少、逻辑最简单 —— zip 里那点代码本来也没必要压。
 * @param {Array<{name: string, data: Buffer}>} files 要放进去的文件
 * @returns {Buffer} zip 字节
 */
export function makeZip(files) {
  const now = new Date();
  /* DOS 时间戳（zip 的老格式：日期在前、时间在后，各 16 位） */
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;

  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = f.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // 本地文件头
    local.writeUInt16LE(20, 4); // 解压所需版本
    local.writeUInt16LE(0, 6); // 标志位
    local.writeUInt16LE(0, 8); // 压缩方式 = store
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); // 压缩后大小
    local.writeUInt32LE(data.length, 22); // 原始大小
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // 扩展区长度
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // 中央目录条目
    central.writeUInt16LE(20, 4); // 打包程序版本
    central.writeUInt16LE(20, 6); // 解压所需版本
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // 扩展区
    central.writeUInt16LE(0, 32); // 注释
    central.writeUInt16LE(0, 34); // 磁盘号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42); // 本地头偏移
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // 中央目录结束记录
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

/**
 * 把 zip 读回来（验收脚本用它做"打进去再解出来，字节要一样"的往返测试）。
 * @param {Buffer} zip zip 字节
 * @returns {Map<string, Buffer>} 文件名 → 内容
 */
export function readZip(zip) {
  const out = new Map();
  let i = 0;
  while (i + 30 <= zip.length && zip.readUInt32LE(i) === 0x04034b50) {
    const method = zip.readUInt16LE(i + 8);
    const compSize = zip.readUInt32LE(i + 18);
    const nameLen = zip.readUInt16LE(i + 26);
    const extraLen = zip.readUInt16LE(i + 28);
    const name = zip.slice(i + 30, i + 30 + nameLen).toString('utf8');
    const start = i + 30 + nameLen + extraLen;
    const raw = zip.slice(start, start + compSize);
    out.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    i = start + compSize;
  }
  return out;
}

/* ============================================================ TC3 签名 */

/** sha256 十六进制 */
const sha256hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** HMAC-SHA256 */
const hmac = (key, data) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * 按腾讯云 API 3.0 的规矩签名（TC3-HMAC-SHA256）。
 *
 * 这个函数的每一步都是照官方文档来的；验收脚本里有一条**真请求**（拿假密钥去调线上 API），
 * 就是为了确认"端点 / 方法 / 头 / 正文 / 签名流程"这一整条链是通的
 * ——那种情况下腾讯云会明确回"密钥不对"，而不是"请求看不懂"。
 * @param {object} opts 参数
 * @param {string} opts.secretId 密钥 id
 * @param {string} opts.secretKey 密钥
 * @param {string} [opts.token] 临时密钥的 token
 * @param {object} opts.body 请求体（会被 JSON.stringify）
 * @param {number} [opts.timestamp] 秒级时间戳（测试用）
 * @returns {{headers: Record<string,string>, body: string, authorization: string}} 要发的头和正文
 */
export function signRequest({ secretId, secretKey, token, body, timestamp }) {
  const ts = Math.floor(timestamp ?? Date.now() / 1000);
  const date = new Date(ts * 1000).toISOString().slice(0, 10);
  const payload = JSON.stringify(body);
  const contentType = 'application/json; charset=utf-8';
  const action = ACTION.toLowerCase();

  const canonicalHeaders = `content-type:${contentType}\nhost:${ENDPOINT}\nx-tc-action:${action}\n`;
  const signedHeaders = 'content-type;host;x-tc-action';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256hex(payload)].join('\n');
  const stringToSign = ['TC3-HMAC-SHA256', String(ts), `${date}/${SERVICE}/tc3_request`, sha256hex(canonicalRequest)].join('\n');
  const secretDate = hmac(`TC3${secretKey}`, date);
  const secretService = hmac(secretDate, SERVICE);
  const secretSigning = hmac(secretService, 'tc3_request');
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

  const headers = {
    Authorization: `TC3-HMAC-SHA256 Credential=${secretId}/${date}/${SERVICE}/tc3_request, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Type': contentType,
    Host: ENDPOINT,
    'X-TC-Action': ACTION,
    'X-TC-Timestamp': String(ts),
    'X-TC-Version': VERSION,
  };
  if (token) headers['X-TC-Token'] = token;
  return { headers, body: payload, authorization: headers.Authorization };
}

/* ============================================================ 组装请求体 */

/** 从 src/data/liyutang.json 里读环境 id（那条网关地址形如 https://<envId>-<数字>.ap-shanghai...） */
export function envIdFromConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'liyutang.json'), 'utf8'));
    const url = String(cfg?.forum?.twikoo?.envId || '');
    const host = new URL(url).hostname;
    const m = /^(liyutang-[a-z0-9]+)-\d+\./i.exec(host);
    if (m) return m[1];
    return (host.split('.')[0] || '').split('-').slice(0, -1).join('-');
  } catch {
    return '';
  }
}

/**
 * 打包并组装 `UpdateFunctionCode` 的请求体。
 * @returns {{body: object, zip: Buffer, files: string[]}} 请求体 + zip + 打了哪些文件
 */
export function buildDeployBody() {
  const files = ['index.js', 'package.json'].map((name) => {
    const p = path.join(HERE, name);
    if (!fs.existsSync(p)) throw new Error('找不到 ' + p);
    return { name, data: fs.readFileSync(p) };
  });
  const zip = makeZip(files);
  const envId = String(process.env.LT_TCB_ENV_ID || envIdFromConfig());
  const functionName = String(process.env.LT_TCB_FUNCTION || 'twikoo');
  if (!envId) throw new Error('没找到环境 id（src/data/liyutang.json 里那条网关地址，或者给 LT_TCB_ENV_ID）');
  return {
    zip,
    files: files.map((f) => f.name),
    body: {
      FunctionName: functionName,
      EnvId: envId,
      Handler: 'index.main',
      /*
        ⚠ 这一条是这次改动里最要紧的参数：**在线依赖安装**。
        我们只传 index.js + package.json（不含 node_modules），云上按 package.json 自己装
        twikoo-func / mongodb —— 所以覆盖代码不会把依赖搞没。
      */
      InstallDependency: 'TRUE',
      CodeSource: 'ZipFile',
      Code: { ZipFile: zip.toString('base64') },
      Publish: 'FALSE',
    },
  };
}

/* ============================================================ 部署 + 自检 */

/** 调一次腾讯云 API（返回解析后的 JSON） */
async function callApi({ secretId, secretKey, token, body }) {
  const { headers, body: payload } = signRequest({ secretId, secretKey, token, body });
  const res = await fetch(`https://${ENDPOINT}/`, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 不是 JSON 就原样带回去 */
  }
  return { status: res.status, json, text };
}

/** 用公开网关自检：新事件认不认（回"登录/过审"= 新代码；回"站长密码"= 旧代码） */
async function probeGateway(label = '') {
  let api = '';
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'data', 'liyutang.json'), 'utf8'));
    api = String(cfg?.forum?.twikoo?.envId || '');
  } catch {
    /* 读不到就算了 */
  }
  if (!api) return { ok: false, why: '读不到后端地址' };
  const out = {};
  for (const [event, name] of [
    ['GET_FUNC_VERSION', '函数'],
    ['LT_CHAT_LIST', '聊天室'],
    ['LT_DRAW_LIST', '画板'],
  ]) {
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ event }),
        signal: AbortSignal.timeout(20000),
      });
      const j = await r.json();
      const msg = String(j?.message ?? '');
      out[name] = /站长密码/.test(msg) ? '旧代码' : /登录|过审/.test(msg) || j?.code === 0 ? '新代码' : `? ${msg.slice(0, 40)}`;
    } catch (err) {
      out[name] = '连不上：' + String(err?.message ?? err).slice(0, 40);
    }
  }
  const ok = out['聊天室'] === '新代码' && out['画板'] === '新代码';
  if (label) console.log(`     自检（${label}）：` + JSON.stringify(out));
  return { ok, out };
}

/* ============================================================ 主流程 */

/*
  ⚠ 判断"是不是直接 node 跑的这个文件"，**必须用 pathToFileURL**：
  这台机器的仓库路径里有中文，`import.meta.url` 里那些字是**百分号转义**过的
  （`file:///D:/%E6%9B%BC.../deploy.mjs`），拿 `file:///` + 原样路径拼出来的字符串
  永远不相等 —— 于是脚本会"静默地什么都不做"（2026-10-09 验收里逮住的：
  `--dry` 一行输出都没有、退出码还是 0）。GitHub Actions 那边路径是 ASCII，
  这个 bug 在那里反而不会发作 —— 所以它只能在本地被逮住。
*/
const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  const argv = process.argv.slice(2);
  const dry = argv.includes('--dry');
  const local = argv.includes('--local');

  let secretId = String(process.env.TENCENT_SECRET_ID || '');
  let secretKey = String(process.env.TENCENT_SECRET_KEY || '');
  const token = String(process.env.TENCENT_TOKEN || '');
  if (local || (!secretId && !secretKey)) {
    /* 本机那把钥匙（放仓库外面，不进 git） */
    const keyFile = path.join(os.homedir(), '.huajiantang', 'tcb-key.json');
    if (fs.existsSync(keyFile)) {
      const k = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      secretId = secretId || String(k.secretId || '');
      secretKey = secretKey || String(k.secretKey || '');
      if (!token) console.log('     用的是本机钥匙：' + keyFile);
    }
  }

  const built = buildDeployBody();
  console.log(`=== 部署云函数 ${built.body.FunctionName} @ ${built.body.EnvId} ===`);
  console.log(`     打包：${built.files.join(' + ')} → ${Math.round(built.zip.length / 1024)}KB zip（base64 后 ${Math.round(built.body.Code.ZipFile.length / 1024)}KB）`);
  console.log(`     InstallDependency=${built.body.InstallDependency}（云上按 package.json 自己装依赖，我们不传 node_modules）`);

  if (dry) {
    console.log('     --dry：只打包，不调 API、不部署');
    process.exit(0);
  }
  if (!secretId || !secretKey) {
    console.error('     没给密钥：请设 TENCENT_SECRET_ID / TENCENT_SECRET_KEY（或本机 ~/.huajiantang/tcb-key.json）');
    process.exit(2);
  }

  const res = await callApi({ secretId, secretKey, token, body: built.body });
  const r = res.json?.Response ?? {};
  if (res.json?.Response?.Error) {
    console.error(`     部署失败：${r.Error.Code} ${r.Error.Message}`);
    console.error(`     （RequestId ${r.RequestId ?? '?'}；如果码是 UnauthorizedOperation，说明子用户策略里少了 tcb:UpdateFunctionCode）`);
    process.exit(1);
  }
  if (!res.json?.Response) {
    console.error(`     返回看不懂（HTTP ${res.status}）：${res.text.slice(0, 200)}`);
    process.exit(1);
  }
  console.log(`     提交成功：RequestId ${r.RequestId}${r.SCFErrorCode ? ` · SCFErrorCode ${r.SCFErrorCode}` : ''}`);

  /* 部署要几秒生效：隔几秒探一次，最多等 90 秒 */
  let last = null;
  for (let i = 0; i < 12; i += 1) {
    await sleep(8000);
    last = await probeGateway(`第 ${i + 1} 次`);
    if (last.ok) break;
  }
  if (last?.ok) {
    console.log('     ✅ 新代码已经在线上跑着了（聊天室和画板的事件都认了）');
  } else {
    console.log('     ⚠ 还没探到新代码生效 —— 过一两分钟再跑一次 `node tools/checks/liyutang-live-check.mjs` 看看');
    process.exitCode = 1;
  }
}
