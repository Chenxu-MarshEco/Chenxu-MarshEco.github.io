/**
 * ============================================================================
 * 站点上那些「介绍 / 说明」句子（2026-10-10 建）
 * ----------------------------------------------------------------------------
 * 用户原话（2026-10-10）：
 *   「红圈里这句话改为 …… 另外说了不要留任何这种ds味很浓的难以阅读的句子」
 *   「要清的都是这些编辑器里编辑不了且我之前也没有要求需要有这些句子存在的句子」
 *   「如果你无法判断就都把那种句子加上编辑器可以修改的接口」
 *
 * 于是有了这一份：页面里那些**写死、站长改不了**的介绍句，全都挪到
 * `src/data/site-copy.json`，编辑器「文案」面板里一格一句。
 *
 * 三条规矩（和黎语堂那份 copy 完全一样，别各来一套）：
 *   ① **留空 = 那一块整块不渲染**（不是渲染一个空盒子）—— 站长清掉哪句，页面上就干净了；
 *   ② 这里只放介绍 / 说明 / 空状态这类句子；**功能性短提示**（报错、登录闸门、「画太快了」）
 *      仍留在代码里（它们跟逻辑绑着，改了容易看不出问题）；
 *   ③ 用户自己写的东西（文章、手记、公告、板块名…）不在这儿 —— 那些本来就有编辑入口。
 *
 * 占位符：`{n}`（数字）、`{rss}`（订阅地址那个链接）在页面渲染时替换。
 * `fillCopy()` 是给整句替换用的；`splitCopy()` 是给"句子中间夹一个链接"用的
 * （比如「用任意 RSS 阅读器订阅 {rss} 就能跟进更新。」—— 前后两半 + 中间的 <a>）。
 * ============================================================================
 */
import raw from '../data/site-copy.json';

/** 这一份数据的形状（页面按组读，读不到的组当空对象，别有 undefined 炸掉构建） */
export interface SiteCopy {
  site: { tagline?: string; description?: string };
  home: { enter?: string; back?: string };
  about: { intro?: string; tech?: string; subscribe?: string };
  posts: { lead?: string };
  notes: { lead?: string };
  archive: { lead?: string };
  tags: { lead?: string };
  search: { lead?: string; noscript?: string };
  friends: { lead?: string; empty?: string };
  aboutMe: { empty?: string; noAvatar?: string };
  salon: { empty?: string };
  board: { childrenDone?: string };
  iceberg: { missingLink?: string };
  announce: { missingHref?: string };
}

/**
 * 读到的那一份文案。
 * ⚠ `_readme` 是给人看的说明，页面不读它；这里把它摘掉，只留各个组。
 */
const { _readme: _ignored, ...groups } = raw as unknown as SiteCopy & { _readme?: string[] };
void _ignored;

export const copy = groups as SiteCopy;

/**
 * 取一句文案、顺手规整：**全是空白就当空串**（页面按空串走"整块不渲染"那条路）。
 * @param v 原始值
 * @returns 规整后的句子（去首尾空白）
 */
export const text = (v: unknown): string => String(v ?? '').trim();

/**
 * 把 `{占位符}` 换成真的值。
 * 没给值的占位符原样留着（宁可看见 `{n}`，也别悄悄吃掉半个句子）。
 * @param tpl 带占位符的句子
 * @param vars 变量表
 * @returns 替换后的句子
 */
export const fillCopy = (tpl: unknown, vars: Record<string, string | number> = {}): string =>
  text(tpl).replace(/\{(\w+)\}/g, (all, key: string) => (key in vars ? String(vars[key]) : all));

/**
 * 把「前后两半 + 中间夹一个链接」的句子拆开（页面拿它拼 `<a>`）。
 * @param tpl 带 `token` 占位符的句子
 * @param token 占位符（例如 `'{rss}'`）
 * @returns `[前半, 后半]`；句子里没有这个占位符时，后半是空串
 */
export const splitCopy = (tpl: unknown, token: string): [string, string] => {
  const s = text(tpl);
  const i = s.indexOf(token);
  if (i < 0) return [s, ''];
  return [s.slice(0, i).trim(), s.slice(i + token.length).trim()];
};
