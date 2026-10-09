/*
 * ============================================================================
 * 编码守卫：不许再有"UTF-8 被当 GBK 读、又存回 UTF-8"的乱码进仓库（2026-10-09 建）
 * ----------------------------------------------------------------------------
 * 为什么要有这个脚本：2026-10-09 晚上真的出过一次事故 ——
 *   PowerShell 5.1 的 `Get-Content <文件> -Raw` **不写 -Encoding 时按本机 ANSI(GBK) 解码**，
 *   于是「(Get-Content x.ts -Raw) -replace ... | Set-Content x.ts -Encoding utf8」
 *   把整份 UTF-8 源码变成乱码（GBK 解不了的字节还丢成 '?'、连换行一起吃掉），
 *   文件语法直接坏掉、全站构建失败。同样的写法以前也伤过别的文件（有的已经提交进仓库了）。
 *
 * 检测法（不需要任何码表文件，Node 自带 gbk 解码器，运行时把表反过来即可）：
 *   ① 把一行的字符按 GBK **编回字节**；
 *   ② 拿这些字节**按 UTF-8 严格解码**。
 *      · 正常中文：GBK 字节流几乎不可能是合法 UTF-8 → 严格解码失败 → 不是乱码；
 *      · 乱码：那些字符本来就是"UTF-8 字节被 GBK 解释"的产物，编回 GBK 正好还原原始 UTF-8 字节
 *        → 严格解码成功 → 判为乱码，而且**顺手就得到了修正后的原文**。
 *   ③ 丢过字节的行严格解码会失败，所以再放宽一档：允许极少量坏字节，
 *      但要求解出来的文字里"常用汉字"明显比原行多（乱码里全是生僻字组合，读不通）。
 *
 * 自检（本脚本自己跑，不靠人眼）：把一句正常中文**正向**弄成乱码（UTF-8 字节按 GBK 解释），
 * 检测器必须认出来；正常中文必须不被误判。自检不过就整体失败。
 *
 * 用法：
 *   node tools/checks/encoding-check.mjs              # 只报告（CI / 验收用）
 *   node tools/checks/encoding-check.mjs --fix        # 就地修好（只改判定的那几行）
 *   node tools/checks/encoding-check.mjs --fix --all  # 连 src 之外（tools/.github/README）也一起修
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIX = process.argv.includes('--fix');

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   :: ${detail}` : ''}`);
};

/* ---------------------------------------------------------------- GBK 编码表
   Node 自带 TextDecoder('gbk')（GBK 字节 → 字符）。我们缺的是反方向，
   所以运行时把 0x81~0xFE × 0x40~0xFE 全枚举一遍，反建成"字符 → GBK 字节"。
   约 2.4 万次，毫秒级；不落任何码表文件。 */
const gbkDec = new TextDecoder('gbk');
const GBK = new Map();
for (let b1 = 0x81; b1 <= 0xfe; b1 += 1) {
  for (let b2 = 0x40; b2 <= 0xfe; b2 += 1) {
    if (b2 === 0x7f) continue;
    const s = gbkDec.decode(new Uint8Array([b1, b2]));
    if (s.length === 1 && !GBK.has(s)) GBK.set(s, [b1, b2]);
  }
}
GBK.set('\u20ac', [0x80]); // GBK 里 0x80 就是欧元符
for (let b = 0; b < 0x80; b += 1) GBK.set(String.fromCharCode(b), [b]);

/** 字符 → GBK 字节；有任何一个字符不在 GBK 里就返回 null（那说明这行不是乱码产物） */
const gbkEncode = (s) => {
  const out = [];
  for (const ch of s) {
    const b = GBK.get(ch);
    if (!b) return null;
    out.push(...b);
  }
  return out;
};

/**
 * 宽松 UTF-8 解码：不合法的字节算"坏掉几个"（事故里就是被 GBK 解码器换成 '?' 的那几个字节）。
 * 返回 { text, bad }。
 */
