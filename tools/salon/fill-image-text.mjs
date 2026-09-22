/*
 * 把「文字只有 [图片]」的精华替换成图片文件名/元数据里写着的文字。
 *
 * 对应关系（一一对应，不猜）：
 *   · zip 里的文件名格式是 <编号>_<YYYYMMDD-HHMM>_<描述>.ext
 *   · 站点精华有 date + time，**按「日期+时间」对上**（实测 219 条全部唯一命中）
 *   · 同一分钟有多条 / 一条多图时：精华按 id 升序 ↔ zip 编号降序（编号是倒着编的：
 *     e0001↔792、e0002↔791、e0003↔790…实测连续 10 对都符合）
 *   · 文字优先取 zip 里 _chatshots.json / _chatkeep.json 的 lines（完整），
 *     文件名里那份是被长度截断过的，只当兜底
 *
 * 用法：node tools/salon/fill-image-text.mjs [zip路径] [--dry]
 *   zip 路径可以不传：默认用环境变量 SALON_ZIP，再默认到上次那一份。
 *   三个元数据 JSON（_chatshots.json / _chatkeep.json）是脚本自己从 zip 里解出来的，
 *   不依赖外面先解压。
 */
import fs from 'node:fs';
import zlib from 'node:zlib';

const args = process.argv.slice(2);
const DRY = args.includes('--dry');
const zipArg = args.find((a) => !a.startsWith('--'));
const ZIP = zipArg || process.env.SALON_ZIP ||
  String.raw`C:\Users\煦\.dsh\attachments\v1\files\14\14406c54d9b7672ebbd899bf8d4bc2ccd5fd3fd7109ed75fe969cc409cfdfce6\images.zip`;
const SALON = 'src/data/salon.json';

/** zip 中央目录里的每条记录 + 需要时按名字取内容（只认 deflate / stored） */
function openZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('这个 zip 读不了（找不到 EOCD）');
  let off = buf.readUInt32LE(eocd + 16);
  const total = buf.readUInt16LE(eocd + 10);
  const entries = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const size = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 46, off + 46 + nameLen);
    const name = flags & 0x800 ? raw.toString('utf8') : new TextDecoder('gbk').decode(raw);
    entries.push({ name, method, compSize, size, localOff: buf.readUInt32LE(off + 42) });
    off += 46 + nameLen + buf.readUInt16LE(off + 30) + buf.readUInt16LE(off + 32);
  }
  const read = (want) => {
    const e = entries.find((x) => x.name === want || x.name.endsWith(`/${want}`));
    if (!e) return null;
    const lo = e.localOff;
    const nameLen = buf.readUInt16LE(lo + 26);
    const extraLen = buf.readUInt16LE(lo + 28);
    const start = lo + 30 + nameLen + extraLen;
    const data = buf.subarray(start, start + e.compSize);
    const out = e.method === 0 ? data : zlib.inflateRawSync(data);
    return out.toString('utf8');
  };
  return { entries, read };
}

const zip = openZip(fs.readFileSync(ZIP));
const files = zip.entries
  .map((e) => e.name)
  .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n))
  .map((n) => {
    const base = n.split('/').pop();
    const m = /^(\d{1,4})_(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})_(.*)\.(jpe?g|png|webp|gif)$/i.exec(base);
    return m
      ? { base, no: Number(m[1]), noRaw: m[1], date: `${m[2]}-${m[3]}-${m[4]}`, time: `${m[5]}:${m[6]}`, desc: m[7], sub: n.includes('/对话/') ? '对话' : '图片' }
      : null;
  })
  .filter(Boolean);

const shots = JSON.parse(zip.read('_chatshots.json') ?? '{}');
const keep = JSON.parse(zip.read('_chatkeep.json') ?? '{}');

/** 这个编号对应的完整文字（优先 JSON lines，退回文件名；「无文本」就写「无文本」） */
function textOf(f) {
  const lines = (shots[f.noRaw]?.lines?.length ? shots[f.noRaw].lines : keep[f.noRaw]?.lines?.length ? keep[f.noRaw].lines : []) ?? [];
  if (lines.length) return { text: lines.join('\n'), from: 'json' };
  return { text: f.desc.split('｜').join('\n'), from: f.desc === '无文本' ? 'none' : 'filename' };
}

const raw = fs.readFileSync(SALON, 'utf8');
const salon = JSON.parse(raw);
const ess = salon.essences;

