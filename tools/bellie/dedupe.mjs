/*
 * ============================================================================
 * 群圣经查重（2026-11-23 站长）
 * ----------------------------------------------------------------------------
 * 站长原话：
 *   「现在给群圣经自动录入系统加一个功能：查重 可以看到因为机器人并没有隔天的
 *    上下文记忆 所以可能会录入复读的重复圣经 应保证圣经的首发性 注意到11.22Raw
 *    说了梅莉家徒四壁…… 而11.23隰辰煦在复制此话发表吐槽时复制下来的一模一样的话
 *    被bot再次误录入 所以发现这种正文内容完全一样的两条圣经时 应直接删去后录入的
 *    只保留时间最早的一条」
 *
 * 所以规则只有一条：**正文完全一样（只差空白也算一样）→ 只留日期（+时间）最早的那条**，
 * 后录入的整条删掉（连它的评语一起）。不按人、不按评语判断 —— 换个成员复读同一句，
 * 归的仍然是**最早说这句话的那个人**那一条（署名、头像、成员计数都跟着它走）。
 *
 * 为什么抽成单独一份：构建期（`src/utils/bellie.ts`）和验收脚本都要用同一条规则，
 * 放在这里两边 import，免得"验的是另一套查重"。
 * ============================================================================
 */

/** 比正文用的归一化：换行 / 连续空格都折成一个空格，去掉首尾空白 */
export const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/** 排序键：日期 + 时间（没时间按 00:00 算，和页面排序一致） */
const timeKey = (e) => `${String(e?.date ?? '')} ${String(e?.time || '00:00')}`;

/**
 * 按正文去重，只保留最早的一条。
 *
 * @param {{ id?: string, date: string, time?: string, text: string }[]} entries
 * @returns {{ kept: any[], dropped: { kept: any, dropped: any }[] }}
 */
export function dedupeByText(entries) {
  const list = Array.from(entries ?? [])
    /* 稳定排序：同一刻的两条按传进来的先后（也就是列表里的先后）算 */
    .map((e, i) => ({ e, i }))
    .sort((a, b) => timeKey(a.e).localeCompare(timeKey(b.e)) || a.i - b.i)
    .map(({ e }) => e);

  const first = new Map();
  const kept = [];
  const dropped = [];
  for (const e of list) {
    const key = normText(e?.text);
    /* 正文是空的不参与查重（理论上不会有；真有也别把整页弄丢） */
    if (!key) {
      kept.push(e);
      continue;
    }
    if (first.has(key)) {
      dropped.push({ kept: first.get(key), dropped: e });
      continue;
    }
    first.set(key, e);
    kept.push(e);
  }
  return { kept, dropped };
}
