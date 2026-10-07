/*
 * ============================================================================
 * 黎语堂「帖子 + 头像」的验收（2026-10-07 晚上）
 * ----------------------------------------------------------------------------
 * 用户原话：
 *   「参考主网站为我制作一套管理黎语堂的系统 … 我这边编辑器端可以编辑各个板块 类似编辑主网站
 *    的页面 而用户可以选择发帖 帖子类似主网站的文章 可以传图写字 写好以后选择发在我已经建立的
 *    板块下 先大致做一个大概框架 … 另外给注册用户加上可以上传头像的功能」
 *
 * 量三段：
 *   ① 静态：该有的文件 / 事件 / 面板在不在；那份 Markdown 渲染器是不是"先转义"
 *      （这一条是整件事里最要紧的安全属性，光靠肉眼看代码不算数，所以在这里钉死）
 *   ② **真跑**：拿内存里的真 MongoDB，把云函数整份跑一遍 ——
 *      没过审发不出帖 → 过审能发 → 读得到（浏览量 +1）→ 改自己的 → 换头像 →
 *      带头像发评论（头像真的写进评论文档了）→ 站长隐藏 / 置顶 / 移版 / 删 → 作者删自己的
 *   ③ **真浏览器**：把 dist 端上来，后端换成一个"假云函数"（就在这个脚本里），
 *      走完"登录 → 写标题正文 → 发出去 → 跳到帖子页 → 正文渲染出来"，
 *      顺手拿一段 XSS 载荷当帖子正文，验证它**在真浏览器里**也只是文字、不会执行。
 *
 * 用法：node tools/checks/liyutang-posts-check.mjs [dist目录]
 * 说明：默认不重新构建；加 --build 先构建一次（很慢）。
 * ② 需要 mongodb-memory-server（在仓库外面的 %TEMP%\huajiantang-twikoofn 里），没装就跳过②。
 * ============================================================================
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';

const SRC = String.raw`D:\曼沫砾总线\Chenxu-MarshEco.github.io`;
const BACKEND = path.join(SRC, 'tools', 'liyutang-backend', 'index.js');
const ROOT = path.resolve(
  process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : path.join(SRC, 'dist')
);
/*
  ⚠ 端口用**系统随便给一个**（listen(0) 再问它给了哪个），不写死。
  2026-10-07 晚上连撞两次 EADDRINUSE（4398 被另一个实验占着、4452 被自己上一次没收干净的
  进程占着）—— 写死端口这种事在"可能同时开着编辑器 / dev server / 别的检查"的机器上必然踩。
*/
const DEBUG_PORT = 9396;
const CHROME = String.raw`C:\Users\煦\AppData\Local\ms-playwright\chromium-1243\chrome-win64\chrome.exe`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const read = (rel) => {
  const f = path.join(SRC, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};

if (process.argv.includes('--build')) {
  console.log('=== 先构建一次 ===');
  execSync('node tools/images/optimize.mjs', { cwd: SRC, stdio: 'ignore' });
  execSync('node node_modules/astro/bin/astro.mjs build', { cwd: SRC, stdio: 'ignore' });
  console.log('      构建完成');
}

/* ============================================================ ① 静态 */

console.log('=== ① 静态：文件、事件、面板、以及那条最要紧的安全属性 ===');

const backend = read('tools/liyutang-backend/index.js');
check('云函数里有帖子集合与那几个事件', /const POSTS = 'lt_posts'/.test(backend) &&
  ['LT_POST_LIST', 'LT_POST_GET', 'LT_POST_CREATE', 'LT_POST_UPDATE', 'LT_POST_DELETE'].every((e) => backend.includes(e)));
check('站长管帖子的事件也在（列表 / 改 / 删）',
  ['LT_ADMIN_POST_LIST', 'LT_ADMIN_POST_SET', 'LT_ADMIN_POST_DELETE'].every((e) => backend.includes(e)));
check('发帖要求「已过审」账号（令牌 → pending 直接拒）',
  /LT_POST_CREATE/.test(backend) && /user\.status === 'pending'/.test(backend));
check('★ 发帖时昵称 / 头像按账号写死（作者由服务端定，不由客户端说了算）',
  /authorId: user\.id/.test(backend) && /authorNick: user\.nick/.test(backend));
check('有头像事件（LT_AVATAR_SET），并且校验是不是图片 data URL',
  /LT_AVATAR_SET/.test(backend) && /imageDataUrl/.test(backend));
check('★ 评论带上了账号头像（补写评论文档那条路在）',
  /comment'\)/.test(backend) && /\$set: \{ avatar: submitted\.avatar \}/.test(backend));

const md = read('src/utils/liyutang-md.mjs');
check('渲染器在仓库里（自己写的，不引第三方）', md.length > 3000, `${Math.round(md.length / 1024)}KB`);
check('★ 渲染器是「先转义再渲染」（escapeHtml 在最前、renderMarkdown 里第一步就是它）',
  /export function escapeHtml/.test(md) && /const src = escapeHtml\(md\)/.test(md));
check('★ 链接/图片地址有白名单（javascript: 这类进不来）',
  /function safeUrl/.test(md) && /data:image\\\//.test(md) && /mailto/.test(md));
check('★ 没有把用户内容直接塞进 innerHTML 的地方（渲染器里只拼自己的标签）',
  !/innerHTML\s*=/.test(md));

/*
  渲染器**真跑一遍**再断言（比 grep 源码结实得多 —— 第一版是 grep `<ul>`，
  结果它压根不在源码里：列表标签是拼出来的（`<${ordered ? 'ol' : 'ul'}>`），假红了一条）。
*/
const render = await import(pathToFileURL(path.join(SRC, 'src', 'utils', 'liyutang-md.mjs')).href);
const H = (s) => render.renderMarkdown(s);
check('渲染器：标题 / 粗体 / 斜体 / 删除线',
  H('## 标题').includes('<h2>标题</h2>') && H('**粗**').includes('<strong>粗</strong>') &&
  H('*斜*').includes('<em>斜</em>') && H('~~删~~').includes('<del>删</del>'));
check('渲染器：无序 / 有序列表都是一项一个 <li>',
  H('- 甲\n- 乙').includes('<ul><li>甲</li><li>乙</li></ul>') && H('1. 甲\n2. 乙').includes('<ol><li>甲</li><li>乙</li></ol>'),
  H('- 甲\n- 乙'));
check('渲染器：引用 / 代码块 / 行内代码 / 分割线',
  H('> 引一句').includes('<blockquote>') && H('```\ncode\n```').includes('<pre><code>code</code></pre>') &&
  H('`x`').includes('<code>x</code>') && H('---').includes('<hr />'));
check('渲染器：链接和图片（图片允许 data URL —— 用户传的图就是这么内嵌的）',
  H('[文字](https://example.com)').includes('<a href="https://example.com"') &&
  H('![图](data:image/png;base64,AAAA)').includes('<img src="data:image/png;base64,AAAA"'));
/*
  ⚠ 这里断言的是"**没有生成**危险的标签 / 属性"，不是"正文里没有这几个字" ——
  转义之后，`onerror=` 这几个字符还会原样留在文字里（那正是我们要的：它只是字），
  所以判据是 `/<img[^>]*onerror/i`、`/<script/i` 这种"真标签"的形状（第一版写成了
  `!/onerror=/`，等于要求把字也吃掉，假红了一条）。
*/
const xssScript = H('<script>window.x=1</script>');
const xssImg = H('<img src=x onerror="window.x=1">');
check('★ 渲染器：正文里的 HTML 标签只会显示成文字（script 不生成、img 不生成、onerror 不落到标签上）',
  !/<script/i.test(xssScript) &&
    !/<img[^>]*onerror/i.test(xssImg) &&
    xssScript.includes('&lt;script&gt;') &&
    xssImg.includes('&lt;img') &&
    H('<b>粗</b>').includes('&lt;b&gt;'),
  `${xssScript} | ${xssImg}`);
check('★ 渲染器：javascript: 这类地址进不了 href / src',
  !/href="javascript:/i.test(H('[点我](javascript:alert(1))')) && !/<img src="javascript:/i.test(H('![x](javascript:alert(1))')),
  H('[点我](javascript:alert(1))'));
check('渲染器：摘要会把图、代码块和记号都去掉（列表里显示的是一行字）',
  render.excerptOf('**粗**\n\n![图](data:image/png;base64,AAAA)\n\n- 甲', 40) === '粗 甲',
  render.excerptOf('**粗**\n\n![图](data:image/png;base64,AAAA)\n\n- 甲', 40));

const client = read('src/utils/liyutang-client.ts');
check('前端那一层有账号区（mountAccount）和帖子列表（mountPostList）',
  /export function mountAccount/.test(client) && /export async function mountPostList/.test(client));
check('图片在浏览器里压（compressImage：canvas → WebP，压完内嵌）',
  /export async function compressImage/.test(client) && /toDataURL/.test(client));

const newPage = read('src/pages/liyutang/new.astro');
const postPage = read('src/pages/liyutang/post.astro');
const homePage = read('src/pages/liyutang/index.astro');
const boardPage = read(path.join('src', 'pages', 'liyutang', '[board]', 'index.astro'));
check('发帖页在（/liyutang/new/）：版块下拉 + 标题 + 正文 + 传图 + 封面',
  /data-lt-board/.test(newPage) && /data-lt-title/.test(newPage) && /data-lt-md/.test(newPage) &&
  /data-lt-cmd="image"/.test(newPage) && /data-lt-cover-pick/.test(newPage));
check('帖子页在（/liyutang/post/），并且回帖线按帖子分开（__ltPostPath）',
  /data-lt-post-body/.test(postPage) && /__ltPostPath/.test(postPage) && /__ltPostPath/.test(read('src/components/Twikoo.astro')));
check('论坛首页有「最新帖子」和「发帖」入口', /data-lt-latest/.test(homePage) && /liyutang\/new\//.test(homePage));
/*
  "那段话删掉了"这件事，**要在构建产物上验**，不能在源码上验 ——
  源码里到处都留着"用户当初原话"和"以前那句作废了"的注释（这份仓库的风格就是如此），
  照源码 grep 只会 grep 到自己写的注释（第一次跑就是这么假红了两条）。
*/
const inDist = (rel) => {
  const f = path.join(ROOT, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
};
const homeHtml = inDist(path.join('liyutang', 'index.html'));
const boardHtml = inDist(path.join('liyutang', 'chat', 'index.html'));
check('★ 构建出来的首页里，那段「留言只要昵称+邮箱、不用注册」的说明真的不在了',
  homeHtml.length > 0 && !/不用注册任何账号/.test(homeHtml) && !/所有留言都会先经过站长审核/.test(homeHtml),
  homeHtml.length ? `${Math.round(homeHtml.length / 1024)}KB` : '（没找到 dist/liyutang/index.html，先构建）');
check('版块页上也不再说「不用注册」了',
  boardHtml.length > 0 && !/不用注册/.test(boardHtml));
check('版块页会渲染版块公告（notice）', /board\.notice/.test(boardPage) && /renderMarkdown/.test(boardPage));

const lytJson = JSON.parse(read('src/data/liyutang.json'));
/*
  notice 这个键**可以没有**：编辑器那边"空公告就不写这个键"（站长清空公告之后那个键会消失），
  站点上 src/utils/liyutang.ts 用 str() 洗一遍，缺了就是空串。
  所以这里只断言类型对，不要求每个版块都带着它 ——
  （第一版断言的是 `'notice' in b`，被同事提醒这会跟编辑器保存一次就变红，属于自己给自己下套。）
*/
check('版块表支持 notice（公告）字段：有就是字符串，没有就是空公告',
  (lytJson.boards ?? []).every((b) => b.notice === undefined || typeof b.notice === 'string'),
  (lytJson.boards ?? []).map((b) => `${b.id}${b.notice ? '(有公告)' : ''}`).join(' '));
/* 公告真的渲染出来了吗 —— 拿构建产物说事，而且是"有公告的版块"才查（没公告就不该有这个框） */
const noticeBoard = (lytJson.boards ?? []).find((b) => typeof b.notice === 'string' && b.notice.trim());
if (noticeBoard) {
  check(`★ 版块公告在构建产物里渲染出来了（/liyutang/${noticeBoard.id}/ 里的 .lyt-notice）`,
    /class="lyt-notice"/.test(inDist(path.join('liyutang', noticeBoard.id, 'index.html'))), noticeBoard.id);
} else {
  skip('版块公告的渲染', '现在没有任何版块写了公告（不算错，只是没东西可验）');
}
check('★ 版块 id 没占用 new / post 这两条真路由（占了构建会报错）',
  !(lytJson.boards ?? []).some((b) => ['new', 'post'].includes(b.id)));

const adminUi = read(path.join('tools', 'editor', 'ui', 'liyutang.js'));
const adminHtml = read(path.join('tools', 'editor', 'ui', 'liyutang.html'));
const serverSrc = read(path.join('tools', 'editor', 'server.mjs'));
check('管理页有「帖子管理」那一块（renderPosts + lt-posts-box）',
  /renderPosts/.test(adminUi) && /lt-posts-box/.test(adminHtml));
check('管理页能 隐藏 / 置顶 / 移版 / 删除', ['hidden', 'pinned', 'moveTo', 'delete'].every((k) => adminUi.includes(k)));
check('编辑器服务有转给云函数的帖子口子（/api/liyutang/posts）', /\/api\/liyutang\/posts/.test(serverSrc));
check('版块面板能编辑公告（notice）', /notice/.test(adminUi) && /notice/.test(serverSrc));

/* ============================================================ ② 真跑 */

console.log('\n=== ② 真跑：内存里的 MongoDB，把云函数整份跑一遍 ===');

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

if (!MongoMemoryServer || !mongodBinary) {
  skip('帖子 + 头像那一整套的真跑', '这台机器上没有现成的 mongodb-memory-server / mongod 二进制（这里故意不下载）');
} else {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri('twikoo');
  process.env.LT_SECRET = 'check-secret';
  process.env.NODE_PATH = candidates[0];
  Module._initPaths();
  const req2 = createRequire(path.join(candidates[0], 'x.js'));
  const app = req2(BACKEND);
  const call = (body) => app.main(body);
  const md5 = (s) => createHash('md5').update(String(s)).digest('hex');

  /* 一个"能在浏览器里当头像用"的最小 PNG（1×1） */
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/9UeIAAAAAElFTkSuQmCC';

  await call({ event: 'LT_REGISTER', nick: 'hoshi', mail: 'hoshi@example.com', pass: 'hoshi123456' });
  await call({ event: 'LT_REGISTER', nick: 'arcarlight', mail: 'arc@example.com', pass: 'arc123456789' });
  const tokHoshi = (await call({ event: 'LT_LOGIN', nick: 'hoshi', pass: 'hoshi123456' })).token;
  const tokArc = (await call({ event: 'LT_LOGIN', nick: 'arcarlight', pass: 'arc123456789' })).token;

  const noApprove = await call({
    event: 'LT_POST_CREATE',
    ltToken: tokArc,
    board: 'chat',
    title: '没过审也想发',
    md: '正文',
  });
  check('★ 没过审的号发帖 → 被拒', noApprove.code !== 0 && /审核/.test(String(noApprove.message)), String(noApprove.message));
  const anon = await call({ event: 'LT_POST_CREATE', board: 'chat', title: '路人发的', md: '正文' });
  check('没登录发帖 → 被拒', anon.code !== 0, String(anon.message).slice(0, 40));

  await call({ event: 'SET_PASSWORD', password: md5('admin-pass-123') });
  const users = (await call({ event: 'LT_ADMIN_LIST', password: 'admin-pass-123' })).users;
  const idHoshi = users.find((u) => u.nick === 'hoshi').id;
  await call({ event: 'LT_ADMIN_SET', password: 'admin-pass-123', id: idHoshi, status: 'approved' });

  /* ---- 发帖 ---- */
  const badBoard = await call({ event: 'LT_POST_CREATE', ltToken: tokHoshi, board: 'Chat Room', title: '版块 id 不对', md: 'x' });
  check('版块 id 不合法 → 被拒', badBoard.code !== 0, String(badBoard.message));
  const badTitle = await call({ event: 'LT_POST_CREATE', ltToken: tokHoshi, board: 'chat', title: '短', md: 'x' });
  check('标题太短 → 被拒', badTitle.code !== 0, String(badTitle.message));
  const emptyMd = await call({ event: 'LT_POST_CREATE', ltToken: tokHoshi, board: 'chat', title: '正常标题', md: '   ' });
  check('正文空 → 被拒', emptyMd.code !== 0, String(emptyMd.message));
  const tooBig = await call({
    event: 'LT_POST_CREATE',
    ltToken: tokHoshi,
    board: 'chat',
    title: '太大的一篇',
    md: 'x'.repeat(4 * 1024 * 1024 + 10),
  });
  check('正文超过 4MB → 被拒（图片内嵌进正文，这个上限必须有）', tooBig.code !== 0, String(tooBig.message).slice(0, 40));

  const made = await call({
    event: 'LT_POST_CREATE',
    ltToken: tokHoshi,
    board: 'chat',
    title: '我的第一篇帖子',
    md: '**粗体**开头，然后一张图：\n\n![图](data:image/png;base64,AAAA)\n\n- 列表\n- 第二项',
    cover: PNG,
  });
  check('★ 过审的 hoshi 发帖 → 成功，拿到 id', made.code === 0 && /^[0-9a-f]{12}$/.test(String(made.id)), String(made.id));
  const pid = made.id;
  check('返回里作者是账号上的昵称（客户端说什么不算）', made.post?.authorNick === 'hoshi', String(made.post?.authorNick));
  check('摘要去了 Markdown 记号与图片（列表里显示的是一行字）',
    made.post?.excerpt && !/\*\*|data:image/.test(made.post.excerpt), String(made.post?.excerpt));
  check('数出来正文里有 1 张图', made.post?.images === 1, String(made.post?.images));

  /* ---- 列表 / 读 ---- */
  const list = await call({ event: 'LT_POST_LIST', board: 'chat', limit: 10 });
  check('列表读得到，而且**不带正文**（正文里内嵌着图片，列表不能拖）',
    list.code === 0 && list.posts.length === 1 && list.posts[0].md === undefined, JSON.stringify(Object.keys(list.posts?.[0] ?? {})));
  const other = await call({ event: 'LT_POST_LIST', board: 'notice', limit: 10 });
  check('按版块过滤有效（notice 版是空的）', other.code === 0 && other.posts.length === 0);
  const got1 = await call({ event: 'LT_POST_GET', id: pid });
  check('读一条拿得到正文', got1.code === 0 && String(got1.post.md).includes('**粗体**'));
  check('顺手把浏览量 +1 了', got1.post.views === 1, String(got1.post.views));
  const got2 = await call({ event: 'LT_POST_GET', id: pid });
  check('再读一次又 +1', got2.post.views === 2, String(got2.post.views));
  check('别人读得到（论坛就是给人看的）', (await call({ event: 'LT_POST_GET', id: pid, ltToken: tokArc })).code === 0);

  /* ---- 改 / 删自己 ---- */
  const notMine = await call({ event: 'LT_POST_UPDATE', ltToken: tokArc, id: pid, title: '我改别人的' });
  check('★ 改别人的帖子 → 被拒', notMine.code !== 0 && /自己/.test(String(notMine.message)), String(notMine.message));
  const delNotMine = await call({ event: 'LT_POST_DELETE', ltToken: tokArc, id: pid });
  check('★ 删别人的帖子 → 被拒', delNotMine.code !== 0);
  const edited = await call({
    event: 'LT_POST_UPDATE',
    ltToken: tokHoshi,
    id: pid,
    title: '我的第一篇帖子（改过）',
    md: '改过之后的正文',
    cover: '',
  });
  check('改自己的帖子 → 成功，摘要跟着变', edited.code === 0 && edited.post.excerpt === '改过之后的正文', String(edited.post?.excerpt));

  /* ---- 头像 ---- */
  check('头像不是图片 → 被拒', (await call({ event: 'LT_AVATAR_SET', ltToken: tokHoshi, avatar: 'data:text/html;base64,PGI+' })).code !== 0);
  check('头像太大 → 被拒', (await call({ event: 'LT_AVATAR_SET', ltToken: tokHoshi, avatar: PNG.replace(',', ',' + 'A'.repeat(210000)) })).code !== 0);
  check('没登录不能换头像', (await call({ event: 'LT_AVATAR_SET', avatar: PNG })).code !== 0);
  const face = await call({ event: 'LT_AVATAR_SET', ltToken: tokHoshi, avatar: PNG });
  check('★ 换头像 → 成功', face.code === 0 && String(face.avatar).startsWith('data:image/png'), String(face.avatar).slice(0, 30));
  const meAfter = await call({ event: 'LT_ME', ltToken: tokHoshi });
  check('LT_ME 带回头像和"我发了几贴"', meAfter.code === 0 && meAfter.user.avatar === PNG && meAfter.posts === 1,
    `avatar=${String(meAfter.user?.avatar).slice(0, 18)} posts=${meAfter.posts}`);

  /* ---- 评论带头像 ---- */
  const comment = await call({
    event: 'COMMENT_SUBMIT',
    ltToken: tokHoshi,
    url: '/liyutang/post/' + pid,
    nick: '我改个名试试',
    comment: '带头像的一条评论',
    ua: 'check',
  });
  check('过审账号发评论 → 成功', comment.code === 0, JSON.stringify(comment).slice(0, 60));
  const comments = await call({ event: 'COMMENT_GET', url: '/liyutang/post/' + pid, page: 1, pageSize: 10, sort: 'newest' });
  check('★ 评论读得回来，而且**头像真的写进评论文档了**（Twikoo 渲染时优先用它）',
    comments.count === 1 && comments.data[0].avatar === PNG, String(comments.data?.[0]?.avatar).slice(0, 24));

  /* ---- 站长那一段 ---- */
  check('站长密码不对 → 帖子名单拿不到', (await call({ event: 'LT_ADMIN_POST_LIST', password: '乱猜的' })).code !== 0);
  const adminList = await call({ event: 'LT_ADMIN_POST_LIST', password: 'admin-pass-123' });
  check('站长拿到帖子名单（带状态 / 置顶 / 浏览量）',
    adminList.code === 0 && adminList.posts.length === 1 && 'status' in adminList.posts[0] && 'pinned' in adminList.posts[0]);
  check('站长置顶', (await call({ event: 'LT_ADMIN_POST_SET', password: 'admin-pass-123', id: pid, pinned: 1 })).pinned === 1);
  check('站长把帖子移到别的版块', (await call({ event: 'LT_ADMIN_POST_SET', password: 'admin-pass-123', id: pid, board: 'notice' })).board === 'notice');
  check('移版之后原来那一版就空了', (await call({ event: 'LT_POST_LIST', board: 'chat' })).posts.length === 0);
  const hidden = await call({ event: 'LT_ADMIN_POST_SET', password: 'admin-pass-123', id: pid, status: 'hidden' });
  check('站长隐藏', hidden.code === 0 && hidden.status === 'hidden');
  check('★ 隐藏之后公开列表里没有了', (await call({ event: 'LT_POST_LIST', board: 'notice' })).posts.length === 0);
  check('★ 隐藏之后路人读不到', (await call({ event: 'LT_POST_GET', id: pid, ltToken: tokArc })).code !== 0);
  check('★ 但作者自己还看得见（帖子没丢，只是别人看不到）', (await call({ event: 'LT_POST_GET', id: pid, ltToken: tokHoshi })).code === 0);
  check('作者用「我的帖子」能看到自己那条被隐藏的',
    (await call({ event: 'LT_POST_LIST', ltToken: tokHoshi, mine: true })).posts.length === 1);
  check('站长改回正常', (await call({ event: 'LT_ADMIN_POST_SET', password: 'admin-pass-123', id: pid, status: 'ok' })).status === 'ok');
  check('★ 作者删自己的帖子 → 成功', (await call({ event: 'LT_POST_DELETE', ltToken: tokHoshi, id: pid })).code === 0);
  check('删完就没了', (await call({ event: 'LT_POST_GET', id: pid })).code !== 0);
  check('站长删帖子那条路也在（先发一条再删）', await (async () => {
    const m = await call({ event: 'LT_POST_CREATE', ltToken: tokHoshi, board: 'chat', title: '给站长删的', md: 'x' });
    return (await call({ event: 'LT_ADMIN_POST_DELETE', password: 'admin-pass-123', id: m.id })).code === 0;
  })());

  await mongod.stop();
}

/* ============================================================ ③ 真浏览器 */

console.log('\n=== ③ 真浏览器：假云函数 + 真构建产物，走完"发帖 → 看帖" ===');

const liveApi = (() => {
  try {
    return JSON.parse(read('src/data/liyutang.json')).forum?.twikoo?.envId ?? '';
  } catch {
    return '';
  }
})();
/** 假后端记下的"发帖请求"，用来断言前端真的把该带的都带了 */
const seen = { create: null, lists: 0 };

/** 这个 XSS 载荷会当成帖子正文；如果渲染器漏了转义，window.__xss 就会被置上 */
const XSS = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
const FAKE_POST = {
  id: 'testpost0001',
  board: 'chat',
  title: '浏览器里发的一贴',
  excerpt: '正文摘要',
  cover: '',
  authorNick: '测试者',
  authorAvatar: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  status: 'ok',
  pinned: 0,
  views: 1,
  images: 0,
  md: `**粗体**和一行正文。\n\n${XSS}\n\n- 甲\n- 乙`,
};

const fakeBackend = (body) => {
  const event = String(body?.event || '');
  if (event === 'LT_ME') return { code: 0, user: { nick: '测试者', mail: '', status: 'approved', avatar: '', label: '' }, posts: 1 };
  if (event === 'LT_POST_LIST') {
    seen.lists += 1;
    return { code: 0, posts: [FAKE_POST], more: false };
  }
  if (event === 'LT_POST_GET') return { code: 0, post: FAKE_POST, mine: true };
  if (event === 'LT_POST_CREATE') {
    seen.create = body;
    return { code: 0, id: FAKE_POST.id };
  }
  if (event === 'COMMENT_GET') return { code: 0, data: [], count: 0 };
  if (event === 'GET_FUNC_VERSION') return { code: 0, version: 'fake' };
  return { code: 0 };
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
  '.mp3': 'audio/mpeg',
};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  /* 假云函数：把页面上那条真地址换成自己 */
  if (url.pathname === '/__lt') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {
        /* 空请求体 */
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(fakeBackend(body)));
    });
    return;
  }
  const p = decodeURIComponent(url.pathname);
  for (const t of [p, `${p}.html`, path.posix.join(p, 'index.html')]) {
    const f = path.join(ROOT, t);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) {
      const ext = path.extname(f).toLowerCase();
      let buf = fs.readFileSync(f);
      /* 把 HTML 里那条真后端地址换成假后端 —— 这样前端一行都不用改 */
      if (ext === '.html' && liveApi) {
        buf = Buffer.from(buf.toString('utf8').split(liveApi).join(`http://127.0.0.1:${PORT}/__lt`), 'utf8');
      }
      res.writeHead(200, { 'content-type': MIME[ext] ?? 'application/octet-stream' });
      return res.end(buf);
    }
  }
  res.writeHead(404);
  res.end('404');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

const profile = path.join(process.env.TEMP ?? '.', `dsh-lytposts-${Date.now()}`);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--mute-audio',
    '--disable-gpu',
    '--enable-unsafe-swiftshader',
    '--disable-breakpad',
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        this.errors.push(
          String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text).slice(0, 200)
        );
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        this.errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200));
      }
    });
  }
  static async attach(u) {
    const ws = new WebSocket(u);
    await new Promise((res, rej) => {
      ws.addEventListener('open', res, { once: true });
      ws.addEventListener('error', () => rej(new Error('ws')), { once: true });
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
  async wait(expr, ms = 15000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.ev(expr)) return true;
      } catch {
        /* 页面还在换 */
      }
      await sleep(200);
    }
    return false;
  }
  async goto(url) {
    await this.send('Page.navigate', { url });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try {
        if ((await this.ev('document.readyState')) === 'complete') return;
      } catch {
        /* 还在导航 */
      }
    }
  }
}