/* 两组：
   A. 文字**正好**是 [图片] 的（用户说的"仅有[图片]二字"）
   B. 文字只有一堆 [图片] 标记、一个字都没有的（比如一条精华挂了 6 张图 → "[图片]×6"）
   其余那些「[图片] 后面还跟着真文字」的一律不动（它们本来就搜得到）。 */
const targets = ess.filter((e) => String(e.text ?? '').trim() === '[图片]');
const markersOnly = ess.filter((e) => {
  const t = String(e.text ?? '');
  return t.includes('[图片]') && t.replace(/\[图片\]/g, '').trim() === '' && t.trim() !== '[图片]';
});
const byTime = new Map();
for (const f of files) {
  const k = `${f.date} ${f.time}`;
  byTime.set(k, [...(byTime.get(k) ?? []), f]);
}
const groups = new Map();
for (const e of targets) {
  const k = `${e.date} ${e.time}`;
  groups.set(k, [...(groups.get(k) ?? []), e]);
}

const plan = [];
const problems = [];
for (const [k, es] of groups) {
  const cands = (byTime.get(k) ?? []).slice().sort((a, b) => b.no - a.no);
  const sorted = es.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!cands.length) { problems.push(`${k}：${sorted.map((e) => e.id).join('/')} 在 zip 里找不到同一分钟的图`); continue; }
  if (cands.length !== sorted.length) problems.push(`${k}：精华 ${sorted.length} 条 vs 图 ${cands.length} 张（按顺序一一对上）`);
  sorted.forEach((e, i) => {
    const f = cands[Math.min(i, cands.length - 1)];
    plan.push({ e, f, ...textOf(f), group: 'A' });
  });
}
/* B 组：一条精华配它那一分钟里的所有图（按编号升序拼起来） */
for (const e of markersOnly) {
  const k = `${e.date} ${e.time}`;
  const cands = (byTime.get(k) ?? []).slice().sort((a, b) => a.no - b.no);
  if (!cands.length) { problems.push(`${k}：${e.id}（只有标记）在 zip 里找不到同一分钟的图`); continue; }
  const texts = cands.map((f) => textOf(f).text).filter((t) => t && t !== '无文本');
  const text = texts.length ? texts.join('\n\n') : '无文本';
  plan.push({ e, f: cands[0], text, from: texts.length ? 'json' : 'none', group: 'B', n: cands.length });
}

let n = 0;
const stat = { json: 0, filename: 0, none: 0 };
const changed = [];
for (const p of plan) {
  const before = String(p.e.text ?? '');
  if (before === p.text) continue;
  stat[p.from]++;
  changed.push({ id: p.e.id, date: p.e.date, time: p.e.time, no: p.f.noRaw, text: p.text, group: p.group, imgs: p.n });
}

console.log(`zip 图片 ${files.length} 张（去重编号 ${new Set(files.map((f) => f.noRaw)).size} 个）`);
console.log(`A 组"正好是 [图片]"：${targets.length} 条｜B 组"只有 [图片] 标记"：${markersOnly.length} 条（${markersOnly.map((e) => e.id).join(' ')}）`);
console.log(`配上：${plan.length} 条｜要改：${changed.length} 条`);
console.log(`文字来源：JSON lines ${stat.json}｜文件名 ${stat.filename}｜文件名写「无文本」 ${stat.none}`);
if (problems.length) {
  console.log(`\n需要留意（${problems.length} 条）：`);
  for (const p of problems.slice(0, 12)) console.log('  · ' + p);
}
console.log('\n样例：');
for (const c of changed.slice(0, 4)) console.log(`  ${c.id} ${c.date} ${c.time} ← 编号${c.no}：${JSON.stringify(c.text).slice(0, 120)}`);

if (DRY) {
  console.log('\n（--dry：没有写文件）');
  process.exit(0);
}

/* 写回：先确认盘上那份的格式就是 JSON.stringify(…, 2) + 换行，避免重排用户的文件 */
if (`${JSON.stringify(salon, null, 2)}\n` !== raw) {
  console.error('salon.json 的格式和 JSON.stringify(obj, null, 2) 对不上，先不写（避免整份重排）');
  process.exit(3);
}
const byId = new Map(changed.map((c) => [c.id, c]));
for (const e of ess) {
  const c = byId.get(e.id);
  if (c) e.text = c.text;
}
if (salon.updated) salon.updated = new Date().toISOString().slice(0, 19);
fs.writeFileSync(SALON, `${JSON.stringify(salon, null, 2)}\n`, 'utf8');
console.log(`\n写好：${changed.length} 条的 text 换掉了（其余字段一个字没动）`);
