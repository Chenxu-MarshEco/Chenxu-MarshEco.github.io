/*
 * ============================================================================
 * 黎语堂「线上」验收 —— 帖子 / 头像那几条路真的通了吗（2026-10-07 晚上）
 * ----------------------------------------------------------------------------
 * 前面那两段验收（liyutang-posts-check 的 ②③）跑的是"内存里的 MongoDB + 假云函数"，
 * 它们证明的是**代码对不对**。这一个脚本跑的是**部署得对不对**：
 * 直接打线上那条 HTTP 网关地址，走真云函数、真 MongoDB。
 *
 * 前提：云函数里那份代码已经**粘贴更新过**（见 tools/liyutang-backend/README.md）。
 *       没更新的话，LT_POST_* 这些事件老代码不认识，会回一句"站长密码不对"——脚本会告诉你。
 *
 * 它**只碰测试账号**，而且用完就删（不留垃圾）：
 *   · 登录验收测试账号（昵称 / 密码见下面常量）；
 *   · 给它设一个 1×1 的透明头像 → 验 → 再清掉（恢复原样）；
 *   · 发一条标题写着"连通性测试（会自动删掉）"的帖子 → 验列表 / 单条 / 浏览数 → **删掉**。
 *
 * 用法：node tools/checks/liyutang-live-check.mjs
 *      node tools/checks/liyutang-live-check.mjs --nick 你的号 --pass 你的密码
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const cfg = JSON.parse(fs.readFileSync(path.join(SRC, 'src', 'data', 'liyutang.json'), 'utf8'));
const API = String(cfg?.forum?.twikoo?.envId || '').trim();
const BOARD = String(cfg?.boards?.[0]?.id || 'notice');
const NICK = argOf('nick', '验收测试');
const PASS = argOf('pass', 'yanshou-2026-test');
/** 一张 1×1 的透明 PNG（当头像用；设完会清掉） */
const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9UeIAAAAAElFTkSuQmCC';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};
const info = (s) => console.log(`      · ${s}`);

const call = async (body) => {
  const r = await fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(25000),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`HTTP ${r.status} 返回的不是 JSON：${text.slice(0, 160)}`);
  }
};

console.log('=== 黎语堂线上验收（真云函数 + 真数据库）===');
info('后端：' + (API || '(没配！)'));
info(`用 ${NICK} 这个账号，版块 ${BOARD}`);

if (!API) {
  console.log('\n没配后端地址（src/data/liyutang.json → forum.twikoo.envId），没什么可验的。');
  process.exit(2);
}

let token = '';
let postId = '';
/** 聊天室那条测试消息（撤不干净的话收尾要再撤一次） */
let chatId = '';
/** 画板上那一笔测试（撤不干净的话收尾要再撤一次） */
let drawId = '';