try {
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(300);
    try {
      const l = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json();
      target = l.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
    } catch {
      /* 等 */
    }
  }
  const cdp = await CDP.attach(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const base = `http://127.0.0.1:${PORT}`;

  /* ---- 第一趟：访客看发帖页 ---- */
  await cdp.goto(`${base}/liyutang/new/`);
  /* ⚠ 等的是"账号区**画完了**"（data-state 出来了），不是"页面加载完" ——
     2026-10-07 晚上那个 bug（mountAccount 没人调 refresh）就是靠这个区别逮住的：
     页面加载得好好的，界面永远停在「正在看登录状态…」。 */
  const guestPainted = await cdp.wait(`(() => {
      const a = document.querySelector('[data-lt-account]');
      return !!(a && a.dataset.state) && !/正在看登录状态/.test((document.querySelector('[data-lt-gate]')||{}).textContent||'');
    })()`, 20000);
  const guest = await cdp.ev(`(() => ({
      gate: (document.querySelector('[data-lt-gate]')||{}).textContent||'',
      submitDisabled: !!(document.querySelector('[data-lt-submit]')||{}).disabled,
      titleDisabled: !!(document.querySelector('[data-lt-title]')||{}).disabled,
      accountState: (document.querySelector('[data-lt-account]')||{}).dataset ? document.querySelector('[data-lt-account]').dataset.state : '',
      boards: [...document.querySelectorAll('[data-lt-board] option')].map(o=>o.value),
    }))()`);
  info('访客看到的发帖页：' + JSON.stringify(guest));
  check('★ 账号区画出来了（不是一直停在「正在看登录状态…」）', guestPainted === true && guest.accountState === 'guest',
    `painted=${guestPainted} state=${guest.accountState}`);
  check('★ 没登录时发帖按钮是灰的（写也白写）', guest.submitDisabled === true);
  check('没登录时标题框也是灰的', guest.titleDisabled === true);
  check('页面说清楚了"要先登录、账号要过审"', /登录/.test(guest.gate) && !/正在看登录状态/.test(guest.gate), guest.gate.slice(0, 60));
  check('版块下拉里有版块表里的版块', (guest.boards ?? []).length > 0, JSON.stringify(guest.boards));

  /* ---- 第二趟：过审用户发一贴（先塞令牌，再进页面） ---- */
  await cdp.goto(`${base}/liyutang/`);
  await cdp.ev(`localStorage.setItem('lt_token','fake-token')`);
  await cdp.goto(`${base}/liyutang/new/?board=chat`);
  const ready = await cdp.wait(
    `(() => { const g=document.querySelector('[data-lt-gate]'); const b=document.querySelector('[data-lt-submit]');
       return g && b && !b.disabled && /测试者/.test(g.textContent); })()`
  );
  check('★ 过审账号进来之后表单解锁了（"你以 测试者 的身份发帖"）', ready === true, ready ? '' : '没等到解锁');
  const selectedBoard = await cdp.ev(`(document.querySelector('[data-lt-board]')||{}).value || ''`);
  check('地址里的 ?board=chat 被选中了（从版块页点"发帖"会带过来）', selectedBoard === 'chat', selectedBoard);

  await cdp.ev(`(() => {
      const t = document.querySelector('[data-lt-title]');
      const m = document.querySelector('[data-lt-md]');
      t.value = '浏览器里发的一贴';
      t.dispatchEvent(new Event('input', { bubbles: true }));
      m.value = '**粗体**和一行正文。\\n\\n- 甲\\n- 乙';
      m.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`);
  /* 顺手验一下预览：点一下"预览"，正文应该渲染成 HTML（而原文里没有 <strong>） */
  await cdp.ev(`[...document.querySelectorAll('[data-lt-cmd]')].find(b=>b.dataset.ltCmd==='preview').click()`);
  const preview = await cdp.ev(`(() => {
      const p = document.querySelector('[data-lt-preview]');
      return { hidden: p.hidden, html: p.innerHTML.slice(0,200), strong: !!p.querySelector('strong'), ul: !!p.querySelector('ul') };
    })()`);
  check('「预览」把 Markdown 渲染成了真的标签（粗体 / 列表）', preview.hidden === false && preview.strong && preview.ul,
    JSON.stringify({ strong: preview.strong, ul: preview.ul }));

  await cdp.ev(`document.querySelector('[data-lt-submit]').click()`);
  const jumped = await cdp.wait(`location.pathname === '/liyutang/post/' && /id=/.test(location.search)`, 15000);
  check('★ 点「发出去」→ 跳到帖子页', jumped === true, await cdp.ev('location.href'));
  check('★ 前端把该带的都发给后端了（事件 / 令牌 / 版块 / 标题 / 正文）',
    seen.create?.event === 'LT_POST_CREATE' && seen.create?.ltToken === 'fake-token' &&
      seen.create?.board === 'chat' && seen.create?.title === '浏览器里发的一贴' && /粗体/.test(String(seen.create?.md)),
    JSON.stringify({ event: seen.create?.event, board: seen.create?.board, title: seen.create?.title, token: seen.create?.ltToken }));

  /* ---- 第三趟：帖子页（正文是 XSS 载荷，看它会不会执行） ---- */
  const onPostPage = await cdp.wait(
    `(() => { const h=document.querySelector('[data-lt-post-title]'); return !!(h && h.textContent.indexOf('浏览器里发的一贴')===0); })()`,
    20000
  );
  check('★ 帖子页真的把那条帖子读出来了', onPostPage === true, await cdp.ev('location.href'));
  const postView = await cdp.ev(`(() => {
      const body = document.querySelector('[data-lt-post-body]');
      if (!body) return { missing: true };
      return {
        title: (document.querySelector('[data-lt-post-title]')||{}).textContent||'',
        strong: !!body.querySelector('strong'),
        ul: !!body.querySelector('ul'),
        img: body.querySelectorAll('img').length,
        script: body.querySelectorAll('script').length,
        literalImgText: /<img src=x/.test(body.textContent||''),
        xss: window.__xss === undefined ? 'no' : String(window.__xss),
        ownerBox: !document.querySelector('[data-lt-post-owner]').hidden,
        meta: (document.querySelector('[data-lt-post-meta]')||{}).textContent||'',
      };
    })()`);
  info('帖子页：' + JSON.stringify(postView));
  check('★ 帖子页把标题显示出来了', String(postView.title).startsWith('浏览器里发的一贴'), postView.title);
  check('正文渲染了 Markdown（粗体 / 列表）', postView.strong === true && postView.ul === true);
  check('作者那一行有时间 / 浏览数', /浏览/.test(postView.meta ?? ''), String(postView.meta).slice(0, 60));
  check('★ XSS 载荷没有执行（window.__xss 是空的）', postView.xss === 'no', String(postView.xss));
  check('★ XSS 载荷里的标签没有变成真标签（页面里 0 个 script，img 不是那个 x/onerror）',
    postView.script === 0 && postView.literalImgText === true,
    JSON.stringify({ script: postView.script, literal: postView.literalImgText, img: postView.img }));
  check('作者看到「改这贴 / 删掉」', postView.ownerBox === true);
  check('这一趟没有未捕获的 JS 异常',
    cdp.errors.filter((e) => /Uncaught|TypeError|ReferenceError/.test(e)).length === 0,
    cdp.errors.slice(0, 2).join(' | '));

  /* ---- 第四趟：论坛首页的「最新帖子」 ---- */
  await cdp.goto(`${base}/liyutang/`);
  await cdp.wait(`document.querySelectorAll('.lyt-post').length > 0`);
  const home = await cdp.ev(`(() => ({
      posts: document.querySelectorAll('.lyt-post').length,
      head: (document.querySelector('.lyt-posts__head')||{}).textContent||'',
      first: (document.querySelector('.lyt-post__title')||{}).textContent||'',
      noOldBlurb: !/不用注册任何账号/.test(document.body.innerText),
      composeLink: !!document.querySelector('a[href$="/liyutang/new/"]'),
    }))()`);
  info('论坛首页：' + JSON.stringify(home));
  check('★ 首页把用户发的帖子列出来了（最新帖子）', home.posts >= 1 && home.first.includes('浏览器里发的一贴'), JSON.stringify(home));
  check('★ 首页上那段"留言不用注册"的说明真的不在了', home.noOldBlurb === true);
  check('首页有「发帖」入口', home.composeLink === true);
} catch (err) {
  fail++;
  console.log('FAIL  浏览器那一段异常: ' + (err?.stack ?? err));
} finally {
  try {
    execSync(`taskkill /pid ${chrome.pid} /T /F`, { stdio: 'ignore' });
  } catch {
    /* 已退 */
  }
  server.close();
  await sleep(200);
  try {
    fs.rmSync(profile, { recursive: true, force: true });
  } catch {
    /* 忽略 */
  }
}

console.log(`\n==== ${pass} passed, ${fail} failed${skipped ? `, ${skipped} skipped` : ''} ====`);
process.exit(fail ? 1 : 0);
