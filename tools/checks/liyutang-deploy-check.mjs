/*
 * ============================================================================
 * 「自动部署云函数」这条链的验收（2026-10-09）
 * ----------------------------------------------------------------------------
 * 背景：以前改云函数要人手复制粘贴到腾讯云控制台；现在改成推送时由
 * .github/workflows/deploy-function.yml 自动部署（密钥放仓库 Secrets）。
 * 这条链有两段最容易悄悄坏掉，所以单独验：
 *   ① **打出来的 zip** —— 云端要能解出 index.js / package.json（这里做"打进再解出、
 *      字节逐一对上"的往返测试，而不是只看大小）；
 *   ② **TC3 签名与请求** —— 这里拿一把**假密钥**真去调一次线上 API：
 *      如果请求格式/签名流程有问题，腾讯云会回"参数错误"之类；只有"身份不对"才说明
 *      整条链是通的（这比我自己对着文档再算一遍更有说服力）。
 *
 * 用法：node tools/checks/liyutang-deploy-check.mjs
 * 说明：第 ③ 段会真发一个 HTTPS 请求到 tcb.tencentcloudapi.com（拿假密钥，不会有任何副作用）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const DEPLOY = path.join(SRC, 'tools', 'liyutang-backend', 'deploy.mjs');
const WORKFLOW = path.join(SRC, '.github', 'workflows', 'deploy-function.yml');

let pass = 0;
let fail = 0;
let skipped = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const skip = (name, why) => {
  skipped++;
  console.log(`SKIP  ${name}   :: ${why}`);
};
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '');
const info = (s) => console.log(`      · ${s}`);

console.log('=== ① 静态：脚本和工作流都在 ===');
const script = read(DEPLOY);
check('部署脚本在', /export function makeZip/.test(script) && /export function signRequest/.test(script));
check('★ 只更新代码，不碰环境变量 / 触发器 / 函数配置',
  /ACTION = 'UpdateFunctionCode'/.test(script) && !/UpdateFunctionConfig|CreateTrigger|DeleteTrigger/.test(script));
check('★ 带上"在线依赖安装"（不然覆盖代码会把 node_modules 弄没）', /InstallDependency: 'TRUE'/.test(script));
check('只传 index.js + package.json（不传 node_modules）',
  /const files = \['index\.js', 'package\.json'\]/.test(script), '');
check('部署完会自己验（新事件认不认）', /probeGateway/.test(script) && /站长密码/.test(script));

const wf = read(WORKFLOW);
check('工作流在', wf.length > 0);
if (wf) {
  check('★ 只在云函数那几个文件变了时触发（推文档不会乱部署）',
    /paths:/.test(wf) && /tools\/liyutang-backend\/index\.js/.test(wf), '');
  check('也能手动点一下（workflow_dispatch）', /workflow_dispatch/.test(wf));
  check('★ 密钥从 Secrets 里读（不是写在文件里）',
    /secrets\.TENCENT_SECRET_ID/.test(wf) && /secrets\.TENCENT_SECRET_KEY/.test(wf) && !/secretId:\s*['"]AKID/.test(wf));
  check('工作流只读仓库（不给写权限）', /contents: read/.test(wf) && !/contents: write/.test(wf));
  check('跑的是同一个脚本', /node tools\/liyutang-backend\/deploy\.mjs/.test(wf));
}

/* ============================================================ ② 打包往返 */
console.log('\n=== ② 打包：打进 zip 再解出来，字节要一模一样 ===');
const mod = await import(new URL(`file:///${DEPLOY.replace(/\\/g, '/')}`).href);
const srcIndex = fs.readFileSync(path.join(SRC, 'tools', 'liyutang-backend', 'index.js'));
const srcPkg = fs.readFileSync(path.join(SRC, 'tools', 'liyutang-backend', 'package.json'));
const zip = mod.makeZip([
  { name: 'index.js', data: srcIndex },
  { name: 'package.json', data: srcPkg },
]);
info(`zip ${zip.length} 字节（base64 后 ${Math.round((zip.length * 4) / 3 / 1024)}KB）`);
check('zip 头尾都是合法标记（本地头 + 中央目录结束记录）',
  zip.readUInt32LE(0) === 0x04034b50 && zip.readUInt32LE(zip.length - 22) === 0x06054b50, '');
check('中央目录里记着两个文件', zip.readUInt16LE(zip.length - 22 + 10) === 2, String(zip.readUInt16LE(zip.length - 22 + 10)));

const back = mod.readZip(zip);
check('★ 解出来正好是那两个文件', back.size === 2 && back.has('index.js') && back.has('package.json'), [...back.keys()].join(', '));
check('★ index.js 逐字节一致（不是"看着差不多"）',
  Buffer.compare(back.get('index.js'), srcIndex) === 0, `${back.get('index.js')?.length} vs ${srcIndex.length} 字节`);
check('★ package.json 逐字节一致', Buffer.compare(back.get('package.json'), srcPkg) === 0, '');
check('zip 里没有 node_modules（依赖交给云上装）', ![...back.keys()].some((n) => n.includes('node_modules')), '');

/* ============================================================ ③ 签名 */
console.log('\n=== ③ 签名：格式 + 自己照文档再算一遍 ===');
const signed = mod.signRequest({
  secretId: 'AKIDEXAMPLEFAKE1234567890',
  secretKey: 'FAKESECRETKEYEXAMPLE1234567890',
  body: { FunctionName: 'twikoo', EnvId: 'liyutang-test' },
  timestamp: 1759968000, // 固定时间，结果才可复现
});
check('Authorization 是 TC3-HMAC-SHA256 那一套',
  /^TC3-HMAC-SHA256 Credential=AKIDEXAMPLEFAKE1234567890\/\d{4}-\d{2}-\d{2}\/tcb\/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=[0-9a-f]{64}$/.test(
    signed.authorization
  ),
  signed.authorization.slice(0, 80) + '…');