const utf8Loose = (bytes) => {
  let text = '';
  let bad = 0;
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let need = 0;
    let cp = 0;
    if (b < 0x80) { text += String.fromCharCode(b); i += 1; continue; }
    if ((b & 0xe0) === 0xc0) { need = 1; cp = b & 0x1f; } else if ((b & 0xf0) === 0xe0) { need = 2; cp = b & 0x0f; } else if ((b & 0xf8) === 0xf0) { need = 3; cp = b & 0x07; } else { bad += 1; i += 1; continue; }
    let ok = true;
    const cont = [];
    for (let k = 1; k <= need; k += 1) {
      const c = bytes[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) { ok = false; break; }
      cont.push(c & 0x3f);
    }
    if (!ok) { bad += 1; i += 1; continue; }
    let v = cp;
    for (const c of cont) v = (v << 6) | c;
    /* 过短编码（overlong）、代理区、超出 Unicode 的都算坏字节 */
    const min = [0, 0x80, 0x800, 0x10000][need];
    if (v < min || v > 0x10ffff || (v >= 0xd800 && v <= 0xdfff)) { bad += 1; i += 1; continue; }
    text += String.fromCodePoint(v);
    i += need + 1;
  }
  return { text, bad };
};

/* 常用汉字（判断"读得通"的尺子）。乱码里几乎不会出现这些字，正常中文里满篇都是。 */
const COMMON = new Set('的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲萨伙遭盘爸扩盖弄雄稳忘亿刺拥徒姆杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱埃抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操耶阻订彩抽赞魔纷沿喊违妹浪汇币丰蓝殊献桌啦瓦莱援译夺汽烧托吕施灵活俩辉辈蜜疑氏孔沟腹诸脚');

/* ---------------------------------------------------------- 判定：这行是不是乱码 */
const cjkCount = (s) => {
  let n = 0;
  for (const ch of s) { const c = ch.codePointAt(0); if (c >= 0x4e00 && c <= 0x9fff) n += 1; }
  return n;
};
const commonCount = (s) => {
  let n = 0;
  for (const ch of s) if (COMMON.has(ch)) n += 1;
  return n;
};

/**
 * @returns {{fixed:string, bad:number}|null} 是乱码就返回修好的那一行，否则 null
 */
const mojibakeFix = (line) => {
  if (cjkCount(line) < 2) return null;          // 没有汉字，不可能（也不必）判
  const bytes = gbkEncode(line);
  if (!bytes) return null;                      // 有字符不在 GBK 里 → 不是这套事故的产物
  const { text, bad } = utf8Loose(bytes);
  if (text === line) return null;
  if (bad > 3) return null;                     // 丢得太多，这一档不判（同一文件里还有别的行会把它捞出来）
  if (commonCount(text) < 2) return null;        // 解出来还是读不通 → 不判
  if (commonCount(text) <= commonCount(line)) return null; // 解出来没更通顺 → 不判
  return { fixed: text, bad };
};

/**
 * 第二档（只在"这个文件已经被确认中招"之后才用）：
 * 丢掉字节的行按上面的尺子量不出来，但它们跟中招的行躺在同一个文件里 ——
 * 事故是**整份文件**被扫过，所以这时候放宽到"能编回 GBK + 解出来是中文 + 丢的不超过 20 字节"。
 */
const mojibakeFixLoose = (line) => {
  if (cjkCount(line) < 2) return null;
  const bytes = gbkEncode(line);
  if (!bytes) return null;
  const { text, bad } = utf8Loose(bytes);
  if (text === line || bad > 20) return null;
  if (cjkCount(text) < 2) return null;
  return { fixed: text, bad };
};

/**
 * 扫一段文本：先按严格档找；只要找到一行，就认为整份文件被扫过，
 * 再按放宽档把同文件里那些"丢过字节"的行也捞出来。
 * @returns {Array<{n:number,line:string,fixed:string,bad:number,relaxed:boolean}>}
 */
const scanText = (text) => {
  const lines = text.split(/\r?\n/);
  const hits = [];
  lines.forEach((l, i) => {
    const g = mojibakeFix(l);
    if (g) hits.push({ n: i + 1, line: l, ...g, relaxed: false });
  });
  if (!hits.length) return hits;
  const seen = new Set(hits.map((h) => h.n));
  lines.forEach((l, i) => {
    if (seen.has(i + 1)) return;
    const g = mojibakeFixLoose(l);
    if (g) hits.push({ n: i + 1, line: l, ...g, relaxed: true });
  });
  return hits.sort((a, b) => a.n - b.n);
};

/* ============================================================ 自检（必须先过） */
/* 事故的"正向"模型：UTF-8 字节按 GBK 解释；.NET 解码器遇到解不了的字节用 '?' 顶替
   （这正是事故里那些 '?' 的来历，也是它会把换行一起吃掉的原因）。 */
