/**
 * 「涣愿终池 · 时刻」那一段的查重。
 *
 * 站长 2026-11-17 的原话：
 *   「时刻应该读取本网站所有已存在的时间轴并去重后显示 例如虹星的1.20原版开服这个时刻
 *    在花娅年代记和纷鸟衔来的记录里都存在 确认完全查重（名字 时间一致）后在7月8日那一天
 *    就只显示一个即可 而例如纷鸟衔来的记录里Raw家建成这种非主时间轴的小轴里的事件
 *    就需要加上时间轴前缀（举例：618大灭绝这种大事件 目前只在主轴里有 直接显示618大灭绝
 *    就算以后为脆骨症服单独建立时间轴了 发现花娅年代记主轴和脆骨症时间轴里都有618大灭绝查重
 *    则也只显示一个618大灭绝 而raw家建成这种小事件在很多个服里都会发生 目前只有纷鸟衔来的
 *    记录里有 那么就显示纷鸟衔来的记录·raw家建成 而以后要是在新的时间轴通讯期许的回声中
 *    raw家建成刚好也和这一天撞上了 虽然查重 但是在主轴里并不存在 只是分别存在于其他分轴
 *    那么久分别显示纷鸟衔来的记录·raw家建成 与通讯期许的回声·raw家建成」
 *
 * 拆成四条：
 *   ① 名字 + 时间**完全一致**才算同一条（差一个字、差一天都是两条）；
 *   ② 查出来是重复的，而**主轴**里有 → 只留一条，名字直接写事件名（不带轴前缀）；
 *   ③ 只有分轴里有的（小事件，重复发生在好几个服里）→ 一条轴给一条，写成「轴名·事件名」；
 *   ④ 几条分轴都有、但主轴里没有 → **每条分轴各显示一条**（都带自己的前缀），
 *      因为它们本来就不是同一件事。
 *
 * ⚠ 这个文件是**纯函数、没有别的依赖**：`tools/checks/cistern-check.mjs` 直接
 * `import()` 它跑那四种情形的用例（Node 24 能直接读 .ts），所以算法只有这一份，
 * 验收脚本里不许再抄一遍。
 */

/** 时间轴上的一个点，进池子之前的样子 */
export interface CisternPointRow {
  id: string;
  /** 轴的名字（「花娅年代记」这种，页面上的前缀就是它） */
  timeline: string;
  /** 那条轴的 id（判断是不是主轴、按轴分组都靠它） */
  timelineId: string;
  /** `YYYY-MM-DD` */
  date: string;
  /** 事件名 */
  label: string;
  /** moment 时刻 / event 事件（图标颜色跟着它走） */
  kind: string;
  /** 轴上那个点自己填的链接；空串 = 这个刻度本来就没写跳转，点了不动 */
  href: string;
}

/** 查重之后要显示的一条 */
export interface CisternPoint extends CisternPointRow {
  /** 名字前面要不要带「轴名·」（只有分轴独有的小事件才带） */
  showAxis: boolean;
}

/** 名字的比较口径：去首尾空格、把中间的换行 / 连续空格压成一个（页面上看起来一样就算一样） */
const normLabel = (s: string): string => String(s ?? '').trim().replace(/\s+/g, ' ');

/** 日期只认完整的 `YYYY-MM-DD`（`today` 那种实时点、难考据的点本来就进不来） */
const isDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? '').trim());

/** 一组重复里第一个填了链接的（同一条事，谁写了跳转就用谁的） */
const firstHref = (rows: CisternPointRow[]): string => rows.map((r) => r.href).find((h) => h) || '';

/**
 * 按上面的四条规则查重。
 *
 * @param rows   这条日子上、所有时间轴捞出来的全部点（顺序无所谓，输出保持"第一次出现"的顺序）
 * @param mainId 主轴（全站总轴）的 id；传空串就等于"没有主轴"，那时每条轴都带前缀
 */
export function dedupePoints(rows: CisternPointRow[], mainId = ''): CisternPoint[] {
  /* ① 按「日期 + 名字」分组 —— 这就是"完全查重"的口径 */
  const groups = new Map<string, CisternPointRow[]>();
  for (const row of rows) {
    const label = normLabel(row.label);
    const date = String(row.date ?? '').trim();
    if (!label || !isDay(date)) continue;
    const key = `${date}\u0000${label}`;
    const item: CisternPointRow = { ...row, date, label };
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const out: CisternPoint[] = [];
  for (const list of groups.values()) {
    /* ② 主轴里有 → 一条，不带前缀 */
    const main = mainId ? list.find((r) => r.timelineId === mainId) : undefined;
    if (main) {
      out.push({ ...main, href: main.href || firstHref(list), showAxis: false });
      continue;
    }
    /* ③④ 主轴里没有 → 按轴分开，每条轴一条，全都带前缀 */
    const byAxis = new Map<string, CisternPointRow[]>();
    for (const r of list) {
      const axis = r.timelineId || r.timeline;
      const bucket = byAxis.get(axis);
      if (bucket) bucket.push(r);
      else byAxis.set(axis, [r]);
    }
    for (const bucket of byAxis.values()) {
      out.push({ ...bucket[0], href: bucket[0].href || firstHref(bucket), showAxis: true });
    }
  }
  return out;
}