check('日期用的是 UTC（签名里那一段）', signed.authorization.includes('2025-10-09'), signed.authorization.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '');
check('该带的头都带了（Host / X-TC-Action / X-TC-Version / 时间戳）',
  signed.headers.Host === 'tcb.tencentcloudapi.com' &&
    signed.headers['X-TC-Action'] === 'UpdateFunctionCode' &&
    signed.headers['X-TC-Version'] === '2018-06-08' &&
    /^\d{10}$/.test(signed.headers['X-TC-Timestamp']),
  '');
check('没有临时密钥时不会瞎带 X-TC-Token', !('X-TC-Token' in signed.headers));

/* 同一个时间戳、同一把密钥 → 同样的签名（确定性的） */
const again = mod.signRequest({
  secretId: 'AKIDEXAMPLEFAKE1234567890',
  secretKey: 'FAKESECRETKEYEXAMPLE1234567890',
  body: { FunctionName: 'twikoo', EnvId: 'liyutang-test' },
  timestamp: 1759968000,
});
check('同样的输入 → 同样的签名（可复现）', again.authorization === signed.authorization);

/* 照文档把推导链再走一遍：能逮住顺序/拼接写错（不是官方测试向量，但比只看格式强） */
const h = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ts = 1759968000;
const date = new Date(ts * 1000).toISOString().slice(0, 10);
const payload = JSON.stringify({ FunctionName: 'twikoo', EnvId: 'liyutang-test' });
const canonical = ['POST', '/', '', `content-type:application/json; charset=utf-8\nhost:tcb.tencentcloudapi.com\nx-tc-action:updatefunctioncode\n`, 'content-type;host;x-tc-action', sha(payload)].join('\n');
const sts = ['TC3-HMAC-SHA256', String(ts), `${date}/tcb/tc3_request`, sha(canonical)].join('\n');
const sig = crypto.createHmac('sha256', h(h(h('TC3FAKESECRETKEYEXAMPLE1234567890', date), 'tcb'), 'tc3_request')).update(sts).digest('hex');
/* ⚠ 两边的诊断信息要显示**同一位**（都取前 16 位）：一边取头一边取尾，看着像不一致 ——
   我自己就被这行坑得去查了半天"签名为什么不一样"（其实是同一个签名的两头）。 */
const gotSig = signed.authorization.split('Signature=')[1] ?? '';
check('★ 照文档一步步重算，签名和脚本里的一致',
  gotSig === sig, `重算 ${sig.slice(0, 16)}… / 脚本 ${gotSig.slice(0, 16)}…`);

/* ============================================================ ④ 真发一次请求 */
console.log('\n=== ④ 拿假密钥真调一次线上 API：只要错误是"身份不对"，就说明请求本身是通的 ===');
try {
  const { headers, body } = mod.signRequest({
    secretId: 'AKIDEXAMPLEFAKE1234567890',
    secretKey: 'FAKESECRETKEYEXAMPLE1234567890',
    body: { FunctionName: 'twikoo', EnvId: 'liyutang-d2g4e5otdf1ac263c', Handler: 'index.main', InstallDependency: 'TRUE', CodeSource: 'ZipFile', Code: { ZipFile: 'UEsFBgAAAAAAAAAAAAAAAAAAAAAAAA==' } },
  });
  const res = await fetch('https://tcb.tencentcloudapi.com/', { method: 'POST', headers, body, signal: AbortSignal.timeout(25000) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 不是 JSON */
  }
  const err = json?.Response?.Error;
  info(`HTTP ${res.status} · ${err ? `${err.Code}: ${err.Message.slice(0, 60)}` : text.slice(0, 120)}`);
  check('★ 请求真的到达了腾讯云并得到结构化回应（说明端点/方法/头/正文都对）',
    res.status === 200 && !!json?.Response, `HTTP ${res.status}`);
  check('★ 回的是"身份不对"这类错，而不是"参数看不懂"（后者就说明我们请求写错了）',
    !!err && /^AuthFailure|^UnauthorizedOperation|^InvalidSecretId/.test(String(err.Code)),
    String(err?.Code ?? ''));
} catch (err) {
  skip('真发一次请求', '网络不通：' + String(err?.message ?? err).slice(0, 60));
}

/* ============================================================ ⑤ dry 跑一遍 */
console.log('\n=== ⑤ --dry 跑一遍：打包 + 打印要发什么（不部署） ===');
try {
  const out = execFileSync(process.execPath, [DEPLOY, '--dry'], { encoding: 'utf8', cwd: SRC, timeout: 60000 });
  info(out.trim().split('\n').slice(0, 4).join('\n      '));
  check('★ --dry 会认出环境 id 和函数名', /liyutang-d2g4e5otdf1ac263c/.test(out) && /twikoo/.test(out), '');
  check('--dry 明确说不调 API', /只打包，不调 API/.test(out), '');
  /*
    ⚠ 这一条是**专门盯着"脚本静默不干活"**的：这台机器的仓库路径里有中文，
    早先 `import.meta.url` 和 `file:///` 手拼的路径对不上 → 直接跑这个脚本会
    **一行输出都没有**、退出码还是 0（GitHub 那边路径是 ASCII，反而不会发作）。
    所以这里断言的是"真的有输出"，不是"退出码是 0"。
  */
  check('★ --dry 真的有输出（不是静默什么都没做）',
    out.trim().length > 0 && /打包：/.test(out), `${out.trim().length} 字符`);
} catch (err) {
  check('--dry 跑得通', false, String(err?.message ?? err).slice(0, 80));
}

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