const forwardAccident = (s) => gbkDec.decode(new TextEncoder().encode(s)).replace(/\uFFFD/g, '?');

{
  /* 挑几句 UTF-8 字节在 GBK 里**全部合法**的样本 —— 这种事故产物一个字节都不丢，
     修回来必须与原文一模一样（精确到字）。 */
  const words = ['这是一句正常的中文', '编码守卫', '茶园画板', '中文测试', '用户原话', '长时间坐标与视野'];
  let lossless = 0;
  let exact = 0;
  for (const w of words) {
    const f = forwardAccident(w);
    if (!f.includes('?')) lossless += 1;
    const got = mojibakeFix(f);
    if (got && got.fixed === w) exact += 1;
  }
  check('自检：正常中文不被误判成乱码', words.every((w) => mojibakeFix(w) === null), words.join(' / '));
  check('自检：无损样本在这一步确实没丢字节', lossless === words.length, `${lossless}/${words.length}`);
  check('自检：事故产物必须被认出来，而且要精确修回原文', exact === words.length, `${exact}/${words.length} 句精确修回`);

  /* 丢过字节的那种（GBK 解不了的字节被换成 '?'）也要认得出来，只是原样修不回 100% */
  const lossy = forwardAccident('乱码检测');
  const got2 = mojibakeFix(lossy);
  check('自检：丢过字节的乱码也要认出来（允许修回的文字有缺）', !!got2, got2 ? JSON.stringify({ fixed: got2.fixed, bad: got2.bad }) : `没认出来：${JSON.stringify(lossy)}`);

  /* 整份"被事故扫过的文件"：一行承认不出，整段就都得跟着捞出来 */
  const whole = forwardAccident(['# 标题：茶园画板', '这是一句正常的中文', '乱码检测与坐标', 'const s = 1; // 代码行'].join('\n'));
  const hits = scanText(whole);
  check('自检：整段被扫过的文件要整段捞出来（含丢字节那几行）', hits.length >= 3, `${hits.length} 行：${hits.map((h) => h.line).join(' / ')}`);

  check('自检：随机英文/数字不被误判', mojibakeFix('const a = 1; // hello world') === null && mojibakeFix('') === null);
  check('自检：GBK 表反向建起来了', GBK.size > 20000, `${GBK.size} 个字符`);
}

/* ================================================================== 扫全树 */
const SKIP_DIR = /(\\|\/)(node_modules|\.git|dist|\.tmp|\.astro|\.vercel|_cache)(\\|\/)/;
const SKIP_FILE = /(\\|\/)(pnpm-lock\.yaml|package-lock\.json)$/;
const EXT = new Set(['.astro', '.ts', '.mjs', '.js', '.json', '.md', '.yml', '.yaml', '.css', '.html', '.txt', '.mts', '.cts']);
const ONLY_SRC = !process.argv.includes('--all');
const ROOTS = ONLY_SRC ? ['src'] : ['src', 'tools', '.github', 'README.md'];

