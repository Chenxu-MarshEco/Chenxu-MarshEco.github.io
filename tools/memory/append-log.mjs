/*
 * 往「更新日志」（/huaya/memory/update）追加当天的栏目。
 *
 * 用户的要求（2026-09-21 原话）：
 *   「从这次任务开始 你每次完成会话的时候 都生成一段简短易读的更新日志 发到
 *    /huaya/memory/update 也就是更新页面里面 像我一样每一天为一个栏目
 *    上下用分割线隔开 今天的工作内容就发在一个栏里 明天新写一个日期然后发新的内容这样操作」
 *
 * 这一页的数据 = src/data/home-boards.json 里 href = /huaya/memory/update 那个节点的
 * `page` 数组：一天 = 一个 text 块，块与块之间夹一个 divider 块。所以本脚本做的事就是
 * 「今天还没写过 → 补一个分割线 + 一个 text 块；今天已经写过了 → 就地覆盖它」，
 * 于是同一个日期永远只有一个栏目（一天里开了好几轮会话也不会堆出三个 9.21）。
 *
 * 用法：
 *   node tools/memory/append-log.mjs <日期，如 2026.9.21> <正文文件路径>
 *   正文文件就是这段日志的文字（第一行写不写日期都行，脚本会把日期放在最前面）。
 *   想先看看会写成什么样、不动文件：加 --dry
 *
 * 写回格式刻意和编辑器（tools/editor/server.mjs 里写 BOARDS_FILE 那一段）保持一致：
 * `JSON.stringify(data, null, 2) + '\n'`。盘上那份要是不长这样，脚本会拒绝写 ——
 * 宁可报错，也不要顺手把用户整个文件重排一遍（那样 diff 会糊成一片）。
 */
import fs from 'node:fs';
import path from 'node:path';

const [date, bodyFile, ...flags] = process.argv.slice(2);
const dry = flags.includes('--dry');
const FILE = path.resolve('src/data/home-boards.json');
const TARGET = '/huaya/memory/update';

if (!date || !bodyFile) {
  console.error('用法：node tools/memory/append-log.mjs <日期，如 2026.9.21> <正文文件路径> [--dry]');
  process.exit(2);
}
if (!fs.existsSync(FILE)) {
  console.error(`找不到 ${FILE}（这个脚本要在站点根目录跑）`);
  process.exit(2);
}

/* 正文：把文件里第一行如果就是日期就删掉，统一由脚本把日期放到最前面 */
const lines = fs.readFileSync(bodyFile, 'utf8').replace(/\r\n/g, '\n').trim().split('\n');
if (lines[0] && lines[0].trim().startsWith(date)) lines.shift();
const BODY = [`${date}`, ...lines].join('\n').replace(/\n{3,}/g, '\n\n').trim();

const raw = fs.readFileSync(FILE, 'utf8');
const data = JSON.parse(raw);

/** 深度找到那一页（href 完全匹配） */
const find = (nodes) => {
  for (const n of nodes ?? []) {
    if (n && n.href === TARGET) return n;
    const hit = find(n?.children);
    if (hit) return hit;
  }
  return null;
};
const node = find(data.boards);
if (!node) {
  console.error(`找不到 href = ${TARGET} 的节点，没动文件`);
  process.exit(2);
}
if (!Array.isArray(node.page)) node.page = [];

/** 新块的 id：和编辑器生成的那批一个长相（前缀 + 随机后缀），保证唯一 */
const stamp = () => `huaya-r1-1-pmu${Math.random().toString(36).slice(2, 9)}`;
const mine = node.page.find((b) => b.type === 'text' && String(b.text || '').startsWith(date));

if (mine) {
  mine.text = BODY;
  console.log(`「${date}」这一栏已经在了 → 就地覆盖（不会多出一个同一天的栏目）`);
} else {
  const last = node.page[node.page.length - 1];
  if (last && last.type !== 'divider') node.page.push({ id: stamp(), type: 'divider' });
  node.page.push({ id: stamp(), type: 'text', text: BODY });
  console.log(`往「更新日志」尾部补了：一个分割线 + 「${date}」这一栏`);
}

const out = `${JSON.stringify(data, null, 2)}\n`;
if (out === raw) {
  console.log('内容没有变化，文件没动');
  process.exit(0);
}
/* 先确认「原样重新序列化」和盘上那份逐字节一致，免得顺手把用户整个文件重排了 */
if (`${JSON.stringify(JSON.parse(raw), null, 2)}\n` !== raw) {
  console.error('盘上这份 home-boards.json 的缩进/换行和 JSON.stringify(null, 2) 对不上，'
    + '为免整份重排，先不写。请先在编辑器里存一次，让它按自己的格式落盘。');
  process.exit(3);
}
if (dry) {
  console.log('--dry：没有写文件。会写成这样 ——\n');
  console.log(BODY);
  process.exit(0);
}
fs.writeFileSync(FILE, out, 'utf8');
const days = node.page.filter((b) => b.type === 'text').length;
console.log(`写好：这一页现在 ${days} 个日期栏目、${node.page.length} 个块`);