try {
  const ver = await call({ event: 'GET_FUNC_VERSION' });
  check('函数活着（GET_FUNC_VERSION）', ver.code === 0, JSON.stringify(ver).slice(0, 80));

  const login = await call({ event: 'LT_LOGIN', nick: NICK, pass: PASS });
  check(`登录 ${NICK}（这是那个公开的测试账号）`, login.code === 0, String(login.message ?? '').slice(0, 60));
  if (login.code !== 0) {
    console.log('\n（登录不上就没法往下验了。要么这个号被删了 —— 那就自己注册一个、在「黎语堂管理」里通过；');
    console.log('  要么用 --nick / --pass 换成你自己的号再跑一遍。）');
    throw new Error('stop');
  }
  token = login.token;
  check('这个号是「已通过」状态', login.user?.status === 'approved', String(login.user?.status));

  /* ---- 头像：设一个 → 验 → 清掉 ---- */
  const setFace = await call({ event: 'LT_AVATAR_SET', ltToken: token, avatar: PNG });
  check('★ 线上能换头像（LT_AVATAR_SET）', setFace.code === 0, String(setFace.message ?? '').slice(0, 60));
  const me1 = await call({ event: 'LT_ME', ltToken: token });
  check('★ 头像读得回来（LT_ME 带着它）', me1.user?.avatar === PNG, String(me1.user?.avatar ?? '').slice(0, 24));
  const clearFace = await call({ event: 'LT_AVATAR_SET', ltToken: token, avatar: '' });
  check('头像能清掉（把测试留下的痕迹擦干净）', clearFace.code === 0);

  /* 没登录 / 伪造令牌发帖都该被拒 —— 这条在线上再验一次，因为它是最要紧的那道门槛 */
  check('没登录发帖 → 被拒',
    (await call({ event: 'LT_POST_CREATE', board: BOARD, title: '不该发出去的', md: 'x' })).code !== 0);
  check('伪造令牌发帖 → 被拒',
    (await call({ event: 'LT_POST_CREATE', ltToken: 'abc.def', board: BOARD, title: '不该发出去的', md: 'x' })).code !== 0);

  /* ---- 帖子：发 → 列 → 读 → 删 ---- */
  const title = `连通性测试（会自动删掉）${Date.now().toString().slice(-4)}`;
  const made = await call({
    event: 'LT_POST_CREATE',
    ltToken: token,
    board: BOARD,
    title,
    md: '这条是**自动验收**发的，脚本跑完会立刻把它删掉。\n\n- 如果你在页面上看到它，说明脚本刚好在跑。',
  });
  check('★ 线上能发帖（LT_POST_CREATE）', made.code === 0 && !!made.id, String(made.message ?? made.id ?? '').slice(0, 70));
  if (made.code !== 0) throw new Error('stop');
  postId = String(made.id);

  const list = await call({ event: 'LT_POST_LIST', board: BOARD, limit: 20 });
  check('★ 列表里能看到刚发的那条', list.code === 0 && (list.posts ?? []).some((p) => p.id === postId),
    `共 ${(list.posts ?? []).length} 条`);
  check('列表里不带正文（正文会随图片变胖，列表不能拖）', (list.posts ?? []).every((p) => p.md === undefined));

  const got = await call({ event: 'LT_POST_GET', id: postId });
  check('★ 单条读得出来，正文对得上', got.code === 0 && String(got.post?.md ?? '').includes('自动验收'),
    String(got.post?.title ?? '').slice(0, 40));
  check('浏览量在走', (got.post?.views ?? 0) >= 1, String(got.post?.views));

  const del = await call({ event: 'LT_POST_DELETE', ltToken: token, id: postId });
  check('★ 测试帖删得掉（不留垃圾）', del.code === 0, String(del.message ?? '').slice(0, 60));
  const gone = await call({ event: 'LT_POST_GET', id: postId });
  check('删完就真没了', gone.code !== 0, String(gone.message ?? '').slice(0, 40));
  postId = '';

  /* ---- 聊天室：发一条 → 列表里看得到 → 撤回（同样不留垃圾） ---- */
  const heard = await call({ event: 'LT_CHAT_LIST', ltToken: token });
  check('★ 线上聊天室读得到（LT_CHAT_LIST，读也要过审）', heard.code === 0, String(heard.message ?? '').slice(0, 60));
  const say = await call({ event: 'LT_CHAT_SEND', ltToken: token, text: '连通性测试（会自动撤回）' });
  check('★ 线上聊天室发得出去（LT_CHAT_SEND）', say.code === 0 && !!say.message?.id, String(say.message?.id ?? say.message ?? '').slice(0, 60));
  if (say.code === 0) {
    chatId = String(say.message.id);
    check('消息带着"哪一天"（存档按它切）', /^\d{4}-\d{2}-\d{2}$/.test(String(say.message.day)), String(say.message.day));
    const again = await call({ event: 'LT_CHAT_LIST', ltToken: token });
    check('★ 刚发的那条在列表里', again.code === 0 && (again.messages ?? []).some((m) => m.id === chatId));
    const away = await call({ event: 'LT_CHAT_DELETE', ltToken: token, id: chatId });
    check('★ 测试消息撤得掉（不留垃圾）', away.code === 0, String(away.message ?? '').slice(0, 50));
    const after = await call({ event: 'LT_CHAT_LIST', ltToken: token });
    check('撤回之后列表里没有了', !(after.messages ?? []).some((m) => m.id === chatId));
    chatId = '';
  }
  check('没登录读聊天室 → 被拒（会员聊天室）', (await call({ event: 'LT_CHAT_LIST' })).code !== 0);

  /* ---- 画板：画一笔 → 列表里看得到 → 撤掉（同样不留垃圾） ---- */
  const board = await call({ event: 'LT_DRAW_LIST', ltToken: token });
  check('★ 线上画板拉得到（LT_DRAW_LIST，过审才进得来）', board.code === 0, String(board.message ?? '').slice(0, 60));
  if (board.code === 0) {
    const drew = await call({
      event: 'LT_DRAW_ADD',
      ltToken: token,
      tool: 'pen',
      color: '#1d1430',
      size: 6,
      points: [[100, 100], [160, 140], [220, 120]],
    });
    check('★ 线上画板上画得出一笔（LT_DRAW_ADD）', drew.code === 0 && !!drew.stroke?.id, String(drew.stroke?.id ?? drew.message ?? '').slice(0, 50));
    if (drew.code === 0) {
      drawId = String(drew.stroke.id);
      check('笔划带着 uk（账号短哈希，不泄露账号 id）', /^[0-9a-f]{8}$/.test(String(drew.stroke.uk)), String(drew.stroke.uk));
      const after = await call({ event: 'LT_DRAW_LIST', ltToken: token, after: Number(drew.stroke.createdAt) - 1 });
      check('★ 刚画的那一笔在列表里', after.code === 0 && (after.strokes ?? []).some((s) => s.id === drawId));
      const away = await call({ event: 'LT_DRAW_DELETE', ltToken: token, id: drawId });
      check('★ 测试那一笔撤得掉（不留垃圾）', away.code === 0, String(away.message ?? '').slice(0, 50));
      drawId = '';
    }
  }
  check('没登录读画板 → 被拒（会员画板）', (await call({ event: 'LT_DRAW_LIST' })).code !== 0);
  check('站长密码不对 → 取不到某天的笔划（存档那两个事件的闸门）',
    (await call({ event: 'LT_ADMIN_DRAW_DAY', password: '乱猜的', day: '2026-10-09' })).code !== 0);
} catch (err) {
  if (String(err?.message) !== 'stop') {
    fail++;
    console.log('FAIL  线上这一段异常：' + String(err?.message ?? err));
  }
} finally {
  /* 出了意外也要把测试帖和测试消息清掉 */
  if (postId && token) {
    try {
      await call({ event: 'LT_POST_DELETE', ltToken: token, id: postId });
      info('（收尾时把没删干净的测试帖删掉了）');
    } catch {
      info(`⚠ 测试帖 ${postId} 没删掉，去「黎语堂管理 → 帖子」里手动删一下`);
    }
  }
  if (drawId && token) {
    try {
      await call({ event: 'LT_DRAW_DELETE', ltToken: token, id: drawId });
      info('（收尾时把画板上那笔测试撤掉了）');
    } catch {
      info(`⚠ 画板上那一笔（${drawId}）没撤掉，手动撤一下`);
    }
  }
  if (chatId && token) {
    try {
      await call({ event: 'LT_CHAT_DELETE', ltToken: token, id: chatId });
      info('（收尾时把没撤干净的测试消息撤掉了）');
    } catch {
      info(`⚠ 聊天室里那条测试消息（${chatId}）没撤掉，手动撤一下`);
    }
  }
}