const walk = (target, out) => {
  if (!fs.existsSync(target)) return out;
  const st = fs.statSync(target);
  if (st.isFile()) { out.push(target); return out; }
  for (const e of fs.readdirSync(target, { withFileTypes: true })) {
    const p = path.join(target, e.name);
    if (SKIP_DIR.test(p + path.sep) || SKIP_FILE.test(p)) continue;
    if (e.isDirectory()) walk(p, out);
    else if (EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
};

const files = [];
for (const r of ROOTS) walk(path.join(ROOT, r), files);

/*
 * 历史遗留的替换字符（U+FFFD）：`src/data/salon.json` 里 44 个，**2026-10-06 就已经提交进仓库**，
 * 混在群友写的正文里（"想要"后面跟三个 U+FFFD 这种），原始字已经无从考证 —— 那是用户的内容，
 * 不能替他猜字。所以这里把它记成一个**明确的、不许变大的**基数：
 *   · 只有这个文件、且不超过这个数，才算"已知遗留"；
 *   · 别的文件、或者数量涨了，一律失败；
 *   · 报出来的时候把位置列清楚，方便站长自己去补。
 */
const LEGACY_FFFD = { 'src/data/salon.json': 44 };

const offenders = [];
let scanned = 0;
let legacyFffd = 0;
let legacyFffdFiles = 0;
const legacyDetail = [];
let fixedLines = 0;
let fixedFiles = 0;

for (const f of files) {
  const buf = fs.readFileSync(f);
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  const text = buf.toString('utf8');
  scanned += 1;

  const fffd = (text.match(/\uFFFD/g) || []).length;
  if (fffd) {
    const base = LEGACY_FFFD[rel] || 0;
    if (fffd <= base) {
      legacyFffd += fffd;
      legacyFffdFiles += 1;
      for (let i = text.indexOf('\uFFFD'); i !== -1 && legacyDetail.length < 8; i = text.indexOf('\uFFFD', i + 1)) {
        const line = text.slice(0, i).split('\n').length;
        const tag = `${rel}:${line}`;
        if (legacyDetail.some((d) => d.startsWith(tag))) continue; /* 一个字坏掉会连着三个替换字符，按行去重 */
        legacyDetail.push(`${tag}  …${text.slice(Math.max(0, i - 24), i)}[U+FFFD]…`);
      }
    } else {
      offenders.push({ rel, line: 0, kind: `不是合法 UTF-8：替换字符 ${fffd} 个（已知遗留上限 ${base}）`, before: '', after: '' });
    }
  }

  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const hits = scanText(text);
  if (!hits.length) continue;
  fixedFiles += 1;
  fixedLines += hits.length;
  const lines = text.split(/\r?\n/);
  for (const h of hits) offenders.push({ rel, line: h.n, kind: h.relaxed ? `乱码（丢了 ${h.bad} 个字节，同文件连带）` : `乱码（丢了 ${h.bad} 个字节）`, before: h.line, after: h.fixed });
  if (FIX) {
    for (const h of hits) lines[h.n - 1] = h.fixed;
    fs.writeFileSync(f, lines.join(eol), 'utf8');
  }
}

/* ==================================================================== 报告 */
console.log('');
console.log(`扫描 ${scanned} 个文件（${ROOTS.join(' / ')}）`);
if (!offenders.length) {
  console.log('✓ 一个乱码行都没有。');
} else {
  const byFile = new Map();
  for (const o of offenders) byFile.set(o.rel, (byFile.get(o.rel) || 0) + 1);
  console.log(`✗ 命中 ${offenders.length} 行，分布在 ${byFile.size} 个文件：`);
  for (const [rel, n] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)} 行  ${rel}`);
  console.log('');
  for (const o of offenders.slice(0, 40)) {
    console.log(`  ${o.rel}:${o.line}  ${o.kind}`);
    if (o.before) console.log(`      现在: ${o.before.trim().slice(0, 120)}`);
    if (o.after) console.log(`      应为: ${o.after.trim().slice(0, 120)}`);
  }
  if (offenders.length > 40) console.log(`  …… 还有 ${offenders.length - 40} 行（报告只列前 40 行）`);
}

check('全树没有"UTF-8 被当 GBK 读"的乱码行', offenders.filter((o) => o.line > 0).length === 0, `${offenders.filter((o) => o.line > 0).length} 行 / ${fixedFiles} 个文件`);
check('替换字符（U+FFFD）没有冒出新的：只有已知遗留那份，而且没变多',
  offenders.every((o) => o.line > 0) && legacyFffd === 44 && legacyFffdFiles === 1,
  `已知遗留 ${legacyFffd} 个 / ${legacyFffdFiles} 个文件（上限 44，位于 src/data/salon.json）`);
if (legacyDetail.length) {
  console.log('      · 已知遗留（站长自己写的正文里，2026-10-06 就提交了；要补字得他自己来）：');
  for (const d of legacyDetail) console.log(`        ${d}`);
}
check('没有 BOM（BOM 会污染 diff、也会让某些工具读错）',
  files.every((f) => fs.readFileSync(f).slice(0, 3).toString('hex') !== 'efbbbf'),
  `${files.filter((f) => fs.readFileSync(f).slice(0, 3).toString('hex') === 'efbbbf').length} 个文件带 BOM`);

if (FIX) console.log(`\n--fix：改动 ${fixedLines} 行，涉及 ${fixedFiles} 个文件。`);
console.log(`\n==== ${pass} passed, ${fail} failed ====`);
process.exit(fail ? 1 : 0);
