/*
 * 往「眠鱼志」（/huaya/memory/mianyu）追加当天的栏目。
 *
 * ============================================================================
 * ⚠ 2026-09-28 换过地方，务必别改回去
 * ----------------------------------------------------------------------------
 * 用户最初的要求（2026-09-21 原话）：
 *   「从这次任务开始 你每次完成会话的时候 都生成一段简短易读的更新日志 发到
 *    /huaya/memory/update 也就是更新页面里面 像我一样每一天为一个栏目
 *    上下用分割线隔开 今天的工作内容就发在一个栏里 明天新写一个日期然后发新的内容这样操作」
 * 当时这个工具是往 `home-boards.json` 里「更新日志」那一页追加 text 块的。
 *
 * 2026-09-28 用户报了它的毛病（原话）：
 *   「更新日志里你写的内容不会同步进编辑器里 所以现在我没法操作」
 * —— 编辑器打开时会把整棵版块树读成草稿，用户一保存，助手刚写的几栏就被那份
 * 旧草稿覆盖掉了。两边都在写同一个文件，谁也说不清哪一份才算数。
 *
 * 所以现在日志单独放 `src/data/mianyu.json`，并且**搬去了「眠鱼志」那一页**：
 *   · 助手只写这一份（就是本工具）；
 *   · 编辑器保存版块树时碰不到它；
 *   · 页面上那块「助手日志」（page 里 type: "logs"）把这份数据画出来。
 * 更新日志那一页现在只剩两个子版块卡（眠鱼志 / 花涧堂更新），不再堆日志。
 *
 * 用法：
 *   node tools/memory/append-log.mjs <日期，如 2026.9.28> <正文文件路径> [--dry]
 *   正文文件就是这段日志的文字（第一行写不写日期都行，日期单独存一个字段）。
 *   想先看看会写成什么样、不动文件：加 --dry
 *
 * 同一天再写一次 = **就地覆盖**那一栏（一天永远只有一栏，不会堆出三个 9.28）。
 * 写回格式固定是 `JSON.stringify(data, null, 2) + '\n'`；盘上那份要是被人手动排过版，
 * 脚本会拒绝写 —— 宁可报错，也不要顺手把整份文件重排一遍（那样 diff 会糊成一片）。
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';

const [date, bodyFile, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry');
const FILE = path.resolve('src/data/mianyu.json');

if (!date || !bodyFile) {
  console.error('用法：node tools/memory/append-log.mjs <日期，如 2026.9.28> <正文文件路径> [--dry]');
  process.exit(2);
}
if (!/^20\d\d\.\d{1,2}\.\d{1,2}$/.test(date)) {
  console.error(`日期要写成 2026.9.28 这样（收到的是 ${JSON.stringify(date)}）`);
  process.exit(2);
}
if (!fs.existsSync(FILE)) {
  console.error(`找不到 ${FILE}（这个脚本要在站点根目录跑）`);
  process.exit(2);
}

/* 正文：文件里第一行如果就是日期就删掉，日期由脚本单独存 */
const lines = fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
if (lines[0] && lines[0].trim().startsWith(date)) lines.shift();
const BODY = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

const raw = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);
if (!Array.isArray(data.entries)) {
  console.error(`${FILE} 里没有 entries 数组，没动文件`);
  process.exit(2);
}

/** 这一天的栏目 id：log-20260928（和迁移那批生成的一致） */
const idOf = (d) => `log-${d.replace(/\./g, '')}`;
const mine = data.entries.findIndex((e) => String(e?.date ?? '') === date);

if (mine >= 0) {
  data.entries[mine].text = BODY;
  console.log(`「${date}」这一栏已经在了 → 就地覆盖（不会多出一个同一天的栏目）`);
} else {
  /* 追加在最后：眠鱼志是按时间从早到晚排的（和以前那一页一样） */
  data.entries.push({ id: idOf(date), date, text: BODY });
  console.log(`往「眠鱼志」尾部补了「${date}」这一栏`);
}
data.updated = date;

const out = `${JSON.stringify(data, null, 2)}\n`;
if (out === raw) {
  console.log('内容没有变化，文件没动');
  process.exit(0);
}
/* 先确认「原样重新序列化」和盘上那份逐字节一致，免得顺手把整份文件重排了 */
if (`${JSON.stringify(JSON.parse(raw), null, 2)}\n` !== raw) {
  console.error('盘上这份 mianyu.json 的缩进/换行和 JSON.stringify(null, 2) 对不上，'
    + '为免整份重排，先不写。手改过的话先把它按 2 空格缩进存一遍。');
  process.exit(3);
}
if (dry) {
  console.log('--dry：没有写文件。会写成这样 ——\n');
  console.log(`${date}\n${BODY}`);
  process.exit(0);
}
fs.writeFileSync(FILE, out, 'utf8');
console.log(`写好：眠鱼志现在 ${data.entries.length} 天（最后一栏 ${data.entries[data.entries.length - 1].date}）`);