/* ---- 2026-10-09 这一批的新接口：先看部署了没，再逐个走一遍 ---- */
const needDeploy = await call({ event: 'LT_ME', ltToken: 'garbage.token' });
check('★ 线上已经是新代码（坏令牌回 401；回 1000 就说明函数还没部署）', Number(needDeploy.code) === 401, `code=${needDeploy.code}`);
if (Number(needDeploy.code) === 401 && token) {
  const before = await call({ event: 'LT_ME', ltToken: token });
  const wasAlias = String(before.user?.alias ?? '');
  const renamed = await call({ event: 'LT_PROFILE_SET', ltToken: token, alias: '验收测试' });
  check('★ 线上能改昵称（LT_PROFILE_SET）', renamed.code === 0 && renamed.user?.alias === '验收测试', String(renamed.user?.alias ?? renamed.message ?? '').slice(0, 40));
  const meNow = await call({ event: 'LT_ME', ltToken: token });
  check('改完再问一次，昵称确实是新的（不是只回了个 ok）', meNow.user?.alias === '验收测试', String(meNow.user?.alias ?? ''));
  check('用户名没被改（nick 还是原来那个）', meNow.user?.nick === before.user?.nick, `${before.user?.nick} → ${meNow.user?.nick}`);
  const prefs = await call({ event: 'LT_PREFS_SET', ltToken: token, prefs: { palette: ['#ff4d6d', '#FF4D6D', '乱写的'], penSize: 12, eraserSize: 8, 无关字段: 1 } });
  check('★ 线上能存画板偏好：颜色去重、杂字段被丢',
    prefs.code === 0 && prefs.prefs?.palette?.length === 1 && prefs.prefs?.penSize === 12 && !('无关字段' in (prefs.prefs ?? {})),
    JSON.stringify(prefs.prefs ?? prefs.message));
  const meWithPrefs = await call({ event: 'LT_ME', ltToken: token });
  check('偏好跟着账号回来（换设备也在）', meWithPrefs.user?.prefs?.penSize === 12, JSON.stringify(meWithPrefs.user?.prefs ?? {}));
  const peek = await call({ event: 'LT_USER_GET', id: meWithPrefs.user?.id, ltToken: token });
  check('★ 线上能看某个人的公开资料（LT_USER_GET，看自己带 me:true）', peek.code === 0 && peek.me === true, String(peek.message ?? '').slice(0, 40));
  const peekOther = await call({ event: 'LT_USER_GET', id: '不存在的id' });
  check('看不存在的 id → 被拒', peekOther.code !== 0, String(peekOther.message ?? '').slice(0, 30));
  /* 收尾：昵称改回原来的，别在站上留「验收测试」这种痕迹 */
  if (wasAlias) {
    const back = await call({ event: 'LT_PROFILE_SET', ltToken: token, alias: wasAlias });
    info(`（收尾：昵称已改回 ${wasAlias}）` + (back.code === 0 ? '' : ' ⚠ 没改回去，手动改一下'));
  }
}
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
