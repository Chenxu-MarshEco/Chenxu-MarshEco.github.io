/*
 * ============================================================================
 * 黎语堂「账号 + 审核」的验收（2026-10-07）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「我要的不是每句话都给我审核 这样太累了 我要的是审核用户！！例如 A 在论坛上注册了
 *    两个号 一个叫 hoshi 一个叫 arcarlight 而我通过了 hoshi 这个账号的审核 那 hoshi 就可以
 *    随意在任何地方发贴发言 不再需要我的审核 而 arcarlight 因为我忘记审核了 所以它是注册了
 *    也不能发送任何东西的 一定要等到我同意这个账号过审了才能发东西」
 *
 * 两段：
 *   ① 静态：云函数那份代码里真的有那道硬门槛、前端真的默认藏着评论区、管理页真的有用户区块
 *   ② **真跑**：拿内存里的真 MongoDB，把 tools/liyutang-backend/index.js 整份跑一遍
 *      （注册两个号 → 都没过审 → 谁都发不出 → 站长通过 hoshi → hoshi 随便发、arcarlight 还是发不出）
 *
 * ② 需要 mongodb-memory-server（会下载一个 mongod 二进制）。没装就**跳过**②，只跑①，
 *    并在结尾写清楚为什么跳过 —— 不让它变成"看着全绿其实没测"。
 *
 * 用法：node tools/checks/liyutang-users-check.mjs
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const BACKEND = path.join(SRC, 'tools', 'liyutang-backend', 'index.js');

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
const info = (s) => console.log(`      · ${s}`);

/* ============================================================ ① 静态 */

console.log('=== ① 静态：三处该有的东西都在不在 ===');
const backend = fs.readFileSync(BACKEND, 'utf8');
check('云函数那份代码在仓库里（以前只活在控制台）', backend.length > 2000, `${Math.round(backend.length / 1024)}KB`);
check('有一道「发评论必须是已过审账号」的硬门槛', /COMMENT_SUBMIT/.test(backend) && /status === 'pending'/.test(backend) && /ltToken/.test(backend));
check('注册 / 登录 / 我是谁 三个事件都在', ['LT_REGISTER', 'LT_LOGIN', 'LT_ME'].every((e) => backend.includes(e)));
check('站长那三个事件（列表 / 改状态 / 删除）都在', ['LT_ADMIN_LIST', 'LT_ADMIN_SET', 'LT_ADMIN_DELETE'].every((e) => backend.includes(e)));
check(
  '站长身份用 Twikoo 的管理员密码验（不引入第二个秘密）',
  /async function adminCheck/.test(backend) && /event: 'LOGIN'/.test(backend)
);
check(
  '★ 验密码前先 md5（Twikoo 的规矩：客户端上送 md5(密码)）—— 这一条是照着 2026-10-07 那个 bug 加的',
  /createHash\('md5'\)\.update\(String\(password\)\)/.test(backend)
);
check('密码是加盐哈希存的（不是明文）', /scryptSync/.test(backend) && /salt/.test(backend));
check('昵称/邮箱在服务端按账号写死（防冒名）', /payload\.nick = user\.nick/.test(backend));

/*
  ⚠ 2026-10-07 晚上：注册 / 登录那一套从 Twikoo.astro 搬去了
  src/components/LiyutangAccount.astro + src/utils/liyutang-client.ts
  （发帖页、帖子页也要用同一套界面，不能四份各说各话）。
  所以「有没有注册 / 登录表单」这条要在这几份**加起来**里找，不能只盯 Twikoo.astro。
*/
const frontend = fs.readFileSync(path.join(SRC, 'src', 'components', 'Twikoo.astro'), 'utf8');
const frontendAll = [
  frontend,
  fs.readFileSync(path.join(SRC, 'src', 'components', 'LiyutangAccount.astro'), 'utf8'),
  fs.readFileSync(path.join(SRC, 'src', 'utils', 'liyutang-client.ts'), 'utf8'),
].join('\n');
check('前端评论区默认是藏着的（只有登录+过审才露出来）', /id="tcomment"[^>]*hidden/.test(frontend));
check('前端提交时把账号令牌一起带上', /onSubmit/.test(frontend) && /ltToken/.test(frontend));
check('前端有注册 / 登录表单', /LT_REGISTER/.test(frontendAll) && /LT_LOGIN/.test(frontendAll) && /站长审核/.test(frontendAll));

const adminUi = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'ui', 'liyutang.js'), 'utf8');
check('管理页有「用户审核」那一块', /renderUsers/.test(adminUi) && /用户审核/.test(adminUi));
check('管理页能通过 / 封禁 / 删除', ['approved', 'banned', 'delete'].every((k) => adminUi.includes(k)));

const server = fs.readFileSync(path.join(SRC, 'tools', 'editor', 'server.mjs'), 'utf8');
check('编辑器服务有转给云函数的口子（/api/liyutang/users）', /\/api\/liyutang\/users/.test(server));

/* ============================================================ ② 真跑 */

console.log('\n=== ② 真跑：拿内存里的 MongoDB 把云函数整份跑一遍 ===');

/*
  mongodb-memory-server 装在**仓库外面**的临时目录里（它连同 mongod 二进制有 138MB / 9350 个文件，
  放仓库里会把编辑器的文件扫描拖慢 —— 这就是当初为什么要搬出去）。
  找不到就跳过②，不下载。
*/
const candidates = [
  path.join(process.env.TEMP ?? '', 'huajiantang-twikoofn', 'node_modules'),
  path.join(SRC, '.tmp', 'twikoofn', 'node_modules'),
  path.join(SRC, 'node_modules'),
];
let MongoMemoryServer = null;
let mongodBinary = '';
for (const dir of candidates) {
  try {
    const req = createRequire(path.join(dir, 'x.js'));
    MongoMemoryServer = req('mongodb-memory-server').MongoMemoryServer;
    info('用的 mongodb-memory-server 在：' + dir);
    /* 顺手找一下已经下好的 mongod 二进制（**绝不在这里下载** —— 那有 780MB） */
    for (const cache of [
      path.join(dir, '.cache', 'mongodb-memory-server'),
      path.join(process.env.USERPROFILE ?? '', '.cache', 'mongodb-binaries'),
    ]) {
      if (!fs.existsSync(cache)) continue;
      const hit = fs.readdirSync(cache).find((f) => /^mongod-.*\.exe$/i.test(f));
      if (hit) {
        mongodBinary = path.join(cache, hit);
        process.env.MONGOMS_SYSTEM_BINARY = mongodBinary;
        info('用已经下好的 mongod：' + mongodBinary);
        break;
      }
    }
    break;
  } catch {
    /* 换下一个 */
  }
}

if (!MongoMemoryServer) {
  skip('账号那一整套的真跑', '这台机器上没装 mongodb-memory-server（在 .tmp/twikoofn 里装一次即可）');
  console.log('\n（提示：想跑这一段，在 .tmp/twikoofn 目录里 `npm i mongodb-memory-server` 之后再执行本脚本。）');
} else if (!mongodBinary) {
  skip('账号那一整套的真跑', '没找到已经下好的 mongod 二进制（这里故意不下载 —— 它有 780MB；先跑一次 .tmp/twikoofn 里的试验脚本把二进制拉下来即可）');
} else {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('twikoo');
  process.env.LT_SECRET = 'check-secret';
  /*
    云函数那份代码要去 .tmp 那个目录里找 twikoo-func / mongodb（它自己那儿没有 node_modules）。
    靠 NODE_PATH 指过去 —— 注意改完要 _initPaths() 才生效。
  */
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const req2 = createRequire(path.join(candidates[0], 'x.js'));
  const app = req2(BACKEND);
  const call = (body) => app.main(body);

  const v = await call({ event: 'GET_FUNC_VERSION' });
  check('Twikoo 本身照旧活着（GET_FUNC_VERSION）', v.code === 0, JSON.stringify(v).slice(0, 90));

  const r1 = await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'hoshi@example.com', pass: 'hoshi123456' });
  const r2 = await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'arc@example.com', pass: 'arc123456789' });
  check('两个号注册成功，都是「待审核」', r1.code === 0 && r2.code === 0 && r1.status === 'pending' && r2.status === 'pending');
  check('昵称重复（换个大小写也算）→ 被拒', (await call({ event: 'LT_REGISTER', nick: 'HOSHI', mail: '', pass: 'whatever123' })).code !== 0);

  const login1 = await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' });
  const login2 = await call({ event: 'LT_LOGIN', nick: 'arcarlight', pass: 'arc123456789' });
  const tokHoshi = login1.token;
  const tokArc = login2.token;
  check('登录拿得到令牌（未过审也能登录，只是发不了）', !!tokHoshi && !!tokArc && login1.user.status === 'pending');

  const postPending = await call({ event: 'COMMENT_SUBMIT', ltToken: tokHoshi, url: '/liyutang/notice/welcome/', nick: 'hoshi', comment: '没过审就发（不该成功）', ua: 'check' });
  check('★ 没过审的号发评论 → 被拒', postPending.code !== 0 && /审核/.test(String(postPending.message)), String(postPending.message));
  const postAnon = await call({ event: 'COMMENT_SUBMIT', url: '/liyutang/notice/welcome/', nick: '路人', mail: 'a@b.com', comment: '没注册（不该成功）', ua: 'check' });
  check('没登录发评论 → 被拒', postAnon.code !== 0, String(postAnon.message).slice(0, 50));
  const postFake = await call({ event: 'COMMENT_SUBMIT', ltToken: 'abc.def', url: '/liyutang/notice/welcome/', nick: '骗子', comment: '伪造令牌（不该成功）', ua: 'check' });
  check('伪造令牌 → 被拒', postFake.code !== 0, String(postFake.message).slice(0, 50));

  /*
    ⚠ 这里必须模拟**真实客户端**：Twikoo 的规矩是「客户端本地算 md5(密码) 作为 accessToken 上送」
    （服务端拿 config.ADMIN_PASS !== md5(收到的值) 比对）。所以：
      · SET_PASSWORD 传的要是 md5；
      · 而我们自己那几个 LT_ADMIN_* 事件收的是**原文**（云函数内部替我们 md5）。
    2026-10-07 就是在这里踩过坑：原先两边都传原文，错误互相抵消、测试全绿，
    结果线上"密码明明是对的却报密码错误"。
  */
  const md5 = (s) => createHash('md5').update(String(s)).digest('hex');
  await call({ event: 'SET_PASSWORD', password: md5('admin-pass-123') });
  check(
    '用 md5 形态设密码（模拟客户端）之后，状态变成"设过了"',
    (await call({ event: 'GET_PASSWORD_STATUS' })).status === true
  );
  const listWrong = await call({ event: 'LT_ADMIN_LIST', password: '乱猜的' });
  check('站长密码不对 → 名单拿不到', listWrong.code !== 0, String(listWrong.message).slice(0, 40));
  const list = await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' });
  check('站长拿到名单（两个号都在，且没有密码字段）', list.code === 0 && list.users.length === 2 && list.users.every((u) => u.pass === undefined && u.salt === undefined));

  const idHoshi = list.users.find((u) => u.nick === 'hoshi').id;
  const idArc = list.users.find((u) => u.nick === 'arcarlight').id;
  check('站长把 hoshi 设成「已通过」', (await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'approved' })).status === 'approved');

  const postOk = await call({ event: 'COMMENT_SUBMIT', ltToken: tokHoshi, url: '/liyutang/notice/welcome/', nick: '改个名试试', mail: 'fake@example.com', comment: '过审之后发的', ua: 'check' });
  check('★ 过审的 hoshi 发评论 → 成功', postOk.code === 0, JSON.stringify(postOk).slice(0, 90));
  const list2 = await call({ event: 'COMMENT_GET', url: '/liyutang/notice/welcome/', page: 1, pageSize: 10, sort: 'newest' });
  check('★ 评论读得到，而且昵称被服务端写死成 hoshi（改名没用）', list2.count === 1 && list2.data[0].nick === 'hoshi', list2.data?.[0]?.nick);
  const postArc = await call({ event: 'COMMENT_SUBMIT', ltToken: tokArc, url: '/liyutang/notice/welcome/', nick: 'arcarlight', comment: '忘了审的我（不该成功）', ua: 'check' });
  check('★ 忘了审的 arcarlight 还是发不出', postArc.code !== 0 && /审核/.test(String(postArc.message)), String(postArc.message));

  check('封禁之后发不了', (await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'banned' })).code === 0 &&
    (await call({ event: 'COMMENT_SUBMIT', ltToken: tokHoshi, url: '/x/', nick: 'hoshi', comment: 'x', ua: 'check' })).code !== 0);
  check('能打标签（「共创者」的口子）', (await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, label: '共创者' })).label === '共创者');
  check('能删账号', (await call({ event: 'LT_ADMIN_DELETE', password: 'admin-pass-123', id: idArc })).code === 0);
  check('删完之后名单少一个', (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users.length === 1);

  await mongod.stop();
}

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
